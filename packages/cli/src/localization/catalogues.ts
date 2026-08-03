import { readFile, writeFile } from 'node:fs/promises'

import path from 'node:path'

export type FlatMessages = Record<string, string>

export const API_CATALOGUE_FILE = 'src/core/i18n/Catalogues.ts'
export const CLIENT_LOCALES_DIR = 'src/i18n/locales'

const API_MARKER = 'export const SERVER_CATALOGUES = '
const API_END = ' as const'
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u
// Matches the API project's Prettier `printWidth`. Entries whose single-line
// form exceeds this are wrapped with the value on its own indented line, which
// is exactly how Prettier renders the hand-maintained catalogue.
const PRINT_WIDTH = 100

interface ApiCatalogueSlice {
  start: number
  end: number
  text: string
}

async function apiSlice(apiRoot: string): Promise<ApiCatalogueSlice> {
  const file = path.join(apiRoot, API_CATALOGUE_FILE)
  const text = await readFile(file, 'utf8')
  const marker = text.indexOf(API_MARKER)
  if (marker < 0) throw new Error(`Could not find SERVER_CATALOGUES in ${file}.`)
  const start = marker + API_MARKER.length
  const end = text.indexOf(API_END, start)
  if (end < 0) throw new Error(`Could not find the end of SERVER_CATALOGUES in ${file}.`)

  return { start, end, text }
}

/**
 * Evaluate the data-only object literal from the API catalogue module.
 *
 * @param literal
 * @returns
 */
function evalObjectLiteral(literal: string): Record<string, FlatMessages> {
  // The catalogue is pure data (quoted keys, quoted string values) committed to
  // the buyer's own repository. It is not valid JSON (single quotes, unquoted
  // locale keys, trailing commas), so we evaluate the literal directly.
  const factory = new Function(`return (${literal})`) as () => Record<string, FlatMessages>

  return factory()
}

/**
 * Render a value as a single-quoted TypeScript string literal.
 *
 * @param value
 * @returns
 */
function tsString(value: string): string {
  const escaped = value
    .replace(/\\/gu, '\\\\')
    .replace(/'/gu, "\\'")
    .replace(/\n/gu, '\\n')
    .replace(/\r/gu, '\\r')
    .replace(/\t/gu, '\\t')

  return `'${escaped}'`
}

function tsKey(key: string): string {
  return IDENTIFIER.test(key) ? key : tsString(key)
}

function renderApiEntry(key: string, value: string): string {
  const keyLit = tsString(key)
  const valLit = tsString(value)
  const single = `    ${keyLit}: ${valLit},`

  return single.length > PRINT_WIDTH ? `    ${keyLit}:\n      ${valLit},` : single
}

function renderApiObject(locales: Record<string, FlatMessages>): string {
  const blocks = Object.entries(locales).map(([locale, messages]) => {
    const entries = Object.entries(messages)
      .map(([key, value]) => renderApiEntry(key, value))
      .join('\n')

    return `  ${tsKey(locale)}: {\n${entries}\n  },`
  })

  return `{\n${blocks.join('\n')}\n}`
}

export async function readApiCatalogue(apiRoot: string): Promise<Record<string, FlatMessages>> {
  const { start, end, text } = await apiSlice(apiRoot)

  return evalObjectLiteral(text.slice(start, end))
}

/**
 * Replace the SERVER_CATALOGUES object literal in place, preserving the file tail.
 *
 * @param apiRoot
 * @param locales
 */
export async function writeApiCatalogue(
  apiRoot: string,
  locales: Record<string, FlatMessages>,
): Promise<void> {
  const { start, end, text } = await apiSlice(apiRoot)
  const next = text.slice(0, start) + renderApiObject(locales) + text.slice(end)
  await writeFile(path.join(apiRoot, API_CATALOGUE_FILE), next, 'utf8')
}

// ---- client JSON catalogues ----

function clientLocaleFile(appRoot: string, locale: string): string {
  return path.join(appRoot, CLIENT_LOCALES_DIR, `${locale}.json`)
}

export async function readClientLocale(
  appRoot: string,
  locale: string,
): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(clientLocaleFile(appRoot, locale), 'utf8')) as Record<
      string,
      unknown
    >
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

export async function writeClientLocale(
  appRoot: string,
  locale: string,
  data: Record<string, unknown>,
  trailingNewline = false,
): Promise<void> {
  const body = JSON.stringify(data, null, 2)
  await writeFile(clientLocaleFile(appRoot, locale), trailingNewline ? `${body}\n` : body, 'utf8')
}

/**
 * Report whether the client locale file ends with a trailing newline, or `null`
 * when the file does not exist, so writes preserve the project's convention.
 */
export async function clientLocaleTrailingNewline(
  appRoot: string,
  locale: string,
): Promise<boolean | null> {
  try {
    return (await readFile(clientLocaleFile(appRoot, locale), 'utf8')).endsWith('\n')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Flatten a nested locale object into dotted keys, keeping string leaves only.
 *
 * @param source
 * @param prefix
 * @returns
 */
export function flatten(source: Record<string, unknown>, prefix = ''): FlatMessages {
  const flat: FlatMessages = {}
  for (const [key, value] of Object.entries(source)) {
    const path_ = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      flat[path_] = value
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(flat, flatten(value as Record<string, unknown>, path_))
    }
  }

  return flat
}

/**
 * Set a dotted path on a nested object, creating intermediate objects.
 *
 * @param target
 * @param dotted
 * @param value
 * @returns
 */
export function setPath(target: Record<string, unknown>, dotted: string, value: string): void {
  const segments = dotted.split('.')
  const last = segments.pop()
  if (last === undefined) return

  let node = target
  for (const segment of segments) {
    const existing = node[segment]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      node[segment] = {}
    }
    node = node[segment] as Record<string, unknown>
  }
  node[last] = value
}
