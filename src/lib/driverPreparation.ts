import type source from '@/config/driverPreparation.json';
import { legalOperator } from '@/config/legal';
import { queryOptions } from '@tanstack/react-query';
import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';

export type DriverPreparationDocument = typeof source;
export type DriverPreparationReceipt = {
  id: string; driver_id: string; user_id: string; company_id: string;
  terms_version: string; training_version: string; content_hash: string;
  accepted_at: string; training_completed_at: string;
};
export type DriverPreparationMaterials = {
  driver_id: string; user_id: string; company_id: string; document: DriverPreparationDocument; content_hash: string;
  receipt: DriverPreparationReceipt | null;
};
export const preparationKey = (userId: string | undefined) => ['driver-preparation', userId] as const;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const instant = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value));
const hash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export function parseDriverPreparation(value: unknown, driverId?: string): DriverPreparationMaterials {
  const fail = () => { throw new Error('Не успяхме да потвърдим подготовката. Обнови страницата.'); };
  if (!object(value) || !uuid(value.driver_id) || !uuid(value.user_id) || !uuid(value.company_id) || (driverId && value.driver_id !== driverId) || !hash(value.content_hash) || !object(value.document)) return fail();
  const d = value.document;
  if (![d.termsVersion, d.trainingVersion, d.title, d.intro, d.updatedAt].every(text)) return fail();
  for (const key of ['sections', 'steps']) {
    const items = d[key];
    if (!Array.isArray(items) || !items.length || items.length > 30 || !items.every(item => object(item)
      && text(item.id) && text(item.title) && Array.isArray(item.paragraphs) && item.paragraphs.length > 0 && item.paragraphs.every(text))) return fail();
  }
  if (!Array.isArray(d.questions) || !d.questions.length || d.questions.length > 10 || !d.questions.every(item => object(item)
    && text(item.id) && text(item.title) && Array.isArray(item.options) && item.options.length >= 2
    && item.options.every(option => object(option) && text(option.id) && text(option.label)))) return fail();
  if (value.receipt !== null) {
    const receipt = parsePreparationReceipt(value.receipt, value.driver_id, d.termsVersion as string, d.trainingVersion as string, value.content_hash);
    if (receipt.user_id !== value.user_id || receipt.company_id !== value.company_id) return fail();
  }
  return value as unknown as DriverPreparationMaterials;
}

export function parsePreparationReceipt(value: unknown, driverId: string, terms: string, training: string, contentHash: string): DriverPreparationReceipt {
  if (!object(value) || !uuid(value.id) || !uuid(value.user_id) || !uuid(value.company_id)
    || value.driver_id !== driverId || value.terms_version !== terms || value.training_version !== training
    || value.content_hash !== contentHash || !instant(value.accepted_at) || !instant(value.training_completed_at)) {
    throw new Error('Приемането още не е потвърдено от сървъра. Обнови статуса преди повторен опит.');
  }
  return value as DriverPreparationReceipt;
}

export function driverPreparationOptions(userId: string | undefined) {
  return queryOptions({
    queryKey: preparationKey(userId), enabled: !!userId, staleTime: 60_000, retry: 1,
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => supabase.rpc('driver_preparation_materials').abortSignal(abort), 10_000, signal);
      if (error) throw error;
      const materials = parseDriverPreparation(data);
      if (materials.user_id !== userId) throw new Error('Подготовката не е за текущия профил.');
      return materials;
    },
  });
}

export async function completeDriverPreparation(materials: DriverPreparationMaterials, answers: Record<string, string>, userId: string) {
  // One idempotent server transaction pins the real driver and saves all legal
  // acceptance and training together. No partial local success or double writes.
  const { document: d } = materials;
  const { data, error } = await withRequestTimeout(signal => supabase.rpc('accept_driver_preparation', {
    p_driver: materials.driver_id, p_terms: d.termsVersion, p_training: d.trainingVersion,
    p_hash: materials.content_hash, p_answers: answers,
    p_general_terms: legalOperator.termsVersion, p_general_privacy: legalOperator.privacyVersion,
  }).abortSignal(signal), 10_000);
  if (error) throw error;
  const receipt = parsePreparationReceipt(data, materials.driver_id, d.termsVersion, d.trainingVersion, materials.content_hash);
  if (receipt.user_id !== userId || receipt.company_id !== materials.company_id) throw new Error('Записът не е за текущия профил или фирма.');
  if (!object(data) || !uuid(data.general_acceptance_id)) throw new Error('Общите условия не са потвърдени.');
  const generalAcceptanceId = data.general_acceptance_id;
  return { receipt, generalAcceptanceId, legalKey: ['legal-acceptance', userId, legalOperator.termsVersion, legalOperator.privacyVersion] };
}

export function preparationCopy(materials: DriverPreparationMaterials): string {
  const d = materials.document;
  return [
    d.title, 'leskikaruchka.com', 'Версия на условията: ' + d.termsVersion,
    'Версия на обучението: ' + d.trainingVersion, 'SHA-256 на публикувания източник: ' + materials.content_hash,
    materials.receipt ? 'Прието: ' + materials.receipt.accepted_at + '\nОбучение завършено: ' + materials.receipt.training_completed_at
      + '\nЗапис: ' + materials.receipt.id + '\nПрофил: ' + materials.receipt.user_id + '\nФирма: ' + materials.receipt.company_id : 'Тази версия още не е приета.',
    d.intro, ...d.sections.map(s => s.title + '\n' + s.paragraphs.join('\n\n')),
    'Кратко обучение', ...d.steps.map(s => s.title + '\n' + s.paragraphs.join('\n\n')),
    'Проверка за разбиране', ...d.questions.map(q => q.title + '\n' + q.options.map(o => '• ' + o.label).join('\n')),
    'Общи условия: https://leskikaruchka.com/terms', 'Поверителност: https://leskikaruchka.com/privacy',
  ].join('\n\n');
}
