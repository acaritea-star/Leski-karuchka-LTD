import { useRef, useState } from 'react';
import { applicationDocumentLabels, pendingApplicationUpload, prepareApplicationUpload, registerApplicationUpload, uploadApplicationDocument, type ApplicationDocumentKind, type Onboarding } from '@/lib/driverOnboarding';
import { workflowError } from '@/lib/driverDocuments';
import { documentExpired } from '@/lib/legalWorkflow';
export default function ApplicationDocumentCard({ bundle, type, onSaved }: { bundle: Onboarding; type: ApplicationDocumentKind; onSaved: () => Promise<unknown> }) {
  const a = bundle.application;
  const existing = bundle.documents.find(x => x.type === type);
  const expired = !!existing && type !== 'vehicle_registration' && documentExpired(existing.expires_at);
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
  return <section aria-label={applicationDocumentLabels[type]} className="border border-background-200 bg-background-50 rounded-2xl p-4 sm:p-5 space-y-4">
    <h3 className="font-semibold text-xl text-foreground-950">{applicationDocumentLabels[type]}</h3>
    {existing && <p role="status" className={`text-base leading-relaxed ${expired ? 'text-amber-800' : 'text-primary-700'}`}>{expired ? 'Този документ няма валиден срок. Качи актуалния документ.' : '✓ Качен успешно — предстои проверка от фирмата'}{existing.expires_at ? ' · Валиден до ' + new Date(existing.expires_at + 'T12:00:00').toLocaleDateString('bg-BG') : ''}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {pending && <button type="button" disabled={busy} onClick={() => void save(true)} className="text-sm underline text-primary-700">Провери непотвърденото качване</button>}
    {existing && !expired && !replace && !pending ? <button type="button" onClick={() => setReplace(true)} className="min-h-12 text-sm underline text-primary-700">Замени документа</button> : <form aria-label={'Качване: ' + applicationDocumentLabels[type]} onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-4">
      <p className="text-base leading-relaxed text-foreground-600">Избери снимка от телефона или PDF. Всички данни трябва да се четат ясно.</p>
      {type !== 'vehicle_registration' && <label className="block text-sm font-semibold">Валиден до<input type="date" required disabled={busy || !!pending} value={expires} onChange={e => setExpires(e.target.value)} className="block w-full rounded-xl border border-background-200 bg-white p-3 mt-2 text-base font-normal" /><span className="block mt-2 text-sm font-normal text-foreground-500">Въведи датата, до която важи документът.</span></label>}
      <label className="block rounded-xl border-2 border-dashed border-background-300 bg-white p-4 cursor-pointer focus-within:ring-2 focus-within:ring-primary-500"><span className="sr-only">Файл</span><input type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} className="sr-only" /><span className="block text-base font-semibold text-primary-700">{file ? '✓ Файлът е избран' : 'Избери снимка или PDF'}</span><span className="block mt-2 text-sm text-foreground-600 break-all">{file?.name || 'JPG, PNG, WebP или PDF · до 5 MB'}</span></label>
      <p className="text-sm leading-relaxed text-foreground-500">Документът е частен и се вижда от хората, които проверяват профила ти. Не качвай лична карта.</p>
      <button type="submit" disabled={busy || !file} className="w-full rounded-xl bg-primary-500 p-4 text-white text-base font-semibold disabled:opacity-50">{busy ? 'Потвърждаваме качването…' : 'Качи документа'}</button>
    </form>}
  </section>;
}
