import { useRef, useState } from 'react';
import { withRequestTimeout } from '@/lib/requestTimeout';

export type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

export function useFormSubmit(submitAddr: string, honeypotName: string) {
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const inFlight = useRef(false);

  const submit = async (formEl: HTMLFormElement) => {
    if (inFlight.current) return;
    const formData = new FormData(formEl);
    const honeypot = String(formData.get(honeypotName) || '').trim();
    if (honeypot) {
      setStatus('success');
      formEl.reset();
      return;
    }
    formData.delete(honeypotName);

    inFlight.current = true; setStatus('submitting');
    setErrorMsg('');
    try {
      const { response, responseText } = await withRequestTimeout(async signal => {
        const response = await fetch(submitAddr, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(formData as unknown as Record<string, string>).toString(),
        signal,
        });
        return { response, responseText: await response.text() };
      }, 15_000);
      let parsed: { code?: string; meta?: { message?: string; detail?: string }; message?: string } | null = null;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        parsed = null;
      }
      const serverMsg =
        parsed?.meta?.message || parsed?.message || parsed?.meta?.detail || responseText || '';
      const successCode = parsed?.code === 'OK';
      const isSpam = typeof serverMsg === 'string' && serverMsg.toLowerCase().includes('spam');

      if (response.ok && successCode && !isSpam) {
        setStatus('success');
        formEl.reset();
      } else {
        setStatus('error');
        const message = typeof serverMsg === 'string' && !/[<>]/.test(serverMsg) ? serverMsg.trim().slice(0, 300) : '';
        setErrorMsg(message || 'Изпращането не е потвърдено. Данните са запазени. Опитай отново.');
      }
    } catch {
      setStatus('error');
      setErrorMsg('Изпращането не е потвърдено. Провери връзката. Данните са запазени.');
    } finally { inFlight.current = false; }
  };

  return { status, errorMsg, submit };
}
