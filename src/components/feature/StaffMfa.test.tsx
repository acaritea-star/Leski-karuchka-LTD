// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import StaffMfa from './StaffMfa';
const mocks = vi.hoisted(() => ({ list: vi.fn(), enroll: vi.fn(), verify: vi.fn(), unenroll: vi.fn(), refresh: vi.fn(), logout: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'staff' } } } }), mfa: { listFactors: mocks.list, enroll: mocks.enroll, challengeAndVerify: mocks.verify, unenroll: mocks.unenroll }, refreshSession: vi.fn().mockResolvedValue({ error: null }) } } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'staff', role: 'DRIVER' }, refreshProfile: mocks.refresh, signOut: mocks.logout }) }));
const factor = { id: 'verified', factor_type: 'totp', status: 'verified', friendly_name: 'Основно приложение' };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  mocks.list.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
  mocks.enroll.mockResolvedValue({ data: { id: 'new', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'SYNTHETICTESTKEY' } }, error: null });
  mocks.verify.mockResolvedValue({ error: null }); mocks.unenroll.mockResolvedValue({ error: null });
  mocks.refresh.mockResolvedValue(undefined); mocks.logout.mockResolvedValue(undefined);
});
afterEach(cleanup);
it('requires explicit enrollment and never stores the setup secret', async () => {
  render(<StaffMfa />); const start = await screen.findByText('Настрой двуфакторен вход');
  expect(mocks.enroll).not.toHaveBeenCalled(); fireEvent.click(start);
  await screen.findByAltText('QR код за приложението за удостоверяване');
  fireEvent.change(screen.getByLabelText('2. Въведи шестцифрения код'), { target: { value: '001234' } });
  fireEvent.click(screen.getByText('Активирай и продължи'));
  await waitFor(() => expect(mocks.verify).toHaveBeenCalledWith({ factorId: 'new', code: '001234' }));
  expect(localStorage.length).toBe(0); await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
});
it('keeps a failed challenge locked and permits an explicit retry', async () => {
  mocks.list.mockResolvedValue({ data: { all: [factor], totp: [factor] }, error: null });
  mocks.verify.mockResolvedValueOnce({ error: { status: 400 } });
  render(<StaffMfa />); const code = await screen.findByLabelText('Шестцифрен код');
  fireEvent.change(code, { target: { value: '123456' } }); fireEvent.click(screen.getByText('Потвърди входа'));
  await screen.findByRole('alert'); expect(mocks.refresh).not.toHaveBeenCalled();
  fireEvent.change(code, { target: { value: '654321' } }); fireEvent.click(screen.getByText('Потвърди входа'));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce()); expect(mocks.verify).toHaveBeenCalledTimes(2);
});
it('does not enroll after a failed factor read', async () => {
  mocks.list.mockResolvedValue({ error: new Error('offline') }); render(<StaffMfa />);
  await screen.findByRole('alert'); expect((screen.getByText('Настрой двуфакторен вход') as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.enroll).not.toHaveBeenCalled();
});
it('cleans only incomplete setup and retains the verified factor when adding a backup', async () => {
  const incomplete = { ...factor, id: 'incomplete', status: 'unverified', friendly_name: 'Лески Каручка стар опит' };
  mocks.list.mockResolvedValue({ data: { all: [factor, incomplete], totp: [factor] }, error: null });
  render(<StaffMfa management />); await screen.findByText('Основно приложение');
  expect((screen.getByText('Премахни') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Добави резервно приложение')); await screen.findByAltText('QR код за приложението за удостоверяване');
  expect(mocks.unenroll).toHaveBeenCalledExactlyOnceWith({ factorId: 'incomplete' });
});
it('sends one challenge while a response is pending', async () => {
  mocks.list.mockResolvedValue({ data: { all: [factor], totp: [factor] }, error: null });
  let resolve!: (value: unknown) => void; mocks.verify.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  render(<StaffMfa />); const code = await screen.findByLabelText('Шестцифрен код');
  fireEvent.change(code, { target: { value: '123456' } }); const form = code.closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form); await waitFor(() => expect(mocks.verify).toHaveBeenCalledOnce()); expect(code.matches(':disabled')).toBe(true);
  await act(async () => resolve({ error: null }));
});
