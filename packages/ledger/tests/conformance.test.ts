import { describe, expect, it } from 'vitest'

import { MemoryLedger } from '../src/index'
import { LedgerConformanceSuite, type ConformanceHarness } from '../src/conformance'

const harness: ConformanceHarness = { describe, it, expect: expect as never }

/**
 * The reference implementation against the suite it ships with.
 *
 * If the shared suite and the smallest complete implementation ever disagree,
 * one of the two is wrong before any chain is involved. Both settlement shapes
 * run, because an implementation that settles on acceptance and one that makes the
 * caller wait must still satisfy the same interface.
 */
describe('a ledger that makes the caller wait', () => {
  new LedgerConformanceSuite({
    ledger: () => new MemoryLedger(),
    settle: async (ledger, tx) => {
      ;(ledger as MemoryLedger).advance()

      return (await ledger.transaction({ reference: tx.reference }))!
    },
  }).run(harness)
})

describe('a ledger that settles on acceptance', () => {
  new LedgerConformanceSuite({
    ledger: () => new MemoryLedger({ autoSettle: true }),
  }).run(harness)
})
