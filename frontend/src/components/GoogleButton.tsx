import { useState } from 'react';
import { GoogleLogo } from './GoogleLogo';

/**
 * "Continue with Google" — our own button (no Google script on the page).
 * It starts the server-side redirect flow; Google returns to /auth/google/callback.
 */
export function GoogleButton({ label = 'Continue with Google' }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <a className={`btn btn-google btn-lg btn-block ${busy ? 'is-busy' : ''}`} href="/api/v1/auth/google/start"
      onClick={() => setBusy(true)} aria-busy={busy}>
      <GoogleLogo size={19} />
      <span>{busy ? 'Opening Google…' : label}</span>
    </a>
  );
}

export type GoogleReturn = { credential: string; state: string } | { error: string };

let parsed: GoogleReturn | null | undefined;

/** Read (once) the result Google appended to /auth/google/callback, then clean the URL. */
export function takeGoogleReturn(): GoogleReturn | null {
  if (parsed !== undefined) return parsed;
  parsed = null;
  if (window.location.pathname === '/auth/google/callback') {
    const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
    const credential = params.get('id_token');
    const state = params.get('state');
    parsed = credential && state ? { credential, state } : { error: params.get('error') ?? 'cancelled' };
    window.history.replaceState(null, '', '/'); // never keep the token in the address bar or history
  }
  return parsed;
}
