import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import LandingFooter from './LandingFooter';
import CookieConsent from '@/components/feature/CookieConsent';
import { LOGO_URL } from '@/lib/logo';

function roleHomePath(role?: string): string {
  if (role === 'DRIVER') return '/driver/home';
  if (role === 'SUPER_ADMIN') return '/admin/dashboard';
  return '/customer/home';
}

export default function LandingLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const isHome = location.pathname === '/';
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const overlay = isHome && !scrolled && !menuOpen;

  const links = [
    { to: '/', label: t('landing.nav_home') },
    { to: '/about', label: t('landing.nav_about') },
    { to: '/pricing', label: t('landing.nav_pricing') },
    { to: '/driver-join', label: t('landing.nav_driver') },
    { to: '/novini', label: t('landing.nav_news') },
    { to: '/contact', label: t('landing.nav_contact') },
  ];

  const appHref = user ? roleHomePath(user.role) : '/auth/login';

  return (
    <div className="brand-scope min-h-screen bg-background-50 flex flex-col">
      {/* Navbar */}
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          overlay
            ? 'bg-transparent'
            : 'bg-background-50/92 backdrop-blur-md border-b border-background-200/60'
        }`}
      >
        <div className="w-full px-4 md:px-6 lg:px-10 h-16 md:h-20 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center" aria-label="Лески Каручка — начало">
            <img src={LOGO_URL} alt="Лески Каручка" className="h-9 md:h-11 w-auto rounded-lg" />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-9">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  `text-sm font-medium tracking-wide transition-colors whitespace-nowrap ${
                    isActive
                      ? 'text-primary-600 font-semibold'
                      : 'text-foreground-600 hover:text-foreground-950'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          {/* Right actions */}
          <div className="hidden md:flex items-center gap-3">
            <a
              href="tel:+359890005900"
              className="hidden xl:inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors whitespace-nowrap"
              aria-label="Телефон за спешни случаи"
            >
              <i className="ri-phone-line" aria-hidden="true" />
              +359 89 000 5900
            </a>
            {!user && (
              <Link
                to="/auth/login"
                className="px-5 py-2.5 rounded-full border border-foreground-300 text-foreground-800 text-sm font-semibold transition-colors hover:bg-background-100 whitespace-nowrap"
              >
                {t('landing.nav_login')}
              </Link>
            )}
            <Link
              to={appHref}
              className="px-5 py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              {user ? t('landing.nav_app') : t('landing.nav_order')}
            </Link>
          </div>

          {/* Hamburger */}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Затвори меню' : 'Отвори меню'}
            aria-expanded={menuOpen}
            className="lg:hidden w-10 h-10 rounded-lg flex items-center justify-center text-foreground-950 hover:bg-background-100 transition-colors cursor-pointer"
          >
            <i className={`${menuOpen ? 'ri-close-line' : 'ri-menu-line'} text-xl`} aria-hidden="true" />
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="lg:hidden bg-background-50 border-b border-background-200/70 px-4 pb-8 pt-2 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain">
            <nav className="flex flex-col gap-1" aria-label="Мобилна навигация">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) =>
                    `px-3 py-3.5 rounded-xl text-[15px] font-medium transition-colors ${
                      isActive
                        ? 'bg-primary-100 text-primary-700 font-semibold'
                        : 'text-foreground-700 hover:bg-background-100'
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
            <div className="flex flex-col gap-2.5 mt-5 pt-5 border-t border-background-200/70">
              <a
                href="tel:+359890005900"
                className="px-4 py-3.5 rounded-full border border-foreground-300 text-foreground-700 text-[15px] font-semibold text-center transition-colors hover:bg-background-100 whitespace-nowrap"
                aria-label="Телефон за спешни случаи"
              >
                <i className="ri-phone-line mr-1.5" aria-hidden="true" />
                +359 89 000 5900
              </a>
              {!user && (
                <Link
                  to="/auth/login"
                  className="px-4 py-3.5 rounded-full border border-foreground-300 text-foreground-700 text-[15px] font-semibold text-center transition-colors hover:bg-background-100 whitespace-nowrap"
                >
                  {t('landing.nav_login')}
                </Link>
              )}
              <Link
                to={appHref}
                className="px-4 py-3.5 rounded-full bg-primary-500 hover:bg-primary-600 text-white text-[15px] font-semibold text-center transition-colors whitespace-nowrap cursor-pointer"
              >
                {user ? t('landing.nav_app') : t('landing.nav_order')}
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Page content */}
      <main className="flex-1">
        <Outlet />
      </main>

      <LandingFooter />
      <CookieConsent />
    </div>
  );
}