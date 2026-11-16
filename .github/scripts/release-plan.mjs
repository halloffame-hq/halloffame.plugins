import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

const SCOPE = '@hallofame/'
const WORKSPACE_ROOTS = ['packages', 'agents']

class ReleaseError extends Error {}

/** A semantic version, compared and bumped on its major.minor.patch core. */
class Version {
  static PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

  constructor(major, minor, patch, prerelease = null) {
    this.major = major
    this.minor = minor
    this.patch = patch
    this.prerelease = prerelease
  }

  static parse(text) {
    const match = Version.PATTERN.exec(text.trim())

    if (!match) {
      return null
    }

    return new Version(Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null)
  }

  static require(text) {
    const version = Version.parse(text)

    if (!version) {
      throw new ReleaseError(`'${text}' is not a semantic version`)
    }

    return version
  }

  get core() {
    return new Version(this.major, this.minor, this.patch)
  }

  compareCore(other) {
    return this.major - other.major || this.minor - other.minor || this.patch - other.patch
  }

  /** The part that went up between `previous` and this version. */
  bumpFrom(previous) {
    if (this.compareCore(previous) <= 0) {
      throw new ReleaseError(`v${this.core} is not newer than the previous release v${previous}`)
    }

    if (this.major !== previous.major) return 'major'
    if (this.minor !== previous.minor) return 'minor'

    return 'patch'
  }

  bump(part) {
    if (part === 'major') return new Version(this.major + 1, 0, 0)
    if (part === 'minor') return new Version(this.major, this.minor + 1, 0)

    return new Version(this.major, this.minor, this.patch + 1)
  }

  withPrerelease(prerelease) {
    return new Version(this.major, this.minor, this.patch, prerelease)
  }

  toString() {
    const core = `${this.major}.${this.minor}.${this.patch}`

    return this.prerelease ? `${core}-${this.prerelease}` : core
  }
}

/** The publishable packages under the workspace roots. */
class Workspace {
  constructor(roots = WORKSPACE_ROOTS) {
    this.packages = roots
      .filter((root) => existsSync(root))
      .flatMap((root) => readdirSync(root).map((name) => `${root}/${name}`))
      .filter((dir) => existsSync(`${dir}/package.json`))
      .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) }))
      .filter(({ manifest }) => manifest.name?.startsWith(SCOPE) && !manifest.private)
      .map(({ dir, manifest }) => ({ dir, name: manifest.name, version: manifest.version }))
  }

  find(name) {
    const fullName = name.startsWith('@') ? name : `${SCOPE}${name}`
    const found = this.packages.find((pkg) => pkg.name === fullName)

    if (!found) {
      throw new ReleaseError(`No workspace package is named '${fullName}'`)
    }

    return found
  }
}

/** Which packages a run publishes, at which versions, and how the result is recorded. */
class ReleasePlan {
  constructor(entries, version, label) {
    this.entries = entries
    this.label = label
    this.distTag = version.prerelease ? 'next' : 'latest'
    this.commit = !version.prerelease
  }

  static resolve({ event, releaseTag, inputPackage, inputVersion }, workspace, tags) {
    if (event !== 'release') {
      return ReleasePlan.single(workspace.find(inputPackage), Version.require(inputVersion))
    }

    const at = releaseTag.lastIndexOf('@')

    if (at > 0) {
      return ReleasePlan.single(
        workspace.find(releaseTag.slice(0, at)),
        Version.require(releaseTag.slice(at + 1)),
      )
    }

    return ReleasePlan.all(workspace, Version.require(releaseTag), releaseTag, tags)
  }

  static single(pkg, version) {
    return new ReleasePlan(
      [{ ...pkg, version: String(version) }],
      version,
      `${pkg.name}@${version}`,
    )
  }

  /** Bumps every package by the part that went up since the previous plain release tag. */
  static all(workspace, version, releaseTag, tags) {
    const previous = tags
      .filter((tag) => tag !== releaseTag)
      .map((tag) => Version.parse(tag))
      .filter((tagged) => tagged && !tagged.prerelease && tagged.compareCore(version) < 0)
      .sort((a, b) => b.compareCore(a))[0]

    if (!previous) {
      throw new ReleaseError(
        `No plain release tag older than ${releaseTag} (such as v0.1.0) to compare it with. Tag an earlier commit first, or release one package with <package>@<version>.`,
      )
    }

    const part = version.bumpFrom(previous)
    const entries = workspace.packages.map((pkg) => {
      const next = Version.require(pkg.version).core.bump(part)

      return {
        ...pkg,
        version: String(version.prerelease ? next.withPrerelease(version.prerelease) : next),
      }
    })

    return new ReleasePlan(entries, version, `v${version} (${part})`)
  }

  write(planPath, outputPath) {
    writeFileSync(
      planPath,
      this.entries.map(({ name, dir, version }) => `${name}\t${dir}\t${version}\n`).join(''),
    )

    appendFileSync(
      outputPath,
      [`tag=${this.distTag}`, `commit=${this.commit}`, `label=${this.label}`, ''].join('\n'),
    )

    for (const { name, version } of this.entries) {
      console.log(`${name}@${version}`)
    }
  }
}

const planPath = `${process.env.RUNNER_TEMP}/release-plan.tsv`

/** Writes each planned version into its package.json, keeping the file's key order. */
function applyPlan() {
  const lines = readFileSync(planPath, 'utf8').split('\n').filter(Boolean)

  for (const line of lines) {
    const [, dir, version] = line.split('\t')
    const path = `${dir}/package.json`
    const text = readFileSync(path, 'utf8')
    const manifest = JSON.parse(text)

    manifest.version = version
    writeFileSync(path, JSON.stringify(manifest, null, 2) + (text.endsWith('\n') ? '\n' : ''))
  }
}

function writePlan() {
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)

  ReleasePlan.resolve(
    {
      event: process.env.EVENT,
      releaseTag: process.env.RELEASE_TAG ?? '',
      inputPackage: process.env.INPUT_PACKAGE ?? '',
      inputVersion: process.env.INPUT_VERSION ?? '',
    },
    new Workspace(),
    tags,
  ).write(planPath, process.env.GITHUB_OUTPUT)
}

try {
  if (process.argv[2] === 'apply') {
    applyPlan()
  } else {
    writePlan()
  }
} catch (error) {
  if (!(error instanceof ReleaseError)) {
    throw error
  }

  console.log(`::error::${error.message}`)
  process.exit(1)
}
