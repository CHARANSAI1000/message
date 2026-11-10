import { AtSign, Ban, BookUser, MessageCircle, MoreHorizontal, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { contactsApi } from '../api';
import { Alert } from '../components/Alert';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { Menu } from '../components/Menu';
import { Modal } from '../components/Modal';
import { canPickContacts, hashEmails, pickContactEmails } from '../services/native';
import type { User } from '../types';
import { errorText } from '../utils/format';

type Props = {
  contacts: User[];
  blocked: Set<string>;
  activePeer: string | null;
  onOpen: (u: User) => void;
  onChanged: () => Promise<void>;
  myId: string;
};

export function ContactsPage({ contacts, blocked, activePeer, onOpen, onChanged }: Props) {
  const [found, setFound] = useState<User[] | null>(null);
  const [finding, setFinding] = useState(false);

  const findFriends = async () => {
    setFinding(true);
    setError('');
    try {
      const emails = await pickContactEmails();
      if (emails === null) { setError('Contacts permission is needed to find friends.'); return; }
      const hashes = await hashEmails(emails);
      setFound(hashes.length ? await contactsApi.discover(hashes) : []);
    } catch (e) { setError(errorText(e, 'Could not read contacts')); } finally { setFinding(false); }
  };
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); await onChanged(); } catch (e) { setError(errorText(e, 'Failed')); }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act(async () => { await contactsApi.add(username.trim()); setUsername(''); });
    setBusy(false);
  };

  const known = new Set(contacts.map((c) => c.id));
  return (
    <>
      {found && (
        <Modal title="Friends on ForYou" icon={<span className="card-icon"><BookUser size={18} /></span>} onClose={() => setFound(null)}>
          {found.length === 0 ? (
            <p className="small text-2">None of the contacts you shared use ForYou yet. Invite them, then try again.</p>
          ) : (
            <ul className="list">
              {found.map((u) => (
                <li key={u.id} className="list-item">
                  <Avatar name={u.username} userId={u.id} version={u.avatar_version} />
                  <span className="li-body"><span className="li-title">{u.username}</span></span>
                  {known.has(u.id)
                    ? <span className="badge">Added</span>
                    : <button className="btn btn-sm btn-primary" onClick={() => act(() => contactsApi.add(u.username))}><UserPlus size={15} /> Add</button>}
                </li>
              ))}
            </ul>
          )}
          <p className="hint">Only scrambled (hashed) email addresses were checked. ForYou doesn't keep your contact list.</p>
        </Modal>
      )}
      <header className="pane-header"><h1>Contacts</h1><span className="badge">{contacts.length}</span></header>
      <div className="pane-tools">
        <form className="row" onSubmit={add}>
          <div className="input-wrap grow">
            <AtSign size={16} />
            <input className="input input-filled" placeholder="Add by exact username" autoCapitalize="none" spellCheck={false}
              value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={32} required aria-label="Username to add" />
          </div>
          <button className="btn btn-primary" disabled={busy || username.trim().length < 3} aria-label="Add contact"><UserPlus size={17} /></button>
        </form>
        {canPickContacts() && (
          <button className="btn btn-block" onClick={findFriends} disabled={finding}>
            <BookUser size={17} /> {finding ? 'Checking your contacts…' : 'Find friends from your contacts'}
          </button>
        )}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
      <div className="pane-scroll">
        {contacts.length === 0 ? (
          <EmptyState icon={<Users size={26} />} title="No contacts yet">
            There's no public directory, for your privacy. Ask friends for their exact username and add them above.
          </EmptyState>
        ) : (
          <ul className="list">
            {contacts.map((c) => {
              const isBlocked = blocked.has(c.id);
              return (
                <li key={c.id} className={`list-item hoverable ${activePeer === c.id ? 'active' : ''}`}>
                  <Avatar name={c.username} userId={c.id} version={c.avatar_version} />
                  <span className="li-body">
                    <span className="li-title">{c.username}</span>
                    <span className="li-sub">
                      {isBlocked
                        ? <><Ban size={13} /><span>Blocked</span></>
                        : c.key
                          ? <><ShieldCheck size={13} /><span>Encryption ready</span></>
                          : <span>Hasn't set up encryption yet</span>}
                    </span>
                  </span>
                  <span className="li-actions">
                    <button className="icon-btn" onClick={() => onOpen(c)} title="Message" aria-label={`Message ${c.username}`}><MessageCircle size={18} /></button>
                    <Menu trigger={({ toggle, open }) => (
                      <button className={`icon-btn ${open ? 'active' : ''}`} onClick={toggle} aria-label={`More actions for ${c.username}`} aria-expanded={open}>
                        <MoreHorizontal size={18} />
                      </button>
                    )}>
                      {(close) => <>
                        <button className="menu-item" role="menuitem" onClick={() => { close(); void act(() => isBlocked ? contactsApi.unblock(c.id) : contactsApi.block(c.id)); }}>
                          <Ban size={16} /> {isBlocked ? 'Unblock' : 'Block'}
                        </button>
                        <button className="menu-item danger" role="menuitem" onClick={() => { close(); void act(() => contactsApi.remove(c.id)); }}>
                          <Trash2 size={16} /> Remove contact
                        </button>
                      </>}
                    </Menu>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
