# `@hallofame/capacitor-native`

Reusable Capacitor native support for Hall Of Fame applications:

- `HallOfFameCalls` (Android): native incoming-call notifications and the lock-screen surface,
  Android Telecom integration, audio routing, permissions, and device-local ringtone selection.
- `HallOfFameGallery` (Android and iOS): the device's own photos and videos, paged newest first with
  thumbnails and video durations, for an in-app gallery.

The implementation derives the installed application's ID, label, icon, and launch activity at
runtime. It contains no reseller package name or brand name. The host can override the plugin's
`hof_call_*` string, drawable and raw resources during normal Android resource merging.

## Installation

```sh
pnpm add @hallofame/capacitor-native @capacitor/push-notifications
pnpm exec cap sync
```

## Setup

### iOS

The gallery reads the photo library, so add a usage description to your app's `Info.plist`. Set
`PHPhotoLibraryPreventAutomaticLimitedAccessAlert` when your app offers its own way to change a
limited selection (through `manageAccess()`), so iOS does not also prompt on its own:

```xml
<dict>
  ...
  <key>NSPhotoLibraryUsageDescription</key>
  <string>Describe why you need access to the person's photos and videos</string>
  <key>PHPhotoLibraryPreventAutomaticLimitedAccessAlert</key>
  <true/>
  ...
</dict>
```

Calls have no iOS implementation, so they need no iOS entries.

### Android

Nothing needs to be added by hand. The library manifest declares every permission it uses, and
Android's manifest merger adds them to your app:

```xml
<manifest>
  ...
  <!-- Calls -->
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
  <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
  <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
  <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
  <uses-permission android:name="android.permission.VIBRATE" />
  <uses-permission android:name="android.permission.WAKE_LOCK" />
  <uses-permission android:name="android.permission.MANAGE_OWN_CALLS" />

  <!-- Gallery -->
  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
  <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
  <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
  <uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" />
  ...
</manifest>
```

The gallery asks for whichever of these the device's Android version uses: `READ_EXTERNAL_STORAGE`
up to Android 12, `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` from Android 13, and
`READ_MEDIA_VISUAL_USER_SELECTED` as well from Android 14, where a person may share only some items.

If your app declares `READ_EXTERNAL_STORAGE` itself, cap it at API 32 or higher. A lower cap in the
app manifest wins the merge and leaves the gallery unable to read on Android 10 to 12:

```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
```

Google Play asks apps that hold `READ_MEDIA_IMAGES` or `READ_MEDIA_VIDEO` to justify broad photo and
video access in a Play Console declaration. An app that does not use the gallery can remove its
permissions from the merged manifest:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
  ...
  <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" tools:node="remove" />
  <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" tools:node="remove" />
  <uses-permission android:name="android.permission.READ_MEDIA_VISUAL_USER_SELECTED" tools:node="remove" />
  ...
</manifest>
```

### Asking for access

`requestAccess()` shows the system prompt only while access is undecided; afterwards it answers the
current state. Read `limited` as access to whatever the person shared:

```ts
import { HallOfFameGallery } from '@hallofame/capacitor-native'

let { access } = await HallOfFameGallery.checkAccess()
if (access === 'prompt') ({ access } = await HallOfFameGallery.requestAccess())

if (access === 'granted' || access === 'limited') {
  const { items, hasMore } = await HallOfFameGallery.list({
    offset: 0,
    limit: 48,
    types: ['image', 'video'],
  })
}

// With limited access, let the person change what they shared.
if (access === 'limited') ({ access } = await HallOfFameGallery.manageAccess())
```

`list()` rejects with the code `ACCESS_DENIED` when there is no access.

## Gallery

`checkAccess()` and `requestAccess()` answer `granted`, `limited`, `denied` or `prompt` (`unavailable`
in a browser). `limited` is Android 14's "Select photos and videos" and iOS's limited library;
`manageAccess()` lets the person change that selection. `list({ offset, limit, types })` pages the
library newest first; each item carries a base64 JPEG thumbnail, and videos a duration in seconds.
`file({ id })` answers a path the WebView reads through `Capacitor.convertFileSrc`: Android's content
URI itself, or on iOS a temporary copy, with HEIC photos converted to JPEG.

## Android manifest components

No call-related host manifest entries are required. Besides the permissions listed under
[Setup](#android), the plugin's library manifest contributes:

- its lock-screen incoming-call activity;
- its self-managed Telecom connection service;
- its FCM service;
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

The call implementation targets Android. On web and iOS, Capacitor's unavailable-plugin rejection
is expected; callers should guard by platform, as the Hall Of Fame client does.
