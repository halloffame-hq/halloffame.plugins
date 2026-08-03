import {
  type LocalizationBundle,
  applyBundle,
  bundleStats,
  buildBundle,
} from '../localization/bundle'

import { Application } from '../Application'
import { Command } from '@h3ravel/musket'
import type { SignatureBuilder } from '@h3ravel/musket'
import { readFile, writeFile } from 'node:fs/promises'
import { ProjectPair, resolveProjectPair } from '../localization/pairing'
import path from 'node:path'

export class LocalizeCommand extends Command<Application> {
  buildSignature(sig: SignatureBuilder) {
    return sig
      .command('localize')
      .describe('Export and apply a combined localization bundle for API and client copy')
      .argument('action', {
        description: 'export or apply',
        required: false,
        choices: ['export', 'apply'],
      })
      .option('locale', {
        short: 'L',
        description: 'Target locale, for example es',
        requiresValue: true,
      })
      .option('file', {
        short: 'F',
        description: 'Bundle file path',
        requiresValue: true,
      })
      .option('api-root', {
        description: 'Path to the Hall of Fame API project',
        requiresValue: true,
      })
      .option('app-root', {
        description: 'Path to the Hall of Fame app project',
        requiresValue: true,
      })
      .option('force', {
        description: 'Apply without confirmation',
      })
  }

  async handle(): Promise<void> {
    const project = this.app.project
    this.info(`Detected Hall of Fame ${project.kind} project at ${project.root}.`)

    const pair = await resolveProjectPair(project, {
      api: this.option('api-root'),
      app: this.option('app-root'),
    })

    this.info(`Using API project ${pair.api}`)
    this.info(`Using app project ${pair.app}`)

    const action =
      this.argument('action') ??
      (await this.choice('What would you like to do?', [
        { name: 'Export a localization bundle to edit', value: 'export' },
        { name: 'Apply an edited localization bundle', value: 'apply' },
      ]))

    if (action === 'export') {
      await this.export(pair)
    } else if (action === 'apply') {
      await this.apply(pair)
    } else {
      this.fail(`Unknown action "${action}". Use "export" or "apply".`)
    }
  }

  private async export(pair: ProjectPair): Promise<void> {
    const locale = ((this.option('locale') as string) || (await this.ask('Target locale', 'es')))
      .trim()
      .toLowerCase()

    const file = path.resolve(
      (this.option('file') as string) ||
        (await this.ask('Bundle file', `localization-${locale}.json`)),
    )

    const spinner = this.spinner(`Building ${locale} bundle...`)
    const bundle = await buildBundle(pair, locale)

    await writeFile(file, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
    spinner.succeed(`Wrote ${file}`)

    const stats = bundleStats(bundle)

    this.info(
      `API: ${stats.api.translated}/${stats.api.total} translated (${stats.api.missing} missing).`,
    )

    this.info(
      `Client: ${stats.client.translated}/${stats.client.total} translated (${stats.client.missing} missing).`,
    )

    this.success(
      `Edit the target values, then run "hof localize apply --file ${path.basename(file)}".`,
    )
  }

  private async apply(pair: ProjectPair): Promise<void> {
    const file = path.resolve(
      (this.option('file') as string) || (await this.ask('Bundle file', 'localization.json')),
    )

    let bundle: LocalizationBundle
    try {
      bundle = JSON.parse(await readFile(file, 'utf8'))
    } catch (error) {
      this.fail(`Could not read bundle ${file}: ${error instanceof Error ? error.message : error}`)

      return
    }

    const stats = bundleStats(bundle)
    this.info(
      `Applying ${bundle.targetLocale}: ${stats.api.translated} API and ${stats.client.translated} client strings.`,
    )

    const force = Boolean(this.option('force'))
    if (!force && !(await this.confirm('Write these translations into both catalogues?', true))) {
      this.info('Cancelled.')

      return
    }

    const spinner = this.spinner(`Applying ${bundle.targetLocale} translations...`)
    const result = await applyBundle(pair, bundle)

    spinner.succeed(
      `Applied ${result.api} API and ${result.client} client ${result.targetLocale} strings.`,
    )
  }
}
