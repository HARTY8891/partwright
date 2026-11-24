import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, Info, X, XCircle } from 'lucide-react';
import { Button, IconButton } from './Button';
import { NumberField } from './Fields';
import { cn } from './cn';

/* ---------- FeaturePanel: the left-side options form ---------- */

export function FeaturePanel({
  icon,
  title,
  canConfirm = true,
  onConfirm,
  onCancel,
  children,
}: {
  icon: ReactNode;
  title: string;
  canConfirm?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={`${title} options`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel?.();
        if (e.key === 'Enter' && canConfirm && (e.target as HTMLElement).tagName !== 'BUTTON') onConfirm?.();
      }}
      className="flex flex-col h-full min-h-0 bg-surface-raised"
    >
      <header className="flex items-center gap-3 h-20 px-6 border-b border-border shrink-0">
        <span className="flex items-center justify-center size-12 rounded-md bg-accent-soft text-accent" aria-hidden>
          {icon}
        </span>
        <h2 className="flex-1 text-base font-semibold truncate">{title}</h2>
      </header>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
      <footer className="flex gap-3 p-4 border-t border-border bg-surface shrink-0">
        <Button variant="primary" className="flex-1" aria-label="Confirm" title="Confirm (Enter)" disabled={!canConfirm} onClick={onConfirm} icon={<Check size={16} aria-hidden />}>
          OK
        </Button>
        <Button variant="secondary" className="flex-1" aria-label="Cancel" title="Cancel (Esc)" onClick={onCancel} icon={<X size={16} aria-hidden />}>
          Cancel
        </Button>
      </footer>
    </section>
  );
}

export function PanelSection({
  title,
  collapsible = true,
  toggle,
  children,
}: {
  title: string;
  collapsible?: boolean;
  toggle?: { checked: boolean; onChange: (v: boolean) => void };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const enabled = toggle ? toggle.checked : true;
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center h-16 px-4 gap-3">
        {toggle && (
          <input
            type="checkbox"
            aria-label={`Use ${title}`}
            checked={toggle.checked}
            onChange={(e) => toggle.onChange(e.target.checked)}
            className="size-8 accent-accent"
          />
        )}
        <button
          aria-expanded={open}
          disabled={!collapsible}
          onClick={() => setOpen(!open)}
          className="flex-1 flex items-center justify-between text-2xs font-semibold uppercase tracking-wide text-text-muted"
        >
          {title}
          {collapsible && <ChevronDown size={14} className={cn('transition-transform', !open && '-rotate-90')} aria-hidden />}
        </button>
      </div>
      {open && (
        <div className={cn('flex flex-col gap-6 px-6 pb-6', !enabled && 'opacity-50 pointer-events-none')} aria-disabled={!enabled}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ---------- MessageBanner ---------- */

const tones = {
  info: { cls: 'bg-accent-soft text-accent', Icon: Info, role: 'status' },
  warning: { cls: 'bg-warning-soft text-warning', Icon: AlertTriangle, role: 'status' },
  error: { cls: 'bg-danger-soft text-danger', Icon: XCircle, role: 'alert' },
} as const;

export function MessageBanner({ tone = 'info', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  const t = tones[tone];
  return (
    <div role={t.role} className={cn('flex gap-4 items-start px-6 py-4 text-xs', t.cls)}>
      <t.Icon size={14} className="shrink-0 mt-px" aria-hidden />
      <div className="text-text">{children}</div>
    </div>
  );
}

/* ---------- ConfirmCorner: top-right of the viewport ---------- */

export function ConfirmCorner({
  mode,
  canConfirm = true,
  onConfirm,
  onCancel,
}: {
  mode: 'sketch' | 'feature';
  canConfirm?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="flex gap-2 p-2 rounded-lg bg-surface-raised/90 shadow-card">
      <IconButton
        size="lg"
        tone="accent"
        label={mode === 'sketch' ? 'Finish sketch' : 'Confirm feature'}
        disabled={!canConfirm}
        onClick={onConfirm}
      >
        <Check size={20} />
      </IconButton>
      <IconButton size="lg" tone="danger" label={mode === 'sketch' ? 'Discard sketch' : 'Cancel'} onClick={onCancel}>
        <X size={20} />
      </IconButton>
    </div>
  );
}

/* ---------- DimensionEditor: inline popup anchored to a dimension ---------- */

export function DimensionEditor({
  name,
  value,
  overDefines,
  onConfirm,
  onCancel,
}: {
  name: string;
  value: string;
  overDefines?: boolean;
  onConfirm?: (text: string) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(value);
  return (
    <div
      role="dialog"
      aria-label={`Edit ${name}`}
      onKeyDown={(e) => e.key === 'Escape' && onCancel?.()}
      className="w-100 flex flex-col gap-4 p-4 rounded-md bg-surface-raised border border-border shadow-pop"
    >
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <NumberField label={name} value={text} onCommit={(t) => setText(t)} vars={{ width: 50 }} />
        </div>
        <IconButton label="Apply" tone="accent" onClick={() => onConfirm?.(text)}>
          <Check size={16} />
        </IconButton>
        <IconButton label="Cancel" tone="danger" onClick={onCancel}>
          <X size={16} />
        </IconButton>
      </div>
      {overDefines && (
        <MessageBanner tone="warning">
          This dimension would over-define the sketch. Keep it as a reference (driven) dimension?
        </MessageBanner>
      )}
    </div>
  );
}
