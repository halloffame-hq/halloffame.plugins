import { Amount } from './Amount'
import { LedgerCoherence } from './LedgerRegistry'
import { LedgerError, type LedgerErrorCode } from './errors'
import type { Ledger, LedgerTransaction, LedgerWallet, WalletRef } from './types'

/**
 * The test runner, as the suite needs it.
 *
 * Taken as a parameter rather than imported, so an adapter can run the suite
 * under whatever it already uses.
 */
export interface ConformanceHarness {
  describe(name: string, body: () => void): void
  it(name: string, body: () => void | Promise<void>): void
  expect: ConformanceExpect
}

export interface ConformanceExpect {
  (actual: unknown): {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
  }
}

export type ConformanceCase =
  | 'capability_coherence'
  | 'wallet_creation'
  | 'wallet_creation_is_idempotent'
  | 'balance_of_new_wallet'
  | 'unknown_wallet'
  | 'transfer_moves_value'
  | 'transfer_is_idempotent'
  | 'transfer_rejects_overdraft'
  | 'transfer_rejects_self'
  | 'transfer_rejects_wrong_asset'
  | 'transaction_lookup'
  | 'settlement_status'
  | 'transaction_listing'
  | 'minting'
  | 'deposits'
  | 'withdrawals'
  | 'self_custody'

export interface ConformanceOptions {
  /** A ledger with no history. Called once per case. */
  ledger(): Promise<Ledger> | Ledger

  /**
   * Put value into a wallet so it can spend.
   *
   * An adapter that can mint does not need this. One that cannot - a chain
   * where value only arrives from outside - funds from a faucet or a treasury.
   */
  fund?(ledger: Ledger, wallet: WalletRef, amount: Amount): Promise<void>

  /**
   * Drive the ledger until the movement is final.
   *
   * A chain mines; the in-memory ledger is told to. Omitted by a ledger
   * that settles on acceptance.
   */
  settle?(ledger: Ledger, tx: LedgerTransaction): Promise<LedgerTransaction>

  /** What cases transact with, in minor units. Large enough to survive a fee. */
  amount?: bigint

  /** Skip a case an adapter genuinely cannot reach, with the reason why. */
  skip?: Partial<Record<ConformanceCase, string>>
}

/**
 * What every adapter must agree to, whatever it runs on.
 *
 * The contract is only worth the name if two adapters behave the same way
 * where the application can tell the difference: a replayed key moves value
 * once, an overdraft is refused, a settled amount is the amount that was asked
 * for, and a capability that is declared can actually be called.
 *
 * Cases an adapter cannot reach are skipped by name with a stated reason, so a
 * gap is visible in the report rather than absent from it.
 */
export class LedgerConformanceSuite {
  private readonly amountMinor: bigint

  constructor(private readonly options: ConformanceOptions) {
    this.amountMinor = options.amount ?? 1000n
  }

  /** Register every case with the given runner. */
  run(harness: ConformanceHarness): void {
    harness.describe('ledger contract conformance', () => {
      for (const [name, title, body] of this.cases()) {
        const reason = this.options.skip?.[name]

        harness.it(`${title}${reason ? ` (skipped: ${reason})` : ''}`, async () => {
          if (reason) return
          await body.call(this, new ConformanceAssertions(harness.expect))
        })
      }
    })
  }

  private cases(): [
    ConformanceCase,
    string,
    (this: LedgerConformanceSuite, t: ConformanceAssertions) => Promise<void>,
  ][] {
    return [
      [
        'capability_coherence',
        'declares only capabilities it implements',
        this.capabilityCoherence,
      ],
      ['wallet_creation', 'creates a wallet with a usable address', this.walletCreation],
      [
        'wallet_creation_is_idempotent',
        'returns the same wallet for one key',
        this.walletIdempotency,
      ],
      ['balance_of_new_wallet', 'reports a coherent balance', this.balanceCoherence],
      ['unknown_wallet', 'refuses a wallet reference it never issued', this.unknownWallet],
      ['transfer_moves_value', 'moves the asked amount to the recipient', this.transferMovesValue],
      ['transfer_is_idempotent', 'moves value once for a repeated key', this.transferIdempotency],
      ['transfer_rejects_overdraft', 'refuses more than the wallet holds', this.transferOverdraft],
      ['transfer_rejects_self', 'refuses a wallet paying itself', this.transferToSelf],
      [
        'transfer_rejects_wrong_asset',
        'refuses an amount of another asset',
        this.transferWrongAsset,
      ],
      ['transaction_lookup', 'finds a movement by its reference', this.transactionLookup],
      ['settlement_status', 'reports a status the contract defines', this.settlementStatus],
      ['transaction_listing', 'lists a wallet own movements', this.transactionListing],
      ['minting', 'creates value when it declares it can', this.minting],
      ['deposits', 'offers somewhere to receive when it declares deposits', this.deposits],
      ['withdrawals', 'pays out and refuses a bad destination', this.withdrawals],
      ['self_custody', 'releases wallet material when it declares custody', this.selfCustody],
    ]
  }

