/**
 * Profile: personal details, password and active sessions.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, LogOut, Save } from 'lucide-react';
import { changePasswordSchema, updateProfileSchema } from '@shared/validators/index.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { useApiMutation } from '@/hooks/useApi.js';
import { auth as authApi } from '@/services/index.js';
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Spinner, StatusBadge } from '@/components/ui/index.jsx';
import { formatDateTime, formatRelative } from '@/utils/format.js';

export default function ProfilePage() {
  const { user, updateProfile, logout } = useAuth();

  const {
    register: bind,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(updateProfileSchema),
    mode: 'onTouched',
    defaultValues: { name: '', phone: '' },
  });

  useEffect(() => {
    if (user) reset({ name: user.name ?? '', phone: user.phone ?? '' });
  }, [user, reset]);

  const save = useApiMutation((values) => updateProfile(values), { successMessage: 'Profile updated' });

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">Your profile</h1>
        <p className="mt-0.5 text-sm text-ink-500">Your name, contact details and sign-in security.</p>
      </header>

      {save.error && <Alert tone="danger">{save.error.message}</Alert>}

      <Card>
        <CardHeader title="Details" />
        <CardBody>
          <form
            noValidate
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const values = await handleSubmit((v) => v)(event);
              if (values) {
                try {
                  await save.mutateAsync(values);
                } catch (error) {
                  for (const [field, message] of Object.entries(error.fields ?? {})) setError(field, { message });
                }
              }
            }}
          >
            <Field label="Full name" htmlFor="profile-name" required error={errors.name?.message}>
              <Input id="profile-name" autoComplete="name" invalid={Boolean(errors.name)} {...bind('name')} />
            </Field>

            <Field label="Email" htmlFor="profile-email" hint="Contact an owner to change your sign-in email">
              <Input id="profile-email" value={user?.email ?? ''} disabled readOnly />
            </Field>

            <Field label="Phone" htmlFor="profile-phone" error={errors.phone?.message}>
              <Input id="profile-phone" type="tel" autoComplete="tel" {...bind('phone')} />
            </Field>

            {!user?.emailVerified && (
              <Alert tone="warning">
                Your email is not verified. Some features may be unavailable until it is confirmed.
              </Alert>
            )}

            <Button type="submit" loading={isSubmitting || save.isPending} disabled={!isDirty}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Save profile
            </Button>
          </form>
        </CardBody>
      </Card>

      <PasswordCard onChanged={logout} />

      <SessionsCard />
    </div>
  );
}

function PasswordCard({ onChanged }) {
  const {
    register: bind,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(changePasswordSchema),
    mode: 'onTouched',
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword') ?? '';

  const change = useApiMutation((values) => authApi.changePassword(values), {
    successMessage: 'Password updated',
    onSuccess: () => {
      reset();
      // Every session was revoked server-side, so send the user back to sign in.
      setTimeout(onChanged, 1500);
    },
  });

  return (
    <Card>
      <CardHeader title="Password" subtitle="Changing it signs out every device" />
      <CardBody>
        {change.isSuccess && (
          <Alert tone="success" className="mb-4">
            Password updated. You will be signed out and asked to sign in again.
          </Alert>
        )}
        {change.error && <Alert tone="danger" className="mb-4">{change.error.message}</Alert>}

        <form
          noValidate
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const values = await handleSubmit((v) => v)(event);
            if (values) {
              try {
                await change.mutateAsync(values);
              } catch (error) {
                for (const [field, message] of Object.entries(error.fields ?? {})) setError(field, { message });
              }
            }
          }}
        >
          <Field label="Current password" htmlFor="pw-current" required error={errors.currentPassword?.message}>
            <Input id="pw-current" type="password" autoComplete="current-password" invalid={Boolean(errors.currentPassword)} {...bind('currentPassword')} />
          </Field>

          <Field label="New password" htmlFor="pw-new" required error={errors.newPassword?.message}>
            <Input id="pw-new" type="password" autoComplete="new-password" invalid={Boolean(errors.newPassword)} {...bind('newPassword')} />
          </Field>

          <p className="text-2xs text-ink-400" aria-live="polite">
            At least 10 characters with an uppercase letter, a lowercase letter and a number.
            {newPassword.length > 0 && ` Currently ${newPassword.length} characters.`}
          </p>

          <Field label="Confirm new password" htmlFor="pw-confirm" required error={errors.confirmPassword?.message}>
            <Input id="pw-confirm" type="password" autoComplete="new-password" {...bind('confirmPassword')} />
          </Field>

          <Button type="submit" loading={isSubmitting || change.isPending}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Update password
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function SessionsCard() {
  const { data: sessions, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => authApi.sessions(),
    staleTime: 60_000,
  });

  const revoke = useApiMutation(() => authApi.revokeSessions(), { successMessage: 'All other sessions revoked' });

  if (isLoading) {
    return (
      <Card>
        <CardBody className="flex justify-center py-8">
          <Spinner className="h-5 w-5 text-brand-600" />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Active sessions"
        subtitle={`${sessions?.length ?? 0} device(s) currently signed in`}
        action={
          (sessions?.length ?? 0) > 1 ? (
            <Button variant="secondary" size="sm" onClick={() => revoke.mutate()} loading={revoke.isPending}>
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Sign out everywhere
            </Button>
          ) : null
        }
      />
      <CardBody className="p-0">
        {(sessions ?? []).length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-400">No other active sessions.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {sessions.map((session) => (
              <li key={session.jti} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-800">{session.userAgent ?? 'Unknown device'}</p>
                  <p className="truncate text-2xs text-ink-400">
                    {session.ip ?? 'unknown IP'} · signed in {formatRelative(session.createdAt)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <StatusBadge status="active" />
                  <p className="mt-1 text-2xs text-ink-400">expires {formatDateTime(session.expiresAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
