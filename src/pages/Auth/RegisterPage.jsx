/**
 * Create an account and the first workspace in one step.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowRight, Check, Eye, EyeOff } from 'lucide-react';
import { registerSchema } from '@shared/validators/index.js';
import { SUPPORTED_CURRENCIES } from '@shared/constants.js';
import { useAuth } from '@/context/AuthContext.jsx';
import { ApiError } from '@/services/http.js';
import { Button, Field, Input, Select } from '@/components/ui/index.jsx';

/** Visible, live confirmation that the password meets the server's policy. */
const PASSWORD_RULES = [
  { id: 'length', label: 'At least 10 characters', test: (v) => v.length >= 10 },
  { id: 'lower', label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { id: 'upper', label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { id: 'number', label: 'A number', test: (v) => /\d/.test(v) },
];

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register: bind,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(registerSchema),
    mode: 'onTouched',
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      businessName: '',
      businessCurrency: 'NPR',
      businessTimezone: 'Asia/Kathmandu',
    },
  });

  const password = watch('password') ?? '';

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      await register(values);
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setServerError(error.message);
        for (const [field, message] of Object.entries(error.fields)) {
          setError(field, { message });
        }
      } else {
        setServerError('Cannot reach the server. Please try again.');
      }
    }
  };

  return (
    <div>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Create your workspace</h1>
        <p className="mt-1.5 text-sm text-ink-500">Set up your business and start selling in a couple of minutes.</p>
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
        <Field label="Business name" htmlFor="businessName" required error={errors.businessName?.message}>
          <Input
            id="businessName"
            placeholder="e.g. Sunrise Store"
            autoComplete="organization"
            invalid={Boolean(errors.businessName)}
            {...bind('businessName')}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Currency" htmlFor="businessCurrency" hint="Used for every invoice and report">
            <Select id="businessCurrency" {...bind('businessCurrency')}>
              {SUPPORTED_CURRENCIES.filter((c) => c.code !== 'NPR_rupee').map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.symbol} {currency.code} — {currency.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Your name" htmlFor="name" required error={errors.name?.message}>
            <Input
              id="name"
              placeholder="Aarav Sharma"
              autoComplete="name"
              invalid={Boolean(errors.name)}
              {...bind('name')}
            />
          </Field>
        </div>

        <Field label="Email address" htmlFor="email" required error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            placeholder="you@business.com"
            autoComplete="username"
            invalid={Boolean(errors.email)}
            {...bind('email')}
          />
        </Field>

        <Field label="Phone number" htmlFor="phone" error={errors.phone?.message} hint="Optional">
          <Input id="phone" type="tel" placeholder="9800000000" autoComplete="tel" {...bind('phone')} />
        </Field>

        <Field label="Password" htmlFor="password" required error={errors.password?.message}>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              invalid={Boolean(errors.password)}
              className="pr-10"
              {...bind('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-400 hover:text-ink-700"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </Field>

        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2" aria-live="polite">
          {PASSWORD_RULES.map((rule) => {
            const met = rule.test(password);
            return (
              <li
                key={rule.id}
                className={`flex items-center gap-1.5 text-2xs ${met ? 'text-success-600' : 'text-ink-400'}`}
              >
                <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                {rule.label}
                <span className="sr-only">{met ? '(met)' : '(not met)'}</span>
              </li>
            );
          })}
        </ul>

        <Field
          label="Confirm password"
          htmlFor="confirmPassword"
          required
          error={errors.confirmPassword?.message ?? errors.password?.message}
        >
          <Input
            id="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            invalid={Boolean(errors.confirmPassword)}
            {...bind('confirmPassword')}
          />
        </Field>

        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create workspace
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>

      <p className="mt-7 text-center text-sm text-ink-500">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
