import { Lock, MessageCirclePlus } from 'lucide-react';
import { LogoMark } from '../components/Logo';

export function EmptyConversation({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="main-empty">
      <div className="empty">
        <LogoMark size={64} />
        <h2>Your private space</h2>
        <p>Pick a conversation from the list, or start a new one with someone you trust.</p>
        <button className="btn btn-primary" onClick={onNewChat}><MessageCirclePlus size={17} /> New chat</button>
        <p className="empty-foot"><Lock size={13} /> End-to-end encrypted. Only you and the people you talk to can read your messages.</p>
      </div>
    </div>
  );
}
