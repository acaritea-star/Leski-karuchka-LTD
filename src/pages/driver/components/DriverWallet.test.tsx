// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Tables } from '@/lib/database.types';
import DriverWallet from './DriverWallet';
const fake = vi.hoisted(() => ({ navigate: vi.fn(), refetch: vi.fn(), failed: false, total: 12.23, testTotal: 0, refundedCount: 0 }));
vi.mock('react-router-dom', () => ({ useNavigate: () => fake.navigate }));
vi.mock('@/hooks/useDriverDay', () => ({ useDriverDay: () => ({ data: { received: { cash: 5, card: 3, online: 4.23, total: fake.total }, testPayments: { total: fake.testTotal, count: fake.testTotal > 0 ? 1 : 0, refundedCount: fake.refundedCount } }, isError: fake.failed, refetch: fake.refetch }) }));
const row = { id: 'paid-ride', driver_id: 'driver', status: 'completed', payment_status: 'paid', payment_method: 'online', payment_environment: 'live', final_price: 4.23 } as Tables<'taxi_requests'>;
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); fake.failed = false; fake.total = 12.23; fake.testTotal = 0; fake.refundedCount = 0; });
afterEach(cleanup);
it('shows a persisted total, amount and distinct company funds without adding the receipt again', () => {
 const view = render(<DriverWallet owner="owner" driverId="driver" receipt={row} />);
 expect(screen.getByText('+4,23 €')).toBeTruthy(); expect(screen.getByText('12,23 €')).toBeTruthy();
 expect(screen.getByRole('status').dataset.new).toBe('true');
 view.rerender(<DriverWallet owner="owner" driverId="driver" receipt={{ ...row }} />);
 expect(screen.getByText('12,23 €')).toBeTruthy();
 view.unmount(); render(<DriverWallet owner="owner" driverId="driver" receipt={row} />);
 expect(screen.getByRole('status').dataset.new).toBe('false');
 fireEvent.click(screen.getByRole('button', { name: 'Портфейл — получени по днешните курсове' }));
 expect(screen.getByText('Онлайн към фирмата')).toBeTruthy();
 fireEvent.click(screen.getByRole('button', { name: 'Отвори отчета' })); expect(fake.navigate).toHaveBeenCalledWith('/driver/earnings');
});
it('labels a sandbox payment and keeps it out of the real balance', () => {
 fake.total = 0; render(<DriverWallet owner="owner" driverId="driver" receipt={{ ...row, payment_environment: 'test' }} />);
 expect(screen.getByText('0,00 €')).toBeTruthy(); expect(screen.getByText('Тест · без реално постъпление')).toBeTruthy();
 expect(screen.getByText('Тестово плащане успешно')).toBeTruthy();
});
it('hides another driver receipt and exposes refresh when the total is stale', () => {
 fake.failed = true; render(<DriverWallet owner="owner" driverId="other" receipt={row} />);
 expect(screen.queryByText('Платено онлайн')).toBeNull();
 fireEvent.click(screen.getByRole('button', { name: /Сумата не е обновена/ })); expect(fake.refetch).toHaveBeenCalledOnce();
});
it('shows only real wallet totals even when historical tests and test refunds exist', () => {
 fake.total = 12.23; fake.testTotal = 2.97; fake.refundedCount = 1;
 const view = render(<DriverWallet owner="owner" driverId="driver" receipt={null} />);
 expect(screen.getByText('12,23 €')).toBeTruthy(); expect(screen.queryByText('2,97 €')).toBeNull();
 view.unmount(); render(<DriverWallet owner="owner" driverId="driver" receipt={null} />);
 fireEvent.click(screen.getByRole('button', { name: 'Портфейл — получени по днешните курсове' }));
 expect(screen.queryByRole('region', { name: 'Тестови плащания за днес' })).toBeNull();
 expect(screen.queryByText('Тестови плащания')).toBeNull(); expect(screen.queryByText('2,97 €')).toBeNull();
 expect(screen.getByText('Онлайн към фирмата')).toBeTruthy();
});
