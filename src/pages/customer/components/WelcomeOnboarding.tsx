import { useTranslation } from 'react-i18next';
import Modal from '@/components/feature/Modal';

const STEPS = [
  { titleKey: 'welcome_step_1_title', descKey: 'welcome_step_1_desc' },
  { titleKey: 'welcome_step_2_title', descKey: 'welcome_step_2_desc' },
  { titleKey: 'welcome_step_3_title', descKey: 'welcome_step_3_desc' },
];

export default function WelcomeOnboarding({ firstName, onClose }: { firstName: string; onClose: () => void }) {
  const { t } = useTranslation();
  return <Modal label={t('welcome_title')} onClose={onClose} className="max-w-sm">
    <div className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-700">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 10 7 5h10l2 5M5 10h14v9H5zM9 5V3h6v2M8 19v2m8-2v2M8 14h1m6 0h1" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <button type="button" onClick={onClose} aria-label={t('welcome_close')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground-500 hover:bg-background-100">
          <span aria-hidden="true" className="text-2xl">×</span>
        </button>
      </div>
      <h2 className="mt-4 font-heading text-2xl font-bold leading-tight text-foreground-950">
        {t('welcome_title')}{firstName ? `, ${firstName}` : ''}!
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-foreground-600">{t('welcome_subtitle')}</p>
      <ol className="my-5 space-y-4">
        {STEPS.map((step, i) => <li key={step.titleKey} className="flex gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background-100 text-sm font-bold text-primary-700">{i + 1}</span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground-900">{t(step.titleKey)}</h3>
            <p className="mt-1 text-xs leading-relaxed text-foreground-600">{t(step.descKey)}</p>
          </div>
        </li>)}
      </ol>
      <div className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 p-3">
        <span aria-hidden="true" className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-bold text-red-700">112 ↗</span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-red-800">{t('welcome_emergency_title')}</h3>
          <p className="mt-1 text-xs leading-relaxed text-red-800">{t('welcome_emergency_desc')}</p>
        </div>
      </div>
      <button type="button" onClick={onClose}
        className="mt-5 min-h-12 w-full rounded-2xl bg-primary-500 px-4 py-3 text-sm font-bold text-white hover:bg-primary-600">
        {t('welcome_cta')}
      </button>
    </div>
  </Modal>;
}
