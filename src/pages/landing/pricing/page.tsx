import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageHero from '@/pages/landing/components/PageHero';
import Reveal from '@/pages/landing/components/Reveal';

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-background-50 border border-background-200/70 rounded-xl overflow-hidden hover:border-primary-200 transition-colors duration-200">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left cursor-pointer"
      >
        <span className="text-sm font-semibold text-foreground-950">{q}</span>
        <i
          className={`ri-arrow-down-s-line text-primary-500 text-xl transition-transform duration-300 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && <p className="px-5 pb-5 text-sm text-foreground-500 leading-relaxed">{a}</p>}
    </div>
  );
}

export default function PricingPage() {
  const { t } = useTranslation();

  const fares = [
    { label: t('landing.pricing_fare_start'), value: t('landing.pricing_fare_1'), icon: 'ri-flag-2-line' },
    { label: t('landing.pricing_fare_km'), value: t('landing.pricing_fare_2'), icon: 'ri-map-2-line' },
    { label: t('landing.pricing_fare_min'), value: t('landing.pricing_fare_3'), icon: 'ri-time-line' },
    { label: t('landing.pricing_fare_min_total'), value: t('landing.pricing_fare_4'), icon: 'ri-bank-card-line' },
  ];

  const vehicles = [
    {
      name: t('landing.pricing_std'),
      desc: t('landing.pricing_std_desc'),
      price: '2.50',
      icon: 'ri-roadster-line',
      features: ['4 пътници', 'Климатик', 'Плащане в брой'],
    },
    {
      name: t('landing.pricing_comfort'),
      desc: t('landing.pricing_comfort_desc'),
      price: '3.20',
      icon: 'ri-roadster-fill',
      features: ['До 4 пътници + багаж', 'По-просторен салон', 'Вода за пътници'],
      featured: true,
    },
  ];

  const routes = [
    { label: t('landing.route_center_train'), price: t('landing.route_price'), time: '≈ 6 мин' },
    { label: t('landing.route_center_bus'), price: t('landing.route_price2'), time: '≈ 5 мин' },
    { label: t('landing.route_municipality_park'), price: t('landing.route_price3'), time: '≈ 5 мин' },
    { label: t('landing.route_train_stadium'), price: t('landing.route_price4'), time: '≈ 7 мин' },
    { label: t('landing.route_medical_center'), price: t('landing.route_price5'), time: '≈ 5 мин' },
  ];

  const faqs = [
    { q: t('landing.pfaq_q1'), a: t('landing.pfaq_a1') },
    { q: t('landing.pfaq_q2'), a: t('landing.pfaq_a2') },
    { q: t('landing.pfaq_q3'), a: t('landing.pfaq_a3') },
  ];

  return (
    <>
      <PageHero
        badge={t('landing.pricing_hero_badge')}
        title={t('landing.pricing_hero_title')}
        subtitle={t('landing.pricing_hero_subtitle')}

      />

      {/* Fares */}
      <section className="bg-background-50 py-16 md:py-20">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-7xl">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {fares.map((fare, i) => (
              <Reveal key={fare.label} delay={i * 70}>
                <div className="p-6 rounded-xl bg-background-50 border border-background-200/70 text-center hover:border-primary-300 transition-colors duration-300">
                  <div className="w-11 h-11 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-3">
                    <i className={`${fare.icon} text-lg`} />
                  </div>
                  <p className="font-heading font-extrabold text-foreground-950 text-2xl mb-1">
                    {fare.value}
                  </p>
                  <p className="text-xs text-foreground-500">{fare.label}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Vehicle types */}
      <section className="bg-secondary-50 py-16 md:py-24">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-5xl">
          <Reveal className="text-center max-w-2xl mx-auto mb-12">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-100 text-primary-700 text-xs font-bold uppercase tracking-wider mb-4">
              <i className="ri-car-line" />
              {t('landing.pricing_vehicles_badge')}
            </span>
            <h2 className="font-heading font-extrabold text-foreground-950 text-2xl md:text-4xl tracking-tight mb-3">
              {t('landing.pricing_vehicles_title')}
            </h2>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {vehicles.map((vehicle, i) => (
              <Reveal key={vehicle.name} delay={i * 100}>
                <div
                  className={`h-full p-7 rounded-xl border transition-all duration-300 hover:-translate-y-1 ${
                    vehicle.featured
                      ? 'bg-background-50 border-primary-300 ring-1 ring-primary-200/60'
                      : 'bg-background-50 border-background-200/70'
                  }`}
                >
                  <div className="flex items-center justify-between mb-5">
                    <div className="w-14 h-14 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center">
                      <i className={`${vehicle.icon} text-2xl`} />
                    </div>
                    {vehicle.featured && (
                      <span className="px-3 py-1 rounded-full bg-primary-500 text-white text-xs font-bold">
                        Популярен
                      </span>
                    )}
                  </div>
                  <h3 className="font-heading font-bold text-foreground-950 text-lg mb-1">
                    {vehicle.name}
                  </h3>
                  <p className="text-sm text-foreground-500 mb-5">{vehicle.desc}</p>
                  <p className="text-sm text-foreground-400 mb-4">
                    {t('landing.pricing_from')}{' '}
                    <span className="font-heading font-extrabold text-primary-600 text-3xl">
                      {vehicle.price} {t('lv')}
                    </span>
                  </p>
                  <ul className="space-y-2.5">
                    {vehicle.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2.5 text-sm text-foreground-600">
                        <i className="ri-check-line text-primary-500" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Routes table */}
      <section className="bg-background-50 py-16 md:py-20">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-4xl">
          <Reveal className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="font-heading font-extrabold text-foreground-950 text-2xl md:text-4xl tracking-tight mb-3">
              {t('landing.pricing_routes_title')}
            </h2>
            <p className="text-foreground-500 text-sm md:text-base">{t('landing.pricing_routes_subtitle')}</p>
          </Reveal>
          <div className="bg-background-50 border border-background-200/70 rounded-xl overflow-hidden">
            {routes.map((route, i) => (
              <div
                key={route.label}
                className={`flex items-center justify-between gap-4 px-5 py-4 ${
                  i !== routes.length - 1 ? 'border-b border-background-200/70' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-foreground-800">{route.label}</span>
                </div>
                <div className="flex items-center gap-5">
                  <span className="text-xs text-foreground-400 whitespace-nowrap">{route.time}</span>
                  <span className="font-heading font-bold text-foreground-950 text-sm whitespace-nowrap">
                    {route.price}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-foreground-400 text-center mt-4">
            {t('landing.pricing_routes_note')}
          </p>
        </div>
      </section>

      {/* Payment methods */}
      <section className="bg-secondary-50 py-16 md:py-20">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-4xl">
          <Reveal className="flex flex-col md:flex-row items-center justify-between gap-8 p-8 md:p-10 rounded-xl bg-background-50 border border-background-200/70 hover:border-primary-200 transition-colors duration-300">
            <div className="max-w-xl text-center md:text-left">
              <h2 className="font-heading font-extrabold text-foreground-950 text-2xl md:text-3xl tracking-tight mb-2">
                {t('landing.pricing_pay_title')}
              </h2>
              <p className="text-foreground-500 text-sm md:text-base">{t('landing.pricing_pay_desc')}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-background-100 text-foreground-700 text-sm font-semibold whitespace-nowrap">
                <i className="ri-cash-line text-primary-500" /> Кеш
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-background-50 py-16 md:py-24">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-3xl">
          <Reveal className="text-center mb-10">
            <h2 className="font-heading font-extrabold text-foreground-950 text-2xl md:text-4xl tracking-tight">
              {t('landing.pricing_faq_title')}
            </h2>
          </Reveal>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <Reveal key={faq.q} delay={i * 60}>
                <FaqItem q={faq.q} a={faq.a} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
