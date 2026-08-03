import type { DeploymentSettings, PackageManager } from './settings'

/** Where a generated file belongs: the output dir, or a project's context root. */
export type DeploymentRoot = 'out' | 'api' | 'app'

/** A deployment path the operator can select (or `all`). */
export type DeployTarget = 'docker' | 'nginx' | 'apache' | 'pm2'

export const DEPLOY_TARGETS: readonly DeployTarget[] = ['docker', 'nginx', 'apache', 'pm2']

export interface DeploymentFile {
  /** Path relative to its {@link root}. */
  path: string
  /** Destination base: the output directory or a project root. */
  root: DeploymentRoot
  /** The deployment path this file belongs to; omitted files are always emitted. */
  target?: DeployTarget
  content: string
}

/**
 * Resolve a list of requested target names (which may include `all` or
 * comma-joined values) to a deduplicated set of concrete targets.
 */
export function resolveDeployTargets(requested: readonly string[]): DeployTarget[] {
  const normalized = requested
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  if (normalized.length === 0 || normalized.includes('all')) return [...DEPLOY_TARGETS]

  const invalid = normalized.filter((value) => !DEPLOY_TARGETS.includes(value as DeployTarget))
  if (invalid.length > 0) {
    throw new Error(
      `Unknown deployment target(s): ${invalid.join(', ')}. Choose from: all, ${DEPLOY_TARGETS.join(', ')}.`,
    )
  }

  return [...new Set(normalized)] as DeployTarget[]
}

interface PackageCommands {
  install: string
  build: string
  corepack: boolean
}

function packageCommands(pm: PackageManager): PackageCommands {
  switch (pm) {
    case 'npm':
      return { install: 'npm ci', build: 'npm run build', corepack: false }
    case 'yarn':
      return { install: 'yarn install --frozen-lockfile', build: 'yarn build', corepack: true }
    default:
      return { install: 'pnpm install --frozen-lockfile', build: 'pnpm build', corepack: true }
  }
}

const LOCKFILES: Record<PackageManager, string> = {
  pnpm: 'pnpm-lock.yaml',
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
}

function apiDockerfile(s: DeploymentSettings): string {
  const pm = packageCommands(s.packageManager)
  const enable = pm.corepack ? 'RUN corepack enable\n' : ''
  const lock = LOCKFILES[s.packageManager]

  return `# syntax=docker/dockerfile:1
# Build and run the ${s.appName} API.
FROM node:${s.nodeVersion}-slim AS build
WORKDIR /app
${enable}COPY package.json ${lock}* ./
RUN ${pm.install}
COPY . .
RUN ${pm.build}

FROM node:${s.nodeVersion}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
EXPOSE ${s.apiPort}
CMD ["node", "dist/server.js"]
`
}

function webDockerfile(s: DeploymentSettings): string {
  const pm = packageCommands(s.packageManager)
  const enable = pm.corepack ? 'RUN corepack enable\n' : ''
  const lock = LOCKFILES[s.packageManager]

  return `# syntax=docker/dockerfile:1
# Build the ${s.appName} client and serve the static bundle with nginx.
FROM node:${s.nodeVersion}-slim AS build
WORKDIR /app
${enable}COPY package.json ${lock}* ./
RUN ${pm.install}
COPY . .
RUN ${pm.build}

FROM nginx:alpine AS runtime
COPY nginx.web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
`
}

function dockerignore(): string {
  return `node_modules
dist
.git
.env
*.log
`
}

