// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import Profile from './page';

const fake = vi.hoisted(() => ({ update: vi.fn(), user: { id: 'customer', first_name: 'Владимир', last_name: 'Атанасов', phone: '0888123456', email: 'customer@example.invalid' } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fake.user, updateProfile: fake.update }) }));
vi.mock('@/pages/customer/components/AppMenu', () => ({ default: () => null }));
const mount = () => render(<MemoryRouter initialEntries={['/customer/profile']}><Routes>
  <Route path="/customer/profile" element={<Profile />} /><Route path="/customer/orders" element={<h1>История</h1>} />
</Routes></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); void i18n.changeLanguage('bg'); fake.update.mockResolvedValue({ data: fake.user, error: null }); });
afterEach(cleanup);

it('discards cancelled edits and reopens the current saved profile', () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Редактирай профила' }));
  fireEvent.change(screen.getByLabelText('Име'), { target: { value: 'Незапазено' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отказ' }));
  fireEvent.click(screen.getByRole('button', { name: 'Редактирай профила' }));
  expect((screen.getByLabelText('Име') as HTMLInputElement).value).toBe('Владимир');
  expect(fake.update).not.toHaveBeenCalled();
});

it('submits one trimmed profile, freezes editing while saving, and keeps confirmation visible', async () => {
  let finish!: (result: unknown) => void; fake.update.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Редактирай профила' }));
  fireEvent.change(screen.getByLabelText('Име'), { target: { value: '  Владимир  ' } });
  const form = screen.getByRole('form', { name: 'Редактирай профила' });
  act(() => { fireEvent.submit(form); fireEvent.submit(form); });
  expect(fake.update).toHaveBeenCalledTimes(1);
  expect(fake.update).toHaveBeenCalledWith({ first_name: 'Владимир', last_name: 'Атанасов', phone: '0888123456' });
  expect((screen.getByRole('button', { name: 'Зареждане...' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { finish({ data: fake.user, error: null }); });
  expect(screen.queryByRole('form')).toBeNull(); expect(screen.getByRole('status').textContent).toBe('Профилът е запазен.');
  fireEvent.click(screen.getByRole('link', { name: /Поръчки/ }));
  expect(screen.getByRole('heading', { name: 'История' })).toBeTruthy();
});

it('retains entered fields after a rejected or unconfirmed save and allows retry', async () => {
  fake.update.mockRejectedValueOnce(new Error('Провери връзката'));
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Редактирай профила' }));
  fireEvent.change(screen.getByLabelText('Телефон'), { target: { value: '0899123456' } });
  await act(async () => { fireEvent.submit(screen.getByRole('form')); });
  expect(screen.getByRole('alert').textContent).toBe('Провери връзката');
  expect((screen.getByLabelText('Телефон') as HTMLInputElement).value).toBe('0899123456');
  fake.update.mockResolvedValueOnce({ data: null, error: null });
  await act(async () => { fireEvent.submit(screen.getByRole('form')); });
  expect(screen.getByRole('alert').textContent).toContain('Записът не е потвърден');
  expect(screen.queryByRole('status')).toBeNull();
  await act(async () => { fireEvent.submit(screen.getByRole('form')); });
  expect(screen.getByRole('status')).toBeTruthy(); expect(fake.update).toHaveBeenCalledTimes(3);
});
