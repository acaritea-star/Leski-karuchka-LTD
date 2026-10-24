import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function BackButton({ to }: { to: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return <button type="button" data-route={to} onClick={() => navigate(to)} aria-label={t('back')}
    className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl hover:bg-background-100 transition-colors cursor-pointer">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h12" /></svg>
  </button>;
}
