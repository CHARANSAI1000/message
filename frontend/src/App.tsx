import { useEffect, useState } from 'react';
import { ApiError, authApi } from './api';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { takeGoogleReturn } from './components/GoogleButton';
import { AuthLayout } from './layouts/AuthLayout';
import { CenteredLayout } from './layouts/CenteredLayout';
import { MessengerLayout } from './layouts/MessengerLayout';
import { AuthPage } from './pages/AuthPage';
import { KeySetupPage } from './pages/KeySetupPage';
import { Vault } from './services/vault';
import type { Me } from './types';
import { errorText } from './utils/format';

type Phase =
  | { kind: 'loading' }
  | { kind: 'auth' }
  | { kind: 'keysetup'; vault: Vault }
  | { kind: 'ready'; vault: Vault }
  | { kind: 'fatal'; message: string };

/** Top-level flow: session check → sign in → encryption key → messenger. */
export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const enter = async (me: Me) => {
    try {
      const vault = await Vault.open(me);
      if (!vault.hasKey && me.key_id === null) {
        await vault.createKey(); // first sign-in: create this browser's key automatically
        setPhase({ kind: 'ready', vault });
      } else {
        setPhase(vault.hasKey ? { kind: 'ready', vault } : { kind: 'keysetup', vault });
      }
    } catch (e) {
      setPhase({ kind: 'fatal', message: errorText(e, 'Could not open your encryption keys') });
    }
  };

  const googleReturn = takeGoogleReturn();

  useEffect(() => {
    if (googleReturn) { setPhase({ kind: 'auth' }); return; } // finish Google sign-in on the auth page
    authApi.me().then(enter).catch((e) => {
      setPhase(e instanceof ApiError && e.status === 401 ? { kind: 'auth' } : { kind: 'fatal', message: errorText(e) });
    });
  }, []);

  const signedOut = () => setPhase({ kind: 'auth' });

  switch (phase.kind) {
    case 'loading':
      return <CenteredLayout><div className="spinner" role="status" aria-label="Loading" /></CenteredLayout>;
    case 'fatal':
      return (
        <CenteredLayout>
          <div className="card">
            <div className="card-header">
              <span className="card-icon danger"><AlertTriangle size={18} /></span>
              <h2>Something went wrong</h2>
            </div>
            <div className="card-body">
              <p className="text-2">{phase.message}</p>
              <div><button className="btn btn-primary" onClick={() => location.reload()}><RotateCw size={16} /> Try again</button></div>
            </div>
          </div>
        </CenteredLayout>
      );
    case 'auth':
      return <AuthLayout><AuthPage onDone={enter} googleReturn={googleReturn} /></AuthLayout>;
    case 'keysetup':
      return (
        <CenteredLayout>
          <KeySetupPage vault={phase.vault} onDone={() => setPhase({ kind: 'ready', vault: phase.vault })} onSignOut={signedOut} />
        </CenteredLayout>
      );
    case 'ready':
      return <MessengerLayout vault={phase.vault} onSignedOut={signedOut} />;
  }
}
