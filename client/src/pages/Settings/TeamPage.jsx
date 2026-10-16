/**
 * Team — members of this workspace and the permissions they hold.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { ROLES, ROLE_LABELS } from '@shared/constants.js';
import { useAuth, useBusinessId } from '@/context/AuthContext.jsx';
import { useApiMutation } from '@/hooks/useApi.js';
import { businesses as businessesApi } from '@/services/index.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Spinner,
  StatusBadge,
} from '@/components/ui/index.jsx';
import { Avatar } from '@/components/WorkspaceSwitcher.jsx';
import { formatRelative, humanise } from '@/utils/format.js';

const PERMISSION_LABELS = {
  'dashboard:read': 'View the dashboard',
  'sale:read': 'View sales',
  'sale:write': 'Record sales',
  'sale:refund': 'Issue refunds',
  'product:read': 'View inventory',
  'product:write': 'Edit products',
  'stock:adjust': 'Adjust stock',
  'customer:read': 'View customers',
  'customer:write': 'Edit customers',
  'supplier:read': 'View suppliers',
  'supplier:write': 'Edit suppliers',
  'purchase:read': 'View purchases',
  'purchase:write': 'Record purchases',
  'expense:read': 'View expenses',
  'expense:write': 'Record expenses',
  'payment:read': 'View payments',
  'payment:write': 'Record payments',
  'invoice:read': 'View invoices',
  'invoice:cancel': 'Cancel invoices',
  'report:read': 'View reports',
  'report:export': 'Export reports',
  'settings:read': 'View settings',
  'settings:write': 'Change settings',
  'member:manage': 'Manage the team',
  'audit:read': 'View the audit log',
};

export default function TeamPage() {
  const { user, isOwner } = useAuth();
  const businessId = useBusinessId();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);

  const { data: members, isLoading, error, refetch } = useQuery({
    queryKey: ['members', businessId],
    queryFn: () => businessesApi.members(),
    enabled: Boolean(businessId),
  });

  const updateMember = useApiMutation(
    ({ id, payload }) => businessesApi.updateMember(id, payload),
    { successMessage: 'Member updated', onSuccess: () => { setRoleTarget(null); refetch(); } }
  );

  const removeMember = useApiMutation(
    ({ id, reason }) => businessesApi.removeMember(id, reason),
    { successMessage: 'Member removed', onSuccess: () => { setRemoveTarget(null); refetch(); } }
  );

  if (isLoading) {
    return (
      <div className="flex justify-center p-16">
        <Spinner className="h-6 w-6 text-brand-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Team</h1>
          <p className="mt-0.5 text-sm text-ink-500">Who can see and change this workspace.</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Invite member
        </Button>
      </header>

      {error && <Alert tone="danger">{error.message}</Alert>}

      <Alert tone="info" title="How permissions work">
        Every role has a fixed set of permissions. Members can be granted extra permissions or have
        individual ones removed, which is how a cashier can record sales but not issue refunds.
      </Alert>

      <Card>
        <CardHeader title="Members" subtitle={`${members?.length ?? 0} in this workspace`} />
        <CardBody className="p-0">
          {(members ?? []).length === 0 ? (
            <EmptyState icon={Users} title="No members" description="Invite your first team member." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {members.map((member) => {
                const isSelf = String(member.user?._id) === String(user?._id);
                return (
                  <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={member.user?.name} src={member.user?.avatarUrl} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-900">
                          {member.user?.name ?? 'Unknown'}
                          {isSelf && <span className="ml-1.5 text-2xs text-ink-400">(you)</span>}
                        </p>
                        <p className="truncate text-2xs text-ink-400">{member.user?.email}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={member.role === 'owner' ? 'brand' : 'neutral'}>
                        {ROLE_LABELS[member.role] ?? member.role}
                      </Badge>
                      <StatusBadge status={member.status} />
                      {member.lastActiveAt && (
                        <span className="text-2xs text-ink-400">{formatRelative(member.lastActiveAt)}</span>
                      )}

                      {isOwner && !isSelf && (
                        <>
                          <Button variant="secondary" size="sm" onClick={() => setRoleTarget(member)}>
                            Change role
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(member)}>
                            Remove
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What each role can do" />
        <CardBody className="space-y-5">
          {ROLES.map((role) => (
            <div key={role}>
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-900">
                <ShieldCheck className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
                {ROLE_LABELS[role]}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {['owner', 'admin', 'manager', 'staff'].includes(role) && (
                  <li>
                    <Badge tone="neutral">{describeRole(role)}</Badge>
                  </li>
                )}
              </ul>
            </div>
          ))}
        </CardBody>
      </Card>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={refetch} />

      <RoleModal
        member={roleTarget}
        loading={updateMember.isPending}
        error={updateMember.error?.message}
        onClose={() => setRoleTarget(null)}
        onSave={(role) => updateMember.mutate({ id: roleTarget.id, payload: { role } })}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => removeMember.mutate({ id: removeTarget.id, reason: 'Removed by workspace owner' })}
        title={`Remove ${removeTarget?.user?.name ?? 'this member'}?`}
        description="They lose access to this workspace immediately. Their past records keep their name, so the audit trail stays intact."
        confirmLabel="Remove member"
        loading={removeMember.isPending}
      >
        {removeMember.error && <Alert tone="danger">{removeMember.error.message}</Alert>}
      </ConfirmDialog>
    </div>
  );
}

function describeRole(role) {
  const labels = {
    owner: 'Everything, including deleting the workspace and transferring ownership.',
    admin: 'Everything except destroying the workspace. Can manage the team.',
    manager: 'Runs the day to day: sales, stock, purchases and reports, including refunds.',
    staff: 'Front-of-house: record sales, manage customers and log expenses.',
  };
  return labels[role];
}

function InviteModal({ open, onClose, onInvited }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'staff', phone: '' });
  const [error, setError] = useState(null);

  const invite = useApiMutation((payload) => businessesApi.inviteMember(payload), {
    successMessage: 'Invitation created',
    onSuccess: () => {
      setForm({ name: '', email: '', role: 'staff', phone: '' });
      onClose();
      onInvited();
    },
  });

  const submit = () => {
    setError(null);
    if (form.name.trim().length < 2) {
      setError('Enter their full name');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError('Enter a valid email address');
      return;
    }
    invite.mutate(form);
  };

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite a team member"
      description="They will be able to sign in with this email and will hold the role you choose."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={invite.isPending}>
            <Mail className="h-4 w-4" aria-hidden="true" />
            Send invitation
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {invite.error && <Alert tone="danger" className="mb-4">{invite.error.message}</Alert>}

      <div className="space-y-4">
        <Field label="Full name" htmlFor="inv-name" required>
          <Input id="inv-name" value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="Email" htmlFor="inv-email" required>
          <Input id="inv-email" type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Phone" htmlFor="inv-phone">
          <Input id="inv-phone" type="tel" value={form.phone} onChange={set('phone')} />
        </Field>
        <Field label="Role" htmlFor="inv-role" required hint={describeRole(form.role)}>
          <select id="inv-role" className="lk-input" value={form.role} onChange={set('role')}>
            {ROLES.filter((r) => r !== 'owner').map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </Field>

        <div>
          <p className="lk-label">Permissions this role grants</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {PERMISSION_SUMMARY[form.role].map((permission) => (
              <li key={permission}>
                <Badge tone="neutral">{PERMISSION_LABELS[permission] ?? humanise(permission)}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

/** Short, human summaries used only in the invite preview. */
const PERMISSION_SUMMARY = {
  admin: ['dashboard:read', 'sale:write', 'sale:refund', 'product:write', 'stock:adjust', 'customer:write', 'supplier:write', 'purchase:write', 'expense:write', 'payment:write', 'invoice:cancel', 'report:export', 'settings:write', 'member:manage'],
  manager: ['dashboard:read', 'sale:write', 'sale:refund', 'product:write', 'stock:adjust', 'customer:write', 'purchase:write', 'expense:write', 'payment:write', 'report:export'],
  staff: ['dashboard:read', 'sale:write', 'product:read', 'customer:read', 'customer:write', 'expense:write', 'payment:read'],
};

function RoleModal({ member, loading, error, onClose, onSave }) {
  const [role, setRole] = useState(member?.role ?? 'staff');

  return (
    <Modal
      open={Boolean(member)}
      onClose={onClose}
      title={`Change ${member?.user?.name ?? 'member'}'s role`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} onClick={() => onSave(role)}>
            Update role
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <Field label="Role" htmlFor="role-select" required hint={describeRole(role)}>
        <select
          id="role-select"
          className="lk-input"
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
    </Modal>
  );
}
