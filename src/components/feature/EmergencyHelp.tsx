import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import Modal from './Modal';

/** A device dialer link, independent of GPS, maps and the application network. */
export default function EmergencyHelp() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-label={t('emergency_open')} title={t('emergency_open')} onClick={() => setOpen(true)}
      className="inline-flex items-center justify-center shrink-0 min-w-11 h-11 rounded-xl border border-red-200 bg-red-50 px-2 text-xs font-bold text-red-700 hover:bg-red-100">
      <span aria-hidden="true">112</span>
    </button>
    {open && <Modal label={t('emergency_title')} onClose={() => setOpen(false)} className="max-w-sm">
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">{t('emergency_title')}</h2>
          <button type="button" aria-label={t('emergency_close')} onClick={() => setOpen(false)} className="min-w-11 min-h-11 rounded-xl hover:bg-background-100">×</button></div>
        <p className="text-sm text-foreground-700">{t('emergency_description')}</p>
        <a href="tel:112" className="flex items-center justify-center gap-3 min-h-14 rounded-xl bg-red-700 px-4 py-3 font-bold text-white hover:bg-red-800">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L9 11a16 16 0 0 0 4 4l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" /></svg>
          {t('emergency_call')}
        </a>
        <p className="text-xs text-foreground-500">{t('emergency_dialer_note')}</p>
        <button type="button" onClick={() => setOpen(false)} className="w-full min-h-11 rounded-xl border border-background-200 text-sm font-medium">{t('emergency_back')}</button>
      </div>
    </Modal>}
  </>;
}
