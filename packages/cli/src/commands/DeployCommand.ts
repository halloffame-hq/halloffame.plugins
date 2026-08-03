import {
  type DeployTarget,
  DEPLOY_TARGETS,
  buildDeploymentFiles,
  resolveDeployTargets,
} from '../deployment/templates'
import {
  type DeploymentSettings,
  type PackageManager,
  readDeploymentDefaults,
  slugify,
} from '../deployment/settings'
import { resolveContexts, writeDeploymentFiles } from '../deployment/generate'

import { Application } from '../Application'
import { Command } from '@h3ravel/musket'
import type { SignatureBuilder } from '@h3ravel/musket'
import path from 'node:path'
import { resolveProjectPair } from '../localization/pairing'

const NODE_VERSIONS = ['22', '24', '25']
const PACKAGE_MANAGERS: PackageManager[] = ['pnpm', 'npm', 'yarn']
const TARGET_CHOICES = [
  { name: 'Docker (compose + images)', value: 'docker' },
  { name: 'nginx (bare-metal reverse proxy)', value: 'nginx' },
  { name: 'Apache (.htaccess)', value: 'apache' },
  { name: 'pm2 (process manager)', value: 'pm2' },
]

export class DeployCommand extends Command<Application> {
  buildSignature(sig: SignatureBuilder) {
    return sig
      .command('deploy')
      .describe('Generate Docker, nginx, Apache, and pm2 deployment resources')
      .argument('environment', {
        description:
          'Targets to generate: all, docker, nginx, apache, pm2 (space or comma separated)',
        required: false,
        multiple: true,
        choices: ['all', 'docker', 'nginx', 'apache', 'pm2'],
      })
      .option('out', {
        description: 'Output directory',
        requiresValue: true,
      })
      .option('domain', {
        description: 'Root domain, e.g. example.com',
        requiresValue: true,
      })
      .option('web-domain', {
        description: 'Client app host',
        requiresValue: true,
      })
      .option('api-domain', {
        description: 'API host',
        requiresValue: true,
      })
      .option('port', {
        description: 'API port',
        requiresValue: true,
      })
      .option('node', {
        description: 'Node major version',
        requiresValue: true,
      })
      .option('pm', {
        description: 'Package manager (pnpm, npm, yarn)',
        requiresValue: true,
        choices: ['pnpm', 'npm', 'yarn'],
      })
      .option('api-root', {
        description: 'Path to the Hall of Fame API project',
        requiresValue: true,
      })
      .option('app-root', {
        description: 'Path to the Hall of Fame app project',
        requiresValue: true,
      })
      .option('skip-redis', {
        description: 'Exclude Redis from the compose file',
      })
      .option('force', {
        description: 'Overwrite existing files',
      })
      .option('yes', {
        short: 'y',
        description: 'Accept defaults without prompting',
      })
  }

  async handle(): Promise<void> {
    const project = this.app.project
    this.info(`Detected Hall of Fame ${project.kind} project at ${project.root}.`)

    const pair = await resolveProjectPair(project, {
      api: this.option('api-root'),
      app: this.option('app-root'),
    })

    const defaults = await readDeploymentDefaults(pair)
    const yes = Boolean(this.option('yes'))

    const targets = await this.resolveTargets(yes)
    this.info(`Targets: ${targets.join(', ')}`)
    const wants = (target: DeployTarget): boolean => targets.includes(target)
    const wantsBuild = wants('docker') || wants('nginx') || wants('pm2')

    const outDir = path.resolve(
      (this.option('out') as string) ||
      (yes ? 'deploy' : await this.ask('Output directory', 'deploy')),
    )

    // Only the nginx host config needs the public domains.
    const askDomains = !yes && wants('nginx')
    const tenantRootDomain = await this.value(
      'domain',
      'Root domain',
      defaults.tenantRootDomain,
      askDomains,
    )

    const webDomain = await this.value(
      'web-domain',
      'Client app host',
      defaults.webDomain,
      askDomains,
    )

    const apiDomain = await this.value('api-domain', 'API host', defaults.apiDomain, askDomains)
    const apiPort = Number(
      await this.value('port', 'API port', String(defaults.apiPort), !yes && wantsBuild),
    )

    const nodeVersion = await this.pick(
      'node',
      'Node version',
      NODE_VERSIONS,
      !yes && wants('docker'),
    )

    const packageManager = (await this.pick(
      'pm',
      'Package manager',
      PACKAGE_MANAGERS,
      !yes && wantsBuild,
    )) as PackageManager

    const includeRedis = wants('docker')
      ? this.option('skip-redis')
        ? false
        : yes || (await this.confirm('Include Redis in the compose file?', true))
      : false

    const settings: DeploymentSettings = {
      appName: defaults.appName,
      slug: slugify(defaults.appName),
      webDomain,
      apiDomain,
      tenantRootDomain,
      apiPort: Number.isFinite(apiPort) ? apiPort : defaults.apiPort,
      nodeVersion,
      packageManager,
      includeRedis,
      queues: defaults.queues,
      dbName: defaults.dbName,
      dbUser: defaults.dbUser,
      ...resolveContexts(outDir, pair),
    }

    const files = buildDeploymentFiles(settings, targets)
    const spinner = this.spinner(`Generating deployment resources in ${outDir}...`)
    const result = await writeDeploymentFiles(
      { out: outDir, api: pair.api, app: pair.app },
      files,
      Boolean(this.option('force')),
    )

    spinner.succeed(`Wrote ${result.written.length} file(s)`)

    for (const file of result.written) this.info(`  + ${file}`)
    if (result.skipped.length > 0) {
      this.warn(`Skipped ${result.skipped.length} existing file(s); pass --force to overwrite:`)
      for (const file of result.skipped) this.warn(`  - ${file}`)
    }

    this.success('Review the generated files, then follow README.md to deploy.')
  }

  private async resolveTargets(yes: boolean): Promise<DeployTarget[]> {
    const raw = this.argument('environment') as string | string[] | undefined
    const requested = Array.isArray(raw) ? raw : raw ? [raw] : []

    try {
      if (requested.length > 0) return resolveDeployTargets(requested)
      if (yes) return [...DEPLOY_TARGETS]

      return resolveDeployTargets(await this.checkbox('Deployment targets', TARGET_CHOICES, true))
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))

      return []
    }
  }

  private async value(
    option: string,
    label: string,
    fallback: string,
    interactive: boolean,
  ): Promise<string> {
    const provided = this.option(option) as string | undefined
    if (provided) return provided.trim()

    return interactive ? (await this.ask(label, fallback)).trim() : fallback
  }

  private async pick(
    option: string,
    label: string,
    choices: string[],
    interactive: boolean,
  ): Promise<string> {
    const provided = this.option(option) as string | undefined
    if (provided && choices.includes(provided)) return provided
    if (!interactive) return choices[0]!

    return this.choice(
      label,
      choices.map((value) => ({ name: value, value })),
    )
  }
}
