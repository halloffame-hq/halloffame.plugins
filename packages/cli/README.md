# Hall of Fame CLI

CLI to interact with Hall of Fame installations, powered by
[`@h3ravel/musket`](https://h3ravel.toneflix.net/musket/).

## Install

Install the package in a Hall of Fame API or app project:

```sh
pnpm add -D @hallofame/cli
```

OR Global install it for use in any Hall of Fame project:

```sh
pnpm i -g @hallofame/cli
```

The command only runs from a recognized Hall of Fame project root. It detects whether the current
project is the API or client app from its package identity and required source markers.

## Usage

Run this from the Hall of Fame API root:

```sh
pnpm exec hof [command] [options]
```

Or for global installs, run this from any Hall of Fame project root:

```sh
hof [command] [options]
```

## Commands

### `hof customize` - Customize the installed system

The command reads the API application's `.env`, connects to the configured database through
ArkORM, and prompts for:

- application identity and metadata;
- authentication-page copy;
- essential colors or every light/dark palette token;
- typography, semantic corner radii, and spacing density;
- premium, advertising, messaging, Frankly, and post-limit system options;
- whether the new immutable theme version should be activated immediately.

The active theme's existing logo, dark logo, favicon, and authentication artwork are copied into
the new version. Theme and system-setting changes are recorded in the platform audit log as local
CLI actions.

### `hof localize` - Round-trip localization for API and client copy

Export a single bundle covering both the API message catalogue and the client locale files, hand it
to a translator, then apply the edited bundle back into each side. The command finds the paired
project automatically (scanning sibling directories), so it runs from either the API or the app
root; pass `--api-root` / `--app-root` to point at them explicitly.

```sh
# Export English source plus any existing target copy into one file
hof localize export --locale es --file localization-es.json

# ...edit the "target" values in the bundle, then write them back
hof localize apply --file localization-es.json
```

Every entry carries the English `source` and the current `target` (empty when untranslated), so the
bundle doubles as a coverage report. Applying is additive and non-destructive: only non-empty
targets are written, existing translations for other keys and locales are left untouched, and an
untranslated entry simply falls back to English at runtime. Writes match each catalogue's formatting
(the API module's Prettier wrapping and the locale files' newline convention), so an unedited
round-trip produces no diff.

### `hof deploy` - Generate deployment resources

Template Docker, nginx, Apache, and pm2 configuration from your project's environment. Like
`localize`, it finds the paired project automatically and runs from either root.

The first argument selects which deployment paths to generate. It accepts `all` or any combination of
`docker`, `nginx`, `apache`, and `pm2` (space or comma separated); omit it to be prompted with a
multi-select.

```sh
hof deploy all --out deploy        # every target; prompts for domains, port, node, package manager
hof deploy nginx pm2 --out deploy  # only the bare-metal reverse proxy and process manager
hof deploy docker --yes            # only Docker, accepting env-derived defaults without prompting
```

Only the files for the selected targets are written, and prompts are limited to the settings those
targets need. Docker build files (`Dockerfile.api`, `Dockerfile.web`, `.dockerignore`,
`nginx.web.conf`) are written to each project root, since that is their build context; the
orchestration files (`docker-compose.yml`, `nginx.conf`, `.htaccess`, `pm2.ecosystem.config.cjs`,
`README.md`) go to the output directory. The compose file wires Postgres, Redis, the API, one worker
per queue, and the nginx-served client; the generated `README.md` covers only the selected paths. The
host `nginx.conf` routes hall tenant subdomains (`*.<root domain>`). Existing files are never
overwritten unless you pass `--force`.
