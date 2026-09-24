import type { Amount } from './Amount'
import type { Asset } from './Asset'
import type { LedgerErrorCode } from './errors'

/**
 * Holding and moving value, in the fewest operations that will do.
 *
 * An application that keeps balances for people needs the same handful of
 * operations whatever those balances are made of: make a wallet, read what it
 * holds, bring value into existence, move it, take it in, pay it out, look a
 * movement up, and ask whether it has settled. Everything beneath that -
 * cells, trustlines, envelopes, fees, signing, channels, RPC, a database table
 * - stops at this line and never reaches the application.
 */

export type WalletCustody = 'embedded' | 'external'

/**
 * Sealed ledger material.
 *
 * The ledger decides what goes in `payload`; the application treats it as an
 * opaque string it stores encrypted and hands back on every call.
 */
export interface LedgerSecret {
  /** Which format `payload` is in, so a ledger can rotate its encoding. */
  scheme: string
  payload: string
}

/**
 * A wallet, as the application refers to it.
 *
 * `reference` is the ledger's own handle. The application stores it and hands
 * it back; it never parses it.
 *
 * The application is the wallet's only custodian, so an operation that has to
 * sign is handed the sealed material along with the reference. A read is not:
 * asking what a wallet holds never requires being able to spend from it.
 */
export interface WalletRef {
  reference: string
  secret?: LedgerSecret | null
}

export type WalletStatus = 'active' | 'provisioning' | 'unfunded' | 'closed'

export interface LedgerWallet extends WalletRef {
  /** The public address, safe to show and to receive at. */
  address: string
  custody: WalletCustody
  asset: Asset
  /**
   * Ledger material the application must persist to keep using this wallet,
   * encrypted at rest. Never logged, never serialized to a client.
   */
  secret: LedgerSecret | null
  /** Whether the wallet can transact yet. A new account may need funding. */
  status: WalletStatus
  createdAt: Date
}

export interface LedgerBalance {
  asset: Asset
  /** Everything the wallet holds. */
  total: Amount
  /** What is committed to movements that have not settled. */
  pending: Amount
  /** What can be spent now. */
  available: Amount
  /** The ledger's position marker, for reconciliation ordering. */
  cursor: string | null
}

export type SettlementStatus =
  /** Accepted by the ledger, not yet broadcast. */
  | 'pending'
  /** Broadcast, awaiting confirmation. */
  | 'submitted'
  /** Final and irreversible as far as the ledger is concerned. */
  | 'settled'
  /** Rejected, reverted, or otherwise will not settle. */
  | 'failed'
  /** Valid for a window that has passed without settling. */
  | 'expired'
  /** The ledger cannot say, usually because it is unreachable. */
  | 'unknown'

export type LedgerTransactionKind = 'mint' | 'transfer' | 'deposit' | 'withdrawal' | 'burn'

/**
 * How a movement travelled.
 *
 * `channel` is an off-chain payment channel, such as CKB Fiber: fast and cheap,
 * settling to the chain when the channel closes. `onchain` is an ordinary
 * settled transaction.
 */
export type SettlementRail = 'onchain' | 'channel'

export interface TransactionRef {
  /** The ledger's identifier for the movement. Opaque. */
  reference: string
}

export interface LedgerFailure {
  code: LedgerErrorCode
  message: string
}

export interface LedgerTransaction extends TransactionRef {
  kind: LedgerTransactionKind
  status: SettlementStatus
  rail: SettlementRail
  amount: Amount
  /** What the ledger charged to move it. */
  fee: Amount
  from: string | null
  to: string | null
  /** The key the caller used, echoed back so a replay is recognisable. */
  idempotencyKey: string
  /** The ledger's own chain-level handle, when one exists yet. */
  externalTxId: string | null
  /** How many confirmations the ledger has seen, where it counts them. */
  confirmations: number | null
  memo: string | null
  createdAt: Date
  settledAt: Date | null
  /** Why it failed, in the contract's own terms. */
  failure: LedgerFailure | null
}

/**
 * Somewhere value can be received from outside the ledger.
 *
 * Deposits are asynchronous everywhere: the ledger hands back an address, and
 * possibly a memo, and the movement appears later.
 */
export interface DepositIntent {
  reference: string
  address: string
  memo: string | null
  asset: Asset
  /** The amount expected, when the caller declared one. */
  amount: Amount | null
  expiresAt: Date | null
  status: SettlementStatus
  /** A payment URI for wallets that understand one. */
  uri: string | null
}

/**
 * Wallet material handed to its owner.
 *
 * Taking custody means the owner receives what is needed to control the wallet
 * elsewhere. An implementation that cannot release it does not offer this.
 */
export interface WalletCustodyExport {
  address: string
  secret: LedgerSecret
  /** A human-transcribable form, where the ledger has one. */
  mnemonic: string | null
}

