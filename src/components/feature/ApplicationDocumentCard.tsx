import { useRef, useState } from 'react';
import { applicationDocumentLabels, pendingApplicationUpload, prepareApplicationUpload, registerApplicationUpload, uploadApplicationDocument, type ApplicationDocumentKind, type Onboarding } from '@/lib/driverOnboarding';
import { workflowError } from '@/lib/driverDocuments';
export default function ApplicationDocumentCard({ bundle, type, onSaved }: { bundle: Onboarding; type: ApplicationDocumentKind; onSaved: () => Promise<unknown> }) {
  const a = bundle.application;
  const existing = bundle.documents.find(x => x.type === type);
  const [pending, setPending] = useState(() => pendingApplicationUpload(a, type));
  const [file, setFile] = useState<File | null>(null);
  const [expires, setExpires] = useState(pending?.expires ?? (type === 'insurance' ? String((a.vehicle_details as Record<string, unknown> | null)?.insurance_expiry_date ?? '') : ''));
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latch = useRef(false);
  async function save(check = false) {
    if (latch.current) return;
    latch.current = true; setBusy(true); setError('');
    try {
      if (check && pending) await registerApplicationUpload(a, pending);
      else {
        if (!file) throw new Error('Избери файл.');
        const command = await prepareApplicationUpload(a, type, type === 'vehicle_registration' ? null : expires, file);
        setPending(command);
        await uploadApplicationDocument(a, command, file);
      }
      setPending(null); setFile(null); setReplace(false);
    } catch (e) { setPending(pendingApplicationUpload(a, type)); setError(workflowError(e, 'Качването не е потвърдено.')); }
    finally { await onSaved(); latch.current = false; setBusy(false); }
  }
  return <section aria-label={applicationDocumentLabels[type]} className="border border-background-200 rounded-xl p-4 space-y-3">
    <h4 className="font-semibold text-sm">{applicationDocumentLabels[type]}</h4>
    {existing && <p role="status" className="text-sm text-accent-700">Получен за общия преглед{existing.expires_at ? ' · Валиден до ' + existing.expires_at : ''}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {pending && <button type="button" disabled={busy} onClick={() => void save(true)} className="text-sm underline text-primary-700">Провери непотвърденото качване</button>}
    {existing && !replace && !pending ? <button type="button" onClick={() => setReplace(true)} className="text-xs underline text-primary-700">Замени документа</button> : <form aria-label={'Качване: ' + applicationDocumentLabels[type]} onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-3">
      {type !== 'vehicle_registration' && <label className="block text-xs">Валиден до<input type="date" required disabled={busy || !!pending} value={expires} onChange={e => setExpires(e.target.value)} className="block w-full rounded-lg border border-background-200 p-2 mt-1" /></label>}
      <label className="block text-xs">Файл<input type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} className="block w-full mt-2 text-sm" /></label>
      <button type="submit" disabled={busy || !file} className="w-full rounded-xl bg-primary-500 p-3 text-white text-sm font-semibold disabled:opacity-50">{busy ? 'Потвърждаваме качването…' : 'Качи документа'}</button>
    </form>}
  </section>;
}
