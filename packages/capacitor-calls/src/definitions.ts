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

export interface HallOfFameCallsPlugin {
  canRingFullScreen(): Promise<FullScreenCallPermission>
  openFullScreenSettings(): Promise<void>
  openOverlaySettings(): Promise<void>
  setRingtone(options: { tone: number }): Promise<{ tones: number }>
  incoming(options: { callId: string; caller: string; video: boolean }): Promise<{ held: boolean }>
  outgoing(options: { callId: string; callee: string; video: boolean }): Promise<{ held: boolean }>
  active(options: { callId: string }): Promise<void>
  end(options: { callId: string; rejected: boolean }): Promise<void>
  route(options: { callId: string; route: CallRoute }): Promise<void>
  addListener<Event extends keyof NativeCallEvents>(
    event: Event,
    handler: (data: NativeCallEvents[Event]) => void,
  ): Promise<PluginListenerHandle>
}
