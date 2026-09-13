import { useTranslation } from 'react-i18next';
import PageHero from '@/pages/landing/components/PageHero';
import Reveal from '@/pages/landing/components/Reveal';
import { useFormSubmit } from '@/pages/landing/components/useFormSubmit';
import { useState } from 'react';

const CONTACT_FORM_URL = 'https://readdy.ai/api/form/d9urfm1kngcel2k3j9e0';

export default function ContactPage() {
  const { t } = useTranslation();
  const { status, errorMsg, submit } = useFormSubmit(CONTACT_FORM_URL, 'company_alt');
  const [gdprConsent, setGdprConsent] = useState(false);
  const [gdprError, setGdprError] = useState(false);

  const infoCards = [
    { icon: 'ri-phone-line', label: t('landing.contact_phone_label'), value: t('landing.footer_phone'), href: 'tel:+359890005900' },
    { icon: 'ri-mail-line', label: t('landing.contact_email_label'), value: t('landing.footer_email'), href: 'mailto:info@leski-karuchka.bg' },
    { icon: 'ri-map-pin-2-line', label: t('landing.contact_address_label'), value: t('landing.footer_address') },
    { icon: 'ri-time-line', label: t('landing.contact_hours_label'), value: t('landing.contact_hours_value') },
  ];

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!gdprConsent) {
      setGdprError(true);
      return;
    }
    setGdprError(false);
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
                  <div className="flex items-start gap-3 bg-primary-50 text-primary-800 px-4 py-3.5 rounded-lg text-sm mb-5">
                    <i className="ri-checkbox-circle-line text-lg mt-0.5" aria-hidden="true" />
                    <span>{t('landing.contact_form_success')}</span>
                  </div>
                )}
                {status === 'error' && (
                  <div className="flex items-start gap-3 bg-red-50 text-red-600 px-4 py-3.5 rounded-lg text-sm mb-5">
                    <i className="ri-error-warning-line text-lg mt-0.5" aria-hidden="true" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <form
                  data-readdy-form="contact-form"
                  onSubmit={handleSubmit}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                        {t('landing.contact_form_name')}
                      </label>
                      <input
                        type="text"
                        name="name"
                        required
                        className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                        {t('landing.contact_form_email')}
                      </label>
                      <input
                        type="email"
                        name="email"
                        required
                        className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                        {t('landing.contact_form_phone')}
                      </label>
                      <input
                        type="tel"
                        name="phone"
                        className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                        {t('landing.contact_form_subject')}
                      </label>
                      <select
                        name="subject"
                        required
                        defaultValue=""
                        className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                      >
                        <option value="" disabled>
                          —
                        </option>
                        <option value="order">Поръчка</option>
                        <option value="question">Въпрос</option>
                        <option value="issue">Проблем с пътуване</option>
                        <option value="other">Друго</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                      {t('landing.contact_form_message')}
                    </label>
                    <textarea
                      name="message"
                      rows={5}
                      required
                      maxLength={500}
                      placeholder="500 символа максимум"
                      className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all resize-none"
                    />
                  </div>

                  {/* GDPR consent */}
                  <div className="pt-1">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={gdprConsent}
                        onChange={(e) => {
                          setGdprConsent(e.target.checked);
                          if (e.target.checked) setGdprError(false);
                        }}
                        className="mt-0.5 w-4 h-4 rounded border-background-300 text-primary-600 focus:ring-primary-400"
                      />
                      <span className="text-xs text-foreground-600 leading-relaxed">
                        Съгласен съм с обработката на личните ми данни (име, имейл, телефон, съобщение)
                        с цел отговор на запитването ми, съгласно{' '}
                        <a href="/privacy" className="text-primary-600 hover:text-primary-700 underline">Политиката за поверителност</a>.
                      </span>
                    </label>
                    {gdprError && (
                      <p className="text-xs text-red-600 mt-1.5">
                        Моля, поставете отметка, за да продължите.
                      </p>
                    )}
                  </div>

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
                </form>
              </div>
            </Reveal>

            {/* Map */}
            <Reveal delay={120}>
              <div className="h-full min-h-[420px] rounded-lg overflow-hidden border border-background-200/70 relative">
                <iframe
                  title="Лески Каручка — Левски, област Плевен"
                  src="https://www.google.com/maps?q=43.3562,25.1404&z=14&output=embed"
                  className="absolute inset-0 w-full h-full border-0"
                  loading="lazy"
                  allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                />
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