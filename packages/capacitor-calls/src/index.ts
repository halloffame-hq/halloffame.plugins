import type { HallOfFameCallsPlugin } from './definitions.js'
import { registerPlugin } from '@capacitor/core'

export * from './definitions.js'

/** The single native bridge used by every Hall Of Fame reseller application. */
export const HallOfFameCalls = registerPlugin<HallOfFameCallsPlugin>('HallOfFameCalls')
