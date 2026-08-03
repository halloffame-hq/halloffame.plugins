import { access, mkdir, writeFile } from 'node:fs/promises'

import type { DeploymentFile, DeploymentRoot } from './templates'
import type { DeploymentSettings } from './settings'
import path from 'node:path'

export interface WriteResult {
  written: string[]
  skipped: string[]
}

/** Absolute base directory for each destination root. */
export type RootDirs = Record<DeploymentRoot, string>

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)

    return true
  } catch {
    return false
  }
}

const toPosix = (value: string): string => value.split(path.sep).join('/')

/**
 * Resolve the Compose build contexts (relative to the output directory) that
 * point at each project root on this machine.
 */
export function resolveContexts(
  outDir: string,
  pair: { api: string; app: string },
): Pick<DeploymentSettings, 'apiContext' | 'webContext'> {
  return {
    apiContext: toPosix(path.relative(outDir, pair.api)),
    webContext: toPosix(path.relative(outDir, pair.app)),
  }
}

/**
 * Write the generated files to their destination roots, skipping existing ones
 * unless `force` is set. Returned paths are prefixed with their root so the
 * caller can report where each file landed.
 */
export async function writeDeploymentFiles(
  roots: RootDirs,
  files: DeploymentFile[],
  force = false,
): Promise<WriteResult> {
  const written: string[] = []
  const skipped: string[] = []

  for (const file of files) {
    const label = file.root === 'out' ? file.path : `${file.root}:${file.path}`
    const dest = path.join(roots[file.root], file.path)
    if (!force && (await exists(dest))) {
      skipped.push(label)
      continue
    }
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, file.content, 'utf8')
    written.push(label)
  }

  return { written, skipped }
}
