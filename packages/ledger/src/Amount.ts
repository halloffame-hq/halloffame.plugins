import { Asset, type AssetDescriptor } from './Asset'
import { AssetMismatchError, InvalidAmountError } from './errors'

/** An amount as it crosses a wire or sits in a column. */
export interface AmountDescriptor {
  /** Minor units as a decimal string, because JSON cannot hold a bigint. */
  minor: string
  asset: AssetDescriptor
}

/**
 * A quantity of one asset, counted in that asset's smallest indivisible unit.
 *
 * Chain amounts overflow a JavaScript number long before they overflow a
 * bigint, and an amount that has lost its asset is a unit error waiting to
 * happen, so the two travel together and arithmetic across two assets is
 * refused rather than silently coerced.
 *
 * Instances are immutable: every operation returns a new amount.
 */
export class Amount {
  readonly minor: bigint
  readonly asset: Asset

  private constructor(minor: bigint, asset: Asset) {
    this.minor = minor
    this.asset = asset
  }

  /** Minor units, however they arrived. */
  static of(value: bigint | number | string, asset: Asset | AssetDescriptor): Amount {
    return new Amount(Amount.readMinor(value), Asset.from(asset))
  }

  /** Nothing, of this asset. */
  static zero(asset: Asset | AssetDescriptor): Amount {
    return new Amount(0n, Asset.from(asset))
  }

  /** Whole units, as a person writes them. */
  static units(value: string | number, asset: Asset | AssetDescriptor): Amount {
    const resolved = Asset.from(asset)
    const text = typeof value === 'number' ? Amount.readFiniteNumber(value) : value.trim()
    const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text)

    if (!match || (!match[2] && !match[3])) {
      throw new InvalidAmountError(`"${value}" is not an amount.`)
    }

    const fraction = match[3] ?? ''
    if (fraction.length > resolved.decimals) {
      throw new InvalidAmountError(
        `"${value}" is finer than ${resolved.code}'s ${resolved.decimals} decimals.`,
      )
    }

    const digits = `${match[2] || '0'}${fraction.padEnd(resolved.decimals, '0')}`

    return new Amount(BigInt(`${match[1]}${digits}`), resolved)
  }

  static fromJSON(descriptor: AmountDescriptor): Amount {
    return Amount.of(descriptor.minor, descriptor.asset)
  }

  get isZero(): boolean {
    return this.minor === 0n
  }

  get isPositive(): boolean {
    return this.minor > 0n
  }

  get isNegative(): boolean {
    return this.minor < 0n
  }

  plus(other: Amount): Amount {
    return new Amount(this.minor + this.sameAsset(other).minor, this.asset)
  }

  minus(other: Amount): Amount {
    return new Amount(this.minor - this.sameAsset(other).minor, this.asset)
  }

  negated(): Amount {
    return new Amount(-this.minor, this.asset)
  }

  /** Negative when this is the smaller, zero when equal, positive when larger. */
  compare(other: Amount): number {
    const difference = this.minor - this.sameAsset(other).minor

    if (difference === 0n) return 0

    return difference < 0n ? -1 : 1
  }

  equals(other: Amount): boolean {
    return this.asset.equals(other.asset) && this.minor === other.minor
  }

  isLessThan(other: Amount): boolean {
    return this.compare(other) < 0
  }

  isGreaterThan(other: Amount): boolean {
    return this.compare(other) > 0
  }

  /** The same amount, refused unless it is above zero. */
  assertPositive(): this {
    if (!this.isPositive) throw new InvalidAmountError('An amount must be greater than zero.')

    return this
  }

  /** Whole units, without rounding any of the amount away. */
  toUnits(): string {
    if (this.asset.decimals === 0) return this.minor.toString(10)

    const negative = this.isNegative
    const digits = (negative ? -this.minor : this.minor)
      .toString(10)
      .padStart(this.asset.decimals + 1, '0')
    const whole = digits.slice(0, digits.length - this.asset.decimals)
    const fraction = digits.slice(digits.length - this.asset.decimals).replace(/0+$/, '')

    return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
  }

  toJSON(): AmountDescriptor {
    return { minor: this.minor.toString(10), asset: this.asset.toJSON() }
  }

  toString(): string {
    return `${this.toUnits()} ${this.asset.code}`
  }

  private sameAsset(other: Amount): Amount {
    if (!this.asset.equals(other.asset)) {
      throw new AssetMismatchError(this.asset.toString(), other.asset.toString())
    }

    return other
  }

  private static readMinor(value: bigint | number | string): bigint {
    if (typeof value === 'bigint') return value

    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) {
        throw new InvalidAmountError(`${value} is not a safe integer amount.`)
      }

      return BigInt(value)
    }

    const text = value.trim()
    if (!/^-?\d+$/.test(text)) {
      throw new InvalidAmountError(`"${value}" is not a whole number of minor units.`)
    }

    return BigInt(text)
  }

  private static readFiniteNumber(value: number): string {
    if (!Number.isFinite(value)) throw new InvalidAmountError(`${value} is not an amount.`)

    return value.toFixed(20).replace(/0+$/, '').replace(/\.$/, '')
  }
}
