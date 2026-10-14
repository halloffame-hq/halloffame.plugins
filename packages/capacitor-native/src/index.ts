import type { HallOfFameCallsPlugin, HallOfFameGalleryPlugin } from './definitions'
import { registerPlugin } from '@capacitor/core'

export * from './definitions'

export const HallOfFameCalls = registerPlugin<HallOfFameCallsPlugin>('HallOfFameCalls', {
  web: () => import('./calls-web').then((web) => new web.HallOfFameCallsWeb()),
})

export const HallOfFameGallery = registerPlugin<HallOfFameGalleryPlugin>('HallOfFameGallery', {
  web: () => import('./gallery-web').then((web) => new web.HallOfFameGalleryWeb()),
})
