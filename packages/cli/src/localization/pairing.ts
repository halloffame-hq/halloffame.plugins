import type { HallOfFameProject, ProjectKind } from '../types'

import { detectHallOfFameProject } from '../project'
import path from 'node:path'
import { readdir } from 'node:fs/promises'

export interface ProjectPair {
  api: string
  app: string
}

export interface PairOverride {
  api?: string
  app?: string
}

async function tryDetect(dir: string): Promise<HallOfFameProject | null> {
  try {
    return await detectHallOfFameProject(dir)
  } catch {
    return null
  }
}

/**
 * Resolve both the API and app project roots. The localization round-trip needs
 * to touch both catalogues, so given one detected project we locate its
 * counterpart. An explicit override wins; otherwise we scan sibling directories
 * for a project of the opposite kind.
 *
 * @param project
 * @param override
 * @returns
 */
export async function resolveProjectPair(
  project: HallOfFameProject,
  override: PairOverride = {},
): Promise<ProjectPair> {
  const roots: Partial<Record<ProjectKind, string>> = { [project.kind]: project.root }
  const counterpart: ProjectKind = project.kind === 'api' ? 'app' : 'api'

  const explicit = override[counterpart]

  if (explicit) {
    const detected = await detectHallOfFameProject(explicit)

    if (detected.kind !== counterpart) {
      throw new Error(`Expected a Hall of Fame ${counterpart} project at ${explicit}.`)
    }
    roots[counterpart] = detected.root
  } else {
    const parent = path.dirname(project.root)
    const entries = await readdir(parent, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(parent, entry.name)

      if (candidate === project.root) continue
      const detected = await tryDetect(candidate)

      if (detected?.kind === counterpart) {
        roots[counterpart] = detected.root
        break
      }
    }
  }

  if (!roots.api || !roots.app) {
    throw new Error(
      `Could not locate the paired Hall of Fame ${counterpart} project next to ${project.root}. ` +
        `Pass --${counterpart}-root to point at it.`,
    )
  }

  return { api: roots.api, app: roots.app }
}
