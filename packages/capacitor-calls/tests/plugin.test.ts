import { expect, it, vi } from 'vitest'

const registerPlugin = vi.fn(() => undefined as never)

vi.mock(import('@capacitor/core'), async (importOriginal) => ({
  ...(await importOriginal()),
  registerPlugin,
}))

/** The name is the contract with `@CapacitorPlugin(name = ...)`; a rename fails only at runtime. */
it('registers under the name the Android plugin answers to', async () => {
  await import('../src/index')

  expect(registerPlugin).toHaveBeenCalledWith(
    'HallOfFameCalls',
    expect.objectContaining({ web: expect.any(Function) }),
  )
})
