import { applyBundle, buildBundle } from '../src/localization/bundle'
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'

import os from 'node:os'
import path from 'node:path'
import { resolveProjectPair } from '../src/localization/pairing'

const CATALOGUE = `export const SERVER_CATALOGUES = {
  en: {
    'common.view': 'View',
    'common.cancel': 'Cancel',
    'mail.verification.body': 'Hello <b>{name}</b>,<br />\\n<br />\\n<a href="{link}">Go</a>',
  },
  es: {
    'common.view': 'Ver',
  },
} as const

export type ServerLocale = keyof typeof SERVER_CATALOGUES
export type ServerMessageKey = keyof (typeof SERVER_CATALOGUES)['en']
`

async function fixtures() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'hof-i18n-'))

  const api = path.join(parent, 'hallofame.ng.api')
  await mkdir(path.join(api, 'src/config'), { recursive: true })
  await mkdir(path.join(api, 'src/core/platform'), { recursive: true })
  await mkdir(path.join(api, 'src/core/i18n'), { recursive: true })
  await writeFile(path.join(api, 'package.json'), JSON.stringify({ name: 'hallofame.ng.api' }))
  await writeFile(path.join(api, 'src/config/database.ts'), '')
  await writeFile(path.join(api, 'src/core/platform/ThemeDocument.ts'), '')
  await writeFile(path.join(api, 'src/core/i18n/Catalogues.ts'), CATALOGUE)

  const app = path.join(parent, 'halloffame.ng.react')
  await mkdir(path.join(app, 'src/repository/types'), { recursive: true })
  await mkdir(path.join(app, 'src/i18n/locales'), { recursive: true })
  await writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'halloffame-react' }))
  await writeFile(path.join(app, 'vite.config.ts'), '')
  await writeFile(path.join(app, 'src/repository/types/app-config.ts'), '')
  await writeFile(
    path.join(app, 'src/i18n/locales/en.json'),
    `${JSON.stringify({ common: { view: 'View', save: 'Save' }, nav: { home: 'Home' } }, null, 2)}\n`,
  )
  await writeFile(
    path.join(app, 'src/i18n/locales/es.json'),
    `${JSON.stringify({ common: { view: 'Ver' } }, null, 2)}\n`,
  )

  return { parent, api, app, pair: { api, app } }
}

describe('localization round-trip', () => {
  it('locates the paired project from either root', async () => {
    const { api, app } = await fixtures()

    await expect(
      resolveProjectPair({ kind: 'api', name: 'hallofame.ng.api', root: api }),
    ).resolves.toEqual({ api, app })
    await expect(
      resolveProjectPair({ kind: 'app', name: 'halloffame-react', root: app }),
    ).resolves.toEqual({ api, app })
  })

  it('exports source and existing target copy for both sides', async () => {
    const { pair } = await fixtures()

    const bundle = await buildBundle(pair, 'es')

    expect(bundle.sourceLocale).toBe('en')
    expect(bundle.targetLocale).toBe('es')
    // API: every en key present; existing es carried, missing ones blank.
    expect(bundle.api['common.view']).toEqual({ source: 'View', target: 'Ver' })
    expect(bundle.api['common.cancel']).toEqual({ source: 'Cancel', target: '' })
    // The mail body decodes its escape sequences to a real newline.
    expect(bundle.api['mail.verification.body']!.source).toContain('\n')
    // Client: nested keys flattened with dotted paths.
    expect(bundle.client['common.view']).toEqual({ source: 'View', target: 'Ver' })
    expect(bundle.client['common.save']).toEqual({ source: 'Save', target: '' })
    expect(bundle.client['nav.home']).toEqual({ source: 'Home', target: '' })
  })

  it('refuses to export the source locale', async () => {
    const { pair } = await fixtures()

    await expect(buildBundle(pair, 'en')).rejects.toThrow(/differ from the source/u)
  })

  it('rewrites the API catalogue byte-for-byte on a no-op apply', async () => {
    const { pair, api } = await fixtures()
    const before = await readFile(path.join(api, 'src/core/i18n/Catalogues.ts'), 'utf8')

    const bundle = await buildBundle(pair, 'es')
    await applyBundle(pair, bundle)

    const after = await readFile(path.join(api, 'src/core/i18n/Catalogues.ts'), 'utf8')
    expect(after).toBe(before)
  })

  it('applies edited targets into both catalogues and preserves the file tail', async () => {
    const { pair, api, app } = await fixtures()

    const bundle = await buildBundle(pair, 'es')
    bundle.api['common.cancel']!.target = 'Cancelar'
    bundle.client['common.save']!.target = 'Guardar'
    bundle.client['nav.home']!.target = 'Inicio'
    // An empty target must not blank an existing translation or add a key.
    bundle.client['common.view']!.target = ''

    // Every non-empty target is written: existing 'Ver' plus the new 'Cancelar'
    // on the API side; 'Guardar' and 'Inicio' on the client side.
    const result = await applyBundle(pair, bundle)
    expect(result).toEqual({ targetLocale: 'es', api: 2, client: 2 })

    const catalogue = await readFile(path.join(api, 'src/core/i18n/Catalogues.ts'), 'utf8')
    expect(catalogue).toContain("'common.cancel': 'Cancelar',")
    expect(catalogue).toContain('export type ServerMessageKey')

    const es = JSON.parse(await readFile(path.join(app, 'src/i18n/locales/es.json'), 'utf8'))
    expect(es).toEqual({ common: { view: 'Ver', save: 'Guardar' }, nav: { home: 'Inicio' } })
  })

  it('rejects a bundle with an unsupported schema version', async () => {
    const { pair } = await fixtures()
    const bundle = await buildBundle(pair, 'es')

    await expect(applyBundle(pair, { ...bundle, schemaVersion: 2 as 1 })).rejects.toThrow(
      /schema version/u,
    )
  })
})
