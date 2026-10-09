import document from '@/config/driverPreparation.json';
import DriverTermsDocument from './DriverTermsDocument';
// Only mounted in the explicit driver application journey. Future partners can
// read terms before the contract; customer menus and public footer don't link it.
export default function DriverTermsPreview() {
  return <details className="my-4 rounded-xl border border-background-200 bg-white p-4">
    <summary className="cursor-pointer text-sm font-semibold text-primary-700">Условия за шофьори — прочети преди кандидатстване</summary>
    <div className="mt-4"><DriverTermsDocument document={document} /></div>
    <p className="mt-3 text-xs text-foreground-500">Кандидатстването не ги приема вместо теб. След одобрение ще преминеш подготовката от своя шофьорски профил.</p>
  </details>;
}
