import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LOGO_URL } from '@/lib/logo';

export default function LandingFooter() {
  const { t } = useTranslation();

  const companyLinks = [
    { to: '/', label: t('landing.nav_home') },
    { to: '/about', label: t('landing.nav_about') },
    { to: '/pricing', label: t('landing.nav_pricing') },
    { to: '/driver-join', label: t('landing.nav_driver') },
    { to: '/novini', label: t('landing.nav_news') },
    { to: '/contact', label: t('landing.nav_contact') },
  ];

  return (
    <footer className="bg-background-100 border-t border-background-200">
      <div className="mx-auto w-full px-4 md:px-6 lg:px-10 py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Brand */}
          <div>
            <Link to="/" className="inline-flex items-center mb-5">
              <img src={LOGO_URL} alt="Лески Каручка" className="h-9 w-auto rounded-lg" />
            </Link>
            <p className="text-sm text-foreground-500 leading-relaxed mb-6">
              {t('landing.footer_tagline')}
            </p>
            <p className="text-xs text-foreground-400">{t('landing.service_area_label')}</p>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-heading font-semibold text-foreground-950 mb-5 text-xs uppercase tracking-[0.25em]">
              {t('landing.footer_company')}
            </h4>
            <ul className="space-y-3">
              {companyLinks.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="text-sm text-foreground-500 hover:text-primary-600 transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-heading font-semibold text-foreground-950 mb-5 text-xs uppercase tracking-[0.25em]">
              Правна информация
            </h4>
            <ul className="space-y-3">
              <li>
                <Link to="/terms" className="text-sm text-foreground-500 hover:text-primary-600 transition-colors">
                  Общи условия
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="text-sm text-foreground-500 hover:text-primary-600 transition-colors">
                  Политика за поверителност
                </Link>
              </li>
              <li>
                <Link to="/cookies" className="text-sm text-foreground-500 hover:text-primary-600 transition-colors">
                  Бисквитки
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-heading font-semibold text-foreground-950 mb-5 text-xs uppercase tracking-[0.25em]">
              {t('landing.footer_contact')}
            </h4>
            <ul className="space-y-3 text-sm text-foreground-500">
              <li className="flex items-start gap-2.5">
                <i className="ri-map-pin-2-line text-primary-600 mt-0.5" />
                <span>{t('landing.footer_address')}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <i className="ri-phone-line text-primary-600 mt-0.5" />
                <a href="tel:+359890005900" className="hover:text-primary-600 transition-colors whitespace-nowrap">
                  {t('landing.footer_phone')}
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <i className="ri-mail-line text-primary-600 mt-0.5" />
                <a href="mailto:info@leski-karuchka.bg" className="hover:text-primary-600 transition-colors">
                  {t('landing.footer_email')}
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-background-200">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 py-5 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-foreground-400 whitespace-nowrap">
            © 2026 Лески Каручка · Левски 5900
          </p>
          <p className="text-xs text-foreground-400">{t('landing.footer_rights')}</p>
        </div>
      </div>
    </footer>
  );
}