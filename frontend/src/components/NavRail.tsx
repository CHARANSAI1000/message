import { MessageCircle, Settings, Users } from 'lucide-react';
import type { Tab } from '../types';
import { Avatar } from './Avatar';
import { LogoMark } from './Logo';

const ITEMS = [
  { id: 'chats', label: 'Chats', Icon: MessageCircle },
  { id: 'contacts', label: 'Contacts', Icon: Users },
  { id: 'settings', label: 'Settings', Icon: Settings },
] as const;

/** Vertical rail on desktop; becomes the bottom tab bar on phones (CSS). */
export function NavRail({ active, username, onChange }: { active: Tab; username: string; onChange: (t: Tab) => void }) {
  return (
    <nav className="rail" aria-label="Main">
      <span className="logo"><LogoMark size={40} /></span>
      <div className="rail-nav">
        {ITEMS.map(({ id, label, Icon }) => (
          <button key={id} className={`rail-item ${active === id ? 'active' : ''}`} onClick={() => onChange(id)}
            aria-current={active === id ? 'page' : undefined}>
            <Icon size={21} strokeWidth={active === id ? 2.3 : 1.9} />
            {label}
          </button>
        ))}
      </div>
      <div className="rail-spacer" />
      <button className="rail-me" onClick={() => onChange('settings')} title={`Signed in as ${username}`} aria-label="Your profile">
        <Avatar name={username} size="sm" />
      </button>
    </nav>
  );
}
