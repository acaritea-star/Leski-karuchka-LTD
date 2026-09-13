import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Reveal from '@/pages/landing/components/Reveal';
import { supabase } from '@/lib/supabase';

interface LandingStats {
  completed_trips: number;
  avg_rating: number;
}

export default function Trust() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<LandingStats | null>(null);

  useEffect(() => {
    let cancelled = false;

    supabase.functions
      .invoke('landing-stats', {})
      .then(({ data, error }) => {
        if (!cancelled && !error && data) {
          setStats(data as LandingStats);
        }
      })
      .catch(() => {
        // Network failure — keep the em-dash placeholders, never show fake numbers.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const items = [
    { num: stats ? String(stats.completed_trips) : '—', label: t('landing.trust_trips_label') },
    { num: stats ? stats.avg_rating.toFixed(1) : '—', label: t('landing.trust_rating_label') },
    { num: t('landing.trust_towns_num'), label: t('landing.trust_towns_label') },
  ];

  return (
    <section className="bg-background-100 py-24 md:py-40">
      <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-14 md:gap-10 text-center">
          {items.map((item, i) => (
            <Reveal key={item.label} delay={i * 100}>
              <p className="font-heading font-light text-foreground-950 text-6xl md:text-8xl tracking-tight mb-4">
                {item.num}
              </p>
              <p className="text-foreground-500 text-xs md:text-sm uppercase tracking-[0.25em]">
                {item.label}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}