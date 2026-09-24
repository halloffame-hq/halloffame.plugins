import { Amount } from './Amount'
import { Asset } from './Asset'
import { BaseLedger, type BaseLedgerOptions } from './BaseLedger'
import {
  InsufficientFundsError,
  InvalidDestinationError,
  MisconfiguredError,
  SettlementFailedError,
  WalletNotFoundError,
} from './errors'
import type {
  CreateWalletInput,
  DepositInput,
  DepositIntent,
  ImportWalletInput,
  LedgerBalance,
  LedgerCapabilities,
  LedgerHealth,
  LedgerTransaction,
  LedgerWallet,
  ListTransactionsInput,
  MintInput,
  TransactionPage,
  TransactionRef,
  TransferInput,
  WalletCustodyExport,
  WalletRef,
  WithdrawInput,
} from './types'

const MEMORY_ASSET = new Asset({ code: 'MEM', decimals: 8, label: 'In-memory unit' })

export interface MemoryLedgerOptions extends BaseLedgerOptions {
  asset?: Asset
  /** Settle movements as they are made, instead of on {@link MemoryLedger.advance}. */
  autoSettle?: boolean
  /** Charged to the sender on every movement, in minor units. */
  fee?: bigint
  /** Seeded when an embedded wallet is created, so it can transact at once. */
  openingBalance?: bigint
}

/** 
 * One wallet's holdings, and the only thing allowed to change them. 
 */
class MemoryWallet implements LedgerWallet {
  balance: Amount

  constructor(
    readonly reference: string,
    readonly address: string,
    readonly custody: LedgerWallet['custody'],
    readonly asset: Asset,
    readonly seed: string,
    opening: Amount,
  ) {
    this.balance = opening
  }

  readonly status: LedgerWallet['status'] = 'active'
  readonly createdAt = new Date()

  get secret(): LedgerWallet['secret'] {
    return { scheme: MemoryLedger.SECRET_SCHEME, payload: this.seed }
  }

  credit(amount: Amount): void {
    this.balance = this.balance.plus(amount)
  }

  debit(amount: Amount): void {
    this.balance = this.balance.minus(amount)
  }
}

/**
 * A ledger that keeps everything in this process.
 *
 * It exists to be read: it is the smallest complete implementation of the
 * contract, and the worked example the integration documentation points at. It
 * is also what a platform runs in development and in tests, so the application
 * can be exercised end to end without a chain, a node, or a funded key.
 *
 * Settlement is deliberately not instant by default. Real chains make a caller
 * wait, and an application that has only ever met an instant ledger has never
 * been asked to handle the state it will spend most of its life in.
 */
export class MemoryLedger extends BaseLedger {
  static readonly SECRET_SCHEME = 'memory.v1'

  readonly name = 'memory'
  readonly label = 'In-memory ledger'
  readonly asset: Asset
  readonly capabilities: LedgerCapabilities

  private readonly wallets = new Map<string, MemoryWallet>()
  private readonly addresses = new Map<string, string>()
  private readonly transactions = new Map<string, LedgerTransaction>()
  private readonly deposits = new Map<string, DepositIntent>()
  private readonly fee: Amount
  private readonly opening: Amount
  private readonly autoSettle: boolean
  private sequence = 0

  constructor(options: MemoryLedgerOptions = {}) {
    super(options)
    this.asset = options.asset ?? MEMORY_ASSET
    this.autoSettle = options.autoSettle ?? false
    this.fee = Amount.of(options.fee ?? 0n, this.asset)
    this.opening = Amount.of(options.openingBalance ?? 0n, this.asset)
    this.capabilities = {
      minting: true,
      deposits: true,
      withdrawals: true,
      selfCustody: true,
      externalWallets: true,
      fastPayments: true,
      memos: true,
      instantSettlement: this.autoSettle,
      confirmationsRequired: 1,
    }
  }

  async balance(ref: WalletRef): Promise<LedgerBalance> {
    const wallet = this.walletOrFail(ref)
    const pending = this.committedOutflowOf(wallet)

    return {
      asset: this.asset,
      total: wallet.balance,
      pending,
      available: wallet.balance.minus(pending),
      cursor: String(this.sequence),
    }
  }

  async transaction(ref: TransactionRef): Promise<LedgerTransaction | null> {
    return this.transactions.get(ref.reference) ?? null
  }

