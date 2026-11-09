import { MessageCircle, Phone, Settings, Users } from 'lucide-react';
import type { Tab } from '../types';
import { Avatar } from './Avatar';
import { LogoMark } from './Logo';

const ITEMS = [
  { id: 'chats', label: 'Chats', Icon: MessageCircle },
  { id: 'calls', label: 'Calls', Icon: Phone },
  { id: 'contacts', label: 'Contacts', Icon: Users },
  { id: 'settings', label: 'Settings', Icon: Settings },
] as const;

/** Vertical rail on desktop; becomes the bottom tab bar on phones (CSS). */
export function NavRail({ active, me, onChange }: { active: Tab; me: { id: string; username: string; avatar_version: number | null }; onChange: (t: Tab) => void }) {
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
      <button className="rail-me" onClick={() => onChange('settings')} title={`Signed in as ${me.username}`} aria-label="Your profile">
        <Avatar name={me.username} size="sm" userId={me.id} version={me.avatar_version} />
      </button>
    </nav>
  );
}
