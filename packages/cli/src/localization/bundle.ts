import {
  type FlatMessages,
  clientLocaleTrailingNewline,
  flatten,
  readApiCatalogue,
  readClientLocale,
  setPath,
  writeApiCatalogue,
  writeClientLocale,
} from './catalogues'

import type { ProjectPair } from './pairing'

export const SOURCE_LOCALE = 'en'
export const BUNDLE_SCHEMA_VERSION = 1

export interface BundleEntry {
  source: string
  target: string
}

export interface LocalizationBundle {
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION
  sourceLocale: string
  targetLocale: string
  generatedAt: string
  api: Record<string, BundleEntry>
  client: Record<string, BundleEntry>
}

export interface SideStats {
  total: number
  translated: number
  missing: number
}

export interface BundleStats {
  api: SideStats
  client: SideStats
}

function pairEntries(source: FlatMessages, target: FlatMessages): Record<string, BundleEntry> {
  const entries: Record<string, BundleEntry> = {}
  for (const [key, value] of Object.entries(source)) {
    entries[key] = { source: value, target: target[key] ?? '' }
  }

  return entries
}

function sideStats(entries: Record<string, BundleEntry>): SideStats {
  const values = Object.values(entries)
  const translated = values.filter((entry) => entry.target.trim().length > 0).length

  return { total: values.length, translated, missing: values.length - translated }
}

export function bundleStats(bundle: LocalizationBundle): BundleStats {
  return { api: sideStats(bundle.api), client: sideStats(bundle.client) }
}

/** Build a combined export bundle for the given target locale from both catalogues. */
export async function buildBundle(
  pair: ProjectPair,
  targetLocale: string,
): Promise<LocalizationBundle> {
  if (targetLocale === SOURCE_LOCALE) {
    throw new Error(`The target locale must differ from the source locale "${SOURCE_LOCALE}".`)
  }

  const apiLocales = await readApiCatalogue(pair.api)
  const apiSource = apiLocales[SOURCE_LOCALE]
  if (!apiSource) {
    throw new Error(`The API catalogue is missing the source locale "${SOURCE_LOCALE}".`)
  }

  const clientSource = flatten(await readClientLocale(pair.app, SOURCE_LOCALE))

  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    sourceLocale: SOURCE_LOCALE,
    targetLocale,
    generatedAt: new Date().toISOString(),
    api: pairEntries(apiSource, apiLocales[targetLocale] ?? {}),
    client: pairEntries(clientSource, flatten(await readClientLocale(pair.app, targetLocale))),
  }
}

function assertBundle(bundle: LocalizationBundle): void {
  if (bundle.schemaVersion !== BUNDLE_SCHEMA_VERSION) {
    throw new Error(`Unsupported bundle schema version: ${String(bundle.schemaVersion)}.`)
  }
  if (bundle.sourceLocale !== SOURCE_LOCALE) {
    throw new Error(`The bundle source locale must be "${SOURCE_LOCALE}".`)
  }
  if (!bundle.targetLocale || bundle.targetLocale === SOURCE_LOCALE) {
    throw new Error('The bundle is missing a valid target locale.')
  }
}

export interface ApplyResult {
  targetLocale: string
  api: number
  client: number
}

/**
 * Apply an edited bundle back into both catalogues. The merge is additive:
 * non-empty targets are written and every other existing translation is left in
 * place, so an untranslated entry falls back to the source locale at runtime.
 */
export async function applyBundle(
  pair: ProjectPair,
  bundle: LocalizationBundle,
): Promise<ApplyResult> {
  assertBundle(bundle)
  const { targetLocale } = bundle

  // API side: merge into the existing locale map, preserving other locales.
  const apiLocales = await readApiCatalogue(pair.api)
  const apiTarget: FlatMessages = { ...(apiLocales[targetLocale] ?? {}) }
  let apiApplied = 0
  for (const [key, entry] of Object.entries(bundle.api)) {
    if (entry.target.trim().length === 0) continue
    apiTarget[key] = entry.target
    apiApplied += 1
  }
  apiLocales[targetLocale] = apiTarget
  await writeApiCatalogue(pair.api, apiLocales)

  // Client side: merge into the existing nested locale document, preserving the
  // target file's trailing-newline convention (falling back to the source's).
  const clientDocument = await readClientLocale(pair.app, targetLocale)
  let clientApplied = 0
  for (const [key, entry] of Object.entries(bundle.client)) {
    if (entry.target.trim().length === 0) continue
    setPath(clientDocument, key, entry.target)
    clientApplied += 1
  }
  const trailingNewline =
    (await clientLocaleTrailingNewline(pair.app, targetLocale)) ??
    (await clientLocaleTrailingNewline(pair.app, SOURCE_LOCALE)) ??
    false
  await writeClientLocale(pair.app, targetLocale, clientDocument, trailingNewline)

  return { targetLocale, api: apiApplied, client: clientApplied }
}
