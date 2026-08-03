import { parse as parseEnv } from 'dotenv'
import path from 'node:path'
import { readFile } from 'node:fs/promises'

export type PackageManager = 'pnpm' | 'npm' | 'yarn'

export interface DeploymentSettings {
  /** Display name, e.g. "Hall of Fame". */
  appName: string
  /** Slug derived from the app name, used for container and process names. */
  slug: string
  /** Public host for the client app, e.g. app.example.com. */
  webDomain: string
  /** Public host for the API, e.g. api.example.com. */
  apiDomain: string
  /** Root domain whose wildcard serves hall tenant subdomains. */
  tenantRootDomain: string
  /** Port the API server listens on (APP_PORT). */
  apiPort: number
  /** Node major version for the base images and engines. */
  nodeVersion: string
  packageManager: PackageManager
  includeRedis: boolean
  /** Queue names run as dedicated workers. */
  queues: string[]
  dbName: string
  dbUser: string
  /** Compose build context for the API, relative to the output directory. */
  apiContext: string
  /** Compose build context for the app, relative to the output directory. */
  webContext: string
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\da-z]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'hall-of-fame'
  )
}

async function loadEnv(root: string): Promise<Record<string, string>> {
  for (const name of ['.env', '.env.example']) {
    try {
      return parseEnv(await readFile(path.join(root, name), 'utf8'))
    } catch {
      // fall through to the next candidate
    }
  }

  return {}
}

function hostOf(url: string | undefined, fallback: string): string {
  if (!url) return fallback
  try {
    return new URL(url).host || fallback
  } catch {
    return fallback
  }
}

/**
 * Derive sensible deployment defaults from the paired projects' environment
 * files. Every value can be overridden by the operator before generation.
 *
 * @param pair
 * @returns
 */
export async function readDeploymentDefaults(pair: {
  api: string
  app: string
}): Promise<
  Pick<
    DeploymentSettings,
    | 'appName'
    | 'apiPort'
    | 'tenantRootDomain'
    | 'webDomain'
    | 'apiDomain'
    | 'dbName'
    | 'dbUser'
    | 'queues'
  >
> {
  const apiEnv = await loadEnv(pair.api)
  const appEnv = await loadEnv(pair.app)

  const appName = apiEnv.APP_NAME || 'Hall of Fame'
  const apiPort = Number(apiEnv.APP_PORT) || 3000
  const tenantRootDomain = appEnv.VITE_TENANT_ROOT_DOMAIN || 'example.com'

  return {
    appName,
    apiPort,
    tenantRootDomain,
    webDomain: hostOf(apiEnv.FRONTEND_URL, `app.${tenantRootDomain}`),
    apiDomain: hostOf(apiEnv.APP_URL, `api.${tenantRootDomain}`),
    dbName: apiEnv.DB_DATABASE || 'hall_of_fame',
    dbUser: apiEnv.DB_USERNAME || 'hall_of_fame',
    queues: ['media', 'notifications'],
  }
}
