import { beforeEach, describe, expect, it } from 'vitest'

import {
  Amount,
  Asset,
  BaseLedger,
  LedgerError,
  LedgerRegistry,
  MemoryIdempotencyStore,
  MemoryLedger,
  LedgerCoherence,
  type LedgerCapabilities,
  type Ledger,
} from '../src/index'

const MEM = new Asset({ code: 'MEM', decimals: 8 })

const mem = (minor: bigint | number | string) => Amount.of(minor, MEM)

/**
 * An adapter that claims minting and backs it with nothing.
 *
 * Inheriting the base class means inheriting every optional operation, so this
 * is what a misconfigured adapter actually looks like: `mint()` is right there
 * on it, and there is no hook behind it.
 */
class HollowProvider extends BaseLedger {
  readonly name = 'hollow'
  readonly label = 'Hollow'
  readonly asset = MEM
  readonly capabilities: LedgerCapabilities = {
    minting: true,
    deposits: false,
    withdrawals: false,
    selfCustody: false,
    externalWallets: false,
    fastPayments: false,
    memos: false,
    instantSettlement: true,
    confirmationsRequired: 0,
  }

  async balance(): Promise<never> {
    throw new Error('not reached')
  }

  async transaction(): Promise<null> {
    return null
  }

  async listTransactions(): Promise<never> {
    throw new Error('not reached')
  }

  async health(): Promise<never> {
    throw new Error('not reached')
  }

  async close(): Promise<void> {}

  protected async findWallet(): Promise<null> {
    return null
  }

  protected async performCreateWallet(): Promise<never> {
    throw new Error('not reached')
  }

  protected async performTransfer(): Promise<never> {
    throw new Error('not reached')
  }
}

describe('Asset', () => {
  it('is the same asset when code and issuer agree', () => {
    expect(new Asset({ code: 'CKB', decimals: 8 }).equals({ code: 'CKB', decimals: 8 })).toBe(true)
    expect(
      new Asset({ code: 'USD', decimals: 7, issuer: 'GA' }).equals({
        code: 'USD',
        decimals: 7,
        issuer: 'GB',
      }),
    ).toBe(false)
  })

  it('refuses a precision that cannot describe an amount', () => {
    expect(() => new Asset({ code: 'CKB', decimals: -1 })).toThrow(LedgerError)
    expect(() => new Asset({ code: 'CKB', decimals: 1.5 })).toThrow(LedgerError)
    expect(() => new Asset({ code: '', decimals: 8 })).toThrow(LedgerError)
  })
})

describe('Amount', () => {
  it('reads minor units from every form they arrive in', () => {
    expect(mem(12n).minor).toBe(12n)
    expect(mem(12).minor).toBe(12n)
    expect(mem(' 12 ').minor).toBe(12n)
    expect(mem('-12').minor).toBe(-12n)
  })

  it('refuses a value that cannot be an exact integer count', () => {
    expect(() => mem(1.5)).toThrow(LedgerError)
    expect(() => mem(Number.MAX_SAFE_INTEGER + 2)).toThrow(LedgerError)
    expect(() => mem('1.5')).toThrow(LedgerError)
  })

  it('survives a round trip at chain scale', () => {
    const huge = 123456789012345678901234567890n
    expect(Amount.fromJSON(mem(huge).toJSON()).minor).toBe(huge)
  })

  it('renders whole units without losing any of the amount', () => {
    expect(mem(123456789n).toUnits()).toBe('1.23456789')
    expect(mem(100000000n).toUnits()).toBe('1')
    expect(mem(1n).toUnits()).toBe('0.00000001')
    expect(Amount.of(-150n, { code: 'X', decimals: 2 }).toUnits()).toBe('-1.5')
    expect(Amount.of(42n, { code: 'X', decimals: 0 }).toUnits()).toBe('42')
  })

  it('reads whole units a person wrote', () => {
    expect(Amount.units('1.23456789', MEM).minor).toBe(123456789n)
    expect(Amount.units('1', MEM).minor).toBe(100000000n)
    expect(Amount.units('.5', { code: 'X', decimals: 2 }).minor).toBe(50n)
    expect(() => Amount.units('1.234', { code: 'X', decimals: 2 })).toThrow(LedgerError)
    expect(() => Amount.units('abc', MEM)).toThrow(LedgerError)
  })

  it('refuses arithmetic across two assets', () => {
    const other = Amount.of(1n, { code: 'CKB', decimals: 8 })

    expect(() => mem(1n).plus(other)).toThrow(/settles in MEM/)
    expect(() => mem(1n).compare(other)).toThrow(LedgerError)
    expect(mem(1n).equals(other)).toBe(false)
  })

  it('compares and combines without mutating either side', () => {
    const a = mem(10n)
    const b = mem(4n)

    expect(a.plus(b).minor).toBe(14n)
    expect(a.minus(b).minor).toBe(6n)
    expect(a.negated().minor).toBe(-10n)
    expect(a.isGreaterThan(b)).toBe(true)
    expect(b.isLessThan(a)).toBe(true)
    expect(a.compare(mem(10n))).toBe(0)
    expect(a.minor).toBe(10n)
  })

  it('refuses an amount that is not above zero where one is required', () => {
    expect(() => mem(0n).assertPositive()).toThrow(LedgerError)
    expect(() => mem(-1n).assertPositive()).toThrow(LedgerError)
    expect(mem(1n).assertPositive().minor).toBe(1n)
  })
})

