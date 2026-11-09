import type { ReactNode } from 'react';
import { Logo } from '../components/Logo';

/** Simple centered screen for loading, key setup and errors. */
export function CenteredLayout({ children }: { children: ReactNode }) {
  return (
    <div className="centered">
      <div className="centered-card">
        <Logo size={44} />
        {children}
      </div>
    </div>
  );
}