  private async capabilityCoherence(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()

    LedgerCoherence.assert(ledger)
    t.equals(typeof ledger.name, 'string')
    t.equals(typeof ledger.label, 'string')
    t.true(ledger.asset.decimals >= 0, 'the asset declares a usable precision')
  }

  private async walletCreation(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    const wallet = await ledger.createWallet({
      ownerKey: 'owner-1',
      idempotencyKey: 'conformance:create:1',
    })

    t.true(Boolean(wallet.reference), 'the wallet has a reference')
    t.true(Boolean(wallet.address), 'the wallet has an address')
    t.equals(wallet.custody, 'embedded')
    t.equals(wallet.asset.code, ledger.asset.code)
  }

  private async walletIdempotency(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    const key = 'conformance:create:repeat'
    const first = await ledger.createWallet({ ownerKey: 'owner-1', idempotencyKey: key })
    const second = await ledger.createWallet({ ownerKey: 'owner-1', idempotencyKey: key })

    t.equals(second.reference, first.reference)
    t.equals(second.address, first.address)
  }

  private async balanceCoherence(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    const wallet = await ledger.createWallet({
      ownerKey: 'owner-1',
      idempotencyKey: 'conformance:balance:1',
    })
    const balance = await ledger.balance(wallet)

    t.equals(balance.asset.code, ledger.asset.code)
    t.true(
      balance.available.equals(balance.total.minus(balance.pending)),
      'available is what is left after what is committed',
    )
    t.true(!balance.total.isNegative, 'a balance is never negative')
  }

  private async unknownWallet(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()

    await t.fails('wallet_not_found', () =>
      ledger.balance({ reference: 'conformance-nonexistent' }),
    )
  }

  private async transferMovesValue(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    const from = await this.fundedWallet(ledger, 'sender')
    const to = await this.emptyWallet(ledger, 'recipient')
    const before = await ledger.balance(to)

    const tx = await ledger.transfer({
      from,
      to,
      amount: this.amount(ledger),
      idempotencyKey: 'conformance:transfer:1',
    })
    const settled = await this.settle(ledger, tx)

    t.equals(settled.kind, 'transfer')
    t.true(settled.amount.equals(this.amount(ledger)), 'the settled amount is the asked amount')
    t.equals(settled.idempotencyKey, 'conformance:transfer:1')

    const after = await ledger.balance(to)
    t.true(
      after.total.minus(before.total).equals(this.amount(ledger)),
      'the recipient gained exactly what was sent',
    )
  }

  private async transferIdempotency(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    const from = await this.fundedWallet(ledger, 'sender')
    const to = await this.emptyWallet(ledger, 'recipient')
    const key = 'conformance:transfer:repeat'

    const first = await ledger.transfer({
      from,
      to,
      amount: this.amount(ledger),
      idempotencyKey: key,
    })
    const second = await ledger.transfer({
      from,
      to,
      amount: this.amount(ledger),
      idempotencyKey: key,
    })

    t.equals(second.reference, first.reference)

    await this.settle(ledger, first)
    const balance = await ledger.balance(to)
    t.true(
      balance.total.equals(this.amount(ledger)),
      'the repeated key moved the value once, not twice',
    )
  }

  private async transferOverdraft(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    const from = await this.fundedWallet(ledger, 'sender', this.amountMinor)
    const to = await this.emptyWallet(ledger, 'recipient')

    await t.fails('insufficient_funds', () =>
      ledger.transfer({
        from,
        to,
        amount: Amount.of(this.amountMinor * 1000n, ledger.asset),
        idempotencyKey: 'conformance:transfer:overdraft',
      }),
    )
  }

