import { useEffect, useRef, useState } from 'react';
import { BULGARIA_CITIES, LEVSKI_CENTER, type LocationPreset } from '@/lib/geo';
import { getPlaceDetails, hasPlacesApi, searchPlaces, type PlacePrediction } from '@/lib/places';
import { isInBulgaria } from '@/lib/serviceArea';

const presets = [...BULGARIA_CITIES,
  { id: 'gorna-oryahovitsa', name: 'Горна Оряховица', address: 'Горна Оряховица, България', lat: 43.1278, lng: 25.7017 },
  { id: 'levski', name: 'Левски', address: 'Левски, област Плевен', ...LEVSKI_CENTER }];
export default function DivisionZonePicker({ onSelect }: { onSelect: (place: LocationPreset) => void }) {
  const [query, setQuery] = useState(''), [results, setResults] = useState<PlacePrediction[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const needle = query.trim().toLocaleLowerCase('bg');
  const matchingPresets = presets.filter(city => [city.name, city.id, city.address].some(value => value.toLocaleLowerCase('bg').includes(needle)));
  const hasLocalMatches = matchingPresets.length > 0;
  const session = useRef(crypto.randomUUID()), revision = useRef(0), details = useRef<AbortController | null>(null);
  useEffect(() => {
    const lifetime = revision, version = ++lifetime.current, controller = new AbortController();
    setResults([]); setError(''); setBusy(false); details.current?.abort();
    if (query.trim().length < 2 || hasLocalMatches || !hasPlacesApi()) return () => { controller.abort(); ++lifetime.current; };
    const timer = window.setTimeout(async () => {
      setBusy(true);
      try { const data = await searchPlaces(query, session.current, 'bg', controller.signal); if (version === revision.current) setResults(data); }
      catch { if (version === revision.current) setError('Търсенето не е достъпно. Опитай отново.'); }
      finally { if (version === revision.current) setBusy(false); }
    }, 350);
    return () => { controller.abort(); window.clearTimeout(timer); ++lifetime.current; };
  }, [query, hasLocalMatches]);
  useEffect(() => { const lifetime = revision, request = details; return () => { ++lifetime.current; request.current?.abort(); }; }, []);
  async function choose(prediction: PlacePrediction) {
    if (busy) return;
    const version = ++revision.current, controller = new AbortController(); details.current?.abort(); details.current = controller;
    const token = session.current; session.current = crypto.randomUUID(); setBusy(true); setError('');
    try {
      const place = await getPlaceDetails(prediction.place_id, token, 'bg', controller.signal);
      if (version !== revision.current) return;
      if (!place || !isInBulgaria(place.lat, place.lng)) throw new Error('Избери място в България.');
      onSelect(place); setQuery(''); setResults([]);
    } catch { if (version === revision.current) setError('Мястото не е потвърдено. Избери отново.'); }
    finally { if (version === revision.current) setBusy(false); }
  }
  return <div className="space-y-3">
    <label className="block text-sm font-medium">Център на обслужването<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Потърси град или адрес" autoComplete="off" className="block w-full mt-1 rounded-xl border border-background-200 p-3" /></label>
    {busy && <p role="status" className="text-xs text-foreground-500">Търсим местоположение…</p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {results.length > 0 && <div className="max-h-52 overflow-y-auto border border-background-200 rounded-xl">{results.map(result => <button key={result.place_id} type="button" disabled={busy} onClick={() => void choose(result)} className="block w-full text-left p-3 text-sm hover:bg-background-50 disabled:opacity-50">{result.description}</button>)}</div>}
    {hasLocalMatches && <div className="flex flex-wrap gap-2">{matchingPresets.map(city => <button key={city.id} type="button" onClick={() => { ++revision.current; details.current?.abort(); setBusy(false); onSelect(city); }} className="px-3 min-h-11 rounded-xl bg-background-50 border border-background-200 text-xs hover:bg-primary-50">{city.name}</button>)}</div>}
    {!hasPlacesApi() && <p className="text-xs text-foreground-500">Търсенето на адреси не е настроено. Можеш да избереш един от показаните градове.</p>}
  </div>;
}
