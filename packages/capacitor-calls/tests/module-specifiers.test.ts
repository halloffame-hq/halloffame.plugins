import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/*
 * TypeScript copies a relative specifier into the emitted ESM exactly as it was written, and Node
 * refuses one with no extension. A bundler hides that, so the host application typechecks, builds
 * and runs, and only its server render and its test run fail to resolve the plugin at all.
 */
describe('the emitted module graph', () => {
  const files = readdirSync(source).filter((name) => name.endsWith('.ts'))

  it('has sources to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('gives every relative import in %s a .js extension', (name) => {
    const specifiers = [
      ...readFileSync(join(source, name), 'utf8').matchAll(/\bfrom\s+'(\.[^']*)'/g),
    ].map(([, specifier]) => specifier)

    for (const specifier of specifiers) expect(specifier).toMatch(/\.js$/)
  })
})
