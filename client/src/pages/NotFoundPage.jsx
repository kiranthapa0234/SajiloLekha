/**
 * Placeholder-free 404 for unknown client routes.
 */
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext.jsx';

export default function NotFoundPage() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-center">
      <p className="text-6xl font-bold tracking-tight text-brand-600">404</p>
      <h1 className="mt-3 text-xl font-semibold text-ink-900">This page does not exist</h1>
      <p className="mt-2 max-w-md text-sm text-ink-500">
        <span className="font-mono text-xs text-ink-400">{location.pathname}</span> did not match any view.
        It may have been moved, or the link may be out of date.
      </p>
      <div className="mt-6 flex gap-2">
        <button type="button" className="lk-btn-secondary" onClick={() => window.history.back()}>
          Go back
        </button>
        <Link to={isAuthenticated ? '/' : '/login'} className="lk-btn-primary">
          {isAuthenticated ? 'Go to overview' : 'Sign in'}
        </Link>
      </div>
    </div>
  );
}
