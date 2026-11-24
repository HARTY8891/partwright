import { useId, useState, type ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from './cn';

/* ---------- NumberField: units + expressions ---------- */

const UNIT: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, deg: 1, '°': 1 };

/** Parses "20", "20 mm", "1 in", "=width/2" (vars). Returns value in the field's unit, or an error. */
export function parseValue(text: string, vars: Record<string, number> = {}): { value?: number; error?: string } {
  const s = text.trim();
  if (!s) return { error: 'Enter a value' };
  if (s.startsWith('=')) {
    const expr = s.slice(1).replace(/[A-Za-z_]\w*/g, (n) => (n in vars ? String(vars[n]) : `__unknown_${n}`));
    if (/__unknown_(\w+)/.test(expr)) return { error: `Unknown variable "${expr.match(/__unknown_(\w+)/)![1]}"` };
    if (!/^[\d\s.+\-*/()]+$/.test(expr)) return { error: 'Only numbers, variables and + - * / ( )' };
    try {
      const v = Function(`"use strict";return (${expr})`)() as number;
      return Number.isFinite(v) ? { value: v } : { error: 'Result is not a number' };
    } catch {
      return { error: 'Cannot read this expression' };
    }
  }
  const m = s.match(/^(-?\d*\.?\d+)\s*(mm|cm|m|in|deg|°)?$/);
  if (!m) return { error: 'Not a number' };
  return { value: parseFloat(m[1]) * (m[2] ? UNIT[m[2]] : 1) };
}

/**
 * A length typed by the user, returned in millimetres. Plain numbers are in the
 * part's units; an explicit unit ("12 mm", "0.5 in") wins.
 */
export function parseLength(text: string, units: 'mm' | 'in', vars: Record<string, number> = {}): { value?: number; error?: string } {
  const r = parseValue(text, vars);
  if (r.value === undefined) return r;
  const explicit = /\d\s*(mm|cm|m|in)\s*$/.test(text.trim());
  return explicit ? r : { value: r.value * (units === 'in' ? 25.4 : 1) };
}

interface NumberFieldProps {
  label: string;
  value: string;
  unit?: 'mm' | 'in' | '°' | '';
  min?: number;
  step?: number;
  vars?: Record<string, number>;
  disabled?: boolean;
  hideLabel?: boolean;
  /** a length in the part's units: the field shows that unit and reports millimetres */
  lengthUnits?: 'mm' | 'in';
  onCommit?: (text: string, value: number) => void;
}

export function NumberField({ label, value, unit = 'mm', min, step = 1, vars, disabled, hideLabel, lengthUnits, onCommit }: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(value);
  // follow the value when it changes from outside (a preset, undo, another field)
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setText(value);
  }
  const parsed = lengthUnits ? parseLength(text, lengthUnits, vars) : parseValue(text, vars);
  if (lengthUnits) unit = lengthUnits;
  const error = parsed.error ?? (min !== undefined && parsed.value! < min ? `Must be at least ${min}` : undefined);
  const linked = text.trim().startsWith('=');

  const commit = () => !error && onCommit?.(text, parsed.value!);
  const bump = (dir: number, big: boolean) => {
    if (parsed.value === undefined || linked) return;
    const shown = lengthUnits === 'in' ? parsed.value / 25.4 : parsed.value;
    const next = +(shown + dir * step * (big ? 10 : 1)).toFixed(6);
    setText(String(min !== undefined ? Math.max(min, next) : next));
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={cn('text-xs text-text-muted', hideLabel && 'sr-only')}>
        {label}
      </label>
      <div
        className={cn(
          'flex items-center h-14 rounded-md border bg-bg',
          error ? 'border-danger' : 'border-border-input focus-within:border-focus',
          disabled && 'opacity-50',
        )}
      >
        {linked && (
          <span className="ml-2 px-2 rounded-sm bg-accent-soft text-accent text-2xs font-semibold" aria-hidden>
            =
          </span>
        )}
        <input
          id={id}
          role="spinbutton"
          inputMode="decimal"
          disabled={disabled}
          value={text}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          aria-valuenow={parsed.value}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'ArrowUp') (e.preventDefault(), bump(1, e.shiftKey));
            if (e.key === 'ArrowDown') (e.preventDefault(), bump(-1, e.shiftKey));
          }}
          className="flex-1 min-w-0 h-full px-4 bg-transparent font-mono text-sm outline-none"
        />
        {unit && <span className="pr-4 text-xs text-text-muted">{unit}</span>}
      </div>
      {error && (
        <span id={`${id}-err`} className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/* ---------- Checkbox ---------- */

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn('inline-flex items-center gap-4 text-sm cursor-default', disabled && 'opacity-50')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-8 accent-accent"
      />
      {label}
    </label>
  );
}

/* ---------- Select (Radix menu as a select) ---------- */

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-text-muted">{label}</span>
      <Menu.Root>
        <Menu.Trigger
          aria-label={`${label}: ${current?.label}`}
          className="flex items-center gap-3 h-14 px-4 rounded-md border border-border-input bg-bg text-sm text-left"
        >
          {current?.icon}
          <span className="flex-1">{current?.label}</span>
          <ChevronDown size={14} className="text-text-muted" aria-hidden />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            align="start"
            sideOffset={4}
            className="min-w-[var(--radix-dropdown-menu-trigger-width)] rounded-md bg-surface-raised border border-border shadow-pop p-2 text-sm z-50"
          >
            <Menu.RadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
              {options.map((o) => (
                <Menu.RadioItem
                  key={o.value}
                  value={o.value}
                  className="flex items-center gap-4 h-14 px-4 rounded-sm outline-none cursor-default data-[highlighted]:bg-accent-soft"
                >
                  <span className="w-8">
                    <Menu.ItemIndicator>
                      <Check size={14} />
                    </Menu.ItemIndicator>
                  </span>
                  {o.icon}
                  {o.label}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

/* ---------- SelectionBox: picked faces / edges ---------- */

export function SelectionBox({
  label,
  prompt,
  items,
  focused,
  error,
  onFocus,
  onRemove,
}: {
  label: string;
  prompt: string;
  items: string[];
  focused?: boolean;
  error?: string;
  onFocus?: () => void;
  onRemove?: (i: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-text-muted">{label}</span>
      <div
        role="listbox"
        aria-label={`${label}. ${prompt}`}
        tabIndex={0}
        onFocus={onFocus}
        onClick={onFocus}
        className={cn(
          'min-h-24 max-h-72 overflow-auto rounded-md border p-2 flex flex-wrap content-start gap-2',
          error ? 'border-danger' : focused ? 'border-focus bg-accent-soft' : 'border-border-input bg-bg',
        )}
      >
        {items.length === 0 && <span className="px-2 py-1 text-xs text-text-muted">{prompt}</span>}
        {items.map((it, i) => (
          <span
            key={it + i}
            role="option"
            aria-selected="false"
            tabIndex={-1}
            onKeyDown={(e) => (e.key === 'Delete' || e.key === 'Backspace') && onRemove?.(i)}
            className="inline-flex items-center gap-1 h-10 pl-3 pr-1 rounded-sm bg-surface-sunken text-xs"
          >
            {it}
            <button
              aria-label={`Remove ${it}`}
              onClick={(e) => (e.stopPropagation(), onRemove?.(i))}
              className="size-8 inline-flex items-center justify-center rounded-sm text-text-muted hover:text-danger"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
