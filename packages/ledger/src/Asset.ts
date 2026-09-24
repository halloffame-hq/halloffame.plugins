import { MisconfiguredError } from './errors'

/** An asset as it crosses a wire or sits in a column. */
export interface AssetDescriptor {
  code: string
  decimals: number
  label?: string | null
  issuer?: string | null
}

/**
 * What is being moved.
 *
 * `decimals` says how many of the asset's minor units make one whole unit, so
 * an amount can be displayed without the application knowing the chain. Two
 * assets are the same when their code and issuer agree; everything else is
 * presentation.
 */
export class Asset {
  readonly code: string
  readonly decimals: number
  readonly label: string | null
  readonly issuer: string | null

  constructor(descriptor: AssetDescriptor) {
    if (!descriptor.code) throw new MisconfiguredError('An asset needs a code.')
    if (!Number.isInteger(descriptor.decimals) || descriptor.decimals < 0) {
      throw new MisconfiguredError(`${descriptor.decimals} is not a valid decimal precision.`)
    }

    this.code = descriptor.code
    this.decimals = descriptor.decimals
    this.label = descriptor.label ?? null
    this.issuer = descriptor.issuer ?? null
  }

  static from(value: Asset | AssetDescriptor): Asset {
    return value instanceof Asset ? value : new Asset(value)
  }

  equals(other: Asset | AssetDescriptor): boolean {
    const asset = Asset.from(other)

    return this.code === asset.code && this.issuer === asset.issuer
  }

  toJSON(): AssetDescriptor {
    return {
      code: this.code,
      decimals: this.decimals,
      label: this.label,
      issuer: this.issuer,
    }
  }

  toString(): string {
    return this.issuer ? `${this.code}:${this.issuer}` : this.code
  }
}
