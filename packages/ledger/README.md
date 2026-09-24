# @kweela/ledger

A small, provider-neutral interface for storing and moving value.

`@kweela/ledger` gives applications a consistent way to work with balances, wallets, transfers, deposits, withdrawals, settlement, and transaction history without knowing how those operations are implemented underneath.

The implementation could be backed by CKB, Stellar, a traditional database, an internal accounting system, or something else entirely.

Your application should not need to care.

```sh
pnpm add @kweela/ledger
```

## Why this exists

Most systems that hold value eventually need the same basic operations:

- create or import a wallet
- read a balance
- issue value
- transfer value
- receive deposits
- process withdrawals
- look up transactions
- check settlement
- list transaction history

How those operations actually work varies significantly between providers.

A CKB implementation may deal with cells, scripts, transaction fees and RPC nodes. Stellar may deal with accounts, trustlines, envelopes and sequence numbers. A database-backed ledger may simply update rows inside a transaction.

Those details belong to the provider implementation.

`@kweela/ledger` defines the boundary between the application and whatever system is responsible for holding value.

Build against the interface once, then select the implementation through configuration.

---

## The Ledger interface

Every ledger implements the same core contract.

```ts
interface Ledger {
  readonly name: string
  readonly label: string
  readonly capabilities: LedgerCapabilities
  readonly asset: Asset

  createWallet(input: CreateWalletInput): Promise<LedgerWallet>

  balance(wallet: WalletRef): Promise<LedgerBalance>

  transfer(input: TransferInput): Promise<LedgerTransaction>

  transaction(ref: TransactionRef): Promise<LedgerTransaction | null>

  settlement(ref: TransactionRef): Promise<SettlementStatus>

  listTransactions(input: ListTransactionsInput): Promise<TransactionPage>

  health(): Promise<LedgerHealth>

  close(): Promise<void>

  mint?(input: MintInput): Promise<LedgerTransaction>

  deposit?(input: DepositInput): Promise<DepositIntent>

  withdraw?(input: WithdrawInput): Promise<LedgerTransaction>

  importWallet?(input: ImportWalletInput): Promise<LedgerWallet>

  exportWallet?(wallet: WalletRef): Promise<WalletCustodyExport>

  supports?(operation: LedgerOperation): boolean
}
```

Some operations are optional because not every ledger supports the same features.

For example, one provider may support deposits and withdrawals but not minting. Another may support externally owned wallets while another manages custody entirely inside the application.

These differences are exposed through `capabilities`.

```ts
ledger.capabilities.deposits
ledger.capabilities.withdrawals
ledger.capabilities.selfCustody
ledger.capabilities.externalWallets
```

Applications should use capabilities to decide what functionality is available instead of checking the provider name.

If a ledger declares that it supports something, it must implement the corresponding operation.

`LedgerCoherence` validates this when the implementation is registered so configuration errors are discovered early.

---

## Amounts

Money and token values should not be represented using JavaScript floating-point numbers.

`Amount` stores values using `bigint` minor units and keeps the associated asset attached to the value.

```ts
import { Amount, Asset } from '@kweela/ledger'

const CKB = new Asset({
  code: 'CKB',
  decimals: 8,
})

const fee = Amount.of(1000n, CKB)

const sent = Amount.units('12.5', CKB)

sent.plus(fee).toUnits()
// '12.50001'
```

Amounts belonging to different assets cannot be combined accidentally.

```ts
const ckb = Amount.units('10', CKB)
const usd = Amount.units('10', USD)

ckb.plus(usd)
// throws
```

### Serialization

JSON does not support `bigint`, so amounts are serialized using decimal strings.

```ts
sent.toJSON()
```

```ts
{
  minor: '1250000000',
  asset: {
    code: 'CKB',
    decimals: 8
  }
}
```

Use `Amount.fromJSON()` when reading the value again.

This format is also suitable for storing amounts in APIs, queues and database columns without losing precision.

---

## Errors

Each provider translates its internal failures into the common ledger error types.

Applications therefore do not need to understand provider-specific exceptions.

