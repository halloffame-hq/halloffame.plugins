import type {
  CallRoute,
  FullScreenCallPermission,
  HallOfFameCallsPlugin,
  IncomingCallOptions,
} from './definitions'

import { WebPlugin } from '@capacitor/core'

const TAG = 'hallofame-call'
const STORE = 'hallofame.calls.ringtone'
const SOURCE = 'hallofame-calls'

const api = () => (typeof Notification === 'undefined' ? null : Notification)
const page = () => (typeof document === 'undefined' ? null : document)
const media = () => (typeof navigator === 'undefined' ? null : (navigator.mediaDevices ?? null))
const workers = () => (typeof navigator === 'undefined' ? null : (navigator.serviceWorker ?? null))

type Sinkable = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }

/** A browser's answer to ringing someone who is not looking at the tab. */
export class HallOfFameCallsWeb extends WebPlugin implements HallOfFameCallsPlugin {
  private ring: IncomingCallOptions | null = null
  private bare: Notification | null = null
  private tone: Sinkable | null = null
  private sink = ''
  private listening = false
  private readonly onVisibility = () => void this.follow()
  private readonly onMessage = (event: MessageEvent) => this.acted(event)

  /** `overlay` is held: there is no second permission here to send anyone looking for. */
  async canRingFullScreen(): Promise<FullScreenCallPermission> {
    return {
      granted: api()?.permission === 'granted',
      askable: api()?.permission === 'default',
      overlay: true,
    }
  }

  async openFullScreenSettings(): Promise<void> {
    if (api()?.permission !== 'default') return

    await api()
      ?.requestPermission()
      .catch(() => undefined)
  }

  async openOverlaySettings(): Promise<void> { }

  /** The application bundles the audio, so it sends the source along with the choice. */
  async setRingtone(options: { tone: number; src?: string }): Promise<{ tones: number }> {
    try {
      localStorage.setItem(STORE, JSON.stringify({ tone: options.tone, src: options.src ?? '' }))
    } catch {
      // Private browsing refuses storage; the choice then lasts as long as the tab.
    }

    return { tones: 0 }
  }

  /** A page picks an output device rather than a built-in speaker; `route` does that. */
  async ringOnSpeaker(): Promise<void> { }

  async incoming(options: IncomingCallOptions): Promise<{ held: boolean }> {
    const here = page()
    if (!here || !options.callId) return { held: false }

    this.ring = options
    here.addEventListener('visibilitychange', this.onVisibility)
    this.listen()
    this.play()
    await this.follow()

    return { held: api()?.permission === 'granted' }
  }

  /** Nothing rings for a call this device placed. */
  async outgoing(): Promise<{ held: boolean }> {
    return { held: false }
  }

  async active(options: { callId: string }): Promise<void> {
    await this.stop(options.callId)
  }

  async end(options: { callId: string }): Promise<void> {
    await this.stop(options.callId)
  }

  /** Moves the ring to the first output device whose label matches the route. */
  async route(options: { callId: string; route: CallRoute }): Promise<void> {
    const outputs = await this.outputs()
    this.sink = outputs.find((output) => named(output.label) === options.route)?.deviceId ?? ''
    await this.applySink()
  }

  private play() {
    const saved = this.saved()
    if (!saved.src) return

    const tone = new Audio(saved.src) as Sinkable
    tone.loop = true
    this.tone = tone
    void this.applySink()
    void tone.play().catch(() => undefined)
  }

  private saved(): { tone: number; src: string } {
    try {
      const held: unknown = JSON.parse(localStorage.getItem(STORE) ?? '{}')

      return { tone: 1, src: '', ...(held as object) }
    } catch {
      return { tone: 1, src: '' }
    }
  }

  private async applySink() {
    if (!this.tone?.setSinkId || !this.sink) return

    await this.tone.setSinkId(this.sink).catch(() => undefined)
  }

  private async outputs(): Promise<MediaDeviceInfo[]> {
    const devices = media()
    if (!devices?.enumerateDevices) return []

    return await devices
      .enumerateDevices()
      .then((all) => all.filter((one) => one.kind === 'audiooutput'))
      .catch(() => [])
  }

  /** Answer and decline only exist on a worker registration; a bare notification has a click. */
  private async follow() {
    const here = page()
    if (!this.ring || !here) return
    if (here.visibilityState === 'visible') return await this.close()
    if (api()?.permission !== 'granted') return

    const text = this.ring.text ?? {}
    const caller = this.ring.caller.trim() || 'Someone'
    const options: NotificationOptions = {
      body: text.body ?? '',
      tag: TAG,
      requireInteraction: true,
      silent: true,
      icon: iconHref(),
      data: { kind: 'call', callId: this.ring.callId },
    }

    const registration = await workers()?.getRegistration()
    if (registration) {
      await registration.showNotification(caller, {
        ...options,
        actions: [
          { action: 'answer', title: text.answer ?? 'Answer' },
          { action: 'decline', title: text.decline ?? 'Decline' },
        ],
      } as NotificationOptions)

      return
    }

    if (this.bare) return
    try {
      this.bare = new Notification(caller, options)
      this.bare.onclick = () => {
        window.focus()
        void this.close()
      }
    } catch {
      // Some browsers only show notifications from a worker, and none is registered.
    }
  }

  private listen() {
    if (this.listening) return

    workers()?.addEventListener('message', this.onMessage)
    this.listening = true
  }

  /** The worker forwards the button that was pressed; the events match the Android ones. */
  private acted(event: MessageEvent) {
    const message = event.data as {
      source?: string
      action?: string
      callId?: string
    }
    if (message?.source !== SOURCE || !message.callId) return

    if (message.action === 'answer') this.notifyListeners('answer', { callId: message.callId })
    if (message.action === 'decline') this.notifyListeners('reject', { callId: message.callId })
  }

  private async stop(callId: string) {
    if (this.ring && callId && this.ring.callId !== callId) return

    this.ring = null
    page()?.removeEventListener('visibilitychange', this.onVisibility)
    if (this.tone) {
      this.tone.pause()
      this.tone.removeAttribute('src')
      this.tone.load()
      this.tone = null
    }
    await this.close()
  }

  private async close() {
    this.bare?.close()
    this.bare = null

    const registration = await workers()?.getRegistration()
    const shown = await registration?.getNotifications({ tag: TAG })
    shown?.forEach((one) => one.close())
  }
}

const named = (label: string): CallRoute => {
  const name = label.toLowerCase()
  if (/bluetooth/.test(name)) return 'bluetooth'
  if (/headphone|headset|wired/.test(name)) return 'headset'
  if (/earpiece|receiver/.test(name)) return 'earpiece'

  return 'speaker'
}

const iconHref = () =>
  page()?.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href || undefined
