# `@hallofame/capacitor-calls`

Reusable Capacitor Android support for Hall Of Fame reseller calls. It provides native incoming-call
notifications and the lock-screen surface, Android Telecom integration, audio routing, permissions,
and device-local ringtone selection.

The implementation derives the installed application's ID, label, icon, and launch activity at
runtime. It contains no reseller package name or brand name. The host can override the plugin's
`hof_call_*` string, drawable and raw resources during normal Android resource merging.

## Installation

```sh
pnpm add @hallofame/capacitor-calls @capacitor/push-notifications
pnpm exec cap sync android
```

Import `HallOfFameCalls` from the package. The TypeScript API covers Telecom lifecycle and route
events, full-screen/overlay permission settings, and native ringtone selection.

Installing from a local path rather than a registry copies the package as it is on disk, and nothing
in that copy builds afterwards. Build this package (`pnpm -r build` at the repository root) before
installing it in a host application, or the host resolves a package with no `dist`.

## Android manifest

No call-related host manifest entries are required. The plugin's library manifest contributes:

- its lock-screen incoming-call activity;
- its self-managed Telecom connection service;
- its FCM service;
- call, notification, full-screen, overlay, foreground-service, Bluetooth and wake-lock permissions;
- optional camera and microphone hardware features.

The plugin FCM service subclasses Capacitor Push Notifications' service and forwards every message
that is not `call.ringing` or `call.settled`. This is why `@capacitor/push-notifications` is a peer
dependency, and why the library manifest removes that plugin's own service declaration: two services
answering `com.google.firebase.MESSAGING_EVENT` leave the delivery target undefined. The host still
needs its own valid Firebase configuration (`google-services.json`) and normal Google Services Gradle
setup; a reusable library cannot provide reseller Firebase credentials.

Incoming rings expect high-priority, data-only FCM messages with `event` and JSON-string `payload`
fields. `call.ringing` reads its call from `payload.meta`; `call.settled` stops the native ring.

## Ringtones

Five tones are packaged as `hof_ring_1` to `hof_ring_5`. `setRingtone({ tone })` selects one by that
position and answers with how many are packaged. Tones are numbered rather than named because the
names shown to a person belong to the application, not to this library; a reseller replaces a sound
by declaring `hof_ring_<n>` in its own `res/raw`.

## Reseller identity and customization

The library derives the application ID, visible application label, launcher icon and launch activity
from the installed host. Native actions use `<applicationId>://call/<id>?action=...`, delivered by an
explicit launch intent, so no reseller-specific URL-scheme manifest entry is needed. Answering and
declining both open the host application with that action: taking a ring off one phone is not a
decline, which needs the account's session to reach the API.

The bundled defaults can be overridden by defining resources with the same names in the host:
`hof_call_channel_name`, `hof_call_channel_description`, `hof_call_incoming_voice`,
`hof_call_incoming_video`, `hof_call_unknown_caller`, `hof_call_answer`, `hof_call_decline`, and the
`hof_call_*` drawables.

The native implementation currently targets Android. On web and iOS, Capacitor's unavailable-plugin
rejection is expected; callers should guard by platform, as the Hall Of Fame client does.
