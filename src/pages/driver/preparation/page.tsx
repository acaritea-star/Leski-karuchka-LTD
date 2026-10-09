import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { completeDriverPreparation, driverPreparationOptions, preparationCopy, preparationKey } from '@/lib/driverPreparation';
import type { DriverPreparationMaterials } from '@/lib/driverPreparation';
import { verificationKey } from '@/lib/driverVerification';
import DriverTermsDocument from '@/components/feature/DriverTermsDocument';

function PreparationForm({ materials, userId }: { materials: DriverPreparationMaterials; userId: string }) {
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const { document: d, receipt } = materials;
  const allAnswered = d.questions.every(q => !!answers[q.id]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([preparationCopy(materials)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'leski-driver-' + d.termsVersion + '.txt';
    link.hidden = true; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const accept = async () => {
    if (inFlight.current || !allAnswered) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await completeDriverPreparation(materials, answers, userId);
      client.setQueryData(preparationKey(userId), { ...materials, receipt: result.receipt });
      client.setQueryData(result.legalKey, { id: result.generalAcceptanceId });
      void client.invalidateQueries({ queryKey: verificationKey(materials.driver_id) });
    } catch (e) {
      setError(e && typeof e === 'object' && 'code' in e && e.code === '22023' && 'message' in e ? String(e.message)
        : 'Не получихме потвърждение. Обнови статуса или опитай пак; отговорите ти остават тук.');
      // A lost POST response must never mean success locally. An authoritative
      // read may confirm the already committed, idempotent receipt.
      void client.invalidateQueries({ queryKey: preparationKey(userId) });
    } finally { inFlight.current = false; setBusy(false); }
  };
  return <div className="space-y-4">
    <section className="rounded-2xl bg-white p-5 space-y-3">
      {receipt ? <div role="status" className="space-y-2">
        <h2 className="font-semibold text-accent-600">Подготовката е завършена</h2>
        <p className="text-sm text-foreground-600">Записана на {new Date(receipt.accepted_at).toLocaleString('bg-BG')}. Фирмата може да продължи проверката на документите и автомобила.</p>
        <Link to="/driver/profile" className="text-sm underline text-primary-700">Към профила и документите</Link>
      </div> : <>
        <p className="text-sm text-foreground-600">Около 3 минути. Премини петте теми и отговори на трите въпроса. Приемането е лично; фирмата не може да го направи вместо теб.</p>
        <ol className="flex gap-2" aria-label="Напредък на обучението">{d.steps.map((s, i) => <li key={s.id} className="flex-1">
          <span className={`block h-1 rounded-full ${i <= step ? 'bg-primary-500' : 'bg-background-200'}`} aria-current={i === step ? 'step' : undefined}><span className="sr-only">{s.title}</span></span>
        </li>)}</ol>
        {step < d.steps.length ? <div className="space-y-3">
          <p className="text-xs text-foreground-500">Тема {step + 1} от {d.steps.length}</p>
          <h2 className="text-lg font-semibold text-foreground-950">{d.steps[step].title}</h2>
          {d.steps[step].paragraphs.map((p, i) => <p key={i} className="text-sm leading-relaxed text-foreground-700">{p}</p>)}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="text-sm underline text-foreground-600">Назад</button>}
            <button type="button" onClick={() => setStep(step + 1)} className="rounded-xl bg-primary-500 px-5 py-3 text-sm font-semibold text-white">{step === d.steps.length - 1 ? 'Към кратката проверка' : 'Продължи'}</button>
          </div>
        </div> : <form className="space-y-5" onSubmit={e => { e.preventDefault(); void accept(); }}>
          <h2 className="font-semibold text-foreground-950">Кратка проверка</h2>
          {d.questions.map(q => <fieldset key={q.id} disabled={busy} className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{q.title}</legend>
            {q.options.map(o => <label key={o.id} className="flex items-start gap-3 rounded-xl bg-background-50 p-3 text-sm leading-relaxed cursor-pointer">
              <input type="radio" name={q.id} value={o.id} checked={answers[q.id] === o.id} onChange={() => setAnswers({ ...answers, [q.id]: o.id })} className="mt-1 shrink-0 accent-primary-500" />
              {o.label}
            </label>)}
          </fieldset>)}
          <p className="text-sm leading-relaxed text-foreground-600">С бутона по-долу приемаш <a href="#driver-terms" onClick={() => { const element = document.querySelector<HTMLDetailsElement>('#driver-terms'); if (element) element.open = true; }} className="underline">Условията за шофьори</a> и <Link to="/terms" target="_blank" rel="noopener noreferrer" className="underline">Общите условия</Link>, потвърждаваш, че си запознат с <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="underline">Политиката за поверителност</Link> и че премина тази подготовка. Приемаш описаното разпределение на отговорността, без отказ от задължителните си права. Това не е съгласие за реклама.</p>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy || !allAnswered} className="w-full rounded-xl bg-primary-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Записване…' : 'Приеми условията и завърши подготовката'}</button>
          <button type="button" disabled={busy} onClick={() => setStep(0)} className="text-sm underline text-foreground-600">Прегледай обучението отново</button>
        </form>}
      </>}
    </section>
    <details id="driver-terms" className="rounded-2xl bg-white p-5">
      <summary className="cursor-pointer font-semibold text-foreground-950">Условия за шофьори · {d.termsVersion}</summary>
      <div className="mt-4"><DriverTermsDocument document={d} /></div>
    </details>
    {receipt && <details className="rounded-2xl bg-white p-5">
      <summary className="cursor-pointer font-semibold text-foreground-950">Преглед на обучението</summary>
      <div className="mt-4 space-y-4">{d.steps.map(s => <section key={s.id} className="space-y-2"><h3 className="font-semibold">{s.title}</h3>{s.paragraphs.map((p, i) => <p key={i} className="text-sm leading-relaxed text-foreground-700">{p}</p>)}</section>)}</div>
    </details>}
    <button type="button" onClick={download} className="text-sm underline text-primary-700">{receipt ? 'Изтегли условията и записа за приемане' : 'Изтегли копие преди приемане'}</button>
    <p className="text-xs text-foreground-500">Условия {d.termsVersion} · Обучение {d.trainingVersion}</p>
  </div>;
}
export default function DriverPreparation() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const query = useQuery(driverPreparationOptions(user?.id));
  return <div className="min-h-screen bg-background-50">
    <header className="sticky top-0 z-50 bg-white px-4 py-3 flex items-center gap-3">
      <button type="button" aria-label="Назад към профила" onClick={() => navigate('/driver/profile')} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-background-100"><i className="ri-arrow-left-line text-lg" aria-hidden="true" /></button>
      <h1 className="font-heading text-lg font-bold text-foreground-950">Подготовка за шофьори</h1>
    </header>
    <main className="mx-auto max-w-2xl p-4 pb-8">
      {query.isPending ? <p role="status">Зареждаме условията и обучението…</p> : query.isError || !query.data ? <div role="alert" className="space-y-3 text-sm">
        <p>Не успяхме да заредим актуалната подготовка. Приемането не е потвърдено.</p>
        <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="underline text-primary-700">Опитай отново</button>
      </div> : user && <PreparationForm key={user.id + ':' + query.data.content_hash} materials={query.data} userId={user.id} />}
    </main>
  </div>;
}
