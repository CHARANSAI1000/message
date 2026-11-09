import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usersApi } from '../api';
import { Alert } from '../components/Alert';
import { CallOverlay } from '../components/CallOverlay';
import { NavRail } from '../components/NavRail';
import { useMessenger } from '../hooks/useMessenger';
import { CallsPage } from '../pages/CallsPage';
import { ChatsPage } from '../pages/ChatsPage';
import { ContactsPage } from '../pages/ContactsPage';
import { ConversationPage } from '../pages/ConversationPage';
import { EmptyConversation } from '../pages/EmptyConversation';
import { SettingsPage } from '../pages/SettingsPage';
import { CallEngine, type CallView } from '../services/calls';
import { refreshPushSubscription, registerServiceWorker } from '../services/push';
import { Realtime } from '../services/realtime';
import { unlockAudio } from '../services/sounds';
import type { Vault } from '../services/vault';
import type { Me, Tab, User } from '../types';

/**
 * Desktop: nav rail | list pane (chats, calls or contacts) | main pane (conversation / settings).
 * Phone: one pane at a time; `data-view` tells the CSS which one.
 */
export function MessengerLayout({ vault, onSignedOut }: { vault: Vault; onSignedOut: () => void }) {
  const [tab, setTab] = useState<Tab>('chats');
  const [openPeer, setOpenPeer] = useState<string | null>(null);
  const [me, setMe] = useState<Me>(vault.me);
  const [, setConnected] = useState(false);
  const [call, setCall] = useState<CallView | null>(null);
  const [callError, setCallError] = useState('');

  const [rt, setRt] = useState<Realtime | null>(null);
  const [engine, setEngine] = useState<CallEngine | null>(null);
  // Create the socket + call engine in an effect so mount/unmount/remount (React StrictMode) is clean.
  useEffect(() => {
    const realtime = new Realtime(setConnected);
    const calls = new CallEngine(vault, realtime, setCall);
    setRt(realtime);
    setEngine(calls);
    return () => { calls.dispose(); realtime.close(); };
  }, [vault]);
  useEffect(() => {
    void registerServiceWorker()?.then(() => refreshPushSubscription()).catch(() => undefined);
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const state = useMessenger(vault, rt, onSignedOut, openPeer);

  const openChat = (user: User) => {
    state.rememberUsers([user]);
    setOpenPeer(user.id);
    if (tab === 'settings') setTab('chats');
  };

  const changeTab = (next: Tab) => {
    setTab(next);
    if (next === 'settings') setOpenPeer(null);
  };

  const startCall = async (peerId: string, video: boolean) => {
    setCallError('');
    try {
      const peer = state.users[peerId] ?? await usersApi.get(peerId);
      if (!engine) throw new Error('Still connecting — try again in a moment');
      await engine.start(peer, video);
    } catch (e) {
      setCallError(e instanceof Error ? e.message : 'Could not start the call');
    }
  };

  const updateMe = (next: Me) => {
    vault.setMe(next);
    setMe({ ...vault.me });
  };

  const peer = openPeer ? state.users[openPeer] : undefined;
  const mode = tab === 'settings' ? 'settings' : peer ? 'chat' : 'list';
  const view = mode === 'list' ? 'list' : 'main';
  const inCall = call !== null;

  return (
    <div className="app" data-mode={mode} data-view={view}>
      <NavRail active={tab} me={me} onChange={changeTab} />

      <section className="list-pane" aria-label={tab}>
        {state.offline && <div className="offline"><WifiOff size={14} /> Reconnecting…</div>}
        {tab === 'contacts' ? (
          <ContactsPage contacts={state.contacts} blocked={state.blocked} activePeer={openPeer} onOpen={openChat} onChanged={state.refreshContacts} />
        ) : tab === 'calls' ? (
          <CallsPage userId={me.id} users={state.users} inCall={inCall} onCall={(id, video) => void startCall(id, video)} />
        ) : (
          <ChatsPage threads={state.threads} users={state.users} activePeer={openPeer} onOpen={setOpenPeer} onNewChat={() => changeTab('contacts')} />
        )}
      </section>

      <section className="main-pane">
        {callError && <div className="call-error"><Alert kind="error">{callError}</Alert></div>}
        {tab === 'settings'
          ? <SettingsPage vault={vault} me={me} onMeChange={updateMe} onSignedOut={onSignedOut} />
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
                onHide={state.hide}
                onCall={(video) => void startCall(peer.id, video)}
                inCall={inCall}
              />
            : <EmptyConversation onNewChat={() => changeTab('contacts')} />}
      </section>

      {call && engine && <CallOverlay call={call} engine={engine} />}
    </div>
  );
}
