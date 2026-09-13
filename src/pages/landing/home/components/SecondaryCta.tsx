import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Reveal from '@/pages/landing/components/Reveal';

export default function SecondaryCta() {
  const { t } = useTranslation();

  return (
    <section className="bg-background-50 py-28 md:py-44">
      <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-3xl text-center">
        <Reveal>
          <h2 className="font-heading font-medium text-foreground-950 text-2xl md:text-4xl leading-snug tracking-tight mb-10 md:mb-12">
            {t('landing.cta2_line')}
          </h2>
          <Link
            to="/auth/login"
            className="inline-flex items-center justify-center px-10 py-4 rounded-full bg-accent-500 hover:bg-accent-600 active:scale-[0.98] text-white font-semibold text-base md:text-lg tracking-wide transition-all whitespace-nowrap cursor-pointer"
          >
            {t('landing.cta2_button')}
          </Link>
          <div className="mt-10">
            <Link
              to="/driver-join"
              className="text-sm text-foreground-400 underline underline-offset-4 hover:text-foreground-700 transition-colors"
            >
              {t('landing.cta2_sub')}
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}