// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCustomerViewport } from './useCustomerViewport';

const frames = new Map<number, (time: number) => void>();
let frameId = 0;
function flushFrame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)); }
beforeEach(() => {
  frames.clear(); frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('keeps the panel above the keyboard and preserves pinch-to-zoom', () => {
  const viewport = Object.assign(new EventTarget(), { height: 780, offsetTop: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  function Example() { const ref = useCustomerViewport(); return <div ref={ref} data-testid="viewport" />; }
  render(<Example />);
  const style = screen.getByTestId('viewport').style;
  expect(style.getPropertyValue('--customer-height')).toBe('780px');
  act(() => { viewport.height = 400; viewport.offsetTop = 12; viewport.dispatchEvent(new Event('resize')); flushFrame(); });
  expect(style.getPropertyValue('--customer-height')).toBe('400px');
  expect(style.getPropertyValue('--customer-top')).toBe('12px');
  act(() => { viewport.scale = 2; viewport.height = 200; viewport.dispatchEvent(new Event('resize')); flushFrame(); });
  expect(style.getPropertyValue('--customer-height')).toBe('400px');
});

it('coalesces viewport event bursts and avoids unchanged style writes', () => {
  const viewport = Object.assign(new EventTarget(), { height: 780, offsetTop: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  function Example() { const ref = useCustomerViewport(); return <div ref={ref} data-testid="viewport" />; }
  const view = render(<Example />);
  const style = screen.getByTestId('viewport').style;
  const writes = vi.spyOn(style, 'setProperty');
  act(() => {
    for (let i = 0; i < 10; i++) { viewport.height = 770 - i; viewport.dispatchEvent(new Event('resize')); }
  });
  expect(writes).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  act(flushFrame);
  expect(style.getPropertyValue('--customer-height')).toBe('761px');
  writes.mockClear();
  act(() => { viewport.dispatchEvent(new Event('scroll')); flushFrame(); });
  expect(writes).not.toHaveBeenCalled();
  act(() => viewport.dispatchEvent(new Event('resize')));
  view.unmount(); expect(frames.size).toBe(0);
});
