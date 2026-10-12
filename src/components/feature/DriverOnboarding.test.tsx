// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import DriverOnboarding from './DriverOnboarding';
const fake = vi.hoisted(() => ({ bundle: null as unknown, submit: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ refreshProfile: vi.fn() }) }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/driverOnboarding', () => ({
  onboardingOptions: () => ({ queryKey: ['onboarding'], queryFn: async () => fake.bundle }),
  submitOnboarding: fake.submit, saveApplicationVehicle: vi.fn(), acceptApplicationPreparation: vi.fn(),
  applicationDocumentLabels: { license: 'Шофьорска книжка', insurance: 'Застраховка на автомобила', vehicle_registration: 'Свидетелство за регистрация на автомобила' },
  pendingApplicationUpload: () => null, prepareApplicationUpload: vi.fn(), registerApplicationUpload: vi.fn(), uploadApplicationDocument: vi.fn(),
}));
vi.mock('./DriverPreparationForm', () => ({ default: () => <p>Запазено обучение</p> }));
afterEach(() => { cleanup(); fake.submit.mockReset(); });
const document = (type: string, expires_at = '2099-01-01') => ({ type, expires_at, id: type });
function mount(documents: unknown[], vehicle_details: unknown = { make: 'Тест', model: 'Кола', registration_number: 'A1234BC' }, submitted_at: string | null = null, has_vehicle = true) {
  fake.bundle = { application: { id: 'application', company_id: 'company', user_id: 'user', status: 'pending', has_vehicle, vehicle_details, submitted_at }, documents, preparation: { receipt: {} } };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['onboarding'], fake.bundle);
  render(<QueryClientProvider client={client}><DriverOnboarding applicationId="application" onReviewed={() => {}} /></QueryClientProvider>);
  return client;
}
it('asks for vehicle details before exposing a single next document', () => {
  const client = mount([], null);
  expect(screen.getByRole('form', { name: 'Автомобил за верификация' })).toBeTruthy();
  expect(screen.queryByRole('form', { name: /^Качване:/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Изпрати целия пакет за проверка' })).toBeNull();client.clear();
});
it('shows only the next missing upload and requires replacement of an expired licence', () => {
  const client = mount([document('license', '2000-01-01'), document('insurance')]);
  expect(screen.getAllByRole('form', { name: /^Качване:/ })).toHaveLength(1);
  expect(screen.getByRole('form', { name: 'Качване: Шофьорска книжка' })).toBeTruthy();
  expect(screen.getByText(/Този документ няма валиден срок/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Изпрати целия пакет за проверка' })).toBeNull();client.clear();
});
it('submits a complete package once and shows waiting instead of editable tasks after submission', async () => {
  const documents = [document('license'), document('insurance'), document('vehicle_registration')];
  let finish!: () => void;
  fake.submit.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const client = mount(documents);
  const submit = screen.getByRole('button', { name: 'Изпрати целия пакет за проверка' });
  fireEvent.click(submit); fireEvent.click(submit);
  expect(fake.submit).toHaveBeenCalledOnce();
  await act(async () => { fake.bundle = { ...(fake.bundle as object), application: { ...(fake.bundle as { application: object }).application, submitted_at: '2026-10-12T10:00:00Z' } }; finish(); });
  expect(screen.getByRole('heading', { name: 'Всичко е изпратено' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Изпрати целия пакет за проверка' })).toBeNull();
  expect(screen.queryByRole('form', { name: /^Качване:/ })).toBeNull();client.clear();
});

it('asks only for the licence when the company provides the vehicle', () => {
  const client = mount([], null, null, false);
  expect(screen.getAllByRole('form', { name: /^Качване:/ })).toHaveLength(1);
  expect(screen.getByRole('form', { name: 'Качване: Шофьорска книжка' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Регистрационен номер' })).toBeNull();client.clear();
});
