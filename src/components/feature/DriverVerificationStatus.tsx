import { useQuery } from '@tanstack/react-query';
import { driverVerificationOptions } from '@/lib/driverVerification';
export default function DriverVerificationStatus({ driverId, includeDocuments = true }: { driverId: string; includeDocuments?: boolean }) {
  const query = useQuery(driverVerificationOptions(driverId));
  const report = query.data;
  const issues = report?.blockers.filter(item => includeDocuments || !['license', 'insurance'].includes(item.code)) ?? [];
  return <div className="mb-4 rounded-xl bg-background-50 p-3 text-sm space-y-2" aria-label="Проверка за верификация">
    {query.isPending ? <p role="status">Проверяваме изискванията…</p> : query.isError ? <p role="alert" className="text-red-600">Не успяхме да обновим проверката. Не приемайте стария статус за потвърждение.</p> : report && <>
      <p className="font-medium">{report.can_verify ? report.is_verified ? 'Шофьорът е верифициран. Текущите проверки са изпълнени.' : 'Документите и текущите проверки са изпълнени. Остава верификация от фирмата.' : 'За верификация остава:'}</p>
      {issues.length > 0 && <ul className="list-disc pl-5 space-y-1 text-foreground-700">{issues.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul>}
      {!includeDocuments && !report.can_verify && issues.length === 0 && <p>Качване и одобрение на документите по-долу.</p>}
      {report.warnings.length > 0 && <ul className="list-disc pl-5 space-y-1 text-foreground-500">{report.warnings.map(issue => <li key={issue.code}>{issue.message}</li>)}</ul>}
    </>}
    <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="underline text-primary-700 disabled:opacity-50">Обнови проверката</button>
  </div>;
}
