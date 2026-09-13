import { useTranslation } from 'react-i18next';
import Reveal from '@/pages/landing/components/Reveal';

export default function HowItWorks() {
  const { t } = useTranslation();

  const steps = [
    { num: '01', text: t('landing.step_1') },
    { num: '02', text: t('landing.step_2') },
    { num: '03', text: t('landing.step_3') },
  ];

  return (
    <section className="bg-background-50 py-24 md:py-40">
      <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-6xl">
        <Reveal className="max-w-xl mb-16 md:mb-24">
          <h2 className="font-heading font-semibold text-foreground-950 text-2xl md:text-4xl tracking-tight mb-4">
            {t('landing.steps_title')}
          </h2>
          <p className="text-foreground-500 text-base md:text-lg leading-relaxed">
            {t('landing.steps_subtitle')}
          </p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-14 md:gap-10">
          {steps.map((step, i) => (
            <Reveal key={step.num} delay={i * 120}>
              <div className="border-t border-foreground-200 pt-7">
                <span className="block font-heading font-light text-foreground-300 text-6xl md:text-7xl mb-5">
                  {step.num}
                </span>
                <p className="font-heading font-medium text-foreground-950 text-lg md:text-xl tracking-tight">
                  {step.text}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}