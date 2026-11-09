import { useState } from 'react';

type Size = 'sm' | 'md' | 'lg' | 'xl';

type Props = { name: string; size?: Size; userId?: string; version?: number | null };

/** Profile photo when the user has one, otherwise gradient initials. */
export function Avatar({ name, size = 'md', userId, version }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
  const cls = `avatar ${size !== 'md' ? `avatar-${size}` : ''} av-${hash % 8}`;
  const src = userId && version ? `/api/v1/users/${userId}/avatar?v=${version}` : null;
  if (src && failed !== src) {
    return <img className={`${cls} avatar-img`} src={src} alt="" onError={() => setFailed(src)} draggable={false} />;
  }
  return <span className={cls} aria-hidden>{initials}</span>;
}
