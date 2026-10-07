import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import { documentExpired } from './legalWorkflow';
export const DOCUMENT_BUCKET = 'driver-documents';
const prefix = `storage://${DOCUMENT_BUCKET}/`;
const mimeExtensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const pathPattern = new RegExp(`^${uuid}/${uuid}\\.(jpg|png|webp|pdf)$`);
export type DocumentUpload = { id: string; userId: string; type: 'license' | 'insurance'; expires: string; path: string; digest: string };
const key = (userId: string) => `leski:document-upload:${userId}`;
export function documentPath(value: string | null): string {
  const path = value?.startsWith(prefix) ? value.slice(prefix.length) : '';
  if (!pathPattern.test(path)) throw new Error('Документът няма защитен файл. Шофьорът трябва да го качи отново.');
  return path;
}
export function loadDocumentUpload(userId: string): DocumentUpload | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(userId)) ?? 'null');
    if (value?.userId === userId && (value.type === 'license' || value.type === 'insurance') &&
      typeof value.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.expires) &&
      typeof value.digest === 'string' && /^[0-9a-f]{64}$/.test(value.digest) &&
      pathPattern.test(value.path) && value.path.startsWith(`${userId}/${value.id}.`)) return value;
  } catch { /* Corrupt or unavailable browser storage. */ }
  return null;
}
export function clearDocumentUpload(userId: string): void { try { localStorage.removeItem(key(userId)); } catch { /* Server confirmation already succeeded. */ } }
export async function prepareDocumentUpload(userId: string, type: DocumentUpload['type'], expires: string, file: File): Promise<DocumentUpload> {
  if (!mimeExtensions[file.type] || file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error('Избери JPG, PNG, WebP или PDF до 5 MB.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || documentExpired(expires)) throw new Error('Посочи валиден срок на документа.');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('');
  const previous = loadDocumentUpload(userId);
  if (previous) {
    if (previous.type !== type || previous.expires !== expires || previous.digest !== digest) throw new Error('Има непотвърдено качване. Провери го или избери същия файл със същия срок.');
    return previous;
  }
  const id = crypto.randomUUID();
  const value = { id, userId, type, expires, digest, path: `${userId}/${id}.${mimeExtensions[file.type]}` };
  // Persist the command before sending bytes, so a lost response or reload can be reconciled.
  try { localStorage.setItem(key(userId), JSON.stringify(value)); }
  catch { throw new Error('Браузърът не позволява запазване на състоянието. Разреши данните за сайта и опитай отново.'); }
  return value;
}
export async function registerDocumentUpload(upload: DocumentUpload): Promise<void> {
  const { data, error } = await withRequestTimeout(signal => supabase.rpc('register_driver_document', {
    p_id: upload.id, p_type: upload.type, p_expires: upload.expires, p_path: upload.path,
  }).abortSignal(signal));
  if (error) throw error;
  if (data !== upload.id) throw new Error('Записът на документа не е потвърден.');
  clearDocumentUpload(upload.userId);
}
export async function uploadDriverDocument(upload: DocumentUpload, file: File): Promise<void> {
  try {
    const { error } = await withRequestTimeout(() => supabase.storage.from(DOCUMENT_BUCKET).upload(upload.path, file, { upsert: false, cacheControl: '0', contentType: file.type }), 30_000);
    if (error) throw error;
  } catch {
    // Upload may have committed. Registration checks that the immutable object exists.
    // A retry uses the same UUID; never overwrite the reviewed file.
  }
  await registerDocumentUpload(upload);
}
export async function signedDocumentUrl(fileUrl: string | null): Promise<string> {
  const path = documentPath(fileUrl);
  const { data, error } = await withRequestTimeout(() => supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, 60));
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('Не успяхме да отворим документа.');
  return data.signedUrl;
}
export function workflowError(error: unknown, fallback: string): string {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : fallback;
}
