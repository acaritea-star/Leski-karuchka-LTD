// @vitest-environment jsdom
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CustomerWelcomeGate from './CustomerWelcomeGate';
const api = vi.hoisted(() => ({ claim: vi.fn(), user: { id: 'a', role: 'CUSTOMER', first_name: 'Алекс' } as { id: string; role: string; first_name: string } | null, loading: false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: api.user, loading: api.loading }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: () => ({ abortSignal: () => api.claim() }) } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({
  welcome_title: 'Добре дошъл', welcome_cta: 'Ясно, започваме', welcome_close: 'Затвори приветствието',
  welcome_step_1_title: 'Избери откъде и докъде', welcome_step_2_title: 'Сравни фирмите и цените',
  welcome_step_3_title: 'Поръчай и следи шофьора',
  welcome_emergency_title: 'При спешен случай', welcome_emergency_desc: 'Сигурност · 112 до панела за поръчка.',
} as Record<string, string>)[key] ?? key }) }));
const gate = (path = '/customer/home') => <MemoryRouter initialEntries={[path]}><CustomerWelcomeGate /></MemoryRouter>;
beforeEach(() => { vi.clearAllMocks(); api.user = { id: 'a', role: 'CUSTOMER', first_name: 'Алекс' }; api.loading = false; api.claim.mockResolvedValue({ data: true, error: null }); });
afterEach(cleanup);
it('shows simple steps and the emergency button location, then dismisses without another claim', async () => {
 render(gate()); const modal = await screen.findByRole('dialog', { name: 'Добре дошъл' });
 expect(modal.textContent).toContain('Сравни фирмите и цените'); expect(modal.textContent).toContain('Сигурност · 112'); expect(modal.textContent).toContain('до панела');
 fireEvent.click(screen.getByRole('button', { name: 'Ясно, започваме' }));
 expect(screen.queryByRole('dialog')).toBeNull(); expect(api.claim).toHaveBeenCalledTimes(1);
});
it('shares the first claim across StrictMode effect replay', async () => {
 render(<StrictMode>{gate()}</StrictMode>);
 await screen.findByRole('dialog'); expect(api.claim).toHaveBeenCalledTimes(1);
});
it('does not repeat after a later mount or login when the server has recorded the first view', async () => {
 const view = render(gate()); await screen.findByRole('dialog'); view.unmount();
 api.claim.mockResolvedValue({ data: false, error: null }); render(gate());
 await waitFor(() => expect(api.claim).toHaveBeenCalledTimes(2)); expect(screen.queryByRole('dialog')).toBeNull();
});
it.each(['DRIVER','COMPANY_ADMIN','SUPER_ADMIN',null])('never claims the welcome for %s', async role => {
 api.user = role ? { id: 'a', role, first_name: '' } : null; render(gate());
 expect(api.claim).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull();
});
it('does not claim before profile verification or outside the customer area', () => {
 api.loading = true; const view = render(gate()); expect(api.claim).not.toHaveBeenCalled(); view.unmount();
 api.loading = false; render(gate('/driver-join')); expect(api.claim).not.toHaveBeenCalled();
});
it('ignores a delayed result for the previous customer', async () => {
 let finish!: (value: unknown) => void; api.claim.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
 const view = render(gate()); await waitFor(() => expect(api.claim).toHaveBeenCalledOnce());
 api.user = { id: 'b', role: 'CUSTOMER', first_name: 'Б' }; api.claim.mockResolvedValue({ data: false, error: null }); view.rerender(gate());
 await act(async () => finish({ data: true, error: null }));
 expect(screen.queryByRole('dialog')).toBeNull();
});
it('does not reuse a granted welcome after external logout and login', async () => {
 const view = render(gate()); await screen.findByRole('dialog');
 api.user = null; view.rerender(gate()); expect(screen.queryByRole('dialog')).toBeNull();
 api.user = { id: 'a', role: 'CUSTOMER', first_name: 'Алекс' };
 api.claim.mockResolvedValue({ data: false, error: null }); view.rerender(gate());
 await waitFor(() => expect(api.claim).toHaveBeenCalledTimes(2)); expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps the application usable when the claim fails', async () => {
 api.claim.mockResolvedValue({ data: null, error: new Error('Offline') }); render(gate());
 await waitFor(() => expect(api.claim).toHaveBeenCalledOnce()); expect(screen.queryByRole('dialog')).toBeNull();
});
