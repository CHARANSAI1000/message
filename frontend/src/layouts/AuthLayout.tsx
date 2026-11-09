import { EyeOff, KeyRound, ShieldCheck, Timer } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '../components/Logo';

const FEATURES = [
  { Icon: ShieldCheck, title: 'End-to-end encrypted', text: 'Messages are locked on your device. Not even our server can read them.' },
  { Icon: EyeOff, title: 'No phone number, no tracking', text: 'Just a username. No contact uploads, no ads, no read receipts.' },
  { Icon: Timer, title: 'Disappearing messages', text: 'Set a timer and conversations clean themselves up.' },
];

/** Split screen: brand story on the left, the form on the right (form only on phones). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <Logo size={42} />
        <div className="auth-hero">
          <h1>Private conversations, made for you.</h1>
          <p>ForYou is a simple messenger built around one promise: what you say stays between you and the person you're talking to.</p>
        </div>
        <ul className="auth-features">
          {FEATURES.map(({ Icon, title, text }) => (
            <li key={title}>
              <span className="fi"><Icon size={18} /></span>
              <div><strong>{title}</strong><span>{text}</span></div>
            </li>
          ))}
        </ul>
      </aside>
      <main className="auth-panel">
        <div className="auth-card">
          <div className="mobile-logo"><Logo size={40} /></div>
          {children}
          <p className="auth-foot"><KeyRound size={13} /> Your encryption keys never leave this device.</p>
        </div>
      </main>
    </div>
  );
}
