/**
 * Why an operation did not happen, in terms the application understands.
 *
 * An implementation's own error semantics stop here. Nothing downstream should ever
 * need to know which chain refused, only what it refused, so every adapter
 * translates its failures into one of these before they leave the boundary.
 */
export type LedgerErrorCode =
  | 'insufficient_funds'
  | 'wallet_not_found'
  | 'wallet_unfunded'
  | 'wallet_locked'
  | 'invalid_destination'
  | 'invalid_amount'
  | 'asset_mismatch'
  | 'duplicate_idempotency_key'
  | 'unsupported_operation'
  | 'ledger_unavailable'
  | 'settlement_failed'
  | 'rate_limited'
  | 'misconfigured'

export abstract class LedgerError extends Error {
  abstract readonly code: LedgerErrorCode

  /** Whether the same call could reasonably succeed later. */
  readonly retryable: boolean = false

  protected constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = new.target.name
  }

  /** Whether an unknown thrown value is one of the contract's failures. */
  static is(error: unknown, code?: LedgerErrorCode): error is LedgerError {
    return error instanceof LedgerError && (!code || error.code === code)
  }
}

export class InsufficientFundsError extends LedgerError {
  readonly code = 'insufficient_funds' as const

  constructor(message = 'The wallet does not hold enough to cover this.', cause?: unknown) {
    super(message, cause)
  }
}

export class WalletNotFoundError extends LedgerError {
  readonly code = 'wallet_not_found' as const

  constructor(reference: string, cause?: unknown) {
    super(`No wallet for reference ${reference}.`, cause)
  }
}

export class WalletUnfundedError extends LedgerError {
  readonly code = 'wallet_unfunded' as const

  constructor(message = 'The wallet holds too little to exist on this chain.', cause?: unknown) {
    super(message, cause)
  }
}

/**
 * The ledger needs the wallet's sealed material and was not given it.
 *
 * The application is the only custodian of what a wallet is controlled by, so
 * an operation that signs must be handed it. A read never needs it.
 */
export class WalletLockedError extends LedgerError {
  readonly code = 'wallet_locked' as const

  constructor(reference: string, cause?: unknown) {
    super(`Acting for wallet ${reference} needs its sealed material.`, cause)
  }
}

export class InvalidDestinationError extends LedgerError {
  readonly code = 'invalid_destination' as const

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class InvalidAmountError extends LedgerError {
  readonly code = 'invalid_amount' as const

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class AssetMismatchError extends LedgerError {
  readonly code = 'asset_mismatch' as const

  constructor(expected: string, received: string, cause?: unknown) {
    super(`This ledger settles in ${expected}, not ${received}.`, cause)
  }
}

export class DuplicateIdempotencyKeyError extends LedgerError {
  readonly code = 'duplicate_idempotency_key' as const

  constructor(key: string, cause?: unknown) {
    super(`The key ${key} was already used for a different operation.`, cause)
  }
}

export class UnsupportedOperationError extends LedgerError {
  readonly code = 'unsupported_operation' as const

  constructor(operation: string, cause?: unknown) {
    super(`This ledger does not support ${operation}.`, cause)
  }
}

export class LedgerUnavailableError extends LedgerError {
  readonly code = 'ledger_unavailable' as const
  override readonly retryable = true

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class SettlementFailedError extends LedgerError {
  readonly code = 'settlement_failed' as const

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class RateLimitedError extends LedgerError {
  readonly code = 'rate_limited' as const
  override readonly retryable = true

  constructor(message = 'The ledger is refusing further calls for now.', cause?: unknown) {
    super(message, cause)
  }
}

export class MisconfiguredError extends LedgerError {
  readonly code = 'misconfigured' as const

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}
