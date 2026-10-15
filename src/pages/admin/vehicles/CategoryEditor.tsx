import Modal from '@/components/feature/Modal';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { workflowError } from '@/lib/driverDocuments';
import { SERVICE_CLASSES } from '@/lib/marketplace';
import type { Tables } from '@/lib/database.types';
type Category = Tables<'vehicle_types'>;
const empty = { name: '', service_class: 'standard', capacity: '4', multiplier: '1', is_active: true };

export default function CategoryEditor({ companyId, categories, disabled, createRequest, onSaved }: {
  companyId: string; categories: Category[]; disabled: boolean; createRequest: number;
  onSaved: (category: Category) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const saveId = useRef<string>(crypto.randomUUID());
  const latch = useRef(false);
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved;
  const start = (category?: Category) => {
    saveId.current = category?.id ?? crypto.randomUUID(); setEditing(category ?? null); setError('');
    setForm(category ? { name: category.name, service_class: category.service_class ?? 'standard',
      capacity: String(category.capacity), multiplier: String(category.multiplier), is_active: category.is_active } : empty);
    setOpen(true);
  };
  useEffect(() => { if (createRequest) start(); }, [createRequest]);
  const save = async () => {
    if (latch.current || disabled) return;
    const cap = Number(form.capacity), mult = Number(form.multiplier), name = form.name.trim();
    if (name.length < 2 || name.length > 60 || !Number.isInteger(cap) || cap < 1 || cap > 8
      || !form.multiplier.trim() || !Number.isFinite(mult) || mult <= 0 || mult > 10
      || (form.service_class === 'van' ? cap < 5 : cap > 4)) {
      setError('Въведи име, валиден брой места и множител над 0. Ванът е с 5–8 места, останалите категории — до 4.'); return;
    }
    latch.current = true; setSaving(true); setError('');
    try {
      const { data, error: failure } = await withRequestTimeout(signal => supabase.rpc('save_vehicle_category', {
        p_id: saveId.current, p_company: companyId, p_expected_at: (editing?.updated_at ?? null) as string,
        p_details: { ...form, name, capacity: cap, multiplier: mult },
      }).abortSignal(signal));
      if (failure) throw failure;
      const category = Array.isArray(data) ? (data.length === 1 ? data[0] as Category : null) : data;
      if (!category || category.id !== saveId.current || category.company_id !== companyId) throw new Error('Записът не е потвърден. Обнови списъка.');
      onSavedRef.current(category); setOpen(false);
    } catch (cause) { setError(workflowError(cause, 'Записът не е потвърден. Обнови списъка преди повторен опит.')); }
    finally { latch.current = false; setSaving(false); }
  };
  return <>
    <details className="mb-4 rounded-xl border border-background-200 bg-white p-4">
      <summary className="cursor-pointer font-semibold text-sm">Категории автомобили ({categories.length})</summary>
      <p className="text-xs text-foreground-600 mt-3 leading-relaxed">Добави категориите, които фирмата предлага. „Стандарт“ и „Eco“ могат да са в общия клас Стандарт. Класът определя кои заявки получават колите; множителят определя цената по вашата тарифа.</p>
      <ul className="my-3 space-y-2">{categories.map(category => <li key={category.id} className="flex items-center justify-between gap-2 text-sm">
        <span>{category.name} · {SERVICE_CLASSES.find(c => c.id === category.service_class)?.name ?? 'Стандарт'} · ×{category.multiplier}{!category.is_active && ' · Неактивна'}</span>
        <button type="button" disabled={disabled} onClick={() => start(category)} className="underline text-primary-700 disabled:opacity-50" aria-label={`Редактирай категория ${category.name}`}>Редактирай</button>
      </li>)}</ul>
      <button type="button" disabled={disabled} onClick={() => start()} className="text-sm font-semibold text-primary-700 disabled:opacity-50">Добави категория</button>
    </details>
    {open && <Modal label={editing ? 'Редакция на категория' : 'Нова категория'} onClose={() => setOpen(false)} busy={saving} className="max-w-md">
      <section className="bg-white w-full max-w-md rounded-2xl p-5">
        <h2 id="category-title" className="text-lg font-semibold mb-4">{editing ? 'Редакция на категория' : 'Нова категория'}</h2>
        <fieldset disabled={saving} className="space-y-3">
          <label className="block text-sm">Име на категорията<input value={form.name} maxLength={60} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="block border rounded-lg p-3 w-full mt-1" /></label>
          <label className="block text-sm">Клас за заявки<select value={form.service_class} onChange={e => setForm(f => ({ ...f, service_class: e.target.value, capacity: e.target.value === 'van' ? '6' : '4' }))} className="block border rounded-lg p-3 w-full mt-1">{SERVICE_CLASSES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="block text-sm">Места за пътници<input type="number" min="1" max="8" step="1" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} className="block border rounded-lg p-3 w-full mt-1" /></label>
          <label className="block text-sm">Множител на тарифата<input type="number" min="0.01" max="10" step="0.01" value={form.multiplier} onChange={e => setForm(f => ({ ...f, multiplier: e.target.value }))} className="block border rounded-lg p-3 w-full mt-1" /></label>
          <p className="text-xs text-foreground-600">1 запазва основната тарифа; 1.30 означава 30% по-висока цена. Промяната важи за бъдещи оферти.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />Активна категория</label>
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-700 mt-3">{error}</p>}
        <div className="flex gap-3 mt-5"><button type="button" disabled={saving} onClick={() => setOpen(false)} className="flex-1 border rounded-lg p-3">Отказ</button><button type="button" disabled={saving || disabled} onClick={() => void save()} className="flex-1 bg-primary-500 text-white rounded-lg p-3 disabled:opacity-50">{saving ? 'Записване…' : 'Запази категорията'}</button></div>
      </section>
        </Modal>}
  </>;
}
