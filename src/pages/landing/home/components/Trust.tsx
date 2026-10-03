import { useTranslation } from 'react-i18next';
import Reveal from '@/pages/landing/components/Reveal';

export default function Trust() {
  const { t } = useTranslation();
  const items = [
    { num: '3', label: t('landing.trust_steps_label') },
    { num: 'GPS', label: t('landing.trust_tracking_label') },
    { num: t('landing.trust_payment_value'), label: t('landing.trust_payment_label') },
  ];
  return <section className="bg-background-100 py-24 md:py-40">
    <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-6xl">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-14 md:gap-10 text-center">
        {items.map((item, index) => <Reveal key={item.label} delay={index * 100}>
          <p className="font-heading font-light text-foreground-950 text-5xl md:text-7xl tracking-tight mb-4">{item.num}</p>
          <p className="text-foreground-700 text-sm uppercase tracking-[0.2em]">{item.label}</p>
        </Reveal>)}
      </div>
    </div>
  </section>;
}
