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
