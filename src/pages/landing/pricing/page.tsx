import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHero from '@/pages/landing/components/PageHero';
import Reveal from '@/pages/landing/components/Reveal';

export default function PricingPage() {
  const { t } = useTranslation();
  const steps = [
    { icon: 'ri-route-line', title: t('landing.feature_price_title'), body: t('landing.feature_price_desc') },
    { icon: 'ri-time-line', title: t('landing.pfaq_q1'), body: t('landing.pfaq_a1') },
    { icon: 'ri-money-euro-circle-line', title: t('landing.pricing_pay_title'), body: t('landing.pricing_pay_desc') },
  ];
  return <>
    <PageHero badge={t('landing.pricing_hero_badge')} title={t('landing.pricing_hero_title')} subtitle={t('landing.pricing_hero_subtitle')} />
    <section className="bg-background-50 py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="grid gap-5 md:grid-cols-3">
          {steps.map((step, index) => <Reveal key={step.title} delay={index * 70}>
            <article className="h-full rounded-2xl border border-background-200 bg-white p-6">
              <i className={step.icon + ' text-2xl text-primary-600'} aria-hidden="true" />
              <h2 className="font-heading font-semibold text-lg text-foreground-950 mt-4 mb-3">{step.title}</h2>
              <p className="text-base text-foreground-700 leading-relaxed">{step.body}</p>
            </article>
          </Reveal>)}
        </div>
        <div className="text-center mt-10">
          <Link to="/app" className="inline-block rounded-full bg-primary-600 px-6 py-3 text-white font-semibold">{t('landing.nav_order')}</Link>
          <p className="mt-5 text-sm text-foreground-700">
            <Link to="/terms" className="underline">{t('menu_terms')}</Link>
          </p>
        </div>
      </div>
    </section>
  </>;
}
