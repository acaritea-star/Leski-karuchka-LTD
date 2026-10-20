// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
type Socket = { name: string; options: unknown; hint?: () => void; status?: (status: string) => void };
const fake = vi.hoisted(() => ({ user: { id: 'one', role: 'DRIVER' }, sockets: [] as Socket[], remove: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fake.user }) }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  removeChannel: () => fake.remove(),
  channel: (name: string, options: unknown) => {
    const record: Socket = { name, options }; fake.sockets.push(record);
    const channel = { on: (_event: string, _filter: unknown, hint: () => void) => { record.hint = hint; return channel; },
      subscribe: (status: (status: string) => void) => { record.status = status; return channel; } }; return channel;
  },
} }));
import DriverOffersProvider from './DriverOffersProvider';
import { useDriverOfferConnection } from '@/hooks/useDriverOfferConnection';
import { queryKeys } from '@/lib/queryKeys';
function Screen({ route }: { route: string }) { const connected = useDriverOfferConnection(); return <p>{route}: {connected ? 'connected' : 'disconnected'}</p>; }
function setup() {
  const client = new QueryClient();const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  const content = (route = 'home') => <StrictMode><QueryClientProvider client={client}><DriverOffersProvider><Screen route={route} /></DriverOffersProvider></QueryClientProvider></StrictMode>;
  return { ...render(content()), content, invalidate };
}
beforeEach(() => { fake.user = { id: 'one', role: 'DRIVER' }; fake.sockets = []; fake.remove.mockReset().mockResolvedValue('ok'); });
afterEach(() => cleanup());
it('keeps one private subscription across StrictMode initialization and page navigation', async () => {
  const view=setup();await act(async()=>{});expect(fake.sockets).toHaveLength(1);
  expect(fake.sockets[0]).toMatchObject({name:'driver-offers:one',options:{config:{private:true}}});
  act(()=>fake.sockets[0].status?.('SUBSCRIBED'));expect(screen.getByText('home: connected')).toBeTruthy();
  view.rerender(view.content('requests'));await act(async()=>{});expect(fake.sockets).toHaveLength(1);expect(fake.remove).not.toHaveBeenCalled();
  view.invalidate.mockClear();act(()=>fake.sockets[0].hint?.());
  expect(view.invalidate).toHaveBeenCalledWith({queryKey:queryKeys.driverIncomingRequests('one')},{cancelRefetch:false});
});
it('waits for old-account teardown and ignores old hints during a fast account switch', async () => {
  const view=setup();await act(async()=>{});act(()=>fake.sockets[0].status?.('SUBSCRIBED'));
  let finish!: () => void;fake.remove.mockReturnValue(new Promise<void>(resolve=>{finish=resolve;}));
  fake.user={id:'two',role:'DRIVER'};view.rerender(view.content());await act(async()=>{});
  expect(screen.getByText('home: disconnected')).toBeTruthy();expect(fake.sockets).toHaveLength(1);
  view.invalidate.mockClear();act(()=>fake.sockets[0].hint?.());expect(view.invalidate).not.toHaveBeenCalled();
  await act(async()=>finish());expect(fake.sockets).toHaveLength(2);expect(fake.sockets[1].name).toBe('driver-offers:two');
  act(()=>fake.sockets[1].status?.('SUBSCRIBED'));expect(screen.getByText('home: connected')).toBeTruthy();
});
it('does not create a driver offer connection for a customer', async () => {
  fake.user={id:'customer',role:'CUSTOMER'};setup();await act(async()=>{});expect(fake.sockets).toHaveLength(0);
});
it('coalesces hints during an in-flight read into one trailing reconciliation', async () => {
  const view=setup();await act(async()=>{});
  let finish!: () => void;
  const pending=new Promise<void>(resolve=>{finish=resolve;});let calls=0;
  view.invalidate.mockImplementation(()=> ++calls<=2 ? pending : Promise.resolve());
  act(()=>fake.sockets[0].hint?.());expect(view.invalidate).toHaveBeenCalledTimes(2);
  for(let i=0;i<10;i++)act(()=>fake.sockets[0].hint?.());
  expect(view.invalidate).toHaveBeenCalledTimes(2);
  await act(async()=>finish());expect(view.invalidate).toHaveBeenCalledTimes(4);
});
it('does not replay a queued old-account hint after account switching', async () => {
  const view=setup();await act(async()=>{});
  let finish!: () => void;const pending=new Promise<void>(resolve=>{finish=resolve;});
  view.invalidate.mockReturnValue(pending);
  act(()=>{fake.sockets[0].hint?.();fake.sockets[0].hint?.();});
  fake.user={id:'two',role:'DRIVER'};view.rerender(view.content());await act(async()=>{});
  const before=view.invalidate.mock.calls.length;await act(async()=>finish());
  expect(view.invalidate).toHaveBeenCalledTimes(before);
  act(()=>fake.sockets[1].hint?.());
  expect(view.invalidate).toHaveBeenLastCalledWith({queryKey:queryKeys.driverIncomingRequests('two')},{cancelRefetch:false});
});

it('does not reuse a connected flag when the same account rejoins after losing its driver scope', async () => {
  const view = setup(); await act(async () => {});
  act(() => fake.sockets[0].status?.('SUBSCRIBED'));
  expect(screen.getByText('home: connected')).toBeTruthy();
  fake.user = { id: 'one', role: 'CUSTOMER' };
  view.rerender(view.content()); await act(async () => {});
  fake.user = { id: 'one', role: 'DRIVER' };
  view.rerender(view.content()); await act(async () => {});
  expect(fake.sockets).toHaveLength(2);
  expect(screen.getByText('home: disconnected')).toBeTruthy();
  act(() => fake.sockets[1].status?.('SUBSCRIBED'));
  expect(screen.getByText('home: connected')).toBeTruthy();
});
