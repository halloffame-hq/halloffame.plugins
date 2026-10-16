import { expect, it, vi } from 'vitest'

const registerPlugin = vi.fn(() => undefined as never)

vi.mock(import('@capacitor/core'), async (importOriginal) => ({
  ...(await importOriginal()),
  registerPlugin,
}))

/**
 * The names are the contract with `@CapacitorPlugin(name = ...)` and the iOS `jsName`; a rename
 * fails only at runtime.
 */
it('registers under the names the native plugins answer to', async () => {
  await import('../src/index')

  expect(registerPlugin).toHaveBeenCalledWith(
    'HallOfFameCalls',
    expect.objectContaining({ web: expect.any(Function) }),
  )
  expect(registerPlugin).toHaveBeenCalledWith(
    'HallOfFameGallery',
    expect.objectContaining({ web: expect.any(Function) }),
  )
  expect(registerPlugin).toHaveBeenCalledWith(
    'HallOfFameInstallReferrer',
    expect.objectContaining({ web: expect.any(Function) }),
  )
})

it('reports the gallery as unavailable in a browser', async () => {
  const { HallOfFameGalleryWeb } = await import('../src/gallery-web')
  const gallery = new HallOfFameGalleryWeb()

  await expect(gallery.checkAccess()).resolves.toEqual({ access: 'unavailable' })
  await expect(gallery.list()).resolves.toEqual({ items: [], hasMore: false })
})

it('reports no install referrer in a browser', async () => {
  const { HallOfFameInstallReferrerWeb } = await import('../src/referrer-web')

  await expect(new HallOfFameInstallReferrerWeb().get()).resolves.toEqual({
    referrer: null,
    clickedAt: null,
    installedAt: null,
  })
})
