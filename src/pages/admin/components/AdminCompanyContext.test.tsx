// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminCompanyProvider, useAdminCompany } from './AdminCompanyContext';

const api = vi.hoisted(() => ({ read: vi.fn(), user: { id: 'admin-a', role: 'SUPER_ADMIN', company_id: null as string | null } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: api.user }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  const chain = { select: () => chain, eq: () => chain, order: () => chain, abortSignal: api.read };
  return chain;
} } }));
function Consumer() {
  const { companyId, companyName, setCompanyId, error } = useAdminCompany();
  return <><span>{companyId}:{companyName}</span>{error && <p role="alert">{error}</p>}<button onClick={() => setCompanyId('b')}>B</button><button onClick={() => setCompanyId('foreign')}>invalid</button></>;
}
let client: QueryClient;
const tree = () => <QueryClientProvider client={client}><AdminCompanyProvider><Consumer /></AdminCompanyProvider></QueryClientProvider>;
beforeEach(() => {
  vi.clearAllMocks();
  api.user = { id: 'admin-a', role: 'SUPER_ADMIN', company_id: null };
  api.read.mockResolvedValue({ data: [{ id: 'a', name: 'А' }, { id: 'b', name: 'Б' }], error: null });
  client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); });
it('changes selection without refetching or allowing an unknown company', async () => {
  render(tree());
  await screen.findByText('a:А');
  fireEvent.click(screen.getByText('B'));
  expect(screen.getByText('b:Б')).toBeTruthy();
  fireEvent.click(screen.getByText('invalid'));
  expect(screen.getByText('b:Б')).toBeTruthy();
  expect(api.read).toHaveBeenCalledTimes(1);
});
it('discards the old account and ignores its late response', async () => {
  let finish!: (value: unknown) => void;
  api.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(tree());
  api.user = { id: 'admin-b', role: 'COMPANY_ADMIN', company_id: 'b' };
  api.read.mockResolvedValue({ data: [{ id: 'b', name: 'Б' }], error: null });
  view.rerender(tree());
  await screen.findByText('b:Б');
  await act(async () => { finish({ data: [{ id: 'a', name: 'А' }], error: null }); });
  expect(screen.getByText('b:Б')).toBeTruthy();
  expect(screen.queryByText('a:А')).toBeNull();
});
it('does not query companies for customers', () => {
  api.user = { id: 'customer', role: 'CUSTOMER', company_id: 'a' };
  render(tree());
  expect(api.read).not.toHaveBeenCalled();
});
