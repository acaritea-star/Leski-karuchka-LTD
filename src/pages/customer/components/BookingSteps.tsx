import { useTranslation } from 'react-i18next';
import type { BookingStep } from './bookingFlow';

export default function BookingSteps({ step, canConfirm, disabled, onChange }: {
  step: BookingStep; canConfirm: boolean; disabled: boolean; onChange: (step: BookingStep) => void;
}) {
  const { t } = useTranslation();
  const steps = ['pickup', 'dest', 'confirm'] as const;
  const titles = [t('booking_pickup'), t('booking_destination'), t('booking_confirm')];
  const index = steps.indexOf(step);
  return <div className="booking-heading">
    <div><p className="booking-eyebrow">{t('booking_step', { step: index + 1 })}</p><h1>{titles[index]}</h1></div>
    <nav aria-label={t('booking_steps')} className="booking-steps">
      {steps.map((item, i) => <button type="button" key={item} aria-label={`${i + 1}. ${titles[i]}`}
        aria-current={step === item ? 'step' : undefined}
        disabled={disabled || (item === 'confirm' && !canConfirm)} onClick={() => onChange(item)}>
        <span>{i < index ? <i className="ri-check-line" aria-hidden="true" /> : i + 1}</span>
      </button>)}
    </nav>
  </div>;
}
