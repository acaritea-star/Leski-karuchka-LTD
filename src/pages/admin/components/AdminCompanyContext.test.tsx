// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminCompanyProvider, useAdminCompany } from './AdminCompanyContext';

const api = vi.hoisted(() => ({ read: vi.fn(), user: { id: 'admin-a', role: 'SUPER_ADMIN', company_id: null as string | null } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: api.user }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  const chain = { select: () => chain, eq: () => chain, or: () => chain, order: () => chain, abortSignal: api.read };
  return chain;
} } }));
function Consumer() {
  const { companyId, companyName, setCompanyId, error } = useAdminCompany();
  return <><span>{companyId}:{companyName}</span>{error && <p role="alert">{error}</p>}<button onClick={() => setCompanyId('b')}>B</button><button onClick={() => setCompanyId('foreign')}>invalid</button></>;
}
let client: QueryClient;
const tree = () => <QueryClientProvider client={client}><AdminCompanyProvider><Consumer /></AdminCompanyProvider></QueryClientProvider>;
beforeEach(() => {
  sessionStorage.clear();
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

it('keeps the initial company after creation reorders the list and through a reload', async () => {
  const view = render(tree());
  await screen.findByText('a:А');
  api.read.mockResolvedValue({ data: [{ id: 'new', name: 'Нова' }, { id: 'a', name: 'А' }, { id: 'b', name: 'Б' }], error: null });
  await act(async () => { await client.invalidateQueries({ queryKey: ['admin-companies'] }); });
  expect(screen.getByText('a:А')).toBeTruthy();
  fireEvent.click(screen.getByText('B'));
  view.unmount(); client.clear();
  render(tree());
  await screen.findByText('b:Б');
});

it('ignores a tampered selection and foreign rows for a company administrator', async () => {
  api.user = { id: 'admin-b', role: 'COMPANY_ADMIN', company_id: 'b' };
  sessionStorage.setItem('leski:admin-company:' + JSON.stringify(['admin-b', 'COMPANY_ADMIN', 'b']), 'a');
  render(tree());
  await screen.findByText('b:Б');
  fireEvent.click(screen.getByText('invalid'));
  expect(screen.getByText('b:Б')).toBeTruthy();
  expect(screen.queryByText('a:А')).toBeNull();
});

it('continues with memory when browser storage is blocked', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  try {
    render(tree()); await screen.findByText('a:А');
    fireEvent.click(screen.getByText('B'));
    expect(screen.getByText('b:Б')).toBeTruthy();
  } finally { read.mockRestore(); write.mockRestore(); }
});

it('allows the parent administrator to switch only between its own direct divisions', async () => {
  api.user = { id: 'owner', role: 'COMPANY_ADMIN', company_id: 'a' };
  api.read.mockResolvedValue({ data: [{ id: 'foreign', name: 'Чужда', parent_company_id: 'other' }, { id: 'b', name: 'Горна', parent_company_id: 'a' }, { id: 'a', name: 'Централа', parent_company_id: null }], error: null });
  render(tree()); await screen.findByText('a:Централа');
  fireEvent.click(screen.getByText('B')); expect(screen.getByText('b:Горна')).toBeTruthy();
  fireEvent.click(screen.getByText('invalid')); expect(screen.getByText('b:Горна')).toBeTruthy();
  expect(api.read).toHaveBeenCalledTimes(1);
});

it('keeps a local manager inside its division even if the API returns parent and sibling rows', async () => {
  api.user = { id: 'local', role: 'COMPANY_ADMIN', company_id: 'b' };
  sessionStorage.setItem('leski:admin-company:' + JSON.stringify(['local', 'COMPANY_ADMIN', 'b']), 'a');
  api.read.mockResolvedValue({ data: [{ id: 'a', name: 'Централа', parent_company_id: null }, { id: 'c', name: 'Друг град', parent_company_id: 'a' }, { id: 'b', name: 'Горна', parent_company_id: 'a' }], error: null });
  render(tree()); await screen.findByText('b:Горна');
  expect(screen.queryByText('a:Централа')).toBeNull(); expect(screen.queryByText('c:Друг град')).toBeNull();
});
