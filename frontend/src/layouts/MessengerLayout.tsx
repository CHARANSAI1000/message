import { WifiOff } from 'lucide-react';
import { useState } from 'react';
import { NavRail } from '../components/NavRail';
import { useMessenger } from '../hooks/useMessenger';
import { ChatsPage } from '../pages/ChatsPage';
import { ContactsPage } from '../pages/ContactsPage';
import { ConversationPage } from '../pages/ConversationPage';
import { EmptyConversation } from '../pages/EmptyConversation';
import { SettingsPage } from '../pages/SettingsPage';
import type { Vault } from '../services/vault';
import type { Tab, User } from '../types';

/**
 * Desktop: nav rail | list pane (chats or contacts) | main pane (conversation / settings).
 * Phone: one pane at a time; `data-view` tells the CSS which one.
 */
export function MessengerLayout({ vault, onSignedOut }: { vault: Vault; onSignedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('chats');
  const [openPeer, setOpenPeer] = useState<string | null>(null);
  const state = useMessenger(vault, onSignedOut);

  const openChat = (user: User) => {
    state.rememberUsers([user]);
    setOpenPeer(user.id);
  };

  const changeTab = (next: Tab) => {
    setTab(next);
    if (next === 'settings') setOpenPeer(null);
  };

  const peer = openPeer ? state.users[openPeer] : undefined;
  const mode = tab === 'settings' ? 'settings' : peer ? 'chat' : 'list';
  const view = mode === 'list' ? 'list' : 'main';

  return (
    <div className="app" data-mode={mode} data-view={view}>
      <NavRail active={tab} username={vault.me.username} onChange={changeTab} />

      <section className="list-pane" aria-label={tab === 'contacts' ? 'Contacts' : 'Chats'}>
        {state.offline && <div className="offline"><WifiOff size={14} /> Reconnecting…</div>}
        {tab === 'contacts'
          ? <ContactsPage contacts={state.contacts} blocked={state.blocked} activePeer={openPeer} onOpen={openChat} onChanged={state.refreshContacts} />
          : <ChatsPage threads={state.threads} users={state.users} activePeer={openPeer} onOpen={setOpenPeer} onNewChat={() => changeTab('contacts')} />}
      </section>

      <section className="main-pane">
        {tab === 'settings'
          ? <SettingsPage vault={vault} onSignedOut={onSignedOut} />
          : peer
            ? <ConversationPage
                key={peer.id}
                vault={vault}
                peer={peer}
                messages={state.messages.filter((m) => m.peerId === peer.id)}
                blocked={state.blocked.has(peer.id)}
                onBack={() => setOpenPeer(null)}
                onSent={(m) => state.addMessages([m])}
                onPeerRefreshed={(u) => state.rememberUsers([u])}
              />
            : <EmptyConversation onNewChat={() => changeTab('contacts')} />}
      </section>
    </div>
  );
}
