import { useTranslation } from 'react-i18next';

interface WelcomeOnboardingProps {
  firstName: string;
  onClose: () => void;
}

const STEPS = [
  { icon: 'ri-map-pin-2-line', titleKey: 'welcome_step_1_title', descKey: 'welcome_step_1_desc' },
  { icon: 'ri-flag-line', titleKey: 'welcome_step_2_title', descKey: 'welcome_step_2_desc' },
  { icon: 'ri-radar-line', titleKey: 'welcome_step_3_title', descKey: 'welcome_step_3_desc' },
];

export default function WelcomeOnboarding({ firstName, onClose }: WelcomeOnboardingProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-[70] flex flex-col justify-end">
      <div
        className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-black/70"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-md w-full px-4 pb-6">
        <div className="bg-background-50 rounded-3xl px-5 pt-5 pb-6 relative overflow-hidden animate-in slide-in-from-bottom-8 fade-in duration-500">
          {/* Skip */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 px-3 py-1.5 rounded-full bg-background-100 text-foreground-500 text-xs font-semibold hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            {t('welcome_skip')}
          </button>

          {/* Icon */}
          <div className="w-14 h-14 rounded-2xl bg-primary-100 flex items-center justify-center rise-in">
            <i className="ri-taxi-line text-2xl text-primary-600" />
          </div>

          {/* Title */}
          <h2
            className="mt-4 text-2xl font-bold text-foreground-950 font-heading leading-tight rise-in"
            style={{ animationDelay: '60ms' }}
          >
            {t('welcome_title')}
            {firstName ? `, ${firstName}` : ''}!
          </h2>
          <p
            className="mt-1.5 text-sm text-foreground-500 rise-in"
            style={{ animationDelay: '120ms' }}
          >
            {t('welcome_subtitle')}
          </p>

          {/* Steps */}
          <div className="mt-5 space-y-3">
            {STEPS.map((step, i) => (
              <div
                key={step.titleKey}
                className="flex items-start gap-3 rise-in"
                style={{ animationDelay: `${180 + i * 110}ms` }}
              >
                <div className="w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center flex-shrink-0">
                  <i className={`${step.icon} text-lg text-accent-600`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground-900">
                    {i + 1}. {t(step.titleKey)}
                  </p>
                  <p className="text-xs text-foreground-500 mt-0.5 leading-relaxed">
                    {t(step.descKey)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={onClose}
            className="w-full mt-6 py-3.5 bg-primary-500 text-white font-bold rounded-2xl hover:bg-primary-600 active:scale-[0.98] transition-all whitespace-nowrap cursor-pointer rise-in flex items-center justify-center gap-2"
            style={{ animationDelay: '520ms' }}
          >
            {t('welcome_cta')}
            <i className="ri-arrow-right-line text-lg" />
          </button>
        </div>
      </div>
    </div>
  );
}