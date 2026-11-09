import { useId } from 'react';

/** ForYou mark: a chat bubble carrying a heart — "a message, for you". */
export function LogoMark({ size = 36 }: { size?: number }) {
  const id = useId();
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#A855F7" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <rect x="13" y="15" width="38" height="29" rx="11" fill="#fff" />
      <path d="M19.5 39 L17.5 51 L31 43 Z" fill="#fff" />
      <path
        transform="translate(23 19.75) scale(.75)"
        fill={`url(#${id})`}
        d="M12 21s-7-4.35-9.5-8.5C.5 9 2.5 5 6.5 5c2.1 0 3.6 1.1 5.5 3 1.9-1.9 3.4-3 5.5-3 4 0 6 4 4 7.5C19 16.65 12 21 12 21z"
      />
    </svg>
  );
}

export function Logo({ size = 36, withWord = true }: { size?: number; withWord?: boolean }) {
  return (
    <span className="logo" aria-label="ForYou">
      <LogoMark size={size} />
      {withWord && <span className="logo-word">For<b>You</b></span>}
    </span>
  );
}
