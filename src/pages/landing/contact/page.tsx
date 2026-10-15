import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageHero from '@/pages/landing/components/PageHero';
import Reveal from '@/pages/landing/components/Reveal';
import { useFormSubmit } from '@/pages/landing/components/useFormSubmit';
import { dataController, legalOperator } from '@/config/legal';
import { useEffect, useRef } from 'react';

const CONTACT_FORM_URL = 'https://readdy.ai/api/form/d9urfm1kngcel2k3j9e0';

export default function ContactPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const partnerInquiry = searchParams.get('subject') === 'partner';
  const { status, errorMsg, submit } = useFormSubmit(CONTACT_FORM_URL, 'company_alt');
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status === 'success' || status === 'error') {
      feedback.current?.scrollIntoView({ block: 'nearest' });
      feedback.current?.focus({ preventScroll: true });
    }
  }, [status]);

  const infoCards = [
    { icon: 'ri-phone-line', label: t('landing.contact_phone_label'), value: t('landing.footer_phone'), href: 'tel:+359890005900' },
    { icon: 'ri-mail-line', label: t('landing.contact_email_label'), value: legalOperator.email, href: 'mailto:' + legalOperator.email },
    { icon: 'ri-map-pin-2-line', label: t('landing.contact_address_label'), value: t('landing.footer_address') },
    { icon: 'ri-time-line', label: t('landing.contact_hours_label'), value: t('landing.contact_hours_value') },
  ];

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit(e.currentTarget);
  };

  return (
    <>
      <PageHero
        badge={t('landing.contact_hero_badge')}
        title={t('landing.contact_hero_title')}
        subtitle={t('landing.contact_hero_subtitle')}
      />

      {/* Info cards */}
      <section className="bg-background-50 py-16 md:py-20">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-7xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {infoCards.map((card, i) => (
              <Reveal key={card.label} delay={i * 70}>
                <div className="h-full p-6 rounded-lg bg-background-100 border border-background-200/70 text-center hover:border-primary-300 transition-colors">
                  <div className="w-12 h-12 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-3">
                    <i className={`${card.icon} text-xl`} aria-hidden="true" />
                  </div>
                  <p className="text-xs text-foreground-400 uppercase tracking-wider mb-1">{card.label}</p>
                  {card.href ? (
                    <a
                      href={card.href}
                      className="text-sm font-semibold text-foreground-950 hover:text-primary-600 transition-colors break-all"
                    >
                      {card.value}
                    </a>
                  ) : (
                    <p className="text-sm font-semibold text-foreground-950">{card.value}</p>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-6 text-sm text-foreground-700 leading-relaxed">
            {t('landing.contact_privacy_label')}: {dataController.name}.
            {' '}{t('landing.contact_privacy_email')} <a className="underline text-primary-700" href={'mailto:' + dataController.email}>{dataController.email}</a>.
            {' '}<a className="underline text-primary-700" href="/privacy">{t('auth_privacy_label')}</a>
          </p>
        </div>
      </section>

      {/* Form + Map */}
      <section className="bg-background-100 py-16 md:py-24">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            {/* Form */}
            <Reveal>
              <div className="bg-background-50 border border-background-200/70 rounded-lg p-6 md:p-8 h-full">
                <h3 className="font-heading font-bold text-foreground-950 text-xl mb-6">
                  {t('landing.contact_form_title')}
                </h3>

                {status === 'success' && (
                  <div ref={feedback} tabIndex={-1} role="status" className="flex items-start gap-3 bg-primary-50 text-primary-800 px-4 py-3.5 rounded-lg text-sm mb-5">
                    <i className="ri-checkbox-circle-line text-lg mt-0.5" aria-hidden="true" />
                    <span>{t('landing.contact_form_success')}</span>
                  </div>
                )}
                {status === 'error' && (
                  <div ref={feedback} tabIndex={-1} role="alert" className="flex items-start gap-3 bg-red-50 text-red-600 px-4 py-3.5 rounded-lg text-sm mb-5 break-words">
                    <i className="ri-error-warning-line text-lg mt-0.5" aria-hidden="true" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <form
                  data-readdy-form="contact-form"
                  aria-label={t('landing.contact_form_title')} aria-busy={status === 'submitting'}
                  onSubmit={handleSubmit}
                  className="space-y-4"
                >
                  <fieldset disabled={status === 'submitting'} className="space-y-4 min-w-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="landing-contact-name" className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                        {t('landing.contact_form_name')}
                      </label>
                      <input id="landing-contact-name"
                        type="text"
                        name="name"
                        required
                        className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                      />
                    </div>
                    <div>
                      <label htmlFor="landing-contact-email" className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                        {t('landing.contact_form_email')}
                      </label>
                      <input id="landing-contact-email"
                        type="email"
                        name="email"
                        required
                        className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="landing-contact-phone" className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                        {t('landing.contact_form_phone')}
                      </label>
                      <input id="landing-contact-phone"
                        type="tel"
                        name="phone"
                        className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                      />
                    </div>
                    <div>
                      <label htmlFor="landing-contact-subject" className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                        {t('landing.contact_form_subject')}
                      </label>
                      <select id="landing-contact-subject"
                        aria-label={t('landing.contact_form_subject')}
                        key={partnerInquiry ? 'partner' : 'general'}
                        name="subject"
                        required
                        defaultValue={partnerInquiry ? 'partner' : ''}
                        className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                      >
                        <option value="" disabled>
                          —
                        </option>
                        <option value="order">Поръчка</option>
                        <option value="partner">Фирмено партньорство</option>
                        <option value="question">Въпрос</option>
                        <option value="issue">Проблем с пътуване</option>
                        <option value="other">Друго</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="landing-contact-message" className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                      {t('landing.contact_form_message')}
                    </label>
                    <textarea id="landing-contact-message"
                      name="message"
                      rows={5}
                      required
                      maxLength={500}
                      placeholder="500 символа максимум"
                      className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all resize-none"
                    />
                  </div>

                  <p className="text-sm text-foreground-700 leading-relaxed">
                    Използваме данните за отговор на запитването. Виж
                    {' '}<a href="/privacy" className="underline text-primary-700">Политиката за поверителност</a>.
                    Не изпращай чувствителни или ненужни данни. Това не е абонамент за реклама.
                  </p>

                  <input type="text" name="company_alt" tabIndex={-1} autoComplete="off" aria-hidden="true" readOnly className="form-trap" />

                  <button
                    type="submit"
                    disabled={status === 'submitting'}
                    className="w-full py-3.5 rounded-full bg-primary-500 hover:bg-primary-600 active:scale-[0.98] text-white font-bold text-sm transition-all disabled:opacity-50 whitespace-nowrap cursor-pointer inline-flex items-center justify-center gap-2"
                  >
                    {status === 'submitting' ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                        {t('loading')}
                      </>
                    ) : (
                      <>
                        <i className="ri-send-plane-line" aria-hidden="true" />
                        {t('landing.contact_form_submit')}
                      </>
                    )}
                  </button>
                  </fieldset>
                </form>
              </div>
            </Reveal>

            {/* Map */}
            <Reveal delay={120}>
              <div className="h-full min-h-[420px] rounded-lg overflow-hidden border border-background-200/70 relative">
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-background-50 p-8 text-center">
                  <i className="ri-map-pin-2-line text-5xl text-primary-600" aria-hidden="true" />
                  <h3 className="font-heading font-semibold text-xl text-foreground-950">{t('landing.contact_map_title')}</h3>
                  <a href="https://www.google.com/maps?q=Levski,+Bulgaria" target="_blank" rel="noopener noreferrer"
                    className="rounded-full border border-primary-600 px-5 py-3 text-primary-700 font-semibold">
                    {t('landing.contact_map_open')}
                  </a>
                </div>
                <div className="absolute bottom-4 left-4 right-4 pointer-events-none">
                  <div className="bg-background-50/95 backdrop-blur rounded-lg px-4 py-3 border border-background-200/70">
                    <p className="text-xs font-semibold text-foreground-950">
                      <i className="ri-map-pin-2-line text-primary-500 mr-1.5" aria-hidden="true" />
                      {t('landing.contact_map_title')}
                    </p>
                    <p className="text-xs text-foreground-500 mt-0.5">{t('landing.footer_address')}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}
