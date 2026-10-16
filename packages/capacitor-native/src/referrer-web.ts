import type { HallOfFameInstallReferrerPlugin, InstallReferrer } from './definitions'
import { WebPlugin } from '@capacitor/core'

/** A browser was not installed from a store. */
export class HallOfFameInstallReferrerWeb
  extends WebPlugin
  implements HallOfFameInstallReferrerPlugin
{
  async get(): Promise<InstallReferrer> {
    return { referrer: null, clickedAt: null, installedAt: null }
  }
}
