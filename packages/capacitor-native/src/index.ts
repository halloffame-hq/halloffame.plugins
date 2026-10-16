import type {
  HallOfFameCallsPlugin,
  HallOfFameGalleryPlugin,
  HallOfFameInstallReferrerPlugin,
} from './definitions'
import { registerPlugin } from '@capacitor/core'

export * from './definitions'

export const HallOfFameCalls = registerPlugin<HallOfFameCallsPlugin>('HallOfFameCalls', {
  web: () => import('./calls-web').then((web) => new web.HallOfFameCallsWeb()),
})

export const HallOfFameGallery = registerPlugin<HallOfFameGalleryPlugin>('HallOfFameGallery', {
  web: () => import('./gallery-web').then((web) => new web.HallOfFameGalleryWeb()),
})

export const HallOfFameInstallReferrer = registerPlugin<HallOfFameInstallReferrerPlugin>(
  'HallOfFameInstallReferrer',
  {
    web: () => import('./referrer-web').then((web) => new web.HallOfFameInstallReferrerWeb()),
  },
)