  async listTransactions(input: ListTransactionsInput): Promise<TransactionPage> {
    const wallet = this.walletOrFail(input.wallet)
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
    const after = input.cursor ? Number(input.cursor) : 0

    const matching = [...this.transactions.values()]
      .filter((tx) => tx.from === wallet.address || tx.to === wallet.address)
      .filter((tx) => !input.since || tx.createdAt >= input.since)
      .sort((a, b) => a.reference.localeCompare(b.reference, 'en', { numeric: true }))

    const page = matching.slice(after, after + limit)
    const next = after + page.length

    return { transactions: page, cursor: next < matching.length ? String(next) : null }
  }

  async health(): Promise<LedgerHealth> {
    return { reachable: true, blockHeight: this.sequence, detail: 'in-memory' }
  }

  async close(): Promise<void> {
    this.wallets.clear()
    this.addresses.clear()
    this.transactions.clear()
    this.deposits.clear()
  }

  /**
   * Settle everything outstanding.
   *
   * Not part of the contract. A test drives the passage of time with it; a
   * chain does the same thing by mining a block.
   */
  advance(): LedgerTransaction[] {
    const moved: LedgerTransaction[] = []

    for (const tx of this.transactions.values()) {
      if (tx.status !== 'pending' && tx.status !== 'submitted') continue
      moved.push(this.settle(tx))
    }

    return moved
  }

  /** 
   * Fail one outstanding movement, the way a chain rejects a transaction.
   * 
   * @param reference 
   * @param message 
   * @returns 
   */
  fail(reference: string, message = 'Rejected by the network.'): LedgerTransaction {
    const tx = this.transactions.get(reference)
    if (!tx) throw new SettlementFailedError(`No transaction ${reference}.`)

    return this.replace({
      ...tx,
      status: 'failed',
      settledAt: null,
      failure: { code: 'settlement_failed', message },
    })
  }

  protected async findWallet(ref: WalletRef): Promise<LedgerWallet | null> {
    return this.wallets.get(ref.reference) ?? null
  }

  protected override async findDeposit(reference: string): Promise<DepositIntent | null> {
    return this.deposits.get(reference) ?? null
  }

  protected async performCreateWallet(input: CreateWalletInput): Promise<LedgerWallet> {
    const reference = `mem-wallet-${++this.sequence}`
    const seed = `${input.ownerKey}:${reference}`
    const external = input.custody === 'external'
    const wallet = new MemoryWallet(
      reference,
      input.address ?? this.addressFor(seed),
      external ? 'external' : 'embedded',
      this.asset,
      seed,
      external ? this.zero() : this.opening,
    )

    this.wallets.set(reference, wallet)
    this.addresses.set(wallet.address, reference)

    return wallet
  }

  protected override async performImportWallet(input: ImportWalletInput): Promise<LedgerWallet> {
    if (input.secret.scheme !== MemoryLedger.SECRET_SCHEME) {
      throw new MisconfiguredError(`Unknown secret scheme ${input.secret.scheme}.`)
    }

    const address = this.addressFor(input.secret.payload)
    const known = this.addresses.get(address)
    if (known) return this.walletOrFail({ reference: known })

    return this.performCreateWallet({
      ownerKey: input.ownerKey,
      idempotencyKey: input.idempotencyKey,
      custody: 'external',
      address,
    })
  }

  /**
   * Hand back the material this wallet is controlled by.
   *
   * The application is the custodian, so what it passes in is authoritative
   * over anything remembered here. An implementation that answered from its own
   * memory instead would hand back the wrong key the moment it was restarted,
   * rebuilt, or run beside another copy of itself.
   * 
   * @param ref 
   * @returns 
   */
  protected override async performExportWallet(ref: WalletRef): Promise<WalletCustodyExport> {
    const wallet = this.walletOrFail(ref)

    return {
      address: wallet.address,
      secret: ref.secret ?? { scheme: MemoryLedger.SECRET_SCHEME, payload: wallet.seed },
      mnemonic: null,
    }
  }

  protected override async performMint(input: MintInput): Promise<LedgerTransaction> {
    const wallet = this.walletOrFail(input.to)

    return this.write({
      kind: 'mint',
      amount: input.amount,
      fee: this.zero(),
      from: null,
      to: wallet.address,
      idempotencyKey: input.idempotencyKey,
      memo: input.memo ?? null,
      rail: 'onchain',
    })
  }

  protected async performTransfer(input: TransferInput): Promise<LedgerTransaction> {
    const from = this.walletOrFail(input.from)
    const to =
      'reference' in input.to ? this.walletOrFail(input.to) : this.walletAtOrFail(input.to.address)

    if (from.reference === to.reference) {
      throw new InvalidDestinationError('A wallet cannot pay itself.')
    }

    this.assertCovers(from, input.amount.plus(this.fee))

    return this.write({
      kind: 'transfer',
      amount: input.amount,
      fee: this.fee,
      from: from.address,
      to: to.address,
      idempotencyKey: input.idempotencyKey,
      memo: input.memo ?? null,
      rail: input.preferFast ? 'channel' : 'onchain',
    })
  }