```ts
import { InsufficientFundsError, LedgerError } from '@kweela/ledger'

try {
  await ledger.transfer({
    // ...
  })
} catch (error) {
  if (LedgerError.is(error, 'insufficient_funds')) {
    // Handle insufficient balance.
  }

  if (LedgerError.is(error) && error.retryable) {
    // Retry when appropriate.
  }
}
```

A CKB RPC failure, Stellar submission failure, database conflict or provider timeout can therefore be handled consistently by the rest of the application.

---

## Registering providers

`LedgerRegistry` connects a provider name to the factory responsible for creating it.

```ts
import { LedgerRegistry } from '@kweela/ledger'

LedgerRegistry.shared.register('ckb', () =>
  createCkbLedger({
    // ...
  }),
)

const ledger = await LedgerRegistry.shared.resolve(config.ledger)
```

The registry stores factories instead of initialized ledger instances.

This means registering a provider does not automatically open connections, initialize clients, load keys or perform any other provider-specific setup.

Initialization only happens when the provider is actually resolved.

This makes selecting a ledger through configuration straightforward:

```env
LEDGER_PROVIDER=ckb
```

Changing the provider should not require changing application code above the ledger boundary.

---

## Implementing a ledger

The easiest way to create a provider is to extend `BaseLedger`.

```ts
import { Amount, Asset, BaseLedger } from '@kweela/ledger'

export class MyLedger extends BaseLedger {
  readonly name = 'mine'

  readonly label = 'My Ledger'

  readonly asset = new Asset({
    code: 'MYC',
    decimals: 8,
  })

  readonly capabilities = {
    minting: false,
    deposits: true,
    withdrawals: true,
    selfCustody: true,
    externalWallets: true,
    fastPayments: false,
    memos: true,
    instantSettlement: false,
    confirmationsRequired: 12,
  }

  protected async performTransfer(input) {
    /*
     * Perform the provider-specific transfer here.
     *
     * Provider errors should be translated into
     * @kweela/ledger error types.
     */
  }
}
```

`BaseLedger` handles the common behaviour that every implementation is expected to follow, including:

- amount validation
- asset validation
- capability validation
- idempotency
- common operation checks

Provider implementations only need to handle the parts that are specific to their underlying system.

You can also implement `Ledger` directly if the base class does not fit your use case.

The conformance suite treats both approaches the same.

---

## Idempotency

Moving value is one of the places where blindly retrying an operation can become expensive.

Consider this:

1. the application submits a transfer
2. the provider accepts it
3. the request times out before the application receives the response
4. the application retries
5. the transfer is submitted again

Without replay protection, the recipient may receive the value twice.

Ledger write operations therefore support idempotency keys.

```ts
await ledger.transfer({
  from: alice,
  to: bob,
  amount,
  idempotencyKey: 'payment:7f3c',
})
```

If the same operation is retried with the same key, the ledger returns the original result instead of performing the movement again.

`BaseLedger` includes an in-memory idempotency store by default.

That is useful for tests and local development, but applications moving real value should use durable storage.

```ts
class SqlIdempotencyStore extends IdempotencyStore {
  async recall(key: string) {
    /*
     * Read the stored reference.
     */
  }

  async remember(key: string, reference: string) {
    /*
     * Persist the reference.
     */
  }

  async forget(key: string) {
    /*
     * Remove the stored reference.
     */
  }
}
```

Then provide it to your ledger:

```ts
new MyLedger({
  idempotency: new SqlIdempotencyStore(db),
})
```

The exact storage system is up to the application.

It could be PostgreSQL, MySQL, Redis or anything else that can provide the required durability guarantees.

---

## Conformance testing

Having a shared interface only helps if different providers behave consistently from the application's point of view.

`@kweela/ledger` includes a conformance suite that provider implementations can run against themselves.

```ts
import { describe, expect, it } from 'vitest'

import { LedgerConformanceSuite } from '@kweela/ledger/conformance'

new LedgerConformanceSuite({
  provider: () =>
    new MyLedger({
      // test configuration
    }),

  fund: async (ledger, wallet, amount) => {
    await faucet(wallet.address, amount)
  },

  settle: async (ledger, tx) => {
    await waitForConfirmation(ledger, tx)
  },
}).run({
  describe,
  it,
  expect,
})
```

