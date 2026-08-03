import { type DeploymentSettings, slugify } from '../src/deployment/settings'
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolveContexts, writeDeploymentFiles } from '../src/deployment/generate'

import { buildDeploymentFiles, resolveDeployTargets } from '../src/deployment/templates'
import os from 'node:os'
import path from 'node:path'

function settings(overrides: Partial<DeploymentSettings> = {}): DeploymentSettings {
  return {
    appName: 'Hall of Fame',
    slug: 'hall-of-fame',
    webDomain: 'app.example.com',
    apiDomain: 'api.example.com',
    tenantRootDomain: 'example.com',
    apiPort: 3000,
    nodeVersion: '22',
    packageManager: 'pnpm',
    includeRedis: true,
    queues: ['media', 'notifications'],
    dbName: 'hall_of_fame',
    dbUser: 'hall_of_fame',
    apiContext: '../api',
    webContext: '../web',
    ...overrides,
  }
}

function fileMap(s: DeploymentSettings): Record<string, string> {
  return Object.fromEntries(buildDeploymentFiles(s).map((file) => [file.path, file.content]))
}

describe('deployment resource generation', () => {
  it('places build files at the project roots and orchestration in the output dir', () => {
    const tagged = buildDeploymentFiles(settings()).map((file) => `${file.root}:${file.path}`)

    expect(tagged).toEqual([
      'api:Dockerfile.api',
      'api:.dockerignore',
      'app:Dockerfile.web',
      'app:.dockerignore',
      'app:nginx.web.conf',
      'out:docker-compose.yml',
      'out:nginx.conf',
      'out:.htaccess',
      'out:pm2.ecosystem.config.cjs',
      'out:README.md',
    ])
  })

  it('templates the API port, node version, and build contexts', () => {
    const files = fileMap(settings({ apiPort: 4000, nodeVersion: '20' }))

    expect(files['Dockerfile.api']).toContain('FROM node:20-slim AS build')
    expect(files['Dockerfile.api']).toContain('EXPOSE 4000')
    expect(files['docker-compose.yml']).toContain('context: ../api')
    expect(files['docker-compose.yml']).toContain('dockerfile: Dockerfile.api')
    expect(files['nginx.web.conf']).toContain('proxy_pass http://api:4000;')
    expect(files['nginx.conf']).toContain('server 127.0.0.1:4000;')
  })

  it('emits a worker service and pm2 process per queue', () => {
    const files = fileMap(settings({ queues: ['media', 'notifications', 'analytics'] }))

    expect(files['docker-compose.yml']).toContain('hall-of-fame-analytics-worker:')
    expect(files['docker-compose.yml']).toContain('"queue:work", "--queue", "analytics"')
    expect(files['pm2.ecosystem.config.cjs']).toContain("name: 'hall-of-fame-analytics-worker'")
    expect(files['pm2.ecosystem.config.cjs']).toContain('queue:work --queue analytics')
  })

  it('routes the tenant wildcard in the host nginx config', () => {
    const files = fileMap(settings())

    expect(files['nginx.conf']).toContain('server_name app.example.com example.com *.example.com;')
    expect(files['.htaccess']).toContain('RewriteRule ^ index.html [L]')
  })

  it('omits Redis when disabled', () => {
    const withRedis = fileMap(settings({ includeRedis: true }))['docker-compose.yml']
    const withoutRedis = fileMap(settings({ includeRedis: false }))['docker-compose.yml']

    expect(withRedis).toContain('redis:7-alpine')
    expect(withRedis).toContain('redis-data:')
    expect(withoutRedis).not.toContain('redis')
  })

  it('switches package-manager commands', () => {
    const npm = fileMap(settings({ packageManager: 'npm' }))['Dockerfile.api']

    expect(npm).toContain('npm ci')
    expect(npm).toContain('COPY package.json package-lock.json* ./')
    expect(npm).not.toContain('corepack enable')
  })

  it('resolves build contexts relative to the output directory', () => {
    const contexts = resolveContexts('/srv/deploy', { api: '/srv/api', app: '/srv/web' })

    expect(contexts).toEqual({ apiContext: '../api', webContext: '../web' })
  })

  it('writes each file to its root and skips existing ones unless forced', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'hof-deploy-'))
    const roots = {
      out: path.join(base, 'deploy'),
      api: path.join(base, 'api'),
      app: path.join(base, 'web'),
    }
    await Promise.all(Object.values(roots).map((dir) => mkdir(dir, { recursive: true })))
    const files = buildDeploymentFiles(settings())

    const first = await writeDeploymentFiles(roots, files)
    expect(first.written).toHaveLength(files.length)
    expect(first.written).toContain('api:Dockerfile.api')
    expect(first.written).toContain('docker-compose.yml')
    // The API Dockerfile landed at the API root, not the output directory.
    expect(await readFile(path.join(roots.api, 'Dockerfile.api'), 'utf8')).toContain(
      'dist/server.js',
    )

    // A hand-edited file is preserved on the next run.
    await writeFile(path.join(roots.out, 'nginx.conf'), 'custom', 'utf8')
    const second = await writeDeploymentFiles(roots, files)
    expect(second.written).toHaveLength(0)
    expect(second.skipped).toContain('nginx.conf')
    expect(await readFile(path.join(roots.out, 'nginx.conf'), 'utf8')).toBe('custom')

    // Force overwrites everything.
    const third = await writeDeploymentFiles(roots, files, true)
    expect(third.written).toHaveLength(files.length)
    expect(await readFile(path.join(roots.out, 'nginx.conf'), 'utf8')).toContain('upstream')
  })

  it('slugifies app names for container and process identifiers', () => {
    expect(slugify('Hall of Fame')).toBe('hall-of-fame')
    expect(slugify("Bob's Arena!!")).toBe('bob-s-arena')
    expect(slugify('   ')).toBe('hall-of-fame')
  })

  it('resolves requested deployment targets, including all and comma-joined lists', () => {
    expect(resolveDeployTargets([])).toEqual(['docker', 'nginx', 'apache', 'pm2'])
    expect(resolveDeployTargets(['all'])).toEqual(['docker', 'nginx', 'apache', 'pm2'])
    expect(resolveDeployTargets(['nginx', 'pm2'])).toEqual(['nginx', 'pm2'])
    expect(resolveDeployTargets(['docker,apache'])).toEqual(['docker', 'apache'])
    expect(resolveDeployTargets(['pm2', 'pm2'])).toEqual(['pm2'])
    expect(() => resolveDeployTargets(['heroku'])).toThrow(/Unknown deployment target/u)
  })

  it('generates only the files for the selected targets', () => {
    const only = (targets: Parameters<typeof buildDeploymentFiles>[1]) =>
      buildDeploymentFiles(settings(), targets).map((file) => `${file.root}:${file.path}`)

    expect(only(['pm2'])).toEqual(['out:pm2.ecosystem.config.cjs', 'out:README.md'])
    expect(only(['apache'])).toEqual(['out:.htaccess', 'out:README.md'])
    expect(only(['nginx'])).toEqual(['out:nginx.conf', 'out:README.md'])
    expect(only(['docker'])).toEqual([
      'api:Dockerfile.api',
      'api:.dockerignore',
      'app:Dockerfile.web',
      'app:.dockerignore',
      'app:nginx.web.conf',
      'out:docker-compose.yml',
      'out:README.md',
    ])
    expect(only(['nginx', 'pm2'])).toEqual([
      'out:nginx.conf',
      'out:pm2.ecosystem.config.cjs',
      'out:README.md',
    ])
  })

  it('tailors the README to the selected targets', () => {
    const map = (targets: Parameters<typeof buildDeploymentFiles>[1]) =>
      Object.fromEntries(
        buildDeploymentFiles(settings(), targets).map((file) => [file.path, file.content]),
      )['README.md']

    const apacheOnly = map(['apache'])
    expect(apacheOnly).toContain('for: **apache**')
    expect(apacheOnly).toContain('## Apache shared hosting')
    expect(apacheOnly).not.toContain('## Docker Compose')

    const bareMetal = map(['nginx', 'pm2'])
    expect(bareMetal).toContain('## Bare metal (pm2 + nginx)')
    expect(bareMetal).toContain('pm2 start pm2.ecosystem.config.cjs')
    expect(bareMetal).not.toContain('## Docker Compose')
  })
})
