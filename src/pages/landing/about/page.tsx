import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageHero from '@/pages/landing/components/PageHero';
import Reveal from '@/pages/landing/components/Reveal';

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-background-100 border border-background-200/70 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left cursor-pointer"
      >
        <span className="text-sm font-semibold text-foreground-950">{q}</span>
        <i
          className={`ri-arrow-down-s-line text-foreground-400 text-xl transition-transform duration-300 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && <p className="px-5 pb-5 text-sm text-foreground-500 leading-relaxed">{a}</p>}
    </div>
  );
}

export default function AboutPage() {
  const { t } = useTranslation();

  const values = [
    {
      icon: 'ri-hand-heart-line',
      title: t('landing.about_value_1_title'),
      desc: t('landing.about_value_1_desc'),
    },
    {
      icon: 'ri-time-line',
      title: t('landing.about_value_2_title'),
      desc: t('landing.about_value_2_desc'),
    },
    {
      icon: 'ri-emotion-happy-line',
      title: t('landing.about_value_3_title'),
      desc: t('landing.about_value_3_desc'),
    },
  ];

  const faqs = [
    { q: t('landing.faq_q1'), a: t('landing.faq_a1') },
    { q: t('landing.faq_q2'), a: t('landing.faq_a2') },
    { q: t('landing.faq_q3'), a: t('landing.faq_a3') },
    { q: t('landing.faq_q4'), a: t('landing.faq_a4') },
  ];

  return (
    <>
      <PageHero
        badge={t('landing.about_hero_badge')}
        title={t('landing.about_hero_title')}
        subtitle={t('landing.about_hero_subtitle')}

      />

      {/* Story */}
      <section className="bg-background-50 py-16 md:py-24">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <Reveal>
              <img
                src="https://readdy.ai/api/search-image?query=Warm%20artistic%20illustration%20of%20a%20friendly%20driver%20holding%20a%20door%20open%20for%20a%20passenger%20next%20to%20a%20modern%20ride-hailing%20car%20on%20a%20small%20town%20street%2C%20golden%20hour%20light%2C%20amber%20orange%20palette%2C%20cozy%20atmosphere%2C%20cinematic%2C%20high%20detail%2C%20no%20text&width=1200&height=900&seq=about-story-kar&orientation=portrait"
                alt="Шофьор от Лески Каручка посреща пътник до автомобила"
                loading="lazy"
                decoding="async"
                className="w-full h-[420px] object-cover rounded-lg"
              />
            </Reveal>
            <Reveal delay={120}>
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-100 text-primary-700 text-xs font-bold uppercase tracking-wider mb-4">
                <i className="ri-roadster-line" />
                {t('landing.about_story_title')}
              </span>
              <h2 className="font-heading font-extrabold text-foreground-950 text-2xl md:text-3xl tracking-tight mb-4">
                {t('landing.about_story_title')}
              </h2>
              <p className="text-foreground-500 text-sm md:text-base leading-relaxed mb-4">
                {t('landing.about_story_p1')}
              </p>
              <p className="text-foreground-500 text-sm md:text-base leading-relaxed mb-8">
                {t('landing.about_story_p2')}
              </p>
              <div className="bg-background-100 border-l-4 border-primary-500 rounded-r-lg p-5">
                <p className="text-sm font-semibold text-foreground-800 italic leading-relaxed">
                  „{t('landing.about_mission_desc')}“
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="bg-background-100 py-16 md:py-24">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-7xl">
          <Reveal className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="font-heading font-extrabold text-foreground-950 text-2xl md:text-4xl tracking-tight mb-3">
              {t('landing.about_values_title')}
            </h2>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {values.map((value, i) => (
              <Reveal key={value.title} delay={i * 100}>
                <div className="h-full p-6 md:p-8 rounded-lg bg-background-50 border border-background-200/70 text-center hover:-translate-y-1 transition-all duration-300">
                  <div className="w-14 h-14 rounded-2xl bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-4">
                    <i className={`${value.icon} text-2xl`} />
                  </div>
                  <h3 className="font-heading font-bold text-foreground-950 text-base mb-2">
                    {value.title}
                  </h3>
                  <p className="text-sm text-foreground-500 leading-relaxed">{value.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Service zone */}
      <section className="bg-primary-500 py-14 md:py-20">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-7xl">
          <Reveal className="flex flex-col lg:flex-row items-center justify-between gap-8">
            <div className="max-w-2xl">
              <h2 className="font-heading font-black text-white text-2xl md:text-3xl tracking-tight mb-3">
                {t('landing.about_zone_title')}
              </h2>
              <p className="text-white/85 text-sm md:text-base leading-relaxed">
                {t('landing.about_zone_desc')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5 justify-center">
              {['Левски', 'Българене', 'Асеновци', 'Обнова', 'Градище', 'Малчика'].map((village) => (
                <span
                  key={village}
                  className="px-4 py-2 rounded-full bg-white/15 text-white text-sm font-semibold whitespace-nowrap"
                >
                  {village}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-background-50 py-16 md:py-24">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-3xl">
          <Reveal className="text-center mb-10">
            <h2 className="font-heading font-extrabold text-foreground-950 text-2xl md:text-4xl tracking-tight">
              {t('landing.about_faq_title')}
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