The suite verifies behaviour such as:

- the same idempotency key does not move value twice
- insufficient balances are rejected
- transferred amounts remain exact
- settlement behaves consistently
- declared capabilities can actually be used
- unsupported capabilities remain unavailable
- transaction references can be resolved consistently

The test runner is supplied by the implementation, so the package does not need to depend on Vitest, Jest or another test framework.

### Skipping unsupported cases

Some ledger designs genuinely cannot support certain operations.

Those cases can be explicitly skipped with a reason.

```ts
new LedgerConformanceSuite({
  provider: () => new MyLedger(),

  skip: {
    minting: 'This asset enters the ledger through deposits.',
  },
}).run({
  describe,
  it,
  expect,
})
```

The skipped behaviour remains visible in the test output instead of silently disappearing from coverage.

---

## MemoryLedger

`MemoryLedger` is the reference implementation included with the package.

It requires no blockchain, node, external API or database.

That makes it useful for:

- application development
- unit tests
- integration tests
- demos
- provider development
- understanding the ledger contract

```ts
const ledger = new MemoryLedger({
  fee: 10n,
})

const alice = await ledger.createWallet({
  ownerKey: 'alice',
  idempotencyKey: 'wallet:alice',
})

const bob = await ledger.createWallet({
  ownerKey: 'bob',
  idempotencyKey: 'wallet:bob',
})

await ledger.mint({
  to: alice,
  amount: Amount.of(1000n, ledger.asset),
  idempotencyKey: 'mint:1',
})

ledger.advance()

await ledger.transfer({
  from: alice,
  to: bob,
  amount: Amount.of(400n, ledger.asset),
  idempotencyKey: 'payment:7f3c',
})

ledger.advance()
```

### Settlement behaviour

`MemoryLedger` does not settle transactions immediately by default.

That is intentional.

Most real payment and blockchain systems have a period where a transaction exists but is not yet final. Applications need to handle that state correctly.

`MemoryLedger` lets tests control settlement directly.

```ts
ledger.advance()
```

settles outstanding transactions.

```ts
ledger.fail(reference)
```

marks a transaction as failed.

This makes it possible to test pending, settled and failed transaction states without waiting for a real network.

---

## Provider boundaries

`@kweela/ledger` deliberately contains no blockchain-specific implementation.

For example:

```text
Application
    │
    ▼
@kweela/ledger
    │
    ├── CKB provider
    ├── Stellar provider
    ├── Database provider
    └── Other providers
```

The package defines the contract.

Providers implement it.

That separation allows an application to use CKB today, Stellar tomorrow, or another settlement system later without rebuilding the business logic that sits above the ledger.

Provider-specific concerns such as these stay outside this package:

- signing
- custody
- RPC clients
- transaction construction
- blockchain fees
- trustlines
- cells
- channels
- account sequence numbers
- key storage
- provider authentication
- network configuration

If the application does not need to know about it, it should remain below the ledger interface.

---

## Design goals

`@kweela/ledger` is intentionally small.

The package exists to provide:

**A stable application contract**

Application code should depend on ledger behaviour rather than provider implementation details.

**Precise amounts**

All value is represented using `bigint` minor units and an explicit asset.

**Safe retries**

Idempotency prevents retries from accidentally repeating value-moving operations.

**Explicit capabilities**

Applications can discover supported functionality without checking which provider is running.

**Provider consistency**

The conformance suite keeps implementations aligned where observable behaviour matters.

**Minimal dependencies**

The core package contains no chain SDK, database driver or networking dependency.

---

## What this package is not

`@kweela/ledger` is not a blockchain SDK.

It does not decide how a CKB transaction should be constructed, how Stellar accounts should be funded, how private keys should be stored, or how a database-backed ledger should lock rows.

Those responsibilities belong to provider implementations.

The package defines the language the application and those providers use to talk to each other.

---

## License

MIT
