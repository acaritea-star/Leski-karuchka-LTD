import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { warmRoute } from './routeModules';

/** Only code for this route or a link the user approaches. Never prefetch private data. */
export default function RouteIntent() {
  const { pathname } = useLocation();
  useEffect(() => { warmRoute(pathname); }, [pathname]);
  useEffect(() => {
    const warm = (event: Event) => {
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
      if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('a[href], [data-route]') : null;
      const destination = target?.getAttribute('data-route') ?? target?.getAttribute('href');
      if (!destination) return;
      try {
        const url = new URL(destination, location.href);
        if (url.origin === location.origin) warmRoute(url.pathname);
      } catch { /* Not a navigable internal URL. */ }
    };
    document.addEventListener('pointerover', warm, { passive: true });
    document.addEventListener('pointerdown', warm, { passive: true });
    document.addEventListener('focusin', warm);
    return () => {
      document.removeEventListener('pointerover', warm);
      document.removeEventListener('pointerdown', warm);
      document.removeEventListener('focusin', warm);
    };
  }, []);
  return null;
}
