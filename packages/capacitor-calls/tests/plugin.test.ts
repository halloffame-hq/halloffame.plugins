import { beforeEach, describe, expect, it, vi } from 'vitest'

const registerPlugin = vi.fn(() => ({}) as unknown)

vi.mock('@capacitor/core', () => ({ registerPlugin }))

describe('the native bridge', () => {
  beforeEach(() => {
    registerPlugin.mockClear()
    vi.resetModules()
  })

  /*
   * The name is the contract with the Java side: `@CapacitorPlugin(name = "HallOfFameCalls")`.
   * Renaming either half leaves every call rejecting at runtime and nothing failing at build,
   * which on a phone reads as a call that simply never rings.
   */
  it('registers under the name the Android plugin answers to', async () => {
    await import('../src/index')

    expect(registerPlugin).toHaveBeenCalledWith('HallOfFameCalls')
  })

  it('is the registered plugin itself, not a wrapper around it', async () => {
    const registered = { marker: true }
    registerPlugin.mockReturnValueOnce(registered)

    const { HallOfFameCalls } = await import('../src/index')

    expect(HallOfFameCalls).toBe(registered)
  })
})
