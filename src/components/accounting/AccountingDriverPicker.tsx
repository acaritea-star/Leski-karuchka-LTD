import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Modal from '@/components/feature/Modal';
import { ADMIN_PAGE_SIZE, loadAdminDrivers } from '@/lib/adminData';
import { queryKeys } from '@/lib/queryKeys';

export type AccountingDriver = { id: string; name: string };

/** Loaded only when a company opens the picker; search and paging stay on the server. */
export default function AccountingDriverPicker({ companyId, onChoose, onClose }: {
  companyId: string; onChoose: (driver: AccountingDriver | null) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { searchInput.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const timer = setTimeout(() => { setTerm(search.trim()); setPage(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useQuery({
    queryKey: [...queryKeys.adminDrivers(companyId), term, page],
    queryFn: ({ signal }) => loadAdminDrivers(companyId, term, page, signal),
    staleTime: 30_000,
  });
  const waiting = search.trim() !== term || query.isFetching;
  const total = query.data?.total ?? 0;
  return <Modal label="Избор на шофьор" onClose={onClose} className="max-w-lg">
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-lg font-bold">Избор на шофьор</h2><p className="text-xs text-foreground-500">Само от текущата фирма</p></div>
        <button type="button" aria-label="Затвори избора на шофьор" onClick={onClose} className="min-w-11 min-h-11 rounded-xl hover:bg-background-100">×</button>
      </div>
      <label className="block text-sm font-medium">Име на шофьор
        <input ref={searchInput} type="search" maxLength={80} value={search} onChange={e => setSearch(e.target.value)}
          className="mt-1 w-full min-h-11 rounded-xl border border-background-200 px-3" placeholder="Търси по име…" />
      </label>
      <button type="button" className="w-full min-h-11 rounded-xl border border-background-200 text-left px-3 font-medium" onClick={() => onChoose(null)}>Всички шофьори</button>
      {query.isError ? <div role="alert" className="text-sm text-red-600">Шофьорите не се заредиха. <button className="min-h-11 underline" onClick={() => void query.refetch()}>Опитай отново</button></div>
        : <div aria-busy={waiting} className="divide-y divide-background-100">
          {query.isPending && <p role="status" className="py-4 text-sm text-foreground-500">Зареждане…</p>}
          {!query.isPending && !query.data?.rows.length && <p className="py-4 text-sm text-foreground-500">Няма намерен шофьор.</p>}
          {query.data?.rows.map(driver => {
            const name = `${driver.first_name} ${driver.last_name}`.trim() || `Шофьор ${driver.id.slice(0, 8)}`;
            return <button key={driver.id} type="button" disabled={waiting} onClick={() => onChoose({ id: driver.id, name })}
              className="flex items-center justify-between gap-3 w-full min-h-14 py-3 text-left text-sm hover:text-primary-700 disabled:opacity-50">
              <span className="break-words">{name}</span><span aria-hidden="true">→</span>
            </button>;
          })}
        </div>}
      {total > ADMIN_PAGE_SIZE && <div className="flex items-center justify-between gap-3 text-sm">
        <button className="min-h-11 text-primary-700 disabled:opacity-40" disabled={!page || waiting} onClick={() => setPage(p => p - 1)}>Предишни шофьори</button>
        <span>{page + 1} / {Math.ceil(total / ADMIN_PAGE_SIZE)}</span>
        <button className="min-h-11 text-primary-700 disabled:opacity-40" disabled={(page + 1) * ADMIN_PAGE_SIZE >= total || waiting} onClick={() => setPage(p => p + 1)}>Следващи шофьори</button>
      </div>}
    </div>
  </Modal>;
}
