// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCustomerViewport } from './useCustomerViewport';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('keeps the panel above the keyboard and preserves pinch-to-zoom', () => {
  const viewport = Object.assign(new EventTarget(), { height: 780, offsetTop: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  function Example() { const ref = useCustomerViewport(); return <div ref={ref} data-testid="viewport" />; }
  render(<Example />);
  const style = screen.getByTestId('viewport').style;
  expect(style.getPropertyValue('--customer-height')).toBe('780px');
  act(() => { viewport.height = 400; viewport.offsetTop = 12; viewport.dispatchEvent(new Event('resize')); });
  expect(style.getPropertyValue('--customer-height')).toBe('400px');
  expect(style.getPropertyValue('--customer-top')).toBe('12px');
  act(() => { viewport.scale = 2; viewport.height = 200; viewport.dispatchEvent(new Event('resize')); });
  expect(style.getPropertyValue('--customer-height')).toBe('400px');
});
