// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import i18n from '@/i18n';
import { I18nextProvider } from 'react-i18next';
import EmergencyHelp from './EmergencyHelp';
afterEach(cleanup);
it('opens an explicit dialer action without making a call or requiring GPS', async () => {
  await i18n.changeLanguage('bg');
  render(<I18nextProvider i18n={i18n}><EmergencyHelp /></I18nextProvider>); expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Спешна помощ на 112' }));
  expect(screen.getByRole('link', { name: 'Обади се на 112' }).getAttribute('href')).toBe('tel:112');
  fireEvent.click(screen.getByText('Назад към приложението')); expect(screen.queryByRole('dialog')).toBeNull();
});