describe('LedgerRegistry', () => {
  let registry: LedgerRegistry

  beforeEach(() => {
    registry = new LedgerRegistry()
  })

  it('builds the named provider once and keeps it', async () => {
    let built = 0
    registry.register('memory', () => {
      built += 1

      return new MemoryLedger()
    })

    const first = await registry.resolve('memory')
    const second = await registry.resolve('memory')

    expect(second).toBe(first)
    expect(built).toBe(1)
  })

  it('names what is registered when configuration asks for something else', async () => {
    registry.register('memory', () => new MemoryLedger())

    await expect(registry.resolve('ckb')).rejects.toThrow(/Registered: memory/)
  })

  it('refuses to hand out a provider whose capabilities do not match it', async () => {
    registry.register('broken', () => {
      const provider = new MemoryLedger()
      provider.capabilities.withdrawals = false

      return provider
    })

    await expect(registry.resolve('broken')).rejects.toThrow(
      /can perform withdraw but does not declare withdrawals/,
    )
  })

  it('reports an adapter that declares an operation it does not back', () => {
    expect(() => LedgerCoherence.assert(new HollowProvider())).toThrow(
      /declares minting but cannot perform mint/,
    )
    expect(LedgerCoherence.check(new HollowProvider())).toBe(false)
    expect(LedgerCoherence.check(new MemoryLedger())).toBe(true)
  })

  it('judges a hand-written provider on the methods it defines', () => {
    const provider = {
      name: 'hand-written',
      label: 'Hand written',
      asset: MEM,
      capabilities: { ...new MemoryLedger().capabilities, minting: true },
    } as unknown as Ledger

    expect(() => LedgerCoherence.assert(provider)).toThrow(/cannot perform mint/)
  })
})

describe('IdempotencyStore', () => {
  it('runs the operation once for a key and replays what it produced', async () => {
    const store = new MemoryIdempotencyStore()
    const produced = new Map([['ref-1', 'the result']])
    let runs = 0

    const operation = async () => {
      runs += 1

      return { reference: 'ref-1', result: 'the result' }
    }
    const resolve = async (reference: string) => produced.get(reference) ?? null

    expect(await store.once('k', resolve, operation)).toBe('the result')
    expect(await store.once('k', resolve, operation)).toBe('the result')
    expect(runs).toBe(1)
  })

  it('runs again when the remembered handle no longer resolves', async () => {
    const store = new MemoryIdempotencyStore()
    let runs = 0

    const operation = async () => {
      runs += 1

      return { reference: `ref-${runs}`, result: runs }
    }

    await store.once('k', async () => null, operation)
    await store.once('k', async () => null, operation)

    expect(runs).toBe(2)
  })
})

