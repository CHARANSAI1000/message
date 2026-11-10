# ForYou Android & iPhone apps

The native apps are built with [Capacitor](https://capacitorjs.com) from the same React code.

- **App ID:** `com.charansai.foryou` (permanent once published)
- **App name:** ForYou
- **Projects:** `frontend/android` (Android Studio) and `frontend/ios` (Xcode)
- **Icons / splash sources:** `frontend/assets/` (regenerate with `npx @capacitor/assets generate`)

The apps load your **hosted** ForYou site (`CAP_SERVER_URL`), so sign-in, the strict security policy and all API calls behave exactly as on the web. The site must be online over HTTPS first (see [deployment.md](deployment.md)).

## Built-in protections

| | Android | iPhone |
|---|---|---|
| Screenshots / screen recording | **Blocked** (`FLAG_SECURE`, shows black) | Screenshots can't be blocked by any iOS app; **screen recording/mirroring shows a blur cover** |
| App preview in recent apps | Hidden | **Blur cover** |
| Backups of app data (encryption keys) | **Disabled** (cloud backup and device transfer) | – |

## Build an Android APK to share

Requirements: [Android Studio](https://developer.android.com/studio). Open it once and let it install the Android SDK.

```bash
make apk CAP_SERVER_URL=https://<your-app>.onrender.com
# -> frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

Send `app-debug.apk` to friends. On their phone: open the file, allow "Install unknown apps", then Install.

For the Play Store you need a **release** build signed with your own key (Android Studio → Build → Generate Signed App Bundle). Back up the keystore and passwords: without them you can never update the app.

## Build for iPhone

Requirements: Xcode (Mac App Store), and for other people's iPhones an Apple Developer Program membership ($99/year).

```bash
make ios CAP_SERVER_URL=https://<your-app>.onrender.com   # opens Xcode
```

In Xcode: select the **App** target → Signing & Capabilities → choose your Team, then Product → Archive → Distribute (TestFlight / App Store).

## Ringing when the app is closed (Firebase)

1. Create a free project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Android:** Project settings → Add app → Android → package name `com.charansai.foryou`. Download `google-services.json` and put it in `frontend/android/app/`.
3. **iPhone:** add an iOS app with bundle ID `com.charansai.foryou`. Download `GoogleService-Info.plist` into `frontend/ios/App/App/` (add it to the App target in Xcode). Upload an APNs key (Apple Developer → Keys) under Project settings → Cloud Messaging. In Xcode, add the **Push Notifications** and **Background Modes → Remote notifications** capabilities.
4. **Server:** Project settings → Service accounts → *Generate new private key*. Paste the whole JSON file into Render as `FCM_SERVICE_ACCOUNT_JSON`. It's a secret: never commit it.

Calls then arrive on Android's high-priority **Calls** channel with the ForYou ringtone (`res/raw/ringtone.wav`) and vibration, even when the app is closed. Tapping the notification opens the app, and the call screen appears.

## Known gaps (next steps)

- **Google sign-in in the apps:** Google blocks sign-in inside embedded app views, so it must open the phone's browser and return through a deep link (needs an Android SHA-1 / iOS bundle setup in Google Cloud). Email and code sign-in work now.
- Screen sharing from the phone apps (Android WebView has no screen-capture API; it needs a native WebRTC module).
