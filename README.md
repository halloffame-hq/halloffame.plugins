# Hall Of Fame plugins

Installable integrations and agents for Hall Of Fame.

## Packages

| Package                                | Directory                      |
| -------------------------------------- | ------------------------------ |
| `@hallofame/capacitor-native`          | `packages/capacitor-native`    |
| `@hallofame/cli`                       | `packages/cli`                 |
| `@hallofame/payment-provider-paystack` | `packages/paystack`            |
| `@hallofame/cloudflare-agent`          | `agents/halloffame-cloudflare` |

## Publishing

Packages are published to npm by the [Publish workflow](.github/workflows/publish.yml). Every package in a run passes `pnpm check` and is packed before any of them is published, and npm provenance is attached.

### Setup

- Add an `NPM_TOKEN` repository secret: an npm automation or granular token that can publish to `@hallofame`.
- Allow GitHub Actions to push to `main` if it is protected, so the workflow can commit the published versions.
- Before the first plain release tag, tag an existing commit as the baseline, such as `v0.1.0`.

### Release one package

Publish a GitHub release whose tag names the package and its version. The scope and a leading `v` are optional:

```text
@hallofame/cli@0.1.29
cli@v0.1.29
payment-provider-paystack@v0.2.3
cloudflare-agent@v0.2.14
```

The package is published at exactly that version.

### Release every package

Publish a GitHub release with a plain tag such as `v0.2.0`. The workflow compares it with the previous plain release tag and bumps every package from its own version by the part that went up:

| Previous tag | New tag  | Bump  | `@hallofame/cli` at 0.1.28 becomes |
| ------------ | -------- | ----- | ---------------------------------- |
| `v0.1.0`     | `v0.1.1` | patch | 0.1.29                             |
| `v0.1.0`     | `v0.2.0` | minor | 0.2.0                              |
| `v0.2.0`     | `v1.0.0` | major | 1.0.0                              |

A plain tag with no older plain tag to compare against fails before anything is published.

### Release by hand

Open **Actions → Publish → Run workflow**, choose the package, and enter the version to publish.

### Prereleases

A version with a prerelease suffix, such as `cli@0.2.0-beta.1` or `v1.0.0-beta.1`, is published to the `next` dist-tag, so `latest` is unchanged. For a plain prerelease tag, every package gets its bump with the same suffix, so `v1.0.0-beta.1` after `v0.2.0` publishes `@hallofame/cli@1.0.0-beta.1`.

### After publishing

Stable versions are committed to each `package.json` as `chore: release ...`, on the default branch for a release or on the branch a manual run used. Prerelease versions are not committed, so the next bump starts from the stable version.

A version that is already on npm is skipped, so a run that failed part way can be re-run.
