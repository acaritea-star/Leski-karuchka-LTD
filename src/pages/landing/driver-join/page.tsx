import { useTranslation } from 'react-i18next';
import PageHero from '@/pages/landing/components/PageHero';
import Reveal from '@/pages/landing/components/Reveal';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { beginDriverApplicationLogin } from '@/lib/authReturn';
import DriverTermsPreview from '@/components/feature/DriverTermsPreview';

export default function DriverJoinPage() {
  const { t } = useTranslation();
  const { user, loading, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const busy = useRef(false);
  const applicationKey = ['driver-application', user?.id];
  const application = useQuery({
    queryKey: applicationKey,
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => supabase.from('driver_applications').select('*')
        .eq('user_id', user!.id).abortSignal(abort).maybeSingle(), 10_000, signal);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
  const companies = useQuery({
    queryKey: ['driver-application-companies', user?.id],
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => supabase.from('companies').select('id,name')
        .eq('is_active', true).order('name').abortSignal(abort), 10_000, signal);
      if (error) throw error;
      return data ?? [];
    },
    enabled: user?.role === 'CUSTOMER',
    staleTime: 60_000,
  });

  const benefits = [
    { icon: 'ri-time-line', title: t('landing.dj_benefit_1_title'), desc: t('landing.dj_benefit_1_desc') },
    { icon: 'ri-line-chart-line', title: t('landing.dj_benefit_2_title'), desc: t('landing.dj_benefit_2_desc') },
    { icon: 'ri-team-line', title: t('landing.dj_benefit_3_title'), desc: t('landing.dj_benefit_3_desc') },
    { icon: 'ri-service-line', title: t('landing.dj_benefit_4_title'), desc: t('landing.dj_benefit_4_desc') },
  ];

  const requirements = [
    t('landing.dj_req_1'),
    t('landing.dj_req_2'),
    t('landing.dj_req_3'),
    t('landing.dj_req_4'),
  ];

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy.current || !user || user.role !== 'CUSTOMER') return;
    const form = new FormData(e.currentTarget);
    if (form.get('website_alt')) return;
    busy.current = true;
    setStatus('submitting'); setErrorMsg('');
    try {
      const { error } = await withRequestTimeout(signal => supabase.rpc('submit_driver_application', {
        p_company: String(form.get('company')), p_full_name: String(form.get('name') ?? '').trim(),
        p_phone: String(form.get('phone') ?? '').trim(), p_experience: String(form.get('experience')),
        p_has_vehicle: form.get('vehicle') === 'yes', p_message: String(form.get('message') ?? '').trim(),
      }).abortSignal(signal));
      if (error) throw error;
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setErrorMsg(error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Не успяхме да потвърдим изпращането. Обновете статуса преди повторен опит.');
    } finally {
      busy.current = false;
      void queryClient.invalidateQueries({ queryKey: applicationKey });
    }
  };

  return (
    <>
      <PageHero
        badge={t('landing.driver_join_hero_badge')}
        title={t('landing.driver_join_hero_title')}
        subtitle={t('landing.driver_join_hero_subtitle')}
      />

      {/* Benefits */}
      <section className="bg-background-50 py-16 md:py-20">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-7xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {benefits.map((benefit, i) => (
              <Reveal key={benefit.title} delay={i * 70}>
                <div className="h-full p-6 rounded-lg bg-background-100 border border-background-200/70 hover:border-primary-300 hover:-translate-y-1 transition-all duration-300">
                  <div className="w-12 h-12 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center mb-4">
                    <i className={`${benefit.icon} text-xl`} aria-hidden="true" />
                  </div>
                  <h3 className="font-heading font-bold text-foreground-950 text-base mb-2">
                    {benefit.title}
                  </h3>
                  <p className="text-sm text-foreground-500 leading-relaxed">{benefit.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Requirements + Form */}
      <section className="bg-background-100 py-16 md:py-24">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            {/* Requirements */}
            <Reveal>
              <h2 className="font-heading font-extrabold text-foreground-950 text-2xl md:text-3xl tracking-tight mb-6">
                {t('landing.dj_req_title')}
              </h2>
              <ul className="space-y-4">
                {requirements.map((req) => (
                  <li key={req} className="flex items-start gap-3 text-sm text-foreground-700">
                    <span className="w-6 h-6 rounded-full bg-primary-500 text-white flex items-center justify-center flex-shrink-0 mt-0.5">
                      <i className="ri-check-line text-xs" aria-hidden="true" />
                    </span>
                    {req}
                  </li>
                ))}
              </ul>
              <div className="mt-8 bg-background-50 border border-background-200/70 rounded-lg p-5">
                <p className="text-xs text-foreground-400 leading-relaxed">
                  {t('landing.contact_hours_label')}:{' '}
                  <span className="font-semibold text-foreground-600 whitespace-nowrap">
                    {t('landing.contact_hours_value')}
                  </span>
                </p>
              </div>
            </Reveal>

            {/* Application form */}
            <Reveal delay={120}>
              <div className="bg-background-50 border border-background-200/70 rounded-lg p-6 md:p-8">
                <h3 className="font-heading font-bold text-foreground-950 text-xl mb-1.5">
                  {t('landing.dj_form_title')}
                </h3>
                <p className="text-sm text-foreground-500 mb-6">{t('landing.dj_form_subtitle')}</p>
                {user && (user.role === 'CUSTOMER' || user.role === 'DRIVER') && <DriverTermsPreview />}

                {status === 'success' && (
                  <div className="flex items-start gap-3 bg-primary-50 text-primary-800 px-4 py-3.5 rounded-lg text-sm mb-5">
                    <i className="ri-checkbox-circle-line text-lg mt-0.5" aria-hidden="true" />
                    <span>{t('landing.dj_form_success')}</span>
                  </div>
                )}
                {status === 'error' && (
                  <div className="flex items-start gap-3 bg-red-50 text-red-600 px-4 py-3.5 rounded-lg text-sm mb-5">
                    <i className="ri-error-warning-line text-lg mt-0.5" aria-hidden="true" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {loading ? <p role="status">Зареждаме профила…</p> : !user ? (
                  <Link to="/auth/login" onClick={beginDriverApplicationLogin} className="inline-flex py-3 px-5 rounded-full bg-primary-500 text-white font-bold text-sm">Влез с Google или Facebook, за да кандидатстваш</Link>
                ) : user.role === 'DRIVER' ? (
                  <Link to="/driver/profile" className="text-primary-700 underline">Към шофьорския профил и документите</Link>
                ) : user.role !== 'CUSTOMER' ? <p>Този профил е административен. Кандидатът трябва да влезе със своя Google или Facebook профил.</p> : application.isPending ? <p role="status">Проверяваме кандидатурата…</p> : application.isError || companies.isError ? (
                  <p role="alert">Не успяхме да заредим данните. <button className="underline" onClick={() => { void application.refetch(); void companies.refetch(); }}>Опитай отново</button></p>
                ) : application.data?.status === 'pending' || application.data?.status === 'approved' ? (
                  <div className="text-sm space-y-3">
                    <p>{application.data.status === 'approved' ? 'Кандидатурата е одобрена. Отвори шофьорския профил, за да качиш документите.' : 'Кандидатурата е приета и очаква преглед от избраната фирма.'}</p>
                    <button type="button" className="underline text-primary-700" onClick={() => { void application.refetch(); void refreshProfile(); }}>Обнови статуса</button>
                  </div>
                ) : <form
                  onSubmit={handleSubmit}
                  className="space-y-4"
                >
                  {application.data?.status === 'rejected' && <p role="status" className="text-sm text-red-600">Кандидатурата е отхвърлена. {application.data.review_note} Можеш да кандидатстваш отново с коригирани данни.</p>}
                  <div>
                    <label htmlFor="driver-company" className="block text-xs font-semibold text-foreground-700 mb-1.5">Фирма, към която кандидатстваш</label>
                    <select id="driver-company" name="company" required defaultValue="" className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-sm">
                      <option value="" disabled>{companies.isPending ? 'Зареждане…' : 'Избери фирма'}</option>
                      {(companies.data ?? []).map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
                    </select>
                    {!companies.isPending && !companies.data?.length && <p className="text-sm mt-2">Няма активни фирми за кандидатстване.</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                      {t('landing.dj_form_name')}
                    </label>
                    <input
                      type="text"
                      name="name"
                      defaultValue={`${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim()}
                      minLength={2} maxLength={120}
                      required
                      className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                        {t('landing.dj_form_phone')}
                      </label>
                      <input
                        type="tel"
                        name="phone"
                        defaultValue={user?.phone ?? ''} minLength={6} maxLength={30}
                        required
                        className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                        {t('landing.dj_form_email')}
                      </label>
                      <input
                        type="email"
                        name="email"
                        value={user?.email ?? ''} readOnly
                        className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                        {t('landing.dj_form_exp')}
                      </label>
                      <select
                        name="experience"
                        required
                        defaultValue=""
                        className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                      >
                        <option value="" disabled>
                          —
                        </option>
                        {['1–3', '3–5', '5–10', '10+'].map((years) => (
                          <option key={years} value={years}>
                            {years}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                        {t('landing.dj_form_vehicle')}
                      </label>
                      <select
                        name="vehicle"
                        required
                        defaultValue=""
                        className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                      >
                        <option value="" disabled>
                          —
                        </option>
                        <option value="yes">Да</option>
                        <option value="no">Не</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                      {t('landing.dj_form_message')}
                    </label>
                    <textarea
                      name="message"
                      rows={4}
                      maxLength={500}
                      placeholder="500 символа максимум"
                      className="w-full px-4 py-3 rounded-lg border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-400/15 transition-all resize-none"
                    />
                  </div>

                  <p className="text-sm text-foreground-700 leading-relaxed">
                    Използваме данните за разглеждане на кандидатурата. Виж
                    {' '}<a href="/privacy" className="underline text-primary-700">Политиката за поверителност</a>.
                    Не изпращай чувствителни или ненужни данни. Това не е абонамент за реклама.
                  </p>

                  <p className="text-sm text-foreground-700">Кандидатурата не дава право да извършваш превоз. Преди активиране се проверяват документите на превозвача, водача и автомобила.</p>

                  <input type="text" name="website_alt" tabIndex={-1} autoComplete="off" aria-hidden="true" readOnly className="form-trap" />

                  <button
                    type="submit"
                    disabled={status === 'submitting' || companies.isPending || !companies.data?.length}
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
                        {t('landing.dj_form_submit')}
                      </>
                    )}
                  </button>
                </form>}
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}
