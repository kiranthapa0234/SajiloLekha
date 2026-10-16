/**
 * Workspace switcher and avatar.
 *
 * Switching workspace clears the query cache so no data from the previous
 * business is ever visible while the new one loads.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { Modal, Button, Field, Input } from './ui/index.jsx';
import { ROLE_LABELS } from '@shared/constants.js';

/** Deterministic initials so the avatar never flickers between renders. */
export function initials(name) {
  if (!name) return '?';
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

const AVATAR_TONES = ['bg-brand-600', 'bg-success-600', 'bg-warning-600', 'bg-ink-700', 'bg-brand-800'];

function toneFor(seed) {
  let hash = 0;
  for (let i = 0; i < String(seed).length; i += 1) hash = (hash * 31 + String(seed).charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function Avatar({ name, src, size = 'md', className }) {
  const sizes = { xs: 'h-6 w-6 text-[10px]', sm: 'h-8 w-8 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-12 w-12 text-base' };
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white',
        sizes[size] ?? sizes.md,
        !src && toneFor(name),
        className
      )}
      title={name}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}

export function WorkspaceSwitcher({ compact }) {
  const { business, workspaces, switchBusiness, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const containerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    const onClickAway = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleSwitch = async (id) => {
    if (id === business?.id) {
      setOpen(false);
      return;
    }
    setSwitchingTo(id);
    try {
      await switchBusiness(id);
      setOpen(false);
      navigate('/');
    } finally {
      setSwitchingTo(null);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex w-full items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-ink-50',
          compact ? 'justify-center p-1' : 'px-2 py-1.5'
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Current workspace: ${business?.name ?? 'none'}. Change workspace`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-100 text-2xs font-bold text-brand-700">
          {initials(business?.name)}
        </span>
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink-900">{business?.name}</span>
              <span className="block truncate text-2xs text-ink-500">{business?.address?.city || 'Workspace'}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden="true" />
          </>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Workspaces"
          className="absolute left-0 right-0 top-full z-40 mt-1 animate-slide-up rounded-xl border border-ink-200 bg-white p-1 shadow-popover"
        >
          {workspaces.map((workspace) => {
            const active = workspace.id === business?.id;
            return (
              <button
                key={workspace.id}
                type="button"
                role="option"
                aria-selected={active}
                disabled={Boolean(switchingTo)}
                onClick={() => handleSwitch(workspace.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-brand-50 disabled:opacity-50"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ink-100 text-2xs font-bold text-ink-600">
                  {initials(workspace.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">{workspace.name}</span>
                  <span className="block truncate text-2xs text-ink-500">{ROLE_LABELS[workspace.role] ?? workspace.role}</span>
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />}
                {switchingTo === workspace.id && (
                  <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-label="Switching" />
                )}
              </button>
            );
          })}

          {can('business:manage') && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
              className="mt-1 flex w-full items-center gap-2.5 rounded-lg border-t border-ink-100 px-2.5 py-2 text-left text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New workspace
            </button>
          )}
        </div>
      )}

      <CreateWorkspaceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateWorkspaceModal({ open, onClose }) {
  const { business } = useAuth();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError('Business name must be at least 2 characters');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { businesses } = await import('@/services/index.js');
      await businesses.create({ name: name.trim(), currency: business?.currency, timezone: business?.timezone });
      onClose();
      setName('');
      window.location.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a workspace"
      description="Each workspace keeps its own products, customers and books, fully isolated."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Create workspace
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label="Business name" htmlFor="ws-name" required error={error}>
          <Input
            id="ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sunrise Store"
            autoFocus
          />
        </Field>
      </form>
    </Modal>
  );
}
