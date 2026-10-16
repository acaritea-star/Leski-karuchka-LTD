import { lazy, Suspense, useState } from 'react';
import Modal from './Modal';
const StaffMfa = lazy(() => import('./StaffMfa'));

export default function StaffSecuritySettings() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return <section className="rounded-2xl border border-background-200 bg-white p-4 space-y-2">
    <h2 className="font-semibold">Сигурност на профила</h2>
    <p className="text-sm text-foreground-500">Двуфакторният вход е задължителен за служебния профил.</p>
    <button type="button" onClick={() => setOpen(true)} className="min-h-11 text-sm font-semibold text-primary-700 underline">Управлявай двуфакторния вход</button>
    {open && <Modal label="Настройки на двуфакторния вход" onClose={() => setOpen(false)} busy={busy} className="max-w-lg">
      <div className="p-3"><div className="flex justify-end"><button type="button" onClick={() => setOpen(false)} aria-label="Затвори настройките за сигурност" className="min-h-11 min-w-11 rounded-xl hover:bg-background-100">×</button></div>
        <Suspense fallback={<p role="status" className="p-4">Зареждане…</p>}><StaffMfa management onBusyChange={setBusy} /></Suspense>
      </div>
    </Modal>}
  </section>;
}
