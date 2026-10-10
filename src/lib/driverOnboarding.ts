import { queryOptions } from '@tanstack/react-query';
import { legalOperator } from '@/config/legal';
import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import { DOCUMENT_BUCKET, workflowError } from './driverDocuments';
import { parsePreparationContent, type PreparationContent } from './driverPreparation';
import { documentExpired } from './legalWorkflow';
import type { Json, Tables } from './database.types';

export type ApplicationDocumentKind = 'license' | 'insurance' | 'vehicle_registration';
export const applicationDocumentLabels = { license: 'Шофьорска книжка', insurance: 'Застраховка на автомобила', vehicle_registration: 'Свидетелство за регистрация на автомобила' };
export type ApplicationDocument = { id: string; application_id: string; company_id: string; user_id: string; type: ApplicationDocumentKind; expires_at: string | null; file_url: string };
export type VehicleDetails = { make: string; model: string; registration_number: string; insurance_expiry_date: string; inspection_expiry_date: string };
export type Onboarding = { application: Tables<'driver_applications'>; company_name: string; documents: ApplicationDocument[]; preparation: PreparationContent };
export const onboardingKey = (applicationId: string) => ['driver-onboarding', applicationId] as const;
const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const isId = (v: unknown): v is string => typeof v === 'string' && new RegExp(`^${uuid}$`, 'i').test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
const kinds = new Set(['license', 'insurance', 'vehicle_registration']);
export function parseOnboarding(value: unknown, applicationId: string): Onboarding {
  const fail = () => { throw new Error('Пакетът не е потвърден. Обнови статуса.'); };
  if (!record(value) || !record(value.application)) return fail();
  const a = value.application;
  if (a.id !== applicationId || !isId(a.user_id) || !isId(a.company_id) || !['pending', 'approved', 'rejected'].includes(String(a.status))
    || typeof a.has_vehicle !== 'boolean' || !Number.isSafeInteger(a.onboarding_revision) || Number(a.onboarding_revision) < 0
    || typeof value.company_name !== 'string' || !value.company_name || !Array.isArray(value.documents)) return fail();
  for (const x of value.documents) {
    if (!record(x) || !isId(x.id) || x.application_id !== applicationId || x.user_id !== a.user_id || x.company_id !== a.company_id || !kinds.has(String(x.type))
      || (x.type !== 'vehicle_registration' && !date(x.expires_at)) || (x.type === 'vehicle_registration' && x.expires_at !== null)
      || typeof x.file_url !== 'string' || !new RegExp(`^storage://${DOCUMENT_BUCKET}/${a.user_id}/${applicationId}/${x.id}\\.(jpg|png|webp|pdf)$`).test(x.file_url)) return fail();
  }
  const prep = parsePreparationContent(value.preparation);
  if (prep.receipt && (!record(value.preparation) || !record(value.preparation.receipt) || value.preparation.receipt.application_id !== applicationId
    || prep.receipt.user_id !== a.user_id || prep.receipt.company_id !== a.company_id)) return fail();
  return value as unknown as Onboarding;
}
export function onboardingOptions(applicationId: string) {
  return queryOptions({ queryKey: onboardingKey(applicationId), staleTime: 15_000, retry: 1,
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => supabase.rpc('driver_onboarding', { p_application: applicationId }).abortSignal(abort), 10_000, signal);
      if (error) throw error;
      return parseOnboarding(data, applicationId);
    },
  });
}
export async function acceptApplicationPreparation(bundle: Onboarding, answers: Record<string, string>) {
  const a = bundle.application, p = bundle.preparation;
  const { data, error } = await withRequestTimeout(signal => supabase.rpc('accept_application_preparation', {
    p_application: a.id, p_terms: p.document.termsVersion, p_training: p.document.trainingVersion, p_hash: p.content_hash,
    p_answers: answers, p_general_terms: legalOperator.termsVersion, p_general_privacy: legalOperator.privacyVersion,
  }).abortSignal(signal));
  if (error) throw error;
  const receipt = parsePreparationContent({ ...p, receipt: data }).receipt;
  if (!receipt || receipt.user_id !== a.user_id || receipt.company_id !== a.company_id || !record(data) || data.application_id !== a.id || !isId(data.general_acceptance_id)) {
    throw new Error('Приемането не е потвърдено за текущата кандидатура.');
  }
}
export async function saveApplicationVehicle(a: Onboarding['application'], hasVehicle: boolean, details: VehicleDetails | null) {
  const { data, error } = await withRequestTimeout(signal => supabase.rpc('save_application_vehicle', { p_application: a.id, p_has_vehicle: hasVehicle, p_details: details as Json | null }).abortSignal(signal));
  if (error) throw error;
  if (data !== a.id) throw new Error('Автомобилът не е потвърден.');
}
export async function submitOnboarding(a: Onboarding['application']) {
  const { data, error } = await withRequestTimeout(signal => supabase.rpc('submit_driver_onboarding', { p_application: a.id, p_revision: a.onboarding_revision }).abortSignal(signal));
  if (error) throw error;
  if (data !== a.id) throw new Error('Изпращането не е потвърдено.');
}

