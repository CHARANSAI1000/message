import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

const ICONS = { error: AlertCircle, success: CheckCircle2, warning: TriangleAlert, info: Info };

export function Alert({ kind, children }: { kind: keyof typeof ICONS; children: ReactNode }) {
  const Icon = ICONS[kind];
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={16} /><div>{children}</div>
    </div>
  );
}
