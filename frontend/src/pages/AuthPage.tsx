import { ArrowLeft, ArrowRight, AtSign, Eye, EyeOff, KeyRound, Lock, Mail, MailCheck, User as UserIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, authApi } from '../api';
import { Alert } from '../components/Alert';
import { CodeInput } from '../components/CodeInput';
import { GoogleButton, type GoogleReturn } from '../components/GoogleButton';
import type { AuthConfig, Me } from '../types';
import { errorText, passwordScore } from '../utils/format';

type View =
  | { k: 'signin' }
  | { k: 'register' }
  | { k: 'verify'; email: string }              // confirm email after sign-up
  | { k: 'code-email' }                         // passwordless: ask for email
  | { k: 'code-verify'; email: string }         // passwordless: enter code
  | { k: 'forgot' }                             // reset: ask for email
  | { k: 'reset'; email: string }               // reset: code + new password
  | { k: 'google-username'; credential: string; state: string; email: string; suggested: string };

const STRENGTH = ['', 'Too short', 'Okay', 'Good', 'Strong'];
const handledReturns = new WeakSet<GoogleReturn>(); // StrictMode-safe: submit each Google result once
const RESEND_SECONDS = 30;

export function AuthPage({ onDone, googleReturn }: { onDone: (me: Me) => void; googleReturn?: GoogleReturn | null }) {
  const [view, setView] = useState<View>({ k: 'signin' });
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { authApi.config().then(setConfig).catch(() => setConfig({ google: false, email_codes: true, push_public_key: null })); }, []);

  const go = (next: View) => { setView(next); setError(''); setNotice(''); };

  /** Run a request with shared busy/error handling. */
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) {
      if (e instanceof ApiError && e.code === 'email_unverified' && typeof e.data.email === 'string') {
        go({ k: 'verify', email: e.data.email });
        setNotice(e.message);
      } else setError(errorText(e, 'Request failed'));
    } finally { setBusy(false); }
  };

  // Finish a Google sign-in when we land back from Google (runs once).
  useEffect(() => {
    if (!googleReturn || handledReturns.has(googleReturn)) return;
    handledReturns.add(googleReturn);
    if ('error' in googleReturn) {
      if (googleReturn.error !== 'access_denied' && googleReturn.error !== 'cancelled') setError('Google sign-in failed. Please try again.');
      return;
    }
    const { credential, state } = googleReturn;
    void run(async () => {
      try {
        onDone(await authApi.google(credential, state));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'username_required') {
          go({ k: 'google-username', credential, state, email: String(e.data.email), suggested: String(e.data.suggested_username) });
          return;
        }
        throw e;
      }
    });
  }, [googleReturn]);

  const google = config?.google && (view.k === 'signin' || view.k === 'register') ? (
    <>
      <GoogleButton label={view.k === 'register' ? 'Sign up with Google' : 'Continue with Google'} />
      <div className="divider">or with email</div>
    </>
  ) : null;

  const feedback = <>
    {notice && <Alert kind="info">{notice}</Alert>}
    {error && <Alert kind="error">{error}</Alert>}
  </>;

  switch (view.k) {
    case 'signin':
      return <SignIn google={google} feedback={feedback} busy={busy} go={go}
        onSubmit={(id, pw) => run(async () => onDone(await authApi.login(id, pw)))} />;
    case 'register':
      return <Register google={google} feedback={feedback} busy={busy} go={go}
        onSubmit={(email, username, pw) => run(async () => {
          const r = await authApi.register(email, username, pw);
          go({ k: 'verify', email: r.email });
        })} />;
    case 'verify':
      return <VerifyCode title="Check your email" email={view.email} feedback={feedback} busy={busy}
        onBack={() => go({ k: 'register' })} backLabel="Use a different email"
        onResend={() => run(async () => { await authApi.resendVerification(view.email); setNotice('We sent a new code.'); })}
        onSubmit={(code) => run(async () => onDone(await authApi.verifyEmail(view.email, code)))} />;
    case 'code-email':
      return <AskEmail title="Sign in with a code" subtitle="We'll email you a 6-digit code — no password needed." feedback={feedback} busy={busy}
        onBack={() => go({ k: 'signin' })}
        onSubmit={(email) => run(async () => { await authApi.requestCode(email); go({ k: 'code-verify', email }); })} />;
    case 'code-verify':
      return <VerifyCode title="Enter your code" email={view.email} feedback={feedback} busy={busy}
        hint="If an account exists for this address, a code is on its way."
        onBack={() => go({ k: 'code-email' })} backLabel="Use a different email"
        onResend={() => run(async () => { await authApi.requestCode(view.email); setNotice('We sent a new code.'); })}
        onSubmit={(code) => run(async () => onDone(await authApi.loginWithCode(view.email, code)))} />;
    case 'forgot':
      return <AskEmail title="Reset your password" subtitle="Enter your account email and we'll send you a reset code." feedback={feedback} busy={busy}
        onBack={() => go({ k: 'signin' })}
        onSubmit={(email) => run(async () => { await authApi.forgotPassword(email); go({ k: 'reset', email }); })} />;
    case 'reset':
      return <ResetPassword email={view.email} feedback={feedback} busy={busy} onBack={() => go({ k: 'forgot' })}
        onResend={() => run(async () => { await authApi.forgotPassword(view.email); setNotice('We sent a new code.'); })}
        onSubmit={(code, pw) => run(async () => onDone(await authApi.resetPassword(view.email, code, pw)))} />;
    case 'google-username':
      return <ChooseUsername email={view.email} suggested={view.suggested} feedback={feedback} busy={busy}
        onBack={() => go({ k: 'signin' })}
        onSubmit={(username) => run(async () => onDone(await authApi.google(view.credential, view.state, username)))} />;
  }
}