  private async transferToSelf(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    const wallet = await this.fundedWallet(ledger, 'sender')

    await t.fails('invalid_destination', () =>
      ledger.transfer({
        from: wallet,
        to: wallet,
        amount: this.amount(ledger),
        idempotencyKey: 'conformance:transfer:self',
      }),
    )
  }

  private async transferWrongAsset(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    const from = await this.fundedWallet(ledger, 'sender')
    const to = await this.emptyWallet(ledger, 'recipient')

    await t.fails('asset_mismatch', () =>
      ledger.transfer({
        from,
        to,
        amount: Amount.of(this.amountMinor, { code: 'NOT-THIS-ASSET', decimals: 2 }),
        idempotencyKey: 'conformance:transfer:asset',
      }),
    )
  }

  private async transactionLookup(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    const from = await this.fundedWallet(ledger, 'sender')
    const to = await this.emptyWallet(ledger, 'recipient')
    const tx = await ledger.transfer({
      from,
      to,
      amount: this.amount(ledger),
      idempotencyKey: 'conformance:lookup:1',
    })

    const found = await ledger.transaction({ reference: tx.reference })
    t.equals(found?.reference, tx.reference)
    t.true(Boolean(found && found.amount.equals(this.amount(ledger))), 'the lookup kept the amount')

    const missing = await ledger.transaction({ reference: 'conformance-nonexistent-tx' })
    t.equals(missing, null)
  }

  private async settlementStatus(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    const from = await this.fundedWallet(ledger, 'sender')
    const to = await this.emptyWallet(ledger, 'recipient')
    const tx = await ledger.transfer({
      from,
      to,
      amount: this.amount(ledger),
      idempotencyKey: 'conformance:settlement:1',
    })

    const known = ['pending', 'submitted', 'settled', 'failed', 'expired', 'unknown']
    const status = await ledger.settlement({ reference: tx.reference })
    t.true(known.includes(status), `"${status}" is a status the contract defines`)

    const unknown = await ledger.settlement({ reference: 'conformance-nonexistent-tx' })
    t.equals(unknown, 'unknown')

    const settled = await this.settle(ledger, tx)
    t.equals(settled.status, 'settled')
  }

  private async transactionListing(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    const from = await this.fundedWallet(ledger, 'sender')
    const to = await this.emptyWallet(ledger, 'recipient')
    const tx = await ledger.transfer({
      from,
      to,
      amount: this.amount(ledger),
      idempotencyKey: 'conformance:listing:1',
    })
    await this.settle(ledger, tx)

    const page = await ledger.listTransactions({ wallet: to, limit: 10 })
    t.true(
      page.transactions.some((entry) => entry.reference === tx.reference),
      'the recipient history contains the movement',
    )
  }

  private async minting(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    if (!ledger.capabilities.minting) return

    const wallet = await ledger.createWallet({
      ownerKey: 'owner-mint',
      idempotencyKey: 'conformance:mint:wallet',
    })
    const before = await ledger.balance(wallet)

    const tx = await ledger.mint!({
      to: wallet,
      amount: this.amount(ledger),
      idempotencyKey: 'conformance:mint:1',
    })
    await this.settle(ledger, tx)

    const replay = await ledger.mint!({
      to: wallet,
      amount: this.amount(ledger),
      idempotencyKey: 'conformance:mint:1',
    })
    t.equals(replay.reference, tx.reference)

    const after = await ledger.balance(wallet)
    t.true(
      after.total.minus(before.total).equals(this.amount(ledger)),
      'minting added exactly what was asked for, once',
    )
  }

  private async deposits(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    if (!ledger.capabilities.deposits) return

    const wallet = await ledger.createWallet({
      ownerKey: 'owner-deposit',
      idempotencyKey: 'conformance:deposit:wallet',
    })
    const intent = await ledger.deposit!({
      to: wallet,
      amount: this.amount(ledger),
      idempotencyKey: 'conformance:deposit:1',
    })

    t.true(Boolean(intent.address), 'the deposit has somewhere to arrive')
    t.equals(intent.asset.code, ledger.asset.code)

    const replay = await ledger.deposit!({
      to: wallet,
      amount: this.amount(ledger),
      idempotencyKey: 'conformance:deposit:1',
    })
    t.equals(replay.reference, intent.reference)
  }

