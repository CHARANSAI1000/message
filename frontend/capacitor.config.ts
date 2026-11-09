import type { CapacitorConfig } from '@capacitor/cli';

/**
 * ForYou native apps (Android / iOS) via Capacitor.
 *
 * The apps load the hosted ForYou site, so sign-in cookies, the strict CSP and all API calls keep
 * working exactly as on the web (same origin). Build with:
 *   CAP_SERVER_URL=https://<your-app>.onrender.com npx cap sync
 */
const serverUrl = process.env.CAP_SERVER_URL;
if (!serverUrl) {
  console.warn('[capacitor] CAP_SERVER_URL is not set — the app will show the bundled UI but cannot reach the API.');
} else if (!serverUrl.startsWith('https://')) {
  throw new Error('CAP_SERVER_URL must be an https:// address (encryption needs a secure context).');
}

const config: CapacitorConfig = {
  appId: 'com.charansai.foryou',
  appName: 'ForYou',
  webDir: 'dist',
  server: serverUrl ? { url: serverUrl, cleartext: false } : undefined,
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
