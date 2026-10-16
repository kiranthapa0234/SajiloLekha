/**
 * Application shell: sidebar navigation, top bar and the routed outlet.
 *
 * Responsive behaviour
 *  - Desktop: a persistent 260px sidebar.
 *  - Tablet: the sidebar collapses to icons only.
 *  - Mobile: the sidebar becomes an off-canvas drawer opened from the top bar.
 *
 * Accessibility
 *  - `aria-current="page"` marks the active route.
 *  - The drawer traps nothing but does restore focus and close on Escape.
 *  - A skip link jumps straight to the main content.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  Bell,
  ChevronsLeft,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Scale,
  LogOut,
  Menu,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext.jsx';
import { useStockAlerts } from '@/hooks/useApi.js';
import { Avatar, WorkspaceSwitcher } from './WorkspaceSwitcher.jsx';
import { Button } from './ui/index.jsx';

const NAV_SECTIONS = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true, permission: 'dashboard:read' },
      { to: '/sales', label: 'Sales', icon: ShoppingCart, permission: 'sale:read' },
      { to: '/inventory', label: 'Inventory', icon: Package, permission: 'product:read', badge: 'lowStock' },
      { to: '/customers', label: 'Customers', icon: Users, permission: 'customer:read' },
      { to: '/suppliers', label: 'Suppliers', icon: Truck, permission: 'supplier:read' },
      { to: '/purchases', label: 'Purchases', icon: ClipboardList, permission: 'purchase:read' },
      { to: '/expenses', label: 'Expenses', icon: Wallet, permission: 'expense:read' },
      { to: '/payments', label: 'Payments', icon: Receipt, permission: 'payment:read' },
      { to: '/accountant', label: 'Accountant', icon: Scale, permission: 'report:read' },
      { to: '/invoices', label: 'Invoices', icon: FileText, permission: 'invoice:read' },
      { to: '/reports', label: 'Reports', icon: TrendingUp, permission: 'report:read' },
      { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings:read' },
    ],
  },
];

export function AppLayout() {
  const { can, user, business, logout, isOwner } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data: alerts } = useStockAlerts();
  const alertCount = alerts?.length ?? 0;
  const drawerRef = useRef(null);
  const closeButtonRef = useRef(null);

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((section) => section.items.length > 0);

  // Close the drawer on navigation so a tap always returns to the content.
  // Done in the link handler rather than a `location` effect, so the drawer
  // closes on the interaction that caused it with no second render pass.
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    closeButtonRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  const sidebarContent = (
    <>
      <div className={clsx('flex h-16 items-center border-b border-ink-100', collapsed ? 'justify-center px-2' : 'px-5')}>
        <BrandMark compact={collapsed} />
      </div>

      <div className={clsx('border-b border-ink-100 py-3', collapsed ? 'px-2' : 'px-3')}>
        <WorkspaceSwitcher compact={collapsed} />
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4" aria-label="Main navigation">
        {visibleSections.map((section) => (
          <div key={section.label} className="mb-5">
            {!collapsed && (
              <p className="mb-2 px-3 text-2xs font-semibold uppercase tracking-wider text-ink-400">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const badge = item.badge === 'lowStock' ? alertCount : 0;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={closeDrawer}
                      className={({ isActive }) =>
                        clsx('lk-nav-item', isActive && 'lk-nav-item-active', collapsed && 'justify-center px-0')
                      }
                      aria-current={undefined}
                      title={collapsed ? item.label : undefined}
                    >
                      {({ isActive }) => (
                        <>
                          <span className="relative shrink-0">
                            <Icon className={clsx('h-[18px] w-[18px]', isActive && 'text-brand-600')} aria-hidden="true" />
                            {badge > 0 && (
                              <span
                                className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-warning-500 px-1 text-[9px] font-bold text-white"
                                aria-hidden="true"
                              >
                                {badge > 9 ? '9+' : badge}
                              </span>
                            )}
                          </span>
                          {!collapsed && <span className="truncate">{item.label}</span>}
                          {!collapsed && badge > 0 && <span className="sr-only">{badge} items need restocking</span>}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={clsx('border-t border-ink-100 py-3', collapsed ? 'px-2' : 'px-3')}>
        <NavLink
          to="/settings/profile"
          className={clsx('lk-nav-item', collapsed && 'justify-center px-0')}
          title={collapsed ? user?.name : undefined}
        >
          <Avatar name={user?.name} size="sm" />
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink-900">{user?.name}</span>
              <span className="block truncate text-2xs text-ink-500">{isOwner ? 'Owner' : user?.email}</span>
            </span>
          )}
        </NavLink>
        {!collapsed && (
          <button type="button" onClick={handleLogout} className="lk-nav-item mt-1 w-full">
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
            <span>Sign out</span>
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-full bg-white">
      <a
        href="#main-content"
        className="sr-only-focusable absolute left-4 top-4 z-[60] rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
      >
        Skip to main content
      </a>

      {/* ---------------- desktop sidebar ---------------- */}
      <aside
        className={clsx(
          'hidden shrink-0 flex-col border-r border-ink-100 bg-white lg:flex',
          collapsed ? 'w-[72px]' : 'w-[260px]',
          'transition-[width] duration-200'
        )}
      >
        {sidebarContent}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="absolute -right-3 top-[68px] z-20 hidden h-6 w-6 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500 shadow-sm transition-colors hover:text-ink-900 lg:flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronsLeft className={clsx('h-3.5 w-3.5 transition-transform', collapsed && 'rotate-180')} aria-hidden="true" />
        </button>
      </aside>

      {/* ---------------- mobile drawer ---------------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside
            ref={drawerRef}
            className="relative flex h-full w-[280px] animate-slide-up flex-col border-r border-ink-100 bg-white"
            aria-label="Navigation"
          >
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="lk-btn-ghost absolute right-2 top-3.5 p-2"
              aria-label="Close navigation"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* ---------------- main column ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-ink-100 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              className="p-2 lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink-900">{business?.name ?? 'SajiloLekha'}</p>
              <p className="truncate text-2xs text-ink-500">{business?.address?.city || 'Workspace'}</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <NavLink
              to="/inventory?filter=low_stock"
              className="lk-btn-ghost relative p-2"
              aria-label={alertCount > 0 ? `${alertCount} products need restocking` : 'No stock alerts'}
            >
              <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
              {alertCount > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-warning-500" aria-hidden="true" />
              )}
            </NavLink>
            <Avatar name={user?.name} size="sm" className="ml-1 lg:hidden" />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function BrandMark({ compact }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white"
        aria-hidden="true"
      >
        S
      </span>
      {!compact && <span className="text-[15px] font-bold tracking-tight text-ink-900">sajilolekha.</span>}
    </div>
  );
}
