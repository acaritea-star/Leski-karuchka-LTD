import { useRef, useState } from 'react';
import Modal from '@/components/feature/Modal';
import type { LocationPreset } from '@/lib/geo';
import { saveCompanyDivision, validateDivisionDraft, type CompanyDivision } from '@/lib/companyDivisions';
import { workflowError } from '@/lib/driverDocuments';
import DivisionZonePicker from './DivisionZonePicker';

export default function DivisionEditor({ parent, previous, onClose, onSaved, onRefresh }: {
  parent: { id: string; name: string }; previous?: CompanyDivision; onClose: () => void; onSaved: (row: CompanyDivision) => void; onRefresh: () => void;
}) {
  const [city, setCity] = useState(previous?.service_city ?? ''), [name, setName] = useState(previous?.name ?? ''), [radius, setRadius] = useState(String(previous?.service_radius_km ?? 5));
  const [point, setPoint] = useState<LocationPreset | null>(() => previous?.service_latitude != null && previous.service_longitude != null
    ? { id: previous.id, name: 'Запазен център на зоната', address: previous.service_city ?? '', lat: previous.service_latitude, lng: previous.service_longitude } : null);
  const [choosingPoint, setChoosingPoint] = useState(!point), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const latch = useRef(false), intent = useRef<{ signature: string; id: string } | null>(null);
  return <Modal label={previous ? 'Редактирай подразделение' : 'Добави градско подразделение'} onClose={onClose} busy={busy} className="max-w-xl">
    <form className="p-5 space-y-5" onSubmit={async e => {
      e.preventDefault(); if (latch.current) return;
      setError('');
      try {
        if (!point || choosingPoint) throw new Error('Избери център на зоната за обслужване.');
        const draft = validateDivisionDraft({ name: name || `${parent.name} — ${city}`, service_city: city, service_latitude: point.lat, service_longitude: point.lng, service_radius_km: radius.trim() ? Number(radius) : NaN });
        const signature = JSON.stringify(draft);
        if (!intent.current || intent.current.signature !== signature) intent.current = { signature, id: previous?.id ?? crypto.randomUUID() };
        latch.current = true; setBusy(true);
        const row = await saveCompanyDivision(parent.id, intent.current.id, draft, previous);
        onSaved(row);
      } catch (error) { setError(workflowError(error, 'Записът не е потвърден. Провери списъка преди нов опит.')); }
      finally { latch.current = false; setBusy(false); }
    }}>
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-heading text-lg font-semibold">{previous ? 'Редактирай подразделение' : 'Добави градско подразделение'}</h2><p className="text-sm text-foreground-500 mt-1">Към {parent.name}</p></div><button type="button" onClick={onClose} aria-label="Затвори" className="min-w-11 min-h-11 rounded-xl hover:bg-background-50">×</button></div>
      <label className="block text-sm font-medium">Град<input required maxLength={100} value={city} onChange={e => setCity(e.target.value)} placeholder="Например Горна Оряховица" className="block w-full mt-1 p-3 border border-background-200 rounded-xl" /></label>
      <label className="block text-sm font-medium">Име за клиентите<input required maxLength={120} value={name || `${parent.name}${city ? ' — ' + city : ''}`} onChange={e => setName(e.target.value)} className="block w-full mt-1 p-3 border border-background-200 rounded-xl" /></label>
      {point && !choosingPoint && <div className="bg-primary-50 rounded-xl p-3 text-sm"><p className="font-medium">Избран център</p><p className="break-words">{point.address || point.name}</p><button type="button" onClick={() => setChoosingPoint(true)} className="mt-2 min-h-11 underline text-primary-700">Промени центъра</button></div>}
      {choosingPoint && <DivisionZonePicker onSelect={place => { setPoint(place); setChoosingPoint(false); if (!city && !place.id.startsWith('gmap-')) setCity(place.name); }} />}
      <label className="block text-sm font-medium">Радиус на обслужваната зона (км)<input required type="number" min="0.5" max="30" step="0.5" value={radius} onChange={e => setRadius(e.target.value)} className="block w-full mt-1 p-3 border border-background-200 rounded-xl" /></label>
      <p className="text-xs text-foreground-500">Зоната определя откъде подразделението приема клиенти. При застъпване се избира най-близкият център. Разрешенията трябва да покриват обслужваната територия. Шофьорите и отчетите остават отделни.</p>
      {!previous && <p className="text-sm text-foreground-600">Новото подразделение започва в подготовка. След това попълваш реалните разрешения и тарифи; шофьорите преминават одобрение.</p>}
      {error && <div role="alert" className="text-sm text-red-600 space-y-2"><p>{error}</p><button type="button" onClick={() => { onRefresh(); onClose(); }} className="underline min-h-11">Провери списъка</button></div>}
      <button disabled={busy} className="w-full min-h-12 bg-primary-500 text-white rounded-xl font-semibold disabled:opacity-50">{busy ? 'Запазваме…' : previous ? 'Запази подразделението' : 'Създай подразделение'}</button>
    </form>
  </Modal>;
}
