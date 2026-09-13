import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LOGO_URL, LOGO_ALT } from '@/lib/logo';

export default function Hero() {
  const { t } = useTranslation();
  const logoRef = useRef<HTMLImageElement>(null);
  const [carReady, setCarReady] = useState(false);

  // The drive-through animation only starts once the logo image is actually
  // loaded/decoded. On mobile networks the image used to arrive after the
  // animation had already finished — the "car" drove by invisibly (iPhone).
  useEffect(() => {
    const img = logoRef.current;
    if (!img) return;
    const start = () => setCarReady(true);
    if (img.complete && img.naturalWidth > 0) {
      start();
      return;
    }
    img.addEventListener('load', start);
    img.addEventListener('error', start);
    return () => {
      img.removeEventListener('load', start);
      img.removeEventListener('error', start);
    };
  }, []);

  return (
    <section className="relative min-h-[100svh] flex items-center justify-center overflow-hidden">
      <div className="w-full px-4 md:px-6 pt-28 pb-20 text-center">
        <div className="max-w-3xl mx-auto">
          <h1 className="flex flex-col items-center gap-5 md:gap-6 mb-6 md:mb-8">
            {/* Logo drive-through wrapper — .hero-car-play is added only after
                the logo image has loaded, so the animation never plays on an
                invisible image. */}
            <div className={`hero-logo-car-wrapper${carReady ? ' hero-car-play' : ''}`}>
              <img
                ref={logoRef}
                src={LOGO_URL}
                alt={LOGO_ALT}
                decoding="async"
                className="hero-logo-car h-20 md:h-24 lg:h-28 w-auto rounded-lg"
              />
            </div>
            <span className="font-heading font-semibold text-foreground-950 text-3xl sm:text-4xl md:text-5xl tracking-tight">
              {t('landing.hero_brand_name')}
            </span>
            <span className="font-heading font-medium text-foreground-950 text-[2.35rem] leading-[1.12] sm:text-5xl sm:leading-[1.08] md:text-6xl lg:text-[4.5rem] tracking-tight">
              {t('landing.hero_brand_line')}
            </span>
          </h1>
          <p className="max-w-xl mx-auto text-sm md:text-base text-foreground-600 leading-relaxed mb-8 md:mb-10">
            {t('landing.hero_subtitle')}
          </p>
          <Link
            to="/auth/login"
            className="inline-flex items-center justify-center px-10 py-4 rounded-full bg-accent-500 hover:bg-accent-600 active:scale-[0.98] text-white font-semibold text-base md:text-lg tracking-wide transition-all whitespace-nowrap cursor-pointer"
          >
            {t('landing.hero_cta_new')}
          </Link>
        </div>
      </div>
    </section>
  );
}