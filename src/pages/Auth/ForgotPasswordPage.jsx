/**
 * Password reset: request a link, then set a new password.
 *
 * The request step always reports success, whether or not the email exists, so
 * the form cannot be used to discover which addresses are registered.
 */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { forgotPasswordSchema, resetPasswordSchema } from '@shared/validators/index.js';
import { auth } from '@/services/index.js';
import { Alert } from '@/components/ui/index.jsx';
import { Button, Field, Input } from '@/components/ui/index.jsx';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [devToken, setDevToken] = useState(null);
  const [error, setError] = useState(null);

  const {
    register: bind,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(forgotPasswordSchema), mode: 'onTouched' });

  const onSubmit = async (values) => {
    setError(null);
    try {
      const result = await auth.forgotPassword(values.email);
      setSent(true);
      // Outside production the API returns the token so the flow is testable
      // without a mail server.
      if (result?.devToken) setDevToken(result.devToken);
    } catch (err) {
      setError(err.message);
    }
  };

  if (sent) {
    return (
      <div>
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-full bg-success-50 text-success-600">
          <MailCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Check your inbox</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          If an account exists for <span className="font-medium text-ink-700">{getValues('email')}</span>, we have sent a
          password reset link. It expires in 30 minutes.
        </p>

        {devToken && (
          <div className="mt-5">
            <Alert tone="info" title="Development mode">
              <p>No mail server is configured, so here is the reset link:</p>
              <Link
                className="mt-1.5 inline-block font-mono text-xs underline"
                to={`/reset-password?token=${devToken}`}
              >
                Open the reset form
              </Link>
            </Alert>
          </div>
        )}

        <Link to="/login" className="mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Reset your password</h1>
        <p className="mt-1.5 text-sm text-ink-500">Enter the email you signed up with and we will send a reset link.</p>
      </header>

      {error && <Alert tone="danger" className="mb-5">{error}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field label="Email address" htmlFor="email" required error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" invalid={Boolean(errors.email)} {...bind('email')} />
        </Field>

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Send reset link
        </Button>
      </form>

      <Link to="/login" className="mt-7 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to sign in
      </Link>
    </div>
  );
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const token = searchParams.get('token') ?? '';

  const {
    register: bind,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(resetPasswordSchema), mode: 'onTouched', defaultValues: { token } });

  const password = watch('password') ?? '';

  const onSubmit = async (values) => {
    setError(null);
    try {
      await auth.resetPassword({ token: values.token, password: values.password });
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (err) {
      setError(err.message);
    }
  };

  if (done) {
    return (
      <div>
        <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-full bg-success-50 text-success-600">
          <MailCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Password updated</h1>
        <p className="mt-2 text-sm text-ink-500">All other sessions have been signed out. Redirecting you to sign in…</p>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Choose a new password</h1>
        <p className="mt-1.5 text-sm text-ink-500">Use at least 10 characters with upper and lower case letters and a number.</p>
      </header>

      {error && <Alert tone="danger" className="mb-5">{error}</Alert>}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field label="Reset token" htmlFor="token" required error={errors.token?.message}>
          <Input id="token" className="font-mono text-xs" invalid={Boolean(errors.token)} {...bind('token')} />
        </Field>

        <Field label="New password" htmlFor="password" required error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.password)}
            {...bind('password')}
          />
        </Field>

        <Field label="Confirm new password" htmlFor="confirmPassword" required error={errors.confirmPassword?.message}>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...bind('confirmPassword')} />
        </Field>

        <p className="text-2xs text-ink-400" aria-live="polite">
          {password.length >= 10 ? 'Length looks good.' : `${10 - password.length} more characters needed.`}
        </p>

        <Button type="submit" className="w-full" loading={isSubmitting} disabled={!token}>
          Update password
        </Button>
      </form>
    </div>
  );
}

export default ForgotPasswordPage;
