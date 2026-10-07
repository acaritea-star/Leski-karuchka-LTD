// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { documentPath, loadDocumentUpload, registerDocumentUpload, signedDocumentUrl, uploadDriverDocument, type DocumentUpload } from './driverDocuments';
const mock = vi.hoisted(() => ({ upload: vi.fn(), createSignedUrl: vi.fn(), rpc: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { rpc: mock.rpc, storage: { from: () => mock } } }));
const owner = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const command: DocumentUpload = { userId: owner, id, type: 'license', expires: '2099-01-01', digest: 'a'.repeat(64), path: `${owner}/${id}.pdf` };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mock.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: id, error: null }) }); });
describe('private document delivery', () => {
  it.each(['https://evil.example/document', 'javascript:alert(1)', `storage://driver-documents/${owner}/../private.pdf`])('rejects unsafe file URLs %s', url => { expect(() => documentPath(url)).toThrow(); });
  it('scopes persisted retry to its authenticated owner', () => { localStorage.setItem(`leski:document-upload:${owner}`, JSON.stringify(command)); expect(loadDocumentUpload(owner)).toEqual(command); expect(loadDocumentUpload(id)).toBeNull(); });
  it('reconciles a committed upload after a lost response, with the same document ID', async () => {
    localStorage.setItem(`leski:document-upload:${owner}`, JSON.stringify(command));
    mock.upload.mockRejectedValue(new Error('Lost response'));
    await uploadDriverDocument(command, new File(['test'], 'test.pdf', { type: 'application/pdf' }));
    expect(mock.upload).toHaveBeenCalledWith(command.path, expect.any(File), expect.objectContaining({ upsert: false }));
    expect(mock.rpc).toHaveBeenCalledWith('register_driver_document', expect.objectContaining({ p_id: id, p_path: command.path }));
    expect(loadDocumentUpload(owner)).toBeNull();
  });
  it('retains the retry command if registration is not confirmed', async () => {
    localStorage.setItem(`leski:document-upload:${owner}`, JSON.stringify(command));
    mock.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: null, error: { message: 'No object' } }) });
    await expect(registerDocumentUpload(command)).rejects.toMatchObject({ message: 'No object' });
    expect(loadDocumentUpload(owner)).toEqual(command);
  });
  it('requests a short-lived signed URL, never a public URL', async () => {
    mock.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.example/signed' }, error: null });
    expect(await signedDocumentUrl(`storage://driver-documents/${command.path}`)).toBe('https://storage.example/signed');
    expect(mock.createSignedUrl).toHaveBeenCalledWith(command.path, 60);
  });
});
