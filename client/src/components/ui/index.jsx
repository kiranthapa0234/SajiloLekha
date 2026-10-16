/**
 * Design-system primitives.
 *
 * Every component here is keyboard accessible, carries the ARIA attributes its
 * role requires, and renders its own loading/empty/error states so pages never
 * have to reimplement them.
 */
import React, { forwardRef } from 'react';
import { clsx } from 'clsx';

/* --------------------------------------------------------------- BUTTON -- */

const BUTTON_VARIANTS = {
  primary: 'lk-btn-primary',
  secondary: 'lk-btn-secondary',
  ghost: 'lk-btn-ghost',
  danger: 'lk-btn-danger',
};

const BUTTON_SIZES = {
  sm: 'lk-btn-sm',
  md: '',
  lg: 'px-5 py-2.5 text-sm',
};

export const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    className,
    loading = false,
    disabled,
    children,
    type = 'button',
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      // `aria-busy` tells assistive tech the control is working, and
      // `disabled` removes it from the tab order entirely.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={clsx(BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" aria-hidden="true" />}
      {children}
    </button>
  );
});

/* -------------------------------------------------------------- SPINNER -- */

export function Spinner({ className, label = 'Loading' }) {
  return (
    <svg
      className={clsx('animate-spin text-current', className)}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label={label}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/* ----------------------------------------------------------------- CARD -- */

export function Card({ className, children, ...props }) {
  return (
    <section className={clsx('lk-card', className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action, className }) {
  return (
    <header className={clsx('lk-card-header', className)}>
      <div className="min-w-0">
        <h2 className="lk-card-title">{title}</h2>
        {subtitle && <p className="lk-card-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function CardBody({ className, children }) {
  return <div className={clsx('lk-card-body', className)}>{children}</div>;
}

/* --------------------------------------------------------------- BADGE --- */

const BADGE_TONES = {
  neutral: 'bg-ink-100 text-ink-600',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
};

export function Badge({ tone = 'neutral', className, children, ...props }) {
  return (
    <span className={clsx('lk-badge', BADGE_TONES[tone], className)} {...props}>
      {children}
    </span>
  );
}

/** Maps a domain status to its visual tone in one place. */
export const STATUS_TONES = {
  paid: 'success',
  partial: 'warning',
  partial_paid: 'warning',
  unpaid: 'danger',
  overdue: 'danger',
  cancelled: 'neutral',
  received: 'success',
  valid: 'success',
  voided: 'neutral',
  failed: 'danger',
  in_stock: 'success',
  low_stock: 'warning',
  out_of_stock: 'danger',
  not_tracked: 'neutral',
  archived: 'neutral',
  recorded: 'success',
  active: 'success',
  suspended: 'danger',
  invited: 'warning',
  pending: 'warning',
};

export function StatusBadge({ status, label, className }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} className={className}>
      {label ?? status ?? 'unknown'}
    </Badge>
  );
}

/* --------------------------------------------------------------- ALERT --- */

const ALERT_TONES = {
  info: 'border-brand-200 bg-brand-50 text-brand-800',
  success: 'border-success-100 bg-success-50 text-success-700',
  warning: 'border-warning-100 bg-warning-50 text-warning-700',
  danger: 'border-danger-100 bg-danger-50 text-danger-700',
};

export function Alert({ tone = 'info', title, children, className, ...props }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={clsx('rounded-lg border px-4 py-3 text-sm', ALERT_TONES[tone], className)}
      {...props}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={clsx(title && 'mt-1', 'text-[13px] leading-relaxed')}>{children}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- FIELD --- */

export function Field({ label, htmlFor, error, hint, required, className, children }) {
  return (
    <div className={clsx('w-full', className)}>
      {label && (
        <label className="lk-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-danger-600" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="lk-hint">{hint}</p>}
      {error && (
        <p className="lk-error" role="alert">
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx('lk-input', invalid && 'lk-input-error', className)}
      {...props}
    />
  );
});

export const Textarea = forwardRef(function Textarea({ className, invalid, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={clsx('lk-input resize-y', invalid && 'lk-input-error', className)}
      {...props}
    />
  );
});

export const Select = forwardRef(function Select({ className, invalid, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx('lk-input cursor-pointer pr-8', invalid && 'lk-input-error', className)}
      {...props}
    >
      {children}
    </select>
  );
});

export const Checkbox = forwardRef(function Checkbox({ className, label, ...props }, ref) {
  return (
    <label className={clsx('flex cursor-pointer select-none items-center gap-2 text-sm text-ink-700', className)}>
      <input
        ref={ref}
        type="checkbox"
        className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-600"
        {...props}
      />
      {label}
    </label>
  );
});

/* ------------------------------------------------------------ SKELETON --- */

export function Skeleton({ className }) {
  return <div className={clsx('lk-skeleton', className)} aria-hidden="true" />;
}

/** Skeleton that mirrors a table so the layout does not jump when data lands. */
export function TableSkeleton({ rows = 5, columns = 5 }) {
  return (
    <div className="animate-fade-in" role="status" aria-label="Loading records">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 border-b border-ink-100 px-4 py-3.5">
          {Array.from({ length: columns }).map((__, colIndex) => (
            <Skeleton
              key={colIndex}
              className={clsx('h-3.5', colIndex === 0 ? 'w-40' : colIndex === columns - 1 ? 'ml-auto w-16' : 'w-24')}
            />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function CardSkeleton({ className }) {
  return (
    <div className={clsx('lk-card space-y-3 p-5', className)} role="status" aria-label="Loading">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-3 w-full" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/* ---------------------------------------------------------- EMPTY STATE -- */

export function EmptyState({ icon: Icon, title, description, action, className, compact }) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-16',
        className
      )}
    >
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ---------------------------------------------------------- ERROR STATE -- */

export function ErrorState({ error, onRetry, className, compact }) {
  const message =
    error?.message ?? 'Something went wrong while loading this view.';
  return (
    <div
      role="alert"
      className={clsx('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-8' : 'px-6 py-12', className)}
    >
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-danger-50 text-danger-600">
        <span className="text-lg" aria-hidden="true">!</span>
      </div>
      <p className="text-sm font-medium text-ink-900">{message}</p>
      {error?.requestId && (
        <p className="mt-1 font-mono text-2xs text-ink-400">Reference: {error.requestId}</p>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- MODAL ---- */

/**
 * Accessible dialog: focus is moved in on open, trapped while open, and
 * restored to the trigger on close. Escape and backdrop both dismiss.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', className }) {
  const panelRef = React.useRef(null);
  const bodyRef = React.useRef(null);
  const previouslyFocused = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement;

    // The selector already excludes disabled controls. Visibility is checked
    // WITHOUT `offsetParent`, which is null for `position: fixed` subtrees
    // (and always null under jsdom), so it would wrongly reject everything.
    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true');

    // Focus the first control INSIDE the body, not the header's close button.
    // Landing on "close" means a reflexive Enter dismisses the dialog — which
    // for a confirmation is the opposite of the safe default.
    const timer = setTimeout(() => {
      const inBody = Array.from(
        bodyRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true');

      (inBody[0] ?? focusable()[0] ?? panelRef.current)?.focus();
    }, 0);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const targets = focusable();
      if (targets.length === 0) return;
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={clsx(
          'relative z-10 w-full animate-slide-up rounded-t-2xl bg-white shadow-popover sm:rounded-2xl',
          sizes[size],
          className
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="lk-btn-ghost -mr-1.5 -mt-1 p-1.5"
          >
            <span aria-hidden="true" className="text-lg leading-none">×</span>
          </button>
        </header>
        <div ref={bodyRef} className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 px-5 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- CONFIRM DIALOG -- */

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  requireText,
  children,
  loading,
}) {
  const [typed, setTyped] = React.useState('');
  const [wasOpen, setWasOpen] = React.useState(open);

  // Clear the confirmation phrase each time the dialog is opened, so a
  // half-typed word from a previous dialog cannot carry over.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTyped('');
  }

  const blocked = Boolean(requireText) && typed.trim().toUpperCase() !== requireText.toUpperCase();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            disabled={blocked}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {requireText && (
        <Field label={`Type ${requireText} to confirm`} className="mt-4">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={requireText}
            autoComplete="off"
          />
        </Field>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------ TOASTS ---- */

export function Toaster({ toasts, onDismiss }) {
  if (!toasts?.length) return null;
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className={clsx(
            'pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-xl px-4 py-3 shadow-popover',
            toast.tone === 'success' && 'bg-ink-900 text-white',
            toast.tone === 'error' && 'bg-danger-600 text-white',
            toast.tone === 'info' && 'bg-white text-ink-900 ring-1 ring-ink-200'
          )}
        >
          <span className="flex-1 text-sm">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="-mr-1 opacity-60 transition-opacity hover:opacity-100"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- MISC ------ */

export function Divider({ className }) {
  return <hr className={clsx('border-ink-100', className)} />;
}

/** Label + value pair used across detail panels. */
export function DataPoint({ label, value, className, mono }) {
  return (
    <div className={clsx('min-w-0', className)}>
      <dt className="text-2xs font-medium uppercase tracking-wider text-ink-400">{label}</dt>
      <dd className={clsx('mt-0.5 truncate text-sm text-ink-900', mono && 'font-mono')}>{value ?? '--'}</dd>
    </div>
  );
}

/** Keyboard hint shown under a control. */
export function Kbd({ children }) {
  return (
    <kbd className="rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 font-mono text-2xs text-ink-600">
      {children}
    </kbd>
  );
}
