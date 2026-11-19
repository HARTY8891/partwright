import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-raised text-text border border-border-input hover:bg-surface-sunken active:bg-border',
  ghost: 'bg-transparent text-text hover:bg-surface-sunken active:bg-border',
  danger: 'bg-danger text-on-accent hover:brightness-110 active:brightness-95',
};
const sizes: Record<Size, string> = {
  sm: 'h-12 px-4 text-xs',
  md: 'h-14 px-6 text-sm',
  lg: 'h-16 px-8 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-3 rounded-md font-medium select-none',
        'transition-[background-color,filter] duration-100',
        'disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : icon}
      <span>{children}</span>
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md' | 'lg';
  pressed?: boolean;
  tone?: 'default' | 'accent' | 'danger';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', pressed, tone = 'default', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors duration-100',
        'disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' ? 'size-12' : size === 'md' ? 'size-14' : 'size-16',
        pressed
          ? 'bg-accent-soft text-accent'
          : tone === 'accent'
            ? 'text-accent hover:bg-accent-soft'
            : tone === 'danger'
              ? 'text-danger hover:bg-danger-soft'
              : 'text-text-muted hover:bg-surface-sunken hover:text-text',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