type Upload = { id: string; applicationId: string; companyId: string; userId: string; type: ApplicationDocumentKind; expires: string | null; path: string; digest: string };
const key = (a: Onboarding['application'], type: ApplicationDocumentKind) => `leski:application-upload:${a.id}:${a.company_id}:${type}`;
const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
export function pendingApplicationUpload(a: Onboarding['application'], type: ApplicationDocumentKind): Upload | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(a, type)) ?? 'null');
    if (v?.applicationId === a.id && v.companyId === a.company_id && v.userId === a.user_id && v.type === type && isId(v.id)
      && (type === 'vehicle_registration' ? v.expires === null : date(v.expires)) && /^[0-9a-f]{64}$/.test(v.digest)
      && new RegExp(`^${a.user_id}/${a.id}/${v.id}\\.(jpg|png|webp|pdf)$`).test(v.path)) return v;
  } catch { /* No file bytes or access token are persisted. */ }
  return null;
}
export async function prepareApplicationUpload(a: Onboarding['application'], type: ApplicationDocumentKind, expires: string | null, file: File): Promise<Upload> {
  if (!extensions[file.type] || !file.size || file.size > 5 * 1024 * 1024) throw new Error('Избери JPG, PNG, WebP или PDF до 5 MB.');
  if (type !== 'vehicle_registration' && (!date(expires) || documentExpired(expires))) throw new Error('Посочи валиден срок.');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('');
  const previous = pendingApplicationUpload(a, type);
  if (previous) {
    if (previous.digest !== digest || previous.expires !== expires) throw new Error('Провери непотвърденото качване или избери същия файл.');
    return previous;
  }
  const id = crypto.randomUUID();
  const result = { id, applicationId: a.id, companyId: a.company_id, userId: a.user_id, type, expires: type === 'vehicle_registration' ? null : expires, digest, path: `${a.user_id}/${a.id}/${id}.${extensions[file.type]}` };
  try { localStorage.setItem(key(a, type), JSON.stringify(result)); }
  catch { throw new Error('Разреши данните за сайта, за да възстановим качването при прекъсване.'); }
  return result;
}
export async function registerApplicationUpload(a: Onboarding['application'], upload: Upload) {
  const { data, error } = await withRequestTimeout(signal => supabase.rpc('register_application_document', {
    p_application: a.id, p_id: upload.id, p_type: upload.type, p_expires: upload.expires, p_path: upload.path,
  }).abortSignal(signal));
  if (error) throw error;
  if (data !== upload.id) throw new Error('Документът не е потвърден.');
  try { if (pendingApplicationUpload(a, upload.type)?.id === upload.id) localStorage.removeItem(key(a, upload.type)); } catch { /* Server confirmation succeeded. */ }
}
export async function uploadApplicationDocument(a: Onboarding['application'], upload: Upload, file: File) {
  let uploadError: unknown;
  try {
    const { error } = await withRequestTimeout(() => supabase.storage.from(DOCUMENT_BUCKET).upload(upload.path, file, { upsert: false, cacheControl: '0', contentType: file.type }), 30_000);
    if (error) throw error;
  } catch (e) { uploadError = e; }
  try { await registerApplicationUpload(a, upload); }
  catch (e) { throw new Error(workflowError(uploadError ?? e, 'Качването не е потвърдено.') + ' Провери го преди повторен опит.'); }
}
