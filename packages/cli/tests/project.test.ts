import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'

import { detectHallOfFameProject } from '../src/project'
import os from 'node:os'
import path from 'node:path'

async function project(name: string, markers: string[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hof-'))
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name }))
  for (const marker of markers) {
    const file = path.join(root, marker)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, '')
  }

  return root
}

describe('Hall of Fame project detection', () => {
  it('detects API and app roots from their package and source markers', async () => {
    const api = await project('hallofame.ng.api', [
      'src/config/database.ts',
      'src/core/platform/ThemeDocument.ts',
    ])
    const app = await project('halloffame-react', [
      'vite.config.ts',
      'src/repository/types/app-config.ts',
    ])

    await expect(detectHallOfFameProject(api)).resolves.toMatchObject({
      kind: 'api',
      root: api,
    })
    await expect(detectHallOfFameProject(app)).resolves.toMatchObject({
      kind: 'app',
      root: app,
    })
  })

  it('rejects a non-Hall-of-Fame directory', async () => {
    const root = await project('another-project', [])

    await expect(detectHallOfFameProject(root)).rejects.toThrow('Hall of Fame API or app')
  })
})
