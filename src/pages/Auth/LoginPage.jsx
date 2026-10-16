/**
 * Sign in.
 *
 * The form is validated with the SAME Zod schema the server uses
 * (`loginSchema` from `shared/validators`), so the client can never accept
 * something the API will reject, and the messages match exactly.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { loginSchema } from '@shared/validators/index.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { ApiError } from '@/services/http.js';
import { Button, Checkbox, Field, Input } from '@/components/ui/index.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register: bind,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '', remember: true },
  });

  // A businessId carried over from a deep link is applied before submitting.
  useEffect(() => {
    const businessId = new URLSearchParams(location.search).get('businessId');
    if (businessId) setValue('businessId', businessId);
  }, [location.search, setValue]);

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      await login(values);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setServerError(error.message);
        // Map field-level validation errors onto the form so the user sees them
        // next to the input rather than only in the banner.
        for (const [field, message] of Object.entries(error.fields)) {
          if (['email', 'password'].includes(field)) setError(field, { message });
        }
      } else {
        setServerError('Cannot reach the server. Please try again.');
      }
    }
  };

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Welcome back</h1>
        <p className="mt-1.5 text-sm text-ink-500">Sign in to your workspace to continue.</p>
      </header>

      {serverError && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2 rounded-lg border border-danger-100 bg-danger-50 px-3.5 py-3 text-[13px] text-danger-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{serverError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <Field label="Email address" htmlFor="email" required error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="you@business.com"
            invalid={Boolean(errors.email)}
            {...bind('email')}
          />
        </Field>

        <Field label="Password" htmlFor="password" required error={errors.password?.message}>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              invalid={Boolean(errors.password)}
              className="pr-10"
              {...bind('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-400 transition-colors hover:text-ink-700"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </Field>

        <div className="flex items-center justify-between gap-3 pt-1">
          <Checkbox label="Keep me signed in" {...bind('remember')} />
          <Link to="/forgot-password" className="text-xs font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-ink-500">
        New to SajiloLekha?{' '}
        <Link to="/register" className="font-medium text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
