# Feature matrix

"Implemented" means it exists in code and is covered by automated tests (backend: pytest against real PostgreSQL; client crypto: vitest). The main UI flows were also driven end to end in headless Chromium. Google sign-in has only been tested with a mocked token, because a real Google login needs your OAuth origins configured.

| Area | Capability | Status |
|---|---|---|
| Accounts | Email + username + password sign-up with emailed 6-digit verification code; sign in with email or username | Implemented |
| Passwordless | Sign in with an emailed code; forgot-password reset by code (signs out all devices) | Implemented |
| Google | Sign in with Google (ID token verified server-side; links to a verified email account; new users pick a username) | Implemented (needs Authorized JavaScript origins set in Google Cloud) |
| Sessions | Opaque HttpOnly cookie sessions, idle + absolute expiry, list/revoke, logout | Implemented |
| Account | Change password (signs out other devices), delete account (cascades all data) | Implemented |
| Abuse | Rate limits on register, login (per IP and per username), lookup, send, sync | Implemented (in-memory, single instance) |
| Messaging | One-to-one E2EE text, instant delivery over WebSocket (polling fallback), 4,000-character limit | Implemented |
| Edit / delete | Edit own messages for 15 minutes; delete for me (this device) or for everyone (sender) | Implemented |
| Media | E2EE photos (resized, location data stripped), documents up to 10 MB, voice messages | Implemented |
| Calls | One-to-one E2EE voice and video calls (WebRTC, encrypted signalling), mute, camera on/off, switch camera, call history | Implemented (TURN relay optional) |
| Screen sharing | Share your screen during a call | Desktop browsers; not available in mobile browsers |
| Notifications | Ring and notify while closed (Web Push), sounds, silent mode, vibration, 3 ringtones | Implemented (Android Chrome, desktop; iPhone needs Home Screen install) |
| Profile | Change username, profile photo | Implemented |
| Disappearing | Per-message timers (5 min – 1 week); server-side 30-day retention cap | Implemented |
| Verification | Safety numbers, key pinning (TOFU), key-change warning that blocks sending | Implemented |
| Contacts | Add by exact username (no directory), remove, block/unblock | Implemented |
| Web security | Strict CSP, HSTS, frame denial, CSRF (SameSite + custom header + Origin), body size cap | Implemented |
| Operations | Health/readiness, SQL migrations, expiry cleanup job, CI, Dependabot, Docker, free hosting guide | Implemented |
| Multi-device | One key per account; a new browser creates a new key and can't read old messages | Limitation |
| Forward secrecy | Static keys, so no forward secrecy or post-compromise security | Not implemented: needs MLS/Signal (see security doc) |
| Recovery | Password reset by email code (implemented). Encryption-key backup | Key backup not implemented: a new device creates a new key |
| Groups | Group chats | Not implemented |
| Group calls | Calls with more than two people | Not implemented (needs a media server such as LiveKit) |
| Privacy extras | Read receipts, typing, online status | Not implemented (none are collected) |
| App lock | Local passcode / biometric | Not implemented |

Stories, status updates, and broadcast lists remain out of scope.
