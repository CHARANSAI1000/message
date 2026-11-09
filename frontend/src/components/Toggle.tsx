type Props = { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean };

export function Toggle({ checked, onChange, label, hint, disabled }: Props) {
  return (
    <label className={`toggle-row ${disabled ? 'is-disabled' : ''}`}>
      <span className="grow">
        <span className="toggle-label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <input type="checkbox" className="toggle" role="switch" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