/* ------------------------------------------------------------------ views */

type Common = { feedback: ReactNode; busy: boolean };

function Head({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="auth-head">
      {icon && <div className="step-icon">{icon}</div>}
      <h1>{title}</h1>
      {children && <p className="text-2">{children}</p>}
    </div>
  );
}

function Back({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return <button type="button" className="btn btn-ghost btn-sm" onClick={onClick}><ArrowLeft size={16} /> {label}</button>;
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Please wait…' : <>{children}<ArrowRight size={18} /></>}</button>;
}

function PasswordField({ label, value, onChange, autoComplete, meter, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: string; meter?: boolean; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const score = passwordScore(value);
  return (
    <label className="field">
      {label && <span>{label}</span>}
      <div className="input-wrap">
        <Lock size={17} />
        <input className="input has-action" aria-label={label || 'Password'} type={show ? 'text' : 'password'} required minLength={meter ? 12 : 1} maxLength={128}
          autoComplete={autoComplete} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="icon-btn input-action" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      {meter && value && (
        <div className="row">
          <div className="strength grow" data-score={score}><i /><i /><i /><i /></div>
          <span className="xs text-3">{STRENGTH[score]}</span>
        </div>
      )}
    </label>
  );
}

function EmailField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="field">
      <span>Email</span>
      <div className="input-wrap">
        <Mail size={17} />
        <input className="input" type="email" autoComplete="email" required maxLength={254} placeholder="you@example.com"
          value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus} />
      </div>
    </label>
  );
}

function SignIn({ google, feedback, busy, go, onSubmit }: Common & { google: ReactNode; go: (v: View) => void; onSubmit: (id: string, pw: string) => void }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(identifier.trim(), password); }}>
      <Head title="Welcome back">Sign in to continue your conversations.</Head>
      {google}
      <label className="field">
        <span>Email or username</span>
        <div className="input-wrap">
          <AtSign size={17} />
          <input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={254}
            placeholder="you@example.com" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
        </div>
      </label>
      <div className="field">
        <div className="field-head">
          <span>Password</span>
          <button type="button" className="link-btn" onClick={() => go({ k: 'forgot' })}>Forgot password?</button>
        </div>
        <PasswordField label="" value={password} onChange={setPassword} autoComplete="current-password" placeholder="Your password" />
      </div>
      {feedback}
      <Submit busy={busy}>Sign in</Submit>
      <button type="button" className="btn btn-block" onClick={() => go({ k: 'code-email' })}><KeyRound size={16} /> Email me a sign-in code</button>
      <p className="auth-switch">New to ForYou? <button type="button" className="link-btn" onClick={() => go({ k: 'register' })}>Create an account</button></p>
    </form>
  );
}

