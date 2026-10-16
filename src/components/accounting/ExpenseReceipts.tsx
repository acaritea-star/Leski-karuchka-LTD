import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Modal from '@/components/feature/Modal';
import { downloadExpenseReceipt, finalizeExpenseReceipt, listExpenseReceipts, uploadExpenseReceipt, type ExpenseReceipt } from '@/lib/expenseReceipts';
import { money } from '@/lib/accounting';
const button = 'min-h-11 rounded-xl border border-background-200 px-3 py-2 text-sm font-medium disabled:opacity-40';
export default function ExpenseReceipts({entry,owner,canUpload,onClose}:{entry:{id:string;amount:number;note:string;reversed?:boolean};owner:string;canUpload:boolean;onClose:()=>void}) {
 const query = useQuery({queryKey:['expense-receipts',owner,entry.id],queryFn:({signal})=>listExpenseReceipts(entry.id,signal),staleTime:30_000});
 const [busy,setBusy] = useState(false), [error,setError] = useState(''), [previews,setPreviews] = useState<Record<string,string>>({});
 const inFlight = useRef(false), urls = useRef<string[]>([]), alive = useRef(true);
 useEffect(() => {alive.current=true; return () => {alive.current=false;for(const url of urls.current)URL.revokeObjectURL(url);urls.current=[];};},[]);
 const run = async (work:()=>Promise<unknown>) => {
  if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
  try {await work();if(alive.current)await query.refetch();}
  catch(e){if(alive.current)setError(e&&typeof e==='object'&&'message'in e?String(e.message):'Документът не се зареди. Опитай отново.');}
  finally{inFlight.current=false;if(alive.current)setBusy(false);}
 };
 const open = (r:ExpenseReceipt) => run(async()=>{
  const blob=await downloadExpenseReceipt(r);if(!alive.current)return;
  const url=URL.createObjectURL(blob);urls.current.push(url);setPreviews(p=>({...p,[r.id]:url}));
 });
 return <Modal label="Документи към разхода" onClose={onClose} busy={busy} className="max-w-lg"><div className="p-5 space-y-4">
  <div className="flex justify-between items-center gap-2"><h2 className="font-bold text-lg">Документи към разхода</h2><button type="button" aria-label="Затвори документите" className={button} disabled={busy} onClick={onClose}>×</button></div>
  <p className="text-sm break-words"><strong>{money(entry.amount)}</strong> · {entry.note}</p>
  <p className="text-xs text-foreground-500">Разходът вече е записан. Снимката или файлът се добавят към него, без нов финансов запис. Видими са за шофьора и неговата фирма.</p>
  {query.isPending&&<p role="status">Зареждане…</p>}
  {query.isError&&<p role="alert" className="text-sm text-red-700">Документите не се заредиха. <button className="underline min-h-11" onClick={()=>void query.refetch()}>Опитай отново</button></p>}
  {query.data?.map(r=><article key={r.id} className="rounded-xl border border-background-200 p-3 space-y-2">
   <p className="text-sm font-medium break-words">{r.file_name}</p>
   <p className="text-xs text-foreground-500">{r.uploaded_at?'Документът е качен':'Непотвърдено качване — провери или избери същия файл'}</p>
   {r.uploaded_at&&!previews[r.id]&&<button className={button} disabled={busy} onClick={()=>void open(r)}>Виж документа</button>}
   {!r.uploaded_at&&canUpload&&<button className={button} disabled={busy} onClick={()=>void run(()=>finalizeExpenseReceipt(r.id,owner))}>Провери качването</button>}
   {previews[r.id]&&<>{r.mime_type.startsWith('image/')&&<img src={previews[r.id]} alt="Качен документ към разхода" className="max-h-96 w-full object-contain rounded-lg"/>}<a className={`${button} inline-flex items-center`} href={previews[r.id]} download={r.file_name}>Изтегли документа</a></>}
  </article>)}
  {query.data?.length===0&&<p className="text-sm text-foreground-500">Още няма приложени документи.</p>}
  {canUpload&&!entry.reversed&&<label className="block text-sm font-medium">Добави снимка или файл<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy||query.isError||!query.data||query.data.filter(r=>!!r.uploaded_at).length>=3} className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-3" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void run(()=>uploadExpenseReceipt(entry.id,owner,file));}}/><span className="block mt-2 text-xs text-foreground-500">До 3 документа · JPG, PNG, WebP или PDF · до 5 MB всеки. Качвай само данни, свързани с разхода.</span></label>}
  {busy&&<p role="status" className="text-sm">Проверка и качване…</p>}
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
 </div></Modal>;
}
