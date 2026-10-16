import type { PluginListenerHandle } from '@capacitor/core'

export type CallRoute = 'earpiece' | 'speaker' | 'bluetooth' | 'headset'

export interface FullScreenCallPermission {
  granted: boolean
  askable: boolean
  overlay: boolean
}

export interface NativeCallEvents {
  answer: { callId: string }
  reject: { callId: string }
  disconnect: { callId: string }
  audioRoute: { route: CallRoute; available: CallRoute[] }
  showIncoming: { callId: string; caller: string; video: boolean }
}

export interface IncomingCallOptions {
  callId: string
  caller: string
  video: boolean
  /** Notification copy. The application catalogues and translates it; Android uses resources. */
  text?: { body?: string; answer?: string; decline?: string }
}

export interface HallOfFameCallsPlugin {
  canRingFullScreen(): Promise<FullScreenCallPermission>
  openFullScreenSettings(): Promise<void>
  openOverlaySettings(): Promise<void>
  /** `src` is the browser's audio for that tone; Android plays its own packaged copy. */
  setRingtone(options: { tone: number; src?: string }): Promise<{ tones: number }>
  ringOnSpeaker(options: { active: boolean }): Promise<void>
  incoming(options: IncomingCallOptions): Promise<{ held: boolean }>
  outgoing(options: { callId: string; callee: string; video: boolean }): Promise<{ held: boolean }>
  active(options: { callId: string }): Promise<void>
  end(options: { callId: string; rejected: boolean }): Promise<void>
  route(options: { callId: string; route: CallRoute }): Promise<void>
  addListener<Event extends keyof NativeCallEvents>(
    event: Event,
    handler: (data: NativeCallEvents[Event]) => void,
  ): Promise<PluginListenerHandle>
}

/**
 * How much of the device library the application may read.
 *
 * `limited` is the person having shared only some items: Android 14's
 * "Select photos and videos" and iOS's limited library.
 */
export type GalleryAccess = 'granted' | 'limited' | 'denied' | 'prompt' | 'unavailable'

export type GalleryMediaType = 'image' | 'video'

export interface GalleryItem {
  /** Android's content URI, or iOS's asset identifier. */
  id: string
  type: GalleryMediaType
  mimeType: string
  name: string
  width: number
  height: number
  /** Seconds, for a video. */
  duration?: number
  /** ISO 8601. */
  createdAt: string
  /** A small JPEG, base64 encoded. */
  thumbnail: string
}

export interface GalleryPageOptions {
  offset: number
  limit: number
  types: GalleryMediaType[]
  /** Longest side of each thumbnail, in pixels. */
  thumbnailSize?: number
}

export interface GalleryPage {
  items: GalleryItem[]
  hasMore: boolean
}

export interface GalleryFile {
  /** A native path or URI; read it through `Capacitor.convertFileSrc`. */
  path: string
  mimeType: string
  name: string
}

export interface HallOfFameGalleryPlugin {
  checkAccess(): Promise<{ access: GalleryAccess }>
  requestAccess(): Promise<{ access: GalleryAccess }>
  /** Lets a person with limited access change which items the application can see. */
  manageAccess(): Promise<{ access: GalleryAccess }>
  /** Newest first. */
  list(options: GalleryPageOptions): Promise<GalleryPage>
  file(options: { id: string }): Promise<GalleryFile>
}

export interface InstallReferrer {
  /** The store's `referrer` parameter, for example `ref=username`, or null when there was none. */
  referrer: string | null
  /** Epoch milliseconds. */
  clickedAt: number | null
  /** Epoch milliseconds. */
  installedAt: number | null
}

export interface HallOfFameInstallReferrerPlugin {
  /** Android reads the Play Install Referrer; iOS and browsers always report none. */
  get(): Promise<InstallReferrer>
}
