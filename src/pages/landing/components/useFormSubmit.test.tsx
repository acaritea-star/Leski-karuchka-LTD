// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFormSubmit } from './useFormSubmit';

const fetchMock = vi.fn();
const makeForm = () => {
  const form = document.createElement('form'); form.innerHTML = '<input name="name"><input name="trap">';
  document.body.append(form); (form.elements.namedItem('name') as HTMLInputElement).value = 'Владимир'; return form;
};
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.useRealTimers(); });

it('prevents duplicate submissions and resets fields only after confirmed success', async () => {
  let finish!: (response: Response) => void; fetchMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const form = makeForm(), { result } = renderHook(() => useFormSubmit('https://example.invalid/contact', 'trap'));
  let request!: Promise<void>;
  act(() => { request = result.current.submit(form); void result.current.submit(form); });
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(result.current.status).toBe('submitting');
  expect((form.elements.namedItem('name') as HTMLInputElement).value).toBe('Владимир');
  await act(async () => { finish(new Response('{"code":"OK"}')); await request; });
  expect(result.current.status).toBe('success'); expect((form.elements.namedItem('name') as HTMLInputElement).value).toBe('');
  expect(String(fetchMock.mock.calls[0][1].body)).not.toContain('trap');
});

it('times out a stalled submission, preserves the fields and enables a fresh retry', async () => {
  fetchMock.mockReturnValueOnce(new Promise(() => {}));
  const form = makeForm(), { result } = renderHook(() => useFormSubmit('https://example.invalid/contact', 'trap'));
  let request!: Promise<void>; act(() => { request = result.current.submit(form); });
  await act(async () => { await vi.advanceTimersByTimeAsync(15_001); await request; });
  expect(result.current.status).toBe('error'); expect(result.current.errorMsg).toContain('Данните са запазени');
  expect((form.elements.namedItem('name') as HTMLInputElement).value).toBe('Владимир');
  fetchMock.mockResolvedValueOnce(new Response('{"code":"OK"}'));
  await act(async () => { await result.current.submit(form); });
  expect(result.current.status).toBe('success'); expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('shows a readable failure instead of an HTML error page and keeps the original entry', async () => {
  fetchMock.mockResolvedValueOnce(new Response('<html>upstream error</html>', { status: 502 }));
  const form = makeForm(), { result } = renderHook(() => useFormSubmit('https://example.invalid/contact', 'trap'));
  await act(async () => { await result.current.submit(form); });
  expect(result.current.status).toBe('error'); expect(result.current.errorMsg).toContain('Изпращането не е потвърдено');
  expect(result.current.errorMsg).not.toContain('<html>'); expect((form.elements.namedItem('name') as HTMLInputElement).value).toBe('Владимир');
});
