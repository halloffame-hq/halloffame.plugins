import { Amount } from './Amount'
import { Asset } from './Asset'
import { IdempotencyStore, MemoryIdempotencyStore } from './IdempotencyStore'
import {
  AssetMismatchError,
  InvalidDestinationError,
  MisconfiguredError,
  UnsupportedOperationError,
} from './errors'
import type {
  CreateWalletInput,
  DepositInput,
  DepositIntent,
  ImportWalletInput,
  LedgerBalance,
  LedgerCapabilities,
  LedgerHealth,
  LedgerOperation,
  Ledger,
  LedgerTransaction,
  LedgerWallet,
  ListTransactionsInput,
  MintInput,
  SettlementStatus,
  TransactionPage,
  TransactionRef,
  TransferInput,
  WalletCustodyExport,
  WalletRef,
  WithdrawInput,
} from './types'

export interface BaseLedgerOptions {
  /** Where replay protection is remembered. In memory unless given one. */
  idempotency?: IdempotencyStore
}

/**
 * The half of every adapter that is not about any particular chain.
 *
 * Each public operation validates what the contract promises - a positive
 * amount, the right asset, a capability that was declared, a key that has not
 * already been spent - and only then hands a checked request to the `perform`
 * method the adapter implements. An adapter is therefore the chain and nothing
 * else, and two adapters cannot drift apart on the rules they share.
 *
 * Extending this is optional. An implementation may satisfy {@link Ledger}
 * directly, and the conformance suite judges it the same either way.
 */
export abstract class BaseLedger implements Ledger {
  abstract readonly name: string
  abstract readonly label: string
  abstract readonly capabilities: LedgerCapabilities
  abstract readonly asset: Asset

  protected readonly idempotency: IdempotencyStore

  constructor(options: BaseLedgerOptions = {}) {
    this.idempotency = options.idempotency ?? new MemoryIdempotencyStore()
  }

  /**
   * Whether this adapter backs an operation with anything.
   *
   * Every optional operation is defined here, so a subclass inherits all of
   * them whether or not it can honour them. What separates the two is the
   * `perform` hook behind each one.
   */
  supports(operation: LedgerOperation): boolean {
    const hooks: Record<LedgerOperation, unknown> = {
      mint: this.performMint,
      deposit: this.performDeposit,
      withdraw: this.performWithdraw,
      importWallet: this.performImportWallet,
      exportWallet: this.performExportWallet,
    }

    return typeof hooks[operation] === 'function'
  }

  async createWallet(input: CreateWalletInput): Promise<LedgerWallet> {
    this.assertOwnerKey(input.ownerKey)

    if (input.custody === 'external' && !this.capabilities.externalWallets) {
      throw new UnsupportedOperationError('external wallets')
    }

    return this.idempotency.once(
      this.scope('wallet', input.idempotencyKey),
      (reference) => this.findWallet({ reference }),
      async () => {
        const wallet = await this.performCreateWallet(input)

        return { reference: wallet.reference, result: wallet }
      },
    )
  }

  async importWallet(input: ImportWalletInput): Promise<LedgerWallet> {
    if (!this.capabilities.externalWallets || !this.performImportWallet) {
      throw new UnsupportedOperationError('external wallets')
    }
    this.assertOwnerKey(input.ownerKey)

    return this.idempotency.once(
      this.scope('wallet', input.idempotencyKey),
      (reference) => this.findWallet({ reference }),
      async () => {
        const wallet = await this.performImportWallet!(input)

        return { reference: wallet.reference, result: wallet }
      },
    )
  }

  async exportWallet(wallet: WalletRef): Promise<WalletCustodyExport> {
    if (!this.capabilities.selfCustody || !this.performExportWallet) {
      throw new UnsupportedOperationError('taking custody of a wallet')
    }

    return this.performExportWallet(wallet)
  }

  async mint(input: MintInput): Promise<LedgerTransaction> {
    if (!this.capabilities.minting || !this.performMint) {
      throw new UnsupportedOperationError('minting')
    }
    this.assertAmount(input.amount)

    return this.settleOnce(input.idempotencyKey, () => this.performMint!(input))
  }

