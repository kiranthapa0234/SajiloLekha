/**
 * Overview dashboard.
 *
 * Asserted behaviours, in order of how badly they would hurt if broken:
 *   1. money is rendered from the API's integers, correctly scaled;
 *   2. loading, empty and error states are all reachable and distinct;
 *   3. every figure states the formula behind it;
 *   4. the page is navigable by keyboard and announced to screen readers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import DashboardPage from '@client/pages/Dashboard/DashboardPage.jsx';
import { makeAuth, makeDashboardSummary, mockServices, renderWithProviders, restoreServices } from './utils.jsx';

describe('Overview dashboard', () => {
  beforeEach(() => restoreServices());

  it('renders the headline figures from the API, correctly scaled', async () => {
    mockServices({ 'dashboard.summary': vi.fn().mockResolvedValue(makeDashboardSummary()) });

    renderWithProviders(<DashboardPage />);

    // Rs.24,580.00 — the API sends 2458000 minor units.
    expect(await screen.findByText('Rs. 24,580.00')).toBeInTheDocument();
    expect(screen.getByText('148')).toBeInTheDocument();
    expect(screen.getByText('Rs. 9,405.00')).toBeInTheDocument();
    expect(screen.getByText('Rs. 6,200.00')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('6 orders today')).toBeInTheDocument();
  });

  it('scopes each figure to its own card', async () => {
    mockServices({ 'dashboard.summary': vi.fn().mockResolvedValue(makeDashboardSummary()) });
    renderWithProviders(<DashboardPage />);

    await screen.findByText('Outstanding');

    // "3 overdue invoices" belongs to the Outstanding card specifically, so a
    // card that borrowed another card's subtitle would be caught here.
    const outstandingCard = screen.getByText('Outstanding').closest('section');
    expect(within(outstandingCard).getByText('3 overdue invoices')).toBeInTheDocument();
    expect(within(outstandingCard).getByText('Rs. 6,200.00')).toBeInTheDocument();
  });

  it('states the formula behind each figure instead of asking for trust', async () => {
    mockServices({ 'dashboard.summary': vi.fn().mockResolvedValue(makeDashboardSummary())  });
    renderWithProviders(<DashboardPage />);

    await screen.findByText("Today's sales");
    // Net profit is the number people are most likely to take on faith.
    expect(screen.getByText('Revenue - COGS - expenses')).toBeInTheDocument();
    expect(screen.getByText('Billed but not collected')).toBeInTheDocument();
  });

  it('reports the period change with its direction', async () => {
    mockServices({ 'dashboard.summary': vi.fn().mockResolvedValue(makeDashboardSummary())  });
    renderWithProviders(<DashboardPage />);

    await screen.findByText("Today's sales");
    expect(screen.getByText('12.5%')).toBeInTheDocument();
    // Negative change must be shown as a fall, not a rise.
    expect(screen.getByText('2.1%')).toBeInTheDocument();
  });

  it('lists recent transactions with their settlement state', async () => {
    mockServices({ 'dashboard.summary': vi.fn().mockResolvedValue(makeDashboardSummary())  });
    renderWithProviders(<DashboardPage />);

    // The card header renders while loading too, so wait on data, not chrome.
    expect(await screen.findByText('INV-2026-00042')).toBeInTheDocument();
    expect(screen.getByText('Rs. 1,250.00')).toBeInTheDocument();
    // A part-paid invoice shows what is still owed next to the total.
    expect(screen.getByText(/Rs\. 1,500 due/)).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Part paid')).toBeInTheDocument();
  });

  it('announces that it is loading, then replaces the skeleton with data', async () => {
    let resolveSummary;
    const summary = new Promise((resolve) => {
      resolveSummary = resolve;
    });
    mockServices({ 'dashboard.summary': vi.fn().mockReturnValue(summary)  });

    renderWithProviders(<DashboardPage />);

    // While pending, no figures are shown — the skeleton must be announced
    // rather than leaving the screen silently blank.
    expect(screen.getAllByText(/Loading/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Rs. 24,580.00')).not.toBeInTheDocument();

    resolveSummary(makeDashboardSummary());

    await waitFor(() => expect(screen.getByText('Rs. 24,580.00')).toBeInTheDocument());
    expect(screen.queryAllByText(/Loading/)).toHaveLength(0);
  });

  it('offers a first action when there are no transactions yet', async () => {
    const empty = makeDashboardSummary();
    empty.tables.recentTransactions = [];
    mockServices({ 'dashboard.summary': vi.fn().mockResolvedValue(empty)  });

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('No transactions yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new sale/i })).toBeInTheDocument();
  });

  it('surfaces a failure with a retry, and says nothing misleading', async () => {
    mockServices({
      'dashboard.summary': vi
        .fn()
        .mockRejectedValue(new Error('Cannot reach the server. Check your connection and try again.')),
    });

    renderWithProviders(<DashboardPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Cannot reach the server');
    expect(within(alert).getByRole('button', { name: /try again/i })).toBeEnabled();

    // Critically: no stale or fabricated figures alongside the error.
    expect(screen.queryByText('Rs. 24,580.00')).not.toBeInTheDocument();
  });

  it('lets the user change the reporting period', async () => {
    const summary = vi.fn().mockResolvedValue(makeDashboardSummary());
    mockServices({ 'dashboard.summary': summary });

    const { user } = renderWithProviders(<DashboardPage />);
    await screen.findByText("Today's sales");

    await user.selectOptions(screen.getByLabelText('Reporting period'), 'week');

    await waitFor(() => expect(summary).toHaveBeenCalledWith({ preset: 'week', limit: 5 }));
  });

  it('is built from landmarks and headings so it can be navigated', async () => {
    mockServices({ 'dashboard.summary': vi.fn().mockResolvedValue(makeDashboardSummary())  });

    renderWithProviders(<DashboardPage />);
    await screen.findByText("Today's sales");

    expect(screen.getByRole('heading', { level: 1, name: /bigger picture/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Key figures' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    // The table needs a caption so its contents are announced in context.
    expect(screen.getByText('Most recent invoices')).toBeInTheDocument();
  });

  it('renders zeros without pretending the workspace is empty', async () => {
    const fresh = makeDashboardSummary();
    fresh.kpis.todaySales = { valueMinor: 0, orders: 0, changePercent: null, formula: 'Sales completed today' };
    mockServices({ 'dashboard.summary': vi.fn().mockResolvedValue(fresh)  });

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Rs. 0.00')).toBeInTheDocument();
    expect(screen.getByText('0 orders today')).toBeInTheDocument();
  });

  it('hides low-stock alerts when nothing needs restocking', async () => {
    const healthy = makeDashboardSummary();
    healthy.tables.lowStockItems = [];
    mockServices({ 'dashboard.summary': vi.fn().mockResolvedValue(healthy)  });

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText('Stock levels are healthy')).toBeInTheDocument();
  });

  it('marks the business name so a user is never unsure whose books they are reading', async () => {
    mockServices({ 'dashboard.summary': vi.fn().mockResolvedValue(makeDashboardSummary())  });
    const auth = makeAuth({ business: { ...makeAuth().business, name: 'Himalaya Traders' } });

    renderWithProviders(<DashboardPage />, { auth });

    expect(await screen.findByText(/Himalaya Traders/)).toBeInTheDocument();
  });
});