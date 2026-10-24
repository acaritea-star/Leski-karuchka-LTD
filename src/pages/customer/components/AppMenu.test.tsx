// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
import AppMenu from './AppMenu';
import Modal from '@/components/feature/Modal';
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'customer', first_name: 'Клиент' } }) }));
vi.mock('@/hooks/useSignOut', () => ({ useSignOut: () => ({ logout: vi.fn(), pending: false, error: '' }) }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.style.overflow = ''; });
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Отвори менюто' }));

it('does not let an old close timer dismiss a newly opened menu', () => {
  render(<MemoryRouter><AppMenu /></MemoryRouter>); openMenu();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Отказ' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Поръчки' }));
  openMenu(); act(() => vi.advanceTimersByTime(250));
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('keeps the drawer open during diagonal vertical scrolling but accepts an intentional horizontal swipe', () => {
  render(<MemoryRouter><AppMenu /></MemoryRouter>); openMenu();
  const aside = screen.getByRole('dialog').querySelector('aside')!;
  fireEvent.touchStart(aside, { touches: [{ clientX: 80, clientY: 120 }] });
  fireEvent.touchEnd(aside, { changedTouches: [{ clientX: 160, clientY: 420 }] });
  act(() => vi.advanceTimersByTime(250)); expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.touchStart(aside, { touches: [{ clientX: 80, clientY: 120 }] });
  fireEvent.touchEnd(aside, { changedTouches: [{ clientX: 200, clientY: 130 }] });
  act(() => vi.advanceTimersByTime(250)); expect(screen.queryByRole('dialog')).toBeNull();
});

it('a closed menu never unlocks an existing modal and nested releases restore the original scroll style', () => {
  document.body.style.overflow = 'clip';
  const view = render(<MemoryRouter><Modal label="Съществуващ диалог" onClose={() => {}}>Съдържание</Modal><AppMenu /></MemoryRouter>);
  expect(document.body.style.overflow).toBe('hidden');
  openMenu();
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Отвори менюто' })).getByRole('button', { name: 'Отказ' }));
  act(() => vi.advanceTimersByTime(250)); expect(document.body.style.overflow).toBe('hidden');
  view.unmount(); expect(document.body.style.overflow).toBe('clip');
});
