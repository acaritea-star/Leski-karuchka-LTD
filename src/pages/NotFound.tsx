import { useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LOGO_URL } from '@/lib/logo';

export default function NotFound() {
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background-50 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <img
          src={LOGO_URL}
          alt="Лески Каручка"
          className="h-20 w-auto mx-auto mb-6 rounded-lg"
        />

        <h1 className="text-5xl font-black text-foreground-200 font-heading select-none mb-2">
          404
        </h1>

        <h2 className="text-lg font-semibold text-foreground-700 mb-2">
          Страницата не е намерена
        </h2>
        <p className="text-sm text-foreground-400 mb-6">
          {location.pathname}
        </p>

        <Link
          to="/"
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary-500 text-white font-medium rounded-xl hover:bg-primary-600 active:scale-[0.98] transition-all whitespace-nowrap"
        >
          <i className="ri-arrow-left-line" />
          {t('back')}
        </Link>
      </div>
    </div>
  );
}