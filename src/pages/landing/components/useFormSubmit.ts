import { useState } from 'react';

export type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

export function useFormSubmit(submitAddr: string, honeypotName: string) {
  const [status, setStatus] = useState<FormStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const submit = async (formEl: HTMLFormElement) => {
    const formData = new FormData(formEl);
    const honeypot = String(formData.get(honeypotName) || '').trim();
    if (honeypot) {
      setStatus('success');
      formEl.reset();
      return;
    }
    formData.delete(honeypotName);

    setStatus('submitting');
    setErrorMsg('');
    try {
      const response = await fetch(submitAddr, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(formData as unknown as Record<string, string>).toString(),
      });
      const responseText = await response.text();
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
        setErrorMsg(String(serverMsg) || 'Грешка при изпращане. Моля, опитайте отново.');
      }
    } catch {
      setStatus('error');
      setErrorMsg('Мрежова грешка. Моля, опитайте отново.');
    }
  };

  return { status, errorMsg, submit };
}