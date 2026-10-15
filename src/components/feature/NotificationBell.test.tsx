// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import NotificationBell from './NotificationBell';
import NotificationsProvider from './NotificationsProvider';
import { MemoryRouter } from 'react-router-dom';

const fake = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[], fetch: vi.fn(), update: vi.fn(), register: vi.fn(),
  sound: vi.fn(), unlock: vi.fn(), summary: vi.fn(), more: false, subscribe: undefined as undefined | ((status: string) => void),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'customer', role: 'CUSTOMER', company_id: null } }) }));
vi.mock('@/hooks/useNotificationSound', () => ({ useNotificationSound: () => ({ playCustomerSound: fake.sound, unlockAudio: fake.unlock }) }));
vi.mock('@/lib/pushSubscription', () => ({ registerPush: fake.register, getPushPreference: () => true }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  removeChannel: vi.fn(),
  channel: () => {
    const channel = { on: () => channel, subscribe: (callback: (status: string) => void) => { fake.subscribe = callback; return channel; } };
    return channel;
  },
  realtime: { setAuth: vi.fn() },
  rpc: (name: string) => ({ abortSignal: async () => {
    if (name === 'notification_inbox_state') return fake.summary();
    if (name === 'notification_inbox_page') return fake.fetch();
    const result = await fake.update();
    if (!result.error) fake.rows = fake.rows.map(n => ({ ...n, is_read: true }));
    return result;
  } }),
} }));

const notice = () => ({ audience: 'customer', priority: 'normal', expires_at: null, id: 'notice', type: 'trip_status', title: 'Шофьорът пристигна', message: 'Очаква те',
  is_read: false, created_at: new Date().toISOString() });
const mount = async () => {
  render(<MemoryRouter><NotificationsProvider><NotificationBell /></NotificationsProvider></MemoryRouter>); await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Известия' }));
  await act(async () => {});
};
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); fake.rows = []; fake.more = false;
  fake.register.mockResolvedValue(false);
  fake.fetch.mockImplementation(async () => ({ data: { items: fake.rows, has_more: fake.more }, error: null }));
  fake.summary.mockImplementation(async () => ({ data: { unread: fake.rows.filter(n => !n.is_read).length, latest_id: fake.rows[0]?.id ?? null }, error: null }));
  fake.update.mockResolvedValue({ data: 1, error: null });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('notification recovery', () => {
  it('keeps history unloaded while closed and uses at most 32 small reads in a healthy hour', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<MemoryRouter><NotificationsProvider><NotificationBell /></NotificationsProvider></MemoryRouter>);
    await act(async () => {});
    await act(async () => { fake.subscribe?.('SUBSCRIBED'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_600_000); });
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(fake.summary.mock.calls.length).toBeLessThanOrEqual(32);
    expect(fake.summary.mock.calls.length).toBeGreaterThan(25);
    vi.restoreAllMocks();
  });
  it('loads an event missed before the realtime subscription was established', async () => {
    await mount(); expect(screen.queryByText('Шофьорът пристигна')).toBeNull();
    fake.rows = [notice()];
    await act(async () => { fake.subscribe?.('SUBSCRIBED'); });
    expect(screen.getByText('Шофьорът пристигна')).toBeTruthy();
  });
  it('recovers a missed event through visible polling, and pauses polling when hidden', async () => {
    await mount(); fake.rows = [notice()];
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fake.fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Шофьорът пристигна')).toBeNull();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByText('Шофьорът пристигна')).toBeTruthy();
    fake.rows = [{ ...notice(), id: 'next', title: 'Курсът започна' }];
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByText('Курсът започна')).toBeTruthy();
  });
  it('keeps unread status when the server rejects marking notifications read', async () => {
    fake.rows = [notice()]; fake.update.mockResolvedValue({ error: { message: 'offline' } });
    await mount();
    const button = screen.getByRole('button', { name: /прочетени/i });
    await act(async () => { fireEvent.click(button); });
    expect(screen.getByRole('button', { name: /прочетени/i })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Прочитането не е потвърдено');
    fake.update.mockResolvedValue({ data: 1, error: null });
    await act(async () => { fireEvent.click(button); });
    expect(screen.queryByRole('button', { name: /прочетени/i })).toBeNull();
  });
  it('shows a recoverable load error instead of pretending the inbox is empty', async () => {
    fake.fetch.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await mount();
    expect(screen.getByRole('alert').textContent).toContain('Известията не се заредиха');
    expect(screen.queryByText('Няма известия')).toBeNull();
    fake.rows = [notice()];
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Опитай отново' })); });
    expect(screen.getByText('Шофьорът пристигна')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('blocks duplicate read writes, retains unread state on rejection, and closes with Escape', async () => {
    let reject!: (reason: unknown) => void;
    fake.rows = [notice()]; fake.update.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    await mount(); const button = screen.getByRole('button', { name: /прочетени/i });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(fake.update).toHaveBeenCalledOnce(); expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { reject(new Error('offline')); });
    expect(screen.getByRole('button', { name: /прочетени/i })).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Известия' }));
  });
  it('does not restore unread status when an older inbox read finishes after a confirmed write', async () => {
    fake.rows = [notice()]; await mount();
    let finish!: (value: unknown) => void;
    fake.fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /прочетени/i })); });
    expect(screen.queryByRole('button', { name: /прочетени/i })).toBeNull();
    await act(async () => { finish({ data: { items: [notice()], has_more: false }, error: null }); });
    expect(screen.queryByRole('button', { name: /прочетени/i })).toBeNull();
    expect(screen.getByText('Шофьорът пристигна')).toBeTruthy();
  });
});
