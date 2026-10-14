import type { GalleryFile, GalleryPage, HallOfFameGalleryPlugin } from './definitions'
import { WebPlugin } from '@capacitor/core'

/** Browsers expose no device library; their file picker is the way in. */
export class HallOfFameGalleryWeb extends WebPlugin implements HallOfFameGalleryPlugin {
  async checkAccess() {
    return { access: 'unavailable' as const }
  }

  async requestAccess() {
    return { access: 'unavailable' as const }
  }

  async manageAccess() {
    return { access: 'unavailable' as const }
  }

  async list(): Promise<GalleryPage> {
    return { items: [], hasMore: false }
  }

  async file(): Promise<GalleryFile> {
    throw this.unavailable('The device gallery is not available in a browser.')
  }
}
