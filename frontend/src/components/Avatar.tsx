type Size = 'sm' | 'md' | 'lg';

export function Avatar({ name, size = 'md' }: { name: string; size?: Size }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
  return <span className={`avatar ${size !== 'md' ? `avatar-${size}` : ''} av-${hash % 8}`} aria-hidden>{initials}</span>;
}
