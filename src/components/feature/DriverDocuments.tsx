import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { loadDocumentUpload, prepareDocumentUpload, registerDocumentUpload, uploadDriverDocument, workflowError } from '@/lib/driverDocuments';
import { driverVerificationOptions, verificationKey, type DocumentKind, type DocumentState } from '@/lib/driverVerification';
import DriverVerificationStatus from './DriverVerificationStatus';

const labels = { license: 'Шофьорска книжка', insurance: 'Застраховка' };
const stateLabels: Record<DocumentState, string> = { missing: 'Не е качен', missing_expiry: 'Липсва срок', expired: 'Изтекъл срок', rejected: 'Отхвърлен', pending: 'Очаква одобрение от фирмата', missing_file: 'Файлът липсва', approved: 'Одобрен' };
function DocumentCard({ driverId, userId, type, state, expiresAt, unavailable }: {
  driverId: string; userId: string; type: DocumentKind; state?: DocumentState; expiresAt?: string | null; unavailable: boolean;
}) {
  const client = useQueryClient();
  const [pending, setPending] = useState(() => loadDocumentUpload(userId, type));
  const [expires, setExpires] = useState(pending?.expires ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(false);
  const latch = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const showForm = !!pending || replace || (state !== 'approved' && state !== 'pending');
  async function submit(checkOnly = false) {
    if (latch.current) return;
    latch.current = true; setBusy(true); setError(''); setSuccess(false);
    try {
      if (checkOnly && pending) await registerDocumentUpload(pending);
      else {
        if (!file) throw new Error('Избери файл.');
        const command = await prepareDocumentUpload(userId, type, expires, file);
        setPending(command);
        await uploadDriverDocument(command, file);
      }
      setPending(null); setSuccess(true); setFile(null); setExpires(''); setReplace(false);
      if (fileInput.current) fileInput.current.value = '';
      void client.invalidateQueries({ queryKey: queryKeys.driverDocuments(driverId) });
      await client.invalidateQueries({ queryKey: verificationKey(driverId) });
    } catch (error) {
      setPending(loadDocumentUpload(userId, type));
      setError(workflowError(error, 'Качването не е потвърдено. Провери го преди повторен опит.'));
    } finally { latch.current = false; setBusy(false); }
  }
  return <section aria-label={labels[type]} className="border border-background-200 rounded-xl p-4 space-y-3">
    <div className="flex justify-between items-start gap-2"><div><h4 className="text-sm font-semibold">{labels[type]}</h4><p className="text-xs text-foreground-500">Задължителен документ</p></div><span className={`text-xs px-2 py-1 rounded-lg ${state === 'approved' ? 'bg-accent-100 text-accent-700' : 'bg-background-100 text-foreground-600'}`}>{state ? stateLabels[state] : 'Проверяваме…'}</span></div>
    {expiresAt && <p className="text-xs text-foreground-500">Записан срок: {expiresAt}</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {success && <p role="status" className="text-sm text-accent-700">Документът е получен. За верификация и двата документа трябва да бъдат одобрени от фирмата.</p>}
    {pending && <div className="text-sm"><p>Има непотвърдено качване на този документ. Можеш да го провериш и след прекъсната връзка.</p><button type="button" disabled={busy} className="underline text-primary-700" onClick={() => void submit(true)}>Провери качването</button></div>}
    {showForm ? <form aria-label={`Качване: ${labels[type]}`} onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-3">
      <label className="block text-xs text-foreground-600">Валиден до<input type="date" required value={expires} disabled={busy || !!pending || unavailable} onChange={e => setExpires(e.target.value)} className="block w-full p-2 border border-background-200 rounded-lg mt-1" /></label>
      <label className="block text-xs text-foreground-600">Файл<input ref={fileInput} type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy || unavailable} onChange={e => setFile(e.target.files?.[0] ?? null)} className="block w-full mt-2 text-sm" /></label>
      <button type="submit" disabled={busy || !file || unavailable} className="w-full py-3 bg-primary-500 text-white font-semibold rounded-xl disabled:opacity-50">{busy ? 'Проверяваме качването…' : pending ? 'Изпрати същия файл отново' : 'Качи за проверка'}</button>
    </form> : <button type="button" disabled={busy || unavailable} onClick={() => { setReplace(true); setSuccess(false); }} className="underline text-xs text-primary-700">Качи нов документ</button>}
  </section>;
}
export default function DriverDocuments({ driverId, userId }: { driverId: string; userId: string }) {
  const query = useQuery(driverVerificationOptions(driverId));
  return <div className="bg-white rounded-2xl p-5 mb-4">
    <div className="flex items-center gap-2 mb-3"><i className="ri-file-text-line text-foreground-600" /><h3 className="text-sm font-semibold text-foreground-950">Документи за верификация</h3></div>
    <p className="text-sm text-foreground-700 mb-3">Необходими са два отделни документа: шофьорска книжка и застраховка. След качването фирмата проверява и одобрява всеки от тях.</p>
    <DriverVerificationStatus driverId={driverId} includeDocuments={false} />
    <p className="text-xs text-foreground-500 mb-3">Файловете са частни. Качи четлив JPG, PNG, WebP или PDF до 5 MB. Не качвай лична карта или други ненужни данни.</p>
    <div className="space-y-4">{(['license', 'insurance'] as const).map(type => <DocumentCard key={`${userId}:${type}`} driverId={driverId} userId={userId} type={type}
      state={query.data?.documents[type].state} expiresAt={query.data?.documents[type].expires_at} unavailable={query.isPending || query.isError} />)}</div>
  </div>;
}