function composeFile(s: DeploymentSettings): string {
  const worker = (queue: string): string => `  ${s.slug}-${queue}-worker:
    image: ${s.slug}-api
    depends_on:
      - api
    env_file:
      - ${s.apiContext}/.env
    command: ["node_modules/.bin/ark", "queue:work", "--queue", "${queue}"]
    restart: unless-stopped
`

  const redisService = s.includeRedis
    ? `  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis-data:/data
`
    : ''

  const apiDependsOn = s.includeRedis
    ? `      - postgres
      - redis`
    : '      - postgres'

  const workers = s.queues.map(worker).join('')
  const redisVolume = s.includeRedis ? '  redis-data:\n' : ''

  return `# Docker Compose deployment for ${s.appName}.
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${s.dbName}
      POSTGRES_USER: ${s.dbUser}
      POSTGRES_PASSWORD: \${DB_PASSWORD:-change-me}
    volumes:
      - postgres-data:/var/lib/postgresql/data
${redisService}
  api:
    image: ${s.slug}-api
    build:
      context: ${s.apiContext}
      dockerfile: Dockerfile.api
    depends_on:
${apiDependsOn}
    env_file:
      - ${s.apiContext}/.env
    expose:
      - "${s.apiPort}"
    restart: unless-stopped

${workers}
  web:
    build:
      context: ${s.webContext}
      dockerfile: Dockerfile.web
    depends_on:
      - api
    ports:
      - "80:80"
    restart: unless-stopped

volumes:
  postgres-data:
${redisVolume}`
}

const PROXY_HEADERS = `        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";`

/** nginx config used inside the web container: static SPA plus an API proxy. */
function webNginxConf(s: DeploymentSettings): string {
  return `server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    client_max_body_size 100m;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location /api/ {
        proxy_pass http://api:${s.apiPort};
${PROXY_HEADERS}
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
`
}

/**
 * Standalone reverse proxy for a bare-metal (pm2) deployment: serves the built
 * client, proxies the API, and routes hall tenant subdomains.
 */
function hostNginxConf(s: DeploymentSettings): string {
  return `# Reverse proxy for a bare-metal ${s.appName} deployment.
# Point web_root at the built client bundle (the app project's dist directory).
upstream ${s.slug}_api {
    server 127.0.0.1:${s.apiPort};
}

# API host.
server {
    listen 80;
    server_name ${s.apiDomain};

    client_max_body_size 100m;

    location / {
        proxy_pass http://${s.slug}_api;
${PROXY_HEADERS}
    }
}

# Client app plus hall tenant subdomains (*.${s.tenantRootDomain}).
server {
    listen 80;
    server_name ${s.webDomain} ${s.tenantRootDomain} *.${s.tenantRootDomain};

    root /var/www/${s.slug}/dist;
    index index.html;

    client_max_body_size 100m;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location /api/ {
        proxy_pass http://${s.slug}_api;
${PROXY_HEADERS}
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
`
}

/** Apache SPA rewrite for shared hosting of the built client bundle. */
function htaccess(s: DeploymentSettings): string {
  return `# Serve the ${s.appName} client single-page app on Apache shared hosting.
# Place this file at the document root alongside the built client bundle.
<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteBase /

    # Serve existing files and directories directly.
    RewriteCond %{REQUEST_FILENAME} -f [OR]
    RewriteCond %{REQUEST_FILENAME} -d
    RewriteRule ^ - [L]

    # Route everything else to the SPA entry point.
    RewriteRule ^ index.html [L]
</IfModule>

<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml
</IfModule>
`
}

function pm2Config(s: DeploymentSettings): string {
  const workers = s.queues
    .map(
      (queue) => `    {
      name: '${s.slug}-${queue}-worker',
      cwd: '${s.apiContext}',
      script: 'node_modules/.bin/ark',
      args: 'queue:work --queue ${queue}',
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 10000,
      env_production: { NODE_ENV: 'production' },
    },`,
    )
    .join('\n')

  return `// pm2 process definitions for a bare-metal ${s.appName} deployment.
// Serve the client separately with the generated nginx.conf.
module.exports = {
  apps: [
    {
      name: '${s.slug}-api',
      cwd: '${s.apiContext}',
      script: 'dist/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env_production: { NODE_ENV: 'production', APP_PORT: ${s.apiPort} },
    },
${workers}
  ],
}
`
}

