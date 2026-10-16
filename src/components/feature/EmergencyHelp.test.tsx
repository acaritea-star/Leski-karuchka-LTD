// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import EmergencyHelp from './EmergencyHelp';
afterEach(cleanup);
it('opens an explicit dialer action without making a call or requiring GPS', () => {
  render(<EmergencyHelp />); expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Спешна помощ на 112' }));
  expect(screen.getByRole('link', { name: 'Обади се на 112' }).getAttribute('href')).toBe('tel:112');
  fireEvent.click(screen.getByText('Назад към приложението')); expect(screen.queryByRole('dialog')).toBeNull();
});
