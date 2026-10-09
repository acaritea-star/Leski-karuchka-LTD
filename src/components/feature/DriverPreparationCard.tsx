import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { driverVerificationOptions } from '@/lib/driverVerification';
export default function DriverPreparationCard({ driverId }: { driverId: string }) {
  // Reuses DriverDocuments' check; no polling or extra materials request.
  const { data } = useQuery(driverVerificationOptions(driverId));
  const complete = data?.preparation?.complete;
  return <section className="mb-4 rounded-2xl bg-white p-5 space-y-2" aria-label="Подготовка за шофьори">
    <h2 className="font-semibold text-foreground-950">Подготовка за шофьори</h2>
    <p className="text-sm text-foreground-600">{complete ? 'Условията и краткото обучение са завършени. Можеш да ги прегледаш и да изтеглиш копие.'
      : 'Кратко обучение и условия за работа с приложението. Задължително преди нова верификация от фирмата.'}</p>
    <Link to="/driver/preparation" className="inline-block text-sm font-medium underline text-primary-700">{complete ? 'Преглед и копие' : 'Започни подготовката'}</Link>
  </section>;
}