  protected override async performDeposit(input: DepositInput): Promise<DepositIntent> {
    const wallet = this.walletOrFail(input.to)
    const intent: DepositIntent = {
      reference: `mem-deposit-${++this.sequence}`,
      address: wallet.address,
      memo: input.memo ?? null,
      asset: this.asset,
      amount: input.amount ?? null,
      expiresAt: input.expiresAt ?? null,
      status: 'pending',
      uri: `memory:${wallet.address}${input.amount ? `?amount=${input.amount.minor}` : ''}`,
    }

    this.deposits.set(intent.reference, intent)

    return intent
  }

  protected override async performWithdraw(input: WithdrawInput): Promise<LedgerTransaction> {
    const from = this.walletOrFail(input.from)

    if (!input.destination.startsWith('mem1')) {
      throw new InvalidDestinationError(`${input.destination} is not a valid address.`)
    }

    this.assertCovers(from, input.amount.plus(this.fee))

    return this.write({
      kind: 'withdrawal',
      amount: input.amount,
      fee: this.fee,
      from: from.address,
      to: input.destination,
      idempotencyKey: input.idempotencyKey,
      memo: input.memo ?? null,
      rail: 'onchain',
    })
  }

  private write(
    draft: Pick<
      LedgerTransaction,
      'kind' | 'amount' | 'fee' | 'from' | 'to' | 'idempotencyKey' | 'memo' | 'rail'
    >,
  ): LedgerTransaction {
    const reference = `mem-tx-${++this.sequence}`
    const tx: LedgerTransaction = {
      ...draft,
      reference,
      status: 'submitted',
      externalTxId: reference,
      confirmations: 0,
      createdAt: new Date(),
      settledAt: null,
      failure: null,
    }

    this.transactions.set(reference, tx)

    return this.autoSettle ? this.settle(tx) : tx
  }

  /** 
   * Move the balances a settling movement implies, then mark it final.
   * 
   * @param tx 
   * @returns 
   */
  private settle(tx: LedgerTransaction): LedgerTransaction {
    this.walletAt(tx.from)?.debit(tx.amount.plus(tx.fee))
    this.walletAt(tx.to)?.credit(tx.amount)

    return this.replace({
      ...tx,
      status: 'settled',
      confirmations: this.capabilities.confirmationsRequired,
      settledAt: new Date(),
    })
  }

  private replace(tx: LedgerTransaction): LedgerTransaction {
    this.transactions.set(tx.reference, tx)

    return tx
  }

  /** 
   * What outstanding movements have already committed out of a wallet. 
   * 
   * @param wallet 
   * @returns 
   */
  private committedOutflowOf(wallet: MemoryWallet): Amount {
    let pending = this.zero()

    for (const tx of this.transactions.values()) {
      if (tx.from !== wallet.address) continue
      if (tx.status !== 'pending' && tx.status !== 'submitted') continue
      pending = pending.plus(tx.amount).plus(tx.fee)
    }

    return pending
  }

  private assertCovers(wallet: MemoryWallet, amount: Amount): void {
    if (wallet.balance.minus(this.committedOutflowOf(wallet)).isLessThan(amount)) {
      throw new InsufficientFundsError()
    }
  }

  private walletOrFail(ref: WalletRef): MemoryWallet {
    const wallet = this.wallets.get(ref.reference)
    if (!wallet) throw new WalletNotFoundError(ref.reference)

    return wallet
  }

  private walletAtOrFail(address: string): MemoryWallet {
    const wallet = this.walletAt(address)
    if (!wallet) throw new InvalidDestinationError(`No wallet at ${address}.`)

    return wallet
  }

  private walletAt(address: string | null): MemoryWallet | null {
    if (!address) return null
    const reference = this.addresses.get(address)

    return reference ? (this.wallets.get(reference) ?? null) : null
  }

  /** 
   * A short, stable, non-secret address derived from a seed.
   * 
   * @param seed 
   * @returns 
   */
  private addressFor(seed: string): string {
    let value = 0x811c9dc5

    for (let index = 0; index < seed.length; index += 1) {
      value ^= seed.charCodeAt(index)
      value = Math.imul(value, 0x01000193) >>> 0
    }

    return `mem1${value.toString(16).padStart(8, '0')}`
  }
}
