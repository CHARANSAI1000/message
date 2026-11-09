import { KeyRound, LogOut } from 'lucide-react';
import { useState } from 'react';
import { authApi } from '../api';
import { Alert } from '../components/Alert';
import type { Vault } from '../services/vault';
import { errorText } from '../utils/format';

type Props = { vault: Vault; onDone: () => void; onSignOut: () => void };

export function KeySetupPage({ vault, onDone, onSignOut }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const createKey = async () => {
    setBusy(true);
    try {
      await vault.createKey();
      onDone();
    } catch (e) {
      setError(errorText(e, 'Failed'));
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-icon"><KeyRound size={18} /></span>
        <div><h2>New device detected</h2><p className="small text-3">Signed in as @{vault.me.username}</p></div>
      </div>
      <div className="card-body">
        <p className="text-2">Your encryption key lives only on the browser where you created it, and this browser doesn't have it.</p>
        <Alert kind="warning">
          Creating a new key here means older messages can't be read on this device, your previous browser stops sending,
          and your contacts will see that your safety number changed.
        </Alert>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="row-wrap">
          <button className="btn btn-primary" disabled={busy} onClick={createKey}><KeyRound size={16} /> Create a new key</button>
          <button className="btn btn-ghost" onClick={async () => { await authApi.logout().catch(() => undefined); onSignOut(); }}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
