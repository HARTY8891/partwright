import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, XCircle } from 'lucide-react';
import { cn } from './cn';

export type TreeStatus = 'ok' | 'warning' | 'error';

export interface TreeItemProps {
  icon: ReactNode;
  label: string;
  level?: number;
  selected?: boolean;
  suppressed?: boolean;
  rolledBack?: boolean;
  status?: TreeStatus;
  message?: string;
  expanded?: boolean; // undefined = leaf
  onToggle?: () => void;
  onSelect?: () => void;
  onRename?: (name: string) => void;
  /** double-click / Enter: open the item (edit feature). Falls back to rename when absent. */
  onActivate?: () => void;
  /** reordering: drag id of this row (absent = not movable) */
  dragId?: string;
  /** another row was dropped on this one */
  onDropItem?: (draggedId: string) => void;
  /** Alt+↑ / Alt+↓ */
  onMove?: (dir: -1 | 1) => void;
}

export function TreeItem({
  icon,
  label,
  level = 1,
  selected,
  suppressed,
  rolledBack,
  status = 'ok',
  message,
  expanded,
  onToggle,
  onSelect,
  onRename,
  onActivate,
  dragId,
  onDropItem,
  onMove,
}: TreeItemProps) {
  const [dropping, setDropping] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(label);

  const onKey = (e: KeyboardEvent) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && onMove) {
      e.preventDefault();
      e.stopPropagation();
      onMove(e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'F2' && onRename) {
      e.preventDefault();
      setDraft(label);
      setRenaming(true);
    } else if ((e.key === 'ArrowRight' && expanded === false) || (e.key === 'ArrowLeft' && expanded)) {
      e.preventDefault();
      onToggle?.();
    } else if (e.key === 'Enter' && onActivate) {
      e.preventDefault();
      onActivate();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.();
    }
  };

  const commit = () => {
    setRenaming(false);
    if (draft.trim() && draft !== label) onRename?.(draft.trim());
  };

  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-selected={!!selected}
      aria-expanded={expanded}
      tabIndex={selected ? 0 : -1}
      onKeyDown={onKey}
      draggable={!!dragId}
      onDragStart={(e) => {
        if (!dragId) return;
        e.dataTransfer.setData('text/x-partwright-feature', dragId);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!onDropItem || !e.dataTransfer.types.includes('text/x-partwright-feature')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        const id = e.dataTransfer.getData('text/x-partwright-feature');
        if (id && onDropItem) (e.preventDefault(), onDropItem(id));
      }}
      onClick={onSelect}
      onDoubleClick={() => (onActivate ? onActivate() : onRename && (setDraft(label), setRenaming(true)))}
      title={message}
      className={cn(
        'flex items-center gap-2 h-12 pr-4 text-sm cursor-default select-none outline-none',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
        selected ? 'bg-accent-soft' : 'hover:bg-surface-sunken',
        dropping && 'shadow-[inset_0_2px_0_0_var(--pw-color-accent)]',
        (suppressed || rolledBack) && 'text-text-muted',
        suppressed && 'italic',
      )}
      style={{ paddingLeft: 4 + (level - 1) * 16 }}
    >
      <span className="w-8 flex justify-center text-text-muted">
        {expanded !== undefined && (
          <ChevronRight
            size={12}
            aria-hidden
            className={cn('transition-transform duration-100', expanded && 'rotate-90')}
            onClick={(e) => (e.stopPropagation(), onToggle?.())}
          />
        )}
      </span>
      <span className={cn('flex', (suppressed || rolledBack) && 'opacity-50')} aria-hidden>
        {icon}
      </span>
      {renaming ? (
        <input
          autoFocus
          aria-label="Feature name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setRenaming(false);
          }}
          className="flex-1 min-w-0 h-10 px-2 bg-bg border border-focus rounded-sm text-sm"
        />
      ) : (
        <span className="flex-1 truncate">{label}</span>
      )}
      {status === 'error' && <XCircle size={14} className="text-danger shrink-0" aria-label="Error" />}
      {status === 'warning' && <AlertTriangle size={14} className="text-warning shrink-0" aria-label="Warning" />}
    </div>
  );
}

/** Horizontal bar the user drags/arrows to roll the history back. */
export function RollbackBar({ index, max, onChange }: { index: number; max: number; onChange: (i: number) => void }) {
  return (
    <div
      // a tree may only contain tree items, so the bar is one (with its own description)
      role="treeitem"
      aria-roledescription="rollback bar"
      aria-label={`Rollback bar, after ${index} of ${max} items. Use the up and down arrows to move it.`}
      tabIndex={0}
      onKeyDown={(e) => {
        // handled here so the tree's own arrow navigation does not move focus away
        if (e.key === 'ArrowUp' && index > 0) (e.preventDefault(), e.stopPropagation(), onChange(index - 1));
        if (e.key === 'ArrowDown' && index < max) (e.preventDefault(), e.stopPropagation(), onChange(index + 1));
      }}
      className="group h-4 flex items-center cursor-ns-resize outline-none focus-visible:bg-accent-soft"
    >
      <div className="h-px w-full bg-accent group-hover:h-1 group-focus-visible:h-1 transition-all" />
    </div>
  );
}

/**
 * Tree with roving focus (WAI-ARIA tree pattern): one Tab stop that lands on the
 * selected row (or the first row), then ↑/↓/Home/End move between rows.
 */
export function Tree({ label, hasSelection = false, children }: { label: string; hasSelection?: boolean; children: ReactNode }) {
  const rows = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  return (
    <div
      role="tree"
      aria-label={label}
      className="py-2 outline-none"
      // The tree itself is the Tab stop only while no row is selected (a selected row carries tabIndex 0).
      tabIndex={hasSelection ? -1 : 0}
      onFocus={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) return;
        // Coming from outside: forward focus to the selected row, or the first one.
        const list = rows(e.currentTarget);
        (list.find((r) => r.getAttribute('aria-selected') === 'true') ?? list[0])?.focus();
      }}
      onKeyDown={(e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const list = rows(e.currentTarget);
        const i = list.indexOf(document.activeElement as HTMLElement);
        if (i < 0) return;
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        list[next].focus();
      }}
    >
      {children}
    </div>
  );
}