function Register({ google, feedback, busy, go, onSubmit }: Common & { google: ReactNode; go: (v: View) => void; onSubmit: (email: string, username: string, pw: string) => void }) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  return (
    <form className="stack" onSubmit={(e: FormEvent) => {
      e.preventDefault();
      if (password !== confirm) return setMismatch(true);
      setMismatch(false);
      onSubmit(email.trim(), username.trim(), password);
    }}>
      <Head title="Create your account">Free, private, and no phone number needed.</Head>
      {google}
      <EmailField value={email} onChange={setEmail} />
      <label className="field">
        <span>Username</span>
        <div className="input-wrap">
          <UserIcon size={17} />
          <input className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32}
            pattern="[A-Za-z0-9_.\-]{3,32}" placeholder="yourname" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <span className="hint">This is how friends find you. Letters, numbers, dots, dashes and underscores.</span>
      </label>
      <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" meter placeholder="At least 12 characters" />
      <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Repeat your password" />
      {mismatch && <Alert kind="error">Passwords do not match.</Alert>}
      {feedback}
      <Submit busy={busy}>Create account</Submit>
      <p className="auth-switch">Already have an account? <button type="button" className="link-btn" onClick={() => go({ k: 'signin' })}>Sign in</button></p>
    </form>
  );
}

function useCooldown(seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);
  return [left, () => setLeft(seconds)] as const;
}

function Resend({ onResend }: { onResend: () => void }) {
  const [left, restart] = useCooldown(RESEND_SECONDS);
  return (
    <p className="auth-switch">
      Didn't get it? Check spam, or{' '}
      <button type="button" className="link-btn" disabled={left > 0} onClick={() => { restart(); onResend(); }}>
        {left > 0 ? `resend in ${left}s` : 'send a new code'}
      </button>
    </p>
  );
}

function VerifyCode({ title, email, hint, feedback, busy, onBack, backLabel, onResend, onSubmit }: Common & {
  title: string; email: string; hint?: string; onBack: () => void; backLabel: string; onResend: () => void; onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  return (
    <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); if (code.length === 6) onSubmit(code); }}>
      <div><Back onClick={onBack} label={backLabel} /></div>
      <Head icon={<MailCheck size={24} />} title={title}>
        We sent a 6-digit code to <span className="email-pill">{email}</span>. It expires in 10 minutes.
      </Head>
      {hint && <p className="hint">{hint}</p>}
      <CodeInput value={code} onChange={setCode} onComplete={onSubmit} disabled={busy} />
      {feedback}
      <Submit busy={busy}>Continue</Submit>
      <Resend onResend={onResend} />
    </form>
  );
}

function AskEmail({ title, subtitle, feedback, busy, onBack, onSubmit }: Common & {
  title: string; subtitle: string; onBack: () => void; onSubmit: (email: string) => void;
}) {
  const [email, setEmail] = useState('');
  return (
    <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(email.trim().toLowerCase()); }}>
      <div><Back onClick={onBack} /></div>
      <Head icon={<Mail size={24} />} title={title}>{subtitle}</Head>
      <EmailField value={email} onChange={setEmail} autoFocus />
      {feedback}
      <Submit busy={busy}>Send code</Submit>
    </form>
  );
}

function ResetPassword({ email, feedback, busy, onBack, onResend, onSubmit }: Common & {
  email: string; onBack: () => void; onResend: () => void; onSubmit: (code: string, password: string) => void;
}) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  return (
    <form className="stack" onSubmit={(e: FormEvent) => {
      e.preventDefault();
      if (password !== confirm) return setMismatch(true);
      setMismatch(false);
      onSubmit(code, password);
    }}>
      <div><Back onClick={onBack} label="Use a different email" /></div>
      <Head icon={<KeyRound size={24} />} title="Choose a new password">
        If <span className="email-pill">{email}</span> has an account, we've emailed it a 6-digit code.
      </Head>
      <CodeInput value={code} onChange={setCode} disabled={busy} />
      <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" meter placeholder="At least 12 characters" />
      <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" placeholder="Repeat your password" />
      {mismatch && <Alert kind="error">Passwords do not match.</Alert>}
      {feedback}
      <Submit busy={busy}>Reset password &amp; sign in</Submit>
      <p className="hint center">This signs you out of every other device.</p>
      <Resend onResend={onResend} />
    </form>
  );
}

function ChooseUsername({ email, suggested, feedback, busy, onBack, onSubmit }: Common & {
  email: string; suggested: string; onBack: () => void; onSubmit: (username: string) => void;
}) {
  const [username, setUsername] = useState(suggested);
  return (
    <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(username.trim()); }}>
      <div><Back onClick={onBack} label="Cancel" /></div>
      <Head icon={<UserIcon size={24} />} title="One last step">
        Pick the username friends will use to find you. Signed in with Google as <span className="email-pill">{email}</span>.
      </Head>
      <label className="field">
        <span>Username</span>
        <div className="input-wrap">
          <AtSign size={17} />
          <input className="input" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32} autoFocus
            pattern="[A-Za-z0-9_.\-]{3,32}" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
      </label>
      {feedback}
      <Submit busy={busy}>Create account</Submit>
    </form>
  );
}
