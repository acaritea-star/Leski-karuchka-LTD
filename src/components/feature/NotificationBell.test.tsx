// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import NotificationBell from './NotificationBell';

const fake = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[], fetch: vi.fn(), update: vi.fn(), register: vi.fn(),
  sound: vi.fn(), unlock: vi.fn(), subscribe: undefined as undefined | ((status: string) => void),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'customer' } }) }));
vi.mock('@/hooks/useNotificationSound', () => ({ useNotificationSound: () => ({ playCustomerSound: fake.sound, unlockAudio: fake.unlock }) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ register: fake.register }) }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  removeChannel: vi.fn(),
  channel: () => {
    const channel = { on: () => channel, subscribe: (callback: (status: string) => void) => { fake.subscribe = callback; return channel; } };
    return channel;
  },
  from: () => {
    const write = { eq: () => write, in: (...args: unknown[]) => { fake.update(...args); return write; }, select: () => write,
      abortSignal: () => fake.update.mock.results.at(-1)?.value };
    const query = { select: () => query, eq: () => query, order: () => query, abortSignal: () => query,
      limit: () => fake.fetch(), update: () => write };
    return query;
  },
} }));

const notice = () => ({ id: 'notice', type: 'trip_status', title: 'Шофьорът пристигна', message: 'Очаква те',
  is_read: false, created_at: new Date().toISOString() });
const mount = async () => {
  render(<NotificationBell />); await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Известия' }));
};
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); fake.rows = [];
  fake.fetch.mockImplementation(async () => ({ data: fake.rows, error: null }));
  fake.update.mockResolvedValue({ data: [{ id: 'notice' }], error: null });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('notification recovery', () => {
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
    fake.update.mockResolvedValue({ data: [{ id: 'notice' }], error: null });
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
});
