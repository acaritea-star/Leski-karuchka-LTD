import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { documentExpired } from '@/lib/legalWorkflow';
import { loadDocumentUpload, prepareDocumentUpload, registerDocumentUpload, uploadDriverDocument, workflowError, type DocumentUpload } from '@/lib/driverDocuments';

export default function DriverDocuments({ driverId, userId }: { driverId: string; userId: string }) {
  const client = useQueryClient();
  const [pending, setPending] = useState(() => loadDocumentUpload(userId));
  const [type, setType] = useState<DocumentUpload['type']>(pending?.type ?? 'license');
  const [expires, setExpires] = useState(pending?.expires ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const latch = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.driverDocuments(driverId),
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => supabase.from('driver_documents').select('*')
        .eq('driver_id', driverId).order('created_at', { ascending: false }).abortSignal(abort), 10_000, signal);
      if (error) throw error;
      return data ?? [];
    },
  });
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
      setPending(null); setSuccess(true); setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      void client.invalidateQueries({ queryKey: queryKeys.driverDocuments(driverId) });
    } catch (error) {
      setPending(loadDocumentUpload(userId));
      setError(workflowError(error, 'Качването не е потвърдено. Провери статуса преди повторен опит.'));
    } finally { latch.current = false; setBusy(false); }
  }
  return <div className="bg-white rounded-2xl p-5 mb-4">
    <div className="flex items-center gap-2 mb-4"><i className="ri-file-text-line text-foreground-600" /><h3 className="text-sm font-semibold text-foreground-950">Документи</h3></div>
    {query.isPending ? <p role="status" className="text-sm">Зареждане…</p> : query.isError ? <p role="alert" className="text-sm text-red-600">Документите не са заредени. <button className="underline" onClick={() => void query.refetch()}>Опитай отново</button></p> : !query.data?.length ? <p className="text-sm text-foreground-400 py-3">Няма качени документи</p> : <div className="space-y-2 mb-4">
      {query.data.map(doc => <div key={doc.id} className="flex items-center justify-between gap-2 py-2 text-sm">
        <span>{doc.type === 'license' ? 'Шофьорска книжка' : doc.type === 'insurance' ? 'Застраховка' : 'Документ'}{doc.expires_at && <small className="block text-foreground-400">Валиден до {doc.expires_at}</small>}</span>
        <span className={`text-xs px-2.5 py-1 rounded-full ${doc.status === 'rejected' || documentExpired(doc.expires_at) ? 'bg-red-100 text-red-600' : 'bg-primary-100 text-primary-700'}`}>{documentExpired(doc.expires_at) ? 'Изтекъл срок' : doc.status === 'approved' ? 'Одобрен' : doc.status === 'rejected' ? 'Отхвърлен' : 'Очаква преглед'}</span>
      </div>)}
    </div>}
    <p className="text-xs text-foreground-500 mb-3">Качи четлив документ за преглед от фирмата. Файловете са частни. Не качвай лична карта или други ненужни данни. JPG, PNG, WebP или PDF до 5 MB.</p>
    {error && <p role="alert" className="text-sm text-red-600 mb-3">{error}</p>}
    {success && <p role="status" className="text-sm text-accent-700 mb-3">Документът е получен и очаква проверка.</p>}
    {pending && <div className="text-sm mb-3"><p>Има непотвърдено качване. Можеш да го провериш и след прекъсната връзка.</p><button type="button" disabled={busy} className="underline text-primary-700" onClick={() => void submit(true)}>Провери качването</button></div>}
    <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-3">
      <label className="block text-xs text-foreground-600">Тип документ<select value={type} disabled={busy || !!pending} onChange={e => setType(e.target.value as DocumentUpload['type'])} className="block w-full p-2 border border-background-200 rounded-lg mt-1"><option value="license">Шофьорска книжка</option><option value="insurance">Застраховка</option></select></label>
      <label className="block text-xs text-foreground-600">Валиден до<input type="date" required value={expires} disabled={busy || !!pending} onChange={e => setExpires(e.target.value)} className="block w-full p-2 border border-background-200 rounded-lg mt-1" /></label>
      <label className="block text-xs text-foreground-600">Файл<input ref={fileInput} type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} className="block w-full mt-2 text-sm" /></label>
      <button type="submit" disabled={busy || !file} className="w-full py-3 bg-primary-500 text-white font-semibold rounded-xl disabled:opacity-50">{busy ? 'Проверяваме качването…' : pending ? 'Изпрати същия файл отново' : 'Качи за проверка'}</button>
    </form>
  </div>;
}