function readme(s: DeploymentSettings, targets: readonly DeployTarget[]): string {
  const has = (target: DeployTarget): boolean => targets.includes(target)
  const sections: string[] = []

  if (has('docker')) {
    sections.push(`## Layout

The Docker build files live at each project root (their build context):

- \`${s.apiContext}/Dockerfile.api\`, \`${s.apiContext}/.dockerignore\`
- \`${s.webContext}/Dockerfile.web\`, \`${s.webContext}/.dockerignore\`, \`${s.webContext}/nginx.web.conf\`

The \`docker-compose.yml\` orchestration file lives in this directory.

## Docker Compose

\`\`\`sh
docker compose up -d --build
\`\`\`

Brings up Postgres${s.includeRedis ? ', Redis' : ''}, the API, the queue workers
(${s.queues.join(', ')}), and the nginx-served client. The API and workers read
\`${s.apiContext}/.env\`; set \`DB_PASSWORD\` in your shell or an \`.env\` next to
this compose file.`)
  }

  if (has('nginx') || has('pm2')) {
    const steps: string[] = [
      `1. Build both projects (\`${packageCommands(s.packageManager).build}\` in each).`,
    ]
    if (has('nginx')) {
      steps.push(
        `2. Copy the client's \`dist\` to \`/var/www/${s.slug}/dist\` (or edit \`nginx.conf\`).`,
        '3. Install `nginx.conf` into your nginx `sites-enabled` and reload.',
      )
    }
    if (has('pm2')) {
      steps.push(
        `${steps.length + 1}. Start the API and workers with pm2:

\`\`\`sh
pm2 start pm2.ecosystem.config.cjs --env production
\`\`\``,
      )
    }
    sections.push(`## Bare metal (${[has('pm2') && 'pm2', has('nginx') && 'nginx']
      .filter(Boolean)
      .join(' + ')})

${steps.join('\n')}`)
  }

  if (has('apache')) {
    sections.push(`## Apache shared hosting

Upload the client's \`dist\` contents to the document root together with
\`.htaccess\`. Point the app at your API host through the client's build-time
\`VITE_API_URL\`.`)
  }

  return `# ${s.appName} deployment resources

Generated by \`hof deploy\` for: **${targets.join(', ')}**. These files are
templated from your project's environment. Review the domains, ports, and
secrets before using them.

- App: **${s.webDomain}** (hall tenants at \`*.${s.tenantRootDomain}\`)
- API: **${s.apiDomain}** on port \`${s.apiPort}\`

${sections.join('\n\n')}
`
}

/**
 * Build the deployment artifacts for the selected targets. Files without a
 * target (the README) are always included.
 */
export function buildDeploymentFiles(
  settings: DeploymentSettings,
  targets: readonly DeployTarget[] = DEPLOY_TARGETS,
): DeploymentFile[] {
  const files: DeploymentFile[] = [
    { root: 'api', path: 'Dockerfile.api', target: 'docker', content: apiDockerfile(settings) },
    { root: 'api', path: '.dockerignore', target: 'docker', content: dockerignore() },
    { root: 'app', path: 'Dockerfile.web', target: 'docker', content: webDockerfile(settings) },
    { root: 'app', path: '.dockerignore', target: 'docker', content: dockerignore() },
    { root: 'app', path: 'nginx.web.conf', target: 'docker', content: webNginxConf(settings) },
    { root: 'out', path: 'docker-compose.yml', target: 'docker', content: composeFile(settings) },
    { root: 'out', path: 'nginx.conf', target: 'nginx', content: hostNginxConf(settings) },
    { root: 'out', path: '.htaccess', target: 'apache', content: htaccess(settings) },
    { root: 'out', path: 'pm2.ecosystem.config.cjs', target: 'pm2', content: pm2Config(settings) },
    { root: 'out', path: 'README.md', content: readme(settings, targets) },
  ]

  return files.filter((file) => file.target === undefined || targets.includes(file.target))
}
