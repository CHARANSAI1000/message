import {
  Copy, Fingerprint, KeyRound, LogOut, Mail, Monitor, ShieldCheck, Smartphone, Trash2, TriangleAlert,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { authApi } from '../api';
import { Alert } from '../components/Alert';
import { Avatar } from '../components/Avatar';
import { CodeInput } from '../components/CodeInput';
import { GoogleLogo } from '../components/GoogleLogo';
import { Modal } from '../components/Modal';
import { keyFingerprint } from '../services/crypto';
import type { Vault } from '../services/vault';
import type { SessionInfo } from '../types';
import { describeAgent, errorText, formatTime } from '../utils/format';

type Notice = { kind: 'success' | 'error'; text: string } | null;

export function SettingsPage({ vault, onSignedOut }: { vault: Vault; onSignedOut: () => void }) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [fingerprint, setFingerprint] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteCode, setDeleteCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const me = vault.me;
  const username = me.username;

  const loadSessions = () => authApi.sessions().then(setSessions).catch(() => undefined);
  useEffect(() => {
    void loadSessions();
    if (vault.ownSpki) void keyFingerprint(vault.ownSpki).then(setFingerprint);
  }, [vault]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    setNotice(null);
    try { await fn(); if (ok) setNotice({ kind: 'success', text: ok }); } catch (e) { setNotice({ kind: 'error', text: errorText(e, 'Failed') }); }
  };

  const signOut = async () => { await authApi.logout().catch(() => undefined); onSignedOut(); };

  const copyUsername = async () => {
    await navigator.clipboard?.writeText(username).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const changePassword = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      if (data.get('next') !== data.get('confirm')) throw new Error('New passwords do not match.');
      await authApi.changePassword(String(data.get('current')), String(data.get('next')));
      form.reset();
      await loadSessions();
    }, 'Password changed. Your other devices were signed out.');
  };

  const deleteAccount = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const proof = me.has_password ? { password: String(new FormData(e.currentTarget).get('password')) } : { code: deleteCode };
    void run(async () => { await authApi.deleteAccount(proof); onSignedOut(); }, '');
  };

  const sendDeleteCode = () => run(async () => { await authApi.requestDeleteCode(); setCodeSent(true); }, '');

  return (
    <div className="settings">
      <div className="settings-inner">
        <div className="settings-head">
          <h1>Settings</h1>
          <button className="btn" onClick={signOut}><LogOut size={16} /> Sign out</button>
        </div>

        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}

        <section className="card profile">
          <Avatar name={username} size="lg" />
          <div className="grow">
            <div className="profile-name">{username}</div>
            {me.email && <div className="row small text-2"><Mail size={14} /> {me.email}</div>}
            <div className="row-wrap profile-badges">
              <span className="badge badge-success"><ShieldCheck size={13} /> End-to-end encryption on</span>
              {me.google_linked && <span className="badge"><GoogleLogo size={13} /> Google linked</span>}
            </div>
          </div>
          <button className="btn btn-sm" onClick={copyUsername} title="Share this so people can add you">
            <Copy size={14} /> {copied ? 'Copied' : 'Copy username'}
          </button>
        </section>

        <section className="card">
          <div className="card-header">
            <span className="card-icon"><Fingerprint size={18} /></span>
            <div><h2>Encryption key</h2><p className="small text-3">This device's key fingerprint</p></div>
          </div>
          <div className="card-body">
            <div className="fingerprint">{(fingerprint || '').split(' ').filter(Boolean).map((g, i) => <span key={i}>{g}</span>)}</div>
            <p className="hint">Your private key was created on this device, can't be exported (even by ForYou), and never reaches our server. Clearing this site's data deletes it.</p>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <span className="card-icon"><Monitor size={18} /></span>
            <div><h2>Devices</h2><p className="small text-3">Where you're signed in</p></div>
          </div>
          <div className="card-body">
            <div>
              {sessions.map((s) => {
                const agent = describeAgent(s.user_agent);
                return (
                  <div key={s.id} className="session-row">
                    <span className="session-icon">{agent.mobile ? <Smartphone size={18} /> : <Monitor size={18} />}</span>
                    <div className="grow">
                      <div className="row"><strong className="small">{agent.name}</strong>{s.current && <span className="badge badge-brand">This device</span>}</div>
                      <div className="xs text-3">Active {formatTime(Date.parse(s.last_seen_at))} · Signed in {formatTime(Date.parse(s.created_at))}</div>
                    </div>
                    {!s.current && (
                      <button className="btn btn-sm btn-danger-ghost"
                        onClick={() => run(async () => { await authApi.revokeSession(s.id); await loadSessions(); }, 'Device signed out.')}>
                        Sign out
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {!me.has_password ? (
          <section className="card">
            <div className="card-header">
              <span className="card-icon"><KeyRound size={18} /></span>
              <div><h2>Password</h2><p className="small text-3">You sign in with {me.google_linked ? 'Google' : 'email codes'}</p></div>
            </div>
            <div className="card-body">
              <p className="small text-2">Your account doesn't have a password. To add one, sign out and choose <strong>Forgot password?</strong> — we'll email {me.email} a code.</p>
            </div>
          </section>
        ) : (
        <form className="card" onSubmit={changePassword}>
          <div className="card-header">
            <span className="card-icon"><KeyRound size={18} /></span>
            <div><h2>Password</h2><p className="small text-3">Changing it signs out your other devices</p></div>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <label className="field full"><span>Current password</span>
                <input className="input" name="current" type="password" autoComplete="current-password" required /></label>
              <label className="field"><span>New password</span>
                <input className="input" name="next" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
              <label className="field"><span>Confirm new password</span>
                <input className="input" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
            </div>
            <div><button className="btn btn-primary">Update password</button></div>
          </div>
        </form>
        )}

        <section className="card danger">
          <div className="card-header">
            <span className="card-icon danger"><TriangleAlert size={18} /></span>
            <div><h2>Delete account</h2><p className="small text-3">Permanently remove your account and all of its data</p></div>
          </div>
          <div className="card-body">
            <p className="small text-2">This deletes your username, keys, contacts and every message you've sent or received from the server. It can't be undone.</p>
            <div><button className="btn btn-danger-ghost" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete my account</button></div>
          </div>
        </section>
      </div>

      {confirmDelete && (
        <Modal title="Delete your account?" icon={<span className="card-icon danger"><Trash2 size={18} /></span>} onClose={() => setConfirmDelete(false)}>
          <form className="stack" onSubmit={deleteAccount}>
            {me.has_password ? <>
              <p className="small text-2">Everything will be erased. Enter your password to confirm.</p>
              <label className="field"><span>Password</span>
                <input className="input" name="password" type="password" autoComplete="current-password" required autoFocus /></label>
            </> : codeSent ? <>
              <p className="small text-2">Enter the 6-digit code we sent to {me.email}.</p>
              <CodeInput value={deleteCode} onChange={setDeleteCode} />
            </> : <>
              <p className="small text-2">Everything will be erased. We'll email a confirmation code to {me.email}.</p>
              <div><button type="button" className="btn" onClick={sendDeleteCode}><Mail size={16} /> Email me a code</button></div>
            </>}
            {notice?.kind === 'error' && <Alert kind="error">{notice.text}</Alert>}
            <div className="row-wrap">
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn btn-danger" disabled={!me.has_password && deleteCode.length !== 6}><Trash2 size={16} /> Delete forever</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