export interface CreateWalletInput {
  /**
   * The application's own identifier for the wallet's owner. An implementation may use
   * it for deterministic derivation; it must not be a secret.
   */
  ownerKey: string
  /** What makes this creation happen once. */
  idempotencyKey: string
  custody?: WalletCustody
  /** An address supplied by the owner, for `external` custody. */
  address?: string
  metadata?: Record<string, unknown>
}

export interface ImportWalletInput {
  ownerKey: string
  idempotencyKey: string
  secret: LedgerSecret
}

export interface MintInput {
  to: WalletRef
  amount: Amount
  idempotencyKey: string
  memo?: string | null
  metadata?: Record<string, unknown>
}

export type TransferDestination = WalletRef | { address: string }

export interface TransferInput {
  from: WalletRef
  to: TransferDestination
  amount: Amount
  idempotencyKey: string
  memo?: string | null
  /**
   * Prefer a fast off-chain rail where the ledger has one. A ledger without
   * it settles on chain instead rather than refusing.
   */
  preferFast?: boolean
  metadata?: Record<string, unknown>
}

export interface DepositInput {
  to: WalletRef
  idempotencyKey: string
  amount?: Amount | null
  memo?: string | null
  expiresAt?: Date | null
  metadata?: Record<string, unknown>
}

export interface WithdrawInput {
  from: WalletRef
  /** Where the value leaves to. Validated by the ledger, not the caller. */
  destination: string
  amount: Amount
  idempotencyKey: string
  memo?: string | null
  metadata?: Record<string, unknown>
}

export interface ListTransactionsInput {
  wallet: WalletRef
  cursor?: string | null
  limit?: number
  since?: Date | null
}

/**
 * A page of the ledger's own record of movements.
 *
 * Used by reconciliation to walk what the ledger believes happened, rather
 * than asking about one transaction at a time.
 */
export interface TransactionPage {
  transactions: LedgerTransaction[]
  /** Pass back to continue. Null when the ledger has nothing further. */
  cursor: string | null
}

export interface LedgerHealth {
  reachable: boolean
  /** The ledger's view of its own chain head, where it has one. */
  blockHeight: number | null
  detail: string | null
}

/**
 * What a ledger can actually do.
 *
 * The application reads these to decide which controls exist. It never infers a
 * capability from the ledger's name.
 */
export interface LedgerCapabilities {
  /** Value can be created, rather than only moved in from outside. */
  minting: boolean
  deposits: boolean
  withdrawals: boolean
  /** Owners may take their wallet elsewhere. */
  selfCustody: boolean
  /** An owner's existing external wallet may be attached. */
  externalWallets: boolean
  /** An off-chain rail exists for fast, cheap transfers. */
  fastPayments: boolean
  /** Transfers may carry a memo the recipient can read. */
  memos: boolean
  /** Settlement is final on acceptance, so no confirmation wait applies. */
  instantSettlement: boolean
  /** Confirmations at which the ledger considers a movement settled. */
  confirmationsRequired: number
}

/** An operation a ledger may or may not be able to perform. */
export type LedgerOperation = 'mint' | 'deposit' | 'withdraw' | 'importWallet' | 'exportWallet'

/**
 * Everything the application needs from a ledger.
 *
 * Optional members are capabilities: a ledger that declares the capability
 * must be able to perform it, and one that does not must not claim it. The
 * conformance suite enforces exactly that pairing.
 */
export interface Ledger {
  /** 
   * The configuration key that selects this ledger. 
   */
  readonly name: string
  readonly label: string
  readonly capabilities: LedgerCapabilities
  /** 
   * The asset this ledger denominates balances in. 
   */
  readonly asset: Asset

  createWallet(input: CreateWalletInput): Promise<LedgerWallet>

  balance(wallet: WalletRef): Promise<LedgerBalance>

  transfer(input: TransferInput): Promise<LedgerTransaction>

  transaction(ref: TransactionRef): Promise<LedgerTransaction | null>

  settlement(ref: TransactionRef): Promise<SettlementStatus>

  listTransactions(input: ListTransactionsInput): Promise<TransactionPage>

  health(): Promise<LedgerHealth>

  /** 
   * Release ledger connections. Called when a ledger is swapped out. 
   */
  close(): Promise<void>

  mint?(input: MintInput): Promise<LedgerTransaction>

  deposit?(input: DepositInput): Promise<DepositIntent>

  withdraw?(input: WithdrawInput): Promise<LedgerTransaction>

  importWallet?(input: ImportWalletInput): Promise<LedgerWallet>

  exportWallet?(wallet: WalletRef): Promise<WalletCustodyExport>


  /**
   * Whether this ledger can really perform an operation.
   *
   * A ledger that inherits its operations has every method whether or not it
   * can honour them, so presence is not an answer. One that defines its own
   * methods may leave this out and be judged on what it defines.
   * 
   * @param operation 
   */
  supports?(operation: LedgerOperation): boolean
}
