import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

/** Toolbar with roving focus on ←/→ (WAI-ARIA toolbar pattern). */
export function Ribbon({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length].focus();
  };
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      onKeyDown={onKey}
      className="flex items-stretch gap-1 h-44 px-4 pt-2 bg-surface-raised border-b border-border overflow-x-auto overflow-y-hidden"
    >
      {children}
    </div>
  );
}

export function RibbonDivider() {
  return <div role="separator" aria-orientation="vertical" className="w-px my-4 mx-2 bg-border" />;
}

/** A labelled set of related commands, the label underneath (like a desktop CAD ribbon). */
export function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col shrink-0 px-2 border-r border-border last:border-r-0">
      <div className="flex items-start gap-1 flex-1">{children}</div>
      <div className="text-2xs text-text-muted text-center leading-none pb-2 pt-1 select-none" aria-hidden>
        {label}
      </div>
    </div>
  );
}

/** Small commands stacked in a column, two or three high. */
export function RibbonStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col justify-start">{children}</div>;
}

interface RibbonButtonProps {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  layout?: 'large' | 'small';
  /** a shorter label to show; `label` stays the button's name */
  short?: string;
  onClick?: () => void;
}

export function RibbonButton({ icon, label, shortcut, active, disabled, layout = 'large', short, onClick }: RibbonButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={short ? label : undefined}
      disabled={disabled}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        'rounded-sm border text-2xs font-medium text-text transition-colors duration-100',
        'disabled:opacity-40 disabled:pointer-events-none',
        active ? 'bg-accent-soft border-accent' : 'border-transparent hover:bg-surface-sunken',
        layout === 'large'
          ? 'flex flex-col items-center justify-center gap-1 w-28 h-28 px-1'
          : 'flex items-center gap-2 h-10 pl-2 pr-3 whitespace-nowrap',
      )}
    >
      <span className={cn('text-text', active && 'text-accent')} aria-hidden>
        {icon}
      </span>
      <span className={cn('leading-tight', layout === 'large' ? 'text-center' : 'text-left')}>{short ?? label}</span>
    </button>
  );
}

/** Main command + chevron opening related commands (e.g. Extrude ▾ Blind / Through all). */
export function RibbonSplitButton({
  main,
  items,
}: {
  main: RibbonButtonProps;
  items: { label: string; icon?: ReactNode; onSelect?: () => void }[];
}) {
  return (
    <div className="flex items-stretch">
      <RibbonButton {...main} />
      <Menu.Root>
        <Menu.Trigger
          aria-label={`More ${main.label} options`}
          className="w-6 rounded-sm text-text-muted hover:bg-surface-sunken flex items-end justify-center pb-2"
        >
          <ChevronDown size={12} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            sideOffset={4}
            className="min-w-80 rounded-md bg-surface-raised border border-border shadow-pop p-2 text-sm"
          >
            {items.map((it) => (
              <Menu.Item
                key={it.label}
                onSelect={it.onSelect}
                className="flex items-center gap-4 h-14 px-4 rounded-sm outline-none cursor-default data-[highlighted]:bg-accent-soft"
              >
                {it.icon}
                {it.label}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

export function RibbonTabs({
  tabs,
  value,
  onValueChange,
  children,
}: {
  tabs: string[];
  value: string;
  onValueChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <Tabs.Root value={value} onValueChange={onValueChange}>
      <Tabs.List aria-label="Command groups" className="flex h-13 px-4 gap-2 bg-surface border-b border-border">
        {tabs.map((t) => (
          <Tabs.Trigger
            key={t}
            value={t}
            className={cn(
              'px-6 text-xs border-b-2 -mb-px',
              'data-[state=active]:border-accent data-[state=active]:text-text data-[state=active]:font-medium',
              'data-[state=inactive]:border-transparent data-[state=inactive]:text-text-muted hover:text-text',
            )}
          >
            {t}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {children}
    </Tabs.Root>
  );
}
export const RibbonTabPanel = Tabs.Content;
