/**
 * Split-screen shell for the unauthenticated screens.
 * The right panel is hidden below `lg` so the form is never squeezed.
 */
import { Outlet } from 'react-router-dom';
import { ShieldCheck, Sparkles, TrendingUp } from 'lucide-react';

const HIGHLIGHTS = [
  {
    icon: TrendingUp,
    title: 'Profit you can audit',
    body: 'Net profit is built from revenue, cost of goods sold and operating expenses — each figure shows the formula behind it.',
  },
  {
    icon: ShieldCheck,
    title: 'Your books stay yours',
    body: 'Every workspace is fully isolated. No request can ever read another business’s records, even by mistake.',
  },
  {
    icon: Sparkles,
    title: 'Books that stay true',
    body: 'Stock, prices and costs are snapshotted at the moment of sale, so editing a product never rewrites history.',
  },
];

export function AuthLayout() {
  return (
    <div className="flex min-h-full bg-white">
      <div className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-[46%] lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-base font-bold text-white"
              aria-hidden="true"
            >
              S
            </span>
            <span className="text-lg font-bold tracking-tight text-ink-900">sajilolekha.</span>
          </div>
          <Outlet />
        </div>
      </div>

      <aside className="relative hidden flex-1 overflow-hidden bg-brand-950 lg:block">
        <div
          className="absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(120% 90% at 80% 10%, #7657E8 0%, #4E34A0 45%, #26194F 100%)',
          }}
          aria-hidden="true"
        />
        <div className="relative flex h-full flex-col justify-center px-16 py-16">
          <blockquote className="max-w-md">
            <p className="text-2xl font-semibold leading-snug tracking-tight text-white">
              Everything a shop needs to keep honest books.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-brand-200">
              Sales, inventory, customers and suppliers in one place — with the accounting
              definitions written down instead of hidden.
            </p>
          </blockquote>

          <ul className="mt-12 space-y-7">
            {HIGHLIGHTS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.title} className="flex gap-4">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white"
                    aria-hidden="true"
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-brand-200">{item.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </div>
  );
}

export default AuthLayout;