  async transfer(input: TransferInput): Promise<LedgerTransaction> {
    this.assertAmount(input.amount)

    if ('reference' in input.to && input.to.reference === input.from.reference) {
      throw new InvalidDestinationError('A wallet cannot pay itself.')
    }

    return this.settleOnce(input.idempotencyKey, () =>
      this.performTransfer({
        ...input,
        preferFast: Boolean(input.preferFast) && this.capabilities.fastPayments,
        memo: this.capabilities.memos ? (input.memo ?? null) : null,
      }),
    )
  }

  async deposit(input: DepositInput): Promise<DepositIntent> {
    if (!this.capabilities.deposits || !this.performDeposit) {
      throw new UnsupportedOperationError('deposits')
    }
    if (input.amount) this.assertAmount(input.amount)

    return this.idempotency.once(
      this.scope('deposit', input.idempotencyKey),
      (reference) => this.findDeposit(reference),
      async () => {
        const intent = await this.performDeposit!(input)

        return { reference: intent.reference, result: intent }
      },
    )
  }

  async withdraw(input: WithdrawInput): Promise<LedgerTransaction> {
    if (!this.capabilities.withdrawals || !this.performWithdraw) {
      throw new UnsupportedOperationError('withdrawals')
    }
    this.assertAmount(input.amount)

    if (!input.destination?.trim()) {
      throw new InvalidDestinationError('A withdrawal needs somewhere to go.')
    }

    return this.settleOnce(input.idempotencyKey, () => this.performWithdraw!(input))
  }

  async settlement(ref: TransactionRef): Promise<SettlementStatus> {
    return (await this.transaction(ref))?.status ?? 'unknown'
  }

  abstract balance(wallet: WalletRef): Promise<LedgerBalance>
  abstract transaction(ref: TransactionRef): Promise<LedgerTransaction | null>
  abstract listTransactions(input: ListTransactionsInput): Promise<TransactionPage>
  abstract health(): Promise<LedgerHealth>
  abstract close(): Promise<void>

  /** The wallet behind a reference, or null. Used to answer a replayed key. */
  protected abstract findWallet(ref: WalletRef): Promise<LedgerWallet | null>

  protected abstract performCreateWallet(input: CreateWalletInput): Promise<LedgerWallet>

  protected abstract performTransfer(input: TransferInput): Promise<LedgerTransaction>

  protected performMint?(input: MintInput): Promise<LedgerTransaction>

  protected performDeposit?(input: DepositInput): Promise<DepositIntent>

  protected performWithdraw?(input: WithdrawInput): Promise<LedgerTransaction>

  protected performImportWallet?(input: ImportWalletInput): Promise<LedgerWallet>

  protected performExportWallet?(wallet: WalletRef): Promise<WalletCustodyExport>

  /** The deposit behind a reference, or null. Overridden by adapters with deposits. */
  protected async findDeposit(_reference: string): Promise<DepositIntent | null> {
    return null
  }

  /** Nothing of this ledger's asset, for an adapter building a zero fee. */
  protected zero(): Amount {
    return Amount.zero(this.asset)
  }

  /** Minor units of this ledger's own asset. */
  protected amount(minor: bigint | number | string): Amount {
    return Amount.of(minor, this.asset)
  }

  /** Run a value-moving operation once for its key. */
  private async settleOnce(
    idempotencyKey: string,
    operation: () => Promise<LedgerTransaction>,
  ): Promise<LedgerTransaction> {
    this.assertIdempotencyKey(idempotencyKey)

    return this.idempotency.once(
      this.scope('tx', idempotencyKey),
      (reference) => this.transaction({ reference }),
      async () => {
        const transaction = await operation()

        return { reference: transaction.reference, result: transaction }
      },
    )
  }

  /** Keys are the caller's, so one namespace per kind of thing they create. */
  private scope(kind: string, key: string): string {
    return `${this.name}:${kind}:${key}`
  }

  private assertAmount(amount: Amount): void {
    if (!amount.asset.equals(this.asset)) {
      throw new AssetMismatchError(this.asset.toString(), amount.asset.toString())
    }

    amount.assertPositive()
  }

  private assertIdempotencyKey(key: string): void {
    if (!key?.trim()) {
      throw new MisconfiguredError('Every value-moving operation needs an idempotency key.')
    }
  }

  private assertOwnerKey(ownerKey: string): void {
    if (!ownerKey?.trim()) throw new MisconfiguredError('A wallet needs an owner key.')
  }
}
