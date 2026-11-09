import { useEffect, useRef } from 'react';

type Props = { value: string; onChange: (v: string) => void; onComplete?: (code: string) => void; disabled?: boolean };

/** Single 6-digit field: numeric keypad on phones and one-time-code autofill from SMS/email apps. */
export function CodeInput({ value, onChange, onComplete, disabled }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <input
      ref={ref}
      className="input code-input"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={6}
      placeholder="••••••"
      aria-label="6-digit code"
      disabled={disabled}
      value={value}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
        onChange(digits);
        if (digits.length === 6) onComplete?.(digits);
      }}
    />
  );
}
