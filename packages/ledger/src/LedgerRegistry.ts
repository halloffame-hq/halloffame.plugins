import type { Ledger, LedgerOperation } from './types'

import { MisconfiguredError } from './errors'

export type LedgerFactory = () => Ledger | Promise<Ledger>

/**
 * Which ledger a platform is running on.
 *
 * Adapters register themselves at boot and configuration names the active one,
 * so swapping chains is a configuration change rather than a code change. The
 * registry holds factories rather than instances: something that opens sockets
 * or unseals keys should not do so because it was merely installed.
 */
export class LedgerRegistry {
  /** The registry an application uses unless it deliberately makes its own. */
  static readonly shared = new LedgerRegistry()

  private readonly factories = new Map<string, LedgerFactory>()
  private readonly instances = new Map<string, Ledger>()

  /** 
   * Make an adapter selectable. Registering a name again replaces it.
   * 
   * @param name 
   * @param factory 
   * @returns 
   */
  register(name: string, factory: LedgerFactory): this {
    this.factories.set(name, factory)
    this.instances.delete(name)

    return this
  }

  registered(): string[] {
    return [...this.factories.keys()]
  }

  has(name: string): boolean {
    return this.factories.has(name)
  }

  /** 
   * The named adapter, built once and kept.
   * 
   * @param name 
   * @returns 
   */
  async resolve(name: string): Promise<Ledger> {
    const existing = this.instances.get(name)
    if (existing) return existing

    const factory = this.factories.get(name)
    if (!factory) {
      const known = this.registered().join(', ') || 'none'

      throw new MisconfiguredError(`No ledger named "${name}" is registered. Registered: ${known}.`)
    }

    const ledger = await factory()
    LedgerCoherence.assert(ledger)
    this.instances.set(name, ledger)

    return ledger
  }

  /** 
   * Drop everything, closing any ledger that holds resources. 
   */
  async reset(): Promise<void> {
    const built = [...this.instances.values()]
    this.instances.clear()
    this.factories.clear()

    for (const ledger of built) {
      await ledger.close()
    }
  }
}

/**
 * Whether a ledger's declared capabilities match what it implements.
 *
 * A capability the application can see but not call, and an operation it is
 * told does not exist, both end in a failure far from the adapter that caused
 * it. Catching it at registration keeps the blame where it belongs.
 */
export class LedgerCoherence {
  private static readonly pairs: readonly [LedgerOperation, keyof LedgerCapabilityNames][] = [
    ['mint', 'minting'],
    ['deposit', 'deposits'],
    ['withdraw', 'withdrawals'],
    ['exportWallet', 'selfCustody'],
    ['importWallet', 'externalWallets'],
  ]

  static assert(ledger: Ledger): void {
    for (const [operation, capability] of this.pairs) {
      const declared = ledger.capabilities[capability]

      if (this.performs(ledger, operation) === declared) continue

      throw new MisconfiguredError(
        declared
          ? `Ledger "${ledger.name}" declares ${capability} but cannot perform ${operation}.`
          : `Ledger "${ledger.name}" can perform ${operation} but does not declare ${capability}.`,
      )
    }
  }

  /**
   * Whether the ledger can really perform an operation.
   *
   * A ledger that inherits its operations answers for itself, because every
   * such method exists whether or not it is backed by anything. One that
   * defines its own methods is judged on what it defines.
   * 
   * @param ledger 
   * @param operation 
   * @returns 
   */
  private static performs(ledger: Ledger, operation: LedgerOperation): boolean {
    return ledger.supports?.(operation) ?? typeof ledger[operation] === 'function'
  }

  /** 
   * Whether the ledger is coherent, without throwing.
   * 
   * @param ledger 
   * @returns 
   */
  static check(ledger: Ledger): boolean {
    try {
      this.assert(ledger)

      return true
    } catch {
      return false
    }
  }
}

/** The capability flags a member can be paired with. */
type LedgerCapabilityNames = Pick<
  Ledger['capabilities'],
  'minting' | 'deposits' | 'withdrawals' | 'selfCustody' | 'externalWallets'
>
