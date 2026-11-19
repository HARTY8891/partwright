import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as RTooltip from '@radix-ui/react-tooltip';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { IconButton } from './Button';
import { cn } from './cn';

/* ---------- Modal ---------- */

export function Modal({
  open,
  onOpenChange,
  title,
  size = 'md',
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  size?: 'sm' | 'md' | 'lg';
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-text/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-h-[85vh] flex flex-col',
            'rounded-lg bg-surface-raised border border-border shadow-pop',
            size === 'sm' ? 'w-180' : size === 'md' ? 'w-260' : 'w-360',
          )}
        >
          <header className="flex items-center h-20 pl-8 pr-4 border-b border-border">
            <Dialog.Title className="flex-1 text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close">
                <X size={16} />
              </IconButton>
            </Dialog.Close>
          </header>
          <div className="p-8 overflow-auto text-sm">{children}</div>
          {footer && <footer className="flex justify-end gap-4 px-8 py-6 border-t border-border">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Rows for the rebuild error list ("What went wrong", S15). */
export function IssueRow({ kind, feature, message }: { kind: 'error' | 'warning'; feature: string; message: string }) {
  return (
    <div className="flex gap-4 py-4 border-b border-border last:border-b-0">
      {kind === 'error' ? (
        <XCircle size={16} className="text-danger shrink-0" aria-label="Error" />
      ) : (
        <AlertTriangle size={16} className="text-warning shrink-0" aria-label="Warning" />
      )}
      <div>
        <div className="font-medium">{feature}</div>
        <div className="text-text-muted text-xs">{message}</div>
      </div>
    </div>
  );
}

/* ---------- Tooltip ---------- */

export function Tooltip({ label, shortcut, hint, children }: { label: string; shortcut?: string; hint?: string; children: ReactNode }) {
  return (
    <RTooltip.Root delayDuration={500}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content sideOffset={6} className="max-w-120 rounded-md bg-text text-bg px-4 py-3 text-xs shadow-pop z-50">
          <span className="font-medium">{label}</span>
          {shortcut && <kbd className="ml-3 font-mono opacity-70">{shortcut}</kbd>}
          {hint && <div className="opacity-80 mt-1">{hint}</div>}
          <RTooltip.Arrow className="fill-text" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
export const TooltipProvider = RTooltip.Provider;

/* ---------- StatusBar ---------- */

export function StatusBar({
  hint,
  sketchState,
  dof,
  units,
  rebuild,
  onErrorsClick,
}: {
  hint?: string;
  sketchState?: 'under' | 'full' | 'over';
  dof?: number;
  units: string;
  rebuild: { state: 'idle' | 'busy' | 'errors'; ms?: number; errors?: number };
  onErrorsClick?: () => void;
}) {
  const sketchText = { under: 'Under-defined', full: 'Fully defined', over: 'Over-defined' };
  const sketchCls = { under: 'text-sketch-under', full: 'text-sketch-full', over: 'text-sketch-over' };
  return (
    <footer className="flex items-center gap-8 h-12 px-6 bg-surface border-t border-border text-2xs text-text-muted">
      <span className="flex-1 truncate">{hint}</span>
      <span aria-live="polite" className="flex items-center gap-8">
        {sketchState && (
          <span className={cn('font-medium', sketchCls[sketchState])}>
            {sketchText[sketchState]}
            {dof !== undefined && sketchState === 'under' && ` · ${dof} DOF`}
          </span>
        )}
        <span>
          {rebuild.state === 'busy' && (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" aria-hidden /> Rebuilding…
            </span>
          )}
          {rebuild.state === 'idle' && `Rebuilt in ${rebuild.ms ?? 0} ms`}
          {rebuild.state === 'errors' && (
            <button onClick={onErrorsClick} className="text-danger font-medium underline underline-offset-2">
              {rebuild.errors} rebuild {rebuild.errors === 1 ? 'error' : 'errors'}
            </button>
          )}
        </span>
      </span>
      <span>{units}</span>
    </footer>
  );
}

/* ---------- Toasts ---------- */

type ToastTone = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  tone: ToastTone;
  text: string;
}
const ToastCtx = createContext<(tone: ToastTone, text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: ToastTone, text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, tone, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000);
  }, []);
  const Icon = { info: Info, success: CheckCircle2, error: XCircle };
  const cls = { info: 'text-accent', success: 'text-success', error: 'text-danger' };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-16 right-8 flex flex-col gap-4 z-50">
        {items.map((t) => {
          const I = Icon[t.tone];
          return (
            <div key={t.id} className="flex items-center gap-4 min-w-140 px-6 py-5 rounded-md bg-surface-raised border border-border shadow-pop text-sm">
              <I size={16} className={cls[t.tone]} aria-hidden />
              {t.text}
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