  private async withdrawals(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    if (!ledger.capabilities.withdrawals) return

    const from = await this.fundedWallet(ledger, 'sender')
    const elsewhere = await ledger.createWallet({
      ownerKey: 'owner-out',
      idempotencyKey: 'conformance:withdraw:target',
    })

    const tx = await ledger.withdraw!({
      from,
      destination: elsewhere.address,
      amount: this.amount(ledger),
      idempotencyKey: 'conformance:withdraw:1',
    })
    t.equals(tx.kind, 'withdrawal')
    t.true(tx.amount.equals(this.amount(ledger)), 'the withdrawal is for the asked amount')

    await t.fails('invalid_destination', () =>
      ledger.withdraw!({
        from,
        destination: 'conformance-not-an-address',
        amount: this.amount(ledger),
        idempotencyKey: 'conformance:withdraw:invalid',
      }),
    )
  }

  private async selfCustody(t: ConformanceAssertions): Promise<void> {
    const ledger = await this.ledger()
    if (!ledger.capabilities.selfCustody) return

    const wallet = await ledger.createWallet({
      ownerKey: 'owner-custody',
      idempotencyKey: 'conformance:custody:1',
    })
    const exported = await ledger.exportWallet!(wallet)

    t.equals(exported.address, wallet.address)
    t.true(Boolean(exported.secret.scheme), 'the exported material names its scheme')
    t.true(Boolean(exported.secret.payload), 'the exported material carries the key')
  }

  private async ledger(): Promise<Ledger> {
    return this.options.ledger()
  }

  private amount(ledger: Ledger): Amount {
    return Amount.of(this.amountMinor, ledger.asset)
  }

  /** 
   * A wallet holding enough to spend, however this adapter can produce one. 
   * 
   * @param ledger 
   * @param ownerKey 
   * @param minor 
   * @returns 
   */
  private async fundedWallet(
    ledger: Ledger,
    ownerKey: string,
    minor = this.amountMinor * 10n,
  ): Promise<LedgerWallet> {
    const wallet = await this.emptyWallet(ledger, ownerKey)
    const amount = Amount.of(minor, ledger.asset)

    if (this.options.fund) {
      await this.options.fund(ledger, wallet, amount)
    } else if (ledger.capabilities.minting && ledger.mint) {
      const minted = await ledger.mint({
        to: wallet,
        amount,
        idempotencyKey: `conformance:fund:${wallet.reference}`,
      })
      await this.settle(ledger, minted)
    }

    return wallet
  }

  private async emptyWallet(ledger: Ledger, ownerKey: string): Promise<LedgerWallet> {
    return ledger.createWallet({
      ownerKey,
      idempotencyKey: `conformance:wallet:${ownerKey}:${++LedgerConformanceSuite.sequence}`,
    })
  }

  private async settle(ledger: Ledger, tx: LedgerTransaction): Promise<LedgerTransaction> {
    if (!this.options.settle) return (await ledger.transaction({ reference: tx.reference })) ?? tx

    return this.options.settle(ledger, tx)
  }

  private static sequence = 0
}

/** 
 * The assertions the suite makes, over whatever runner it was handed. 
 */
class ConformanceAssertions {
  constructor(private readonly expect: ConformanceExpect) { }

  equals(actual: unknown, expected: unknown): void {
    this.expect(actual).toBe(expected)
  }

  true(actual: boolean, because: string): void {
    this.expect(actual ? because : `not true: ${because}`).toBe(because)
  }

  /** 
   * Assert an operation fails with one of the contract's own codes. 
   * 
   * @param code 
   * @param body 
   */
  async fails(code: LedgerErrorCode, body: () => Promise<unknown>): Promise<void> {
    let thrown: unknown

    try {
      await body()
    } catch (error) {
      thrown = error
    }

    this.expect(thrown instanceof LedgerError ? (thrown as LedgerError).code : thrown).toBe(code)
  }
}

/** Run the shared suite against one adapter. */
export function runLedgerConformance(
  harness: ConformanceHarness,
  options: ConformanceOptions,
): void {
  new LedgerConformanceSuite(options).run(harness)
}