describe('the reference provider', () => {
  const fundedPair = async (provider: MemoryLedger) => {
    const from = await provider.createWallet({ ownerKey: 'a', idempotencyKey: 'a' })
    const to = await provider.createWallet({ ownerKey: 'b', idempotencyKey: 'b' })
    await provider.mint({ to: from, amount: mem(1000n), idempotencyKey: 'mint' })
    provider.advance()

    return { from, to }
  }

  it('holds an outstanding spend against the balance before it settles', async () => {
    const provider = new MemoryLedger()
    const { from, to } = await fundedPair(provider)

    await provider.transfer({ from, to, amount: mem(400n), idempotencyKey: 't1' })
    const balance = await provider.balance(from)

    expect(balance.total.minor).toBe(1000n)
    expect(balance.pending.minor).toBe(400n)
    expect(balance.available.minor).toBe(600n)
  })

  it('refuses a second spend the unsettled first one has already committed', async () => {
    const provider = new MemoryLedger()
    const { from, to } = await fundedPair(provider)

    await provider.transfer({ from, to, amount: mem(800n), idempotencyKey: 't1' })

    await expect(
      provider.transfer({ from, to, amount: mem(800n), idempotencyKey: 't2' }),
    ).rejects.toMatchObject({ code: 'insufficient_funds' })
  })

  it('leaves the balance alone when settlement fails', async () => {
    const provider = new MemoryLedger()
    const { from, to } = await fundedPair(provider)

    const tx = await provider.transfer({ from, to, amount: mem(400n), idempotencyKey: 't1' })
    const failed = provider.fail(tx.reference)

    expect(failed.status).toBe('failed')
    expect(failed.failure?.code).toBe('settlement_failed')
    expect((await provider.balance(from)).total.minor).toBe(1000n)
    expect((await provider.balance(from)).available.minor).toBe(1000n)
    expect((await provider.balance(to)).total.minor).toBe(0n)
  })

  it('charges the fee to the sender and not to the recipient', async () => {
    const provider = new MemoryLedger({ fee: 10n })
    const { from, to } = await fundedPair(provider)

    await provider.transfer({ from, to, amount: mem(400n), idempotencyKey: 't1' })
    provider.advance()

    expect((await provider.balance(from)).total.minor).toBe(590n)
    expect((await provider.balance(to)).total.minor).toBe(400n)
  })

  it('takes the fast rail only when the caller asks for it', async () => {
    const provider = new MemoryLedger()
    const { from, to } = await fundedPair(provider)

    const fast = await provider.transfer({
      from,
      to,
      amount: mem(100n),
      idempotencyKey: 'fast',
      preferFast: true,
    })
    const ordinary = await provider.transfer({
      from,
      to,
      amount: mem(100n),
      idempotencyKey: 'slow',
    })

    expect(fast.rail).toBe('channel')
    expect(ordinary.rail).toBe('onchain')
  })

  it('returns the wallet its material describes when it is imported back', async () => {
    const provider = new MemoryLedger()
    const wallet = await provider.createWallet({ ownerKey: 'a', idempotencyKey: 'a' })
    const exported = await provider.exportWallet(wallet)

    const imported = await provider.importWallet({
      ownerKey: 'a',
      idempotencyKey: 'import',
      secret: exported.secret,
    })

    expect(imported.address).toBe(wallet.address)
  })

  it('pages a wallet history without repeating an entry', async () => {
    const provider = new MemoryLedger({ autoSettle: true })
    const { from, to } = await fundedPair(provider)
    for (let index = 0; index < 5; index += 1) {
      await provider.transfer({ from, to, amount: mem(10n), idempotencyKey: `t${index}` })
    }

    const first = await provider.listTransactions({ wallet: to, limit: 3 })
    const second = await provider.listTransactions({ wallet: to, limit: 3, cursor: first.cursor })

    expect(first.transactions.length).toBe(3)
    expect(first.cursor).toBe('3')
    expect(second.cursor).toBe(null)

    const references = [...first.transactions, ...second.transactions].map((tx) => tx.reference)
    expect(new Set(references).size).toBe(references.length)
  })
})

describe('the shared base class', () => {
  it('refuses an operation the provider does not declare', async () => {
    const provider = new MemoryLedger()
    provider.capabilities.minting = false

    await expect(
      provider.mint({
        to: { reference: 'anything' },
        amount: mem(1n),
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ code: 'unsupported_operation' })
  })

  it('refuses a value-moving call with no idempotency key', async () => {
    const provider = new MemoryLedger()
    const from = await provider.createWallet({ ownerKey: 'a', idempotencyKey: 'a' })
    const to = await provider.createWallet({ ownerKey: 'b', idempotencyKey: 'b' })

    await expect(
      provider.transfer({ from, to, amount: mem(1n), idempotencyKey: '  ' }),
    ).rejects.toMatchObject({ code: 'misconfigured' })
  })

  it('drops a memo a provider cannot carry rather than failing the transfer', async () => {
    const provider = new MemoryLedger({ autoSettle: true, openingBalance: 100n })
    provider.capabilities.memos = false
    const from = await provider.createWallet({ ownerKey: 'a', idempotencyKey: 'a' })
    const to = await provider.createWallet({ ownerKey: 'b', idempotencyKey: 'b' })

    const tx = await provider.transfer({
      from,
      to,
      amount: mem(1n),
      idempotencyKey: 'k',
      memo: 'hello',
    })

    expect(tx.memo).toBe(null)
  })

  it('settles on the ordinary rail when fast payments are unavailable', async () => {
    const provider = new MemoryLedger({ autoSettle: true, openingBalance: 100n })
    provider.capabilities.fastPayments = false
    const from = await provider.createWallet({ ownerKey: 'a', idempotencyKey: 'a' })
    const to = await provider.createWallet({ ownerKey: 'b', idempotencyKey: 'b' })

    const tx = await provider.transfer({
      from,
      to,
      amount: mem(1n),
      idempotencyKey: 'k',
      preferFast: true,
    })

    expect(tx.rail).toBe('onchain')
  })
})
