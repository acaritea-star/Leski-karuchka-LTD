import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import { slugify } from './news';
import type { TablesInsert } from './database.types';

export interface CompanyForm {
  name: string; phone: string; email: string; address: string;
  base_fare: string; price_per_km: string; price_per_minute: string; dispatch_radius_km: string;
}
export function companyPayload(form: CompanyForm, id: string): TablesInsert<'companies'> {
  const name = form.name.trim();
  if (!name || name.length > 200) throw new Error('Въведете име на фирма до 200 символа.');
  const values = [form.base_fare, form.price_per_km, form.price_per_minute, form.dispatch_radius_km].map(value => {
    const text = value.trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Въведете валидни неотрицателни цени и радиус.');
    const n = Number(text);
    if (!Number.isFinite(n) || n > 1_000_000) throw new Error('Проверете цените и радиуса.');
    return n;
  });
  if (values[3] <= 0) throw new Error('Радиусът трябва да е по-голям от нула.');
  return { id, name, slug: `${slugify(name).slice(0, 80) || 'company'}-${id}`,
    phone: form.phone.trim(), email: form.email.trim(), address: form.address.trim(), currency: 'EUR',
    base_fare: values[0], price_per_km: values[1], price_per_minute: values[2], dispatch_radius_km: values[3], is_active: true };
}

/** A lost response must not create a second company. Keep the caller's UUID
 * until a confirmed read/write; on retry the same primary key is used. */
export async function createCompany(payload: TablesInsert<'companies'> & { id: string }): Promise<void> {
  try {
    const { data, error } = await withRequestTimeout(signal => supabase.from('companies').insert(payload)
      .select('id').abortSignal(signal).single(), 15_000);
    if (error) throw error;
    if (data?.id !== payload.id) throw new Error('Създаването на фирмата не е потвърдено.');
  } catch (cause) {
    const { data, error } = await withRequestTimeout(signal => supabase.from('companies')
      .select('id').eq('id', payload.id).abortSignal(signal).maybeSingle(), 5000);
    if (error || data?.id !== payload.id) throw cause;
  }
}
