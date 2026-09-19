import type { HallOfFameCallsPlugin } from './definitions'
import { registerPlugin } from '@capacitor/core'

export * from './definitions'

export const HallOfFameCalls = registerPlugin<HallOfFameCallsPlugin>('HallOfFameCalls', {
  web: () => import('./web').then((web) => new web.HallOfFameCallsWeb()),
})
