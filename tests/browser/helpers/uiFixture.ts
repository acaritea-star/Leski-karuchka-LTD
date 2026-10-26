import type { Page } from '@playwright/test';

export type UiRole = 'visitor' | 'CUSTOMER' | 'DRIVER' | 'COMPANY_ADMIN' | 'SUPER_ADMIN';
export const uiAccount = '11111111-1111-4111-8111-111111111111';
export const uiCompany = '22222222-2222-4222-8222-222222222222';
export const uiDriver = '33333333-3333-4333-8333-333333333333';
const category = '44444444-4444-4444-8444-444444444444';
const cors = {
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer,accept-profile,content-profile,range,range-unit',
  'access-control-expose-headers': 'content-range',
};

export async function setupUi(page: Page, role: UiRole, aal: 'aal1' | 'aal2' = role === 'CUSTOMER' ? 'aal1' : 'aal2') {
  const user = { id: uiAccount, email: 'very.long.synthetic.account.name.for.layout@example.invalid', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: { provider: 'google' } };
  const company = { id: uiCompany, name: 'ОРИОН транспорт и таксиметрови услуги Велико Търново', is_active: true, currency: 'EUR', base_fare: 2, price_per_km: 1, price_per_minute: 0.2, min_fare: 2, dispatch_radius_km: 5, updated_at: new Date().toISOString(), created_at: new Date().toISOString(), setup_completed_at: new Date().toISOString(), drivers: [{ count: 1 }] };
  const state = {
    profile: { id: uiAccount, email: user.email, first_name: 'Александър-Владимир', last_name: 'Атанасов', phone: '0888123456', role, company_id: ['DRIVER', 'COMPANY_ADMIN'].includes(role) ? uiCompany : null, is_active: true },
    profileWrites: [] as Record<string, unknown>[], ratingWrites: [] as Record<string, unknown>[], vehicleWrites: [] as Record<string, unknown>[], contactWrites: [] as string[],
    welcomeFirst: false, welcomeClaims: 0,
    notices: [] as Record<string, unknown>[], rides: [] as Record<string, unknown>[], ratings: [] as Record<string, unknown>[], cars: [] as Record<string, unknown>[],
    articles: [] as Record<string, unknown>[], articleDeletes: 0, failArticleDelete: false,
    failProfile: false, failPreferences: false, failNotificationReads: false, failNotificationWrites: false, failRating: false, loseRatingResponse: false, failContact: false,
    writeDelay: 0, notificationWrites: 0, notificationStateReads: 0, notificationPageReads: 0, notificationOpens: [] as string[], pushRegistrations: 0, pushDeletes: 0, external: [] as string[], errors: [] as string[],
  };
  page.on('pageerror', error => state.errors.push(error.message));
  // Seed a prior choice from the test runner's clock. Playwright clock scripts
  // can run after this initializer, so Date.now() here could otherwise be a few
  // milliseconds ahead of a later fixed clock and invalidate the consent.
  const consentSavedAt = Date.now() - 60_000;
  await page.addInitScript(({ user, role, aal, consentSavedAt }) => {
    localStorage.setItem('i18nextLng', 'bg'); if (!localStorage.getItem('leski:auto-location:' + user.id)) localStorage.setItem('leski:auto-location:' + user.id, 'off');
    localStorage.setItem('lk_cookie_consent_v3', JSON.stringify({ version: 3, savedAt: consentSavedAt, expiresAt: consentSavedAt + 180 * 86400000, consent: { necessary: true, functional: true, analytics: false, marketing: false } }));
    if (role !== 'visitor') {
      const token = [btoa(JSON.stringify({ alg: 'HS256' })), btoa(JSON.stringify({ sub: user.id, role: 'authenticated', aal, exp: Math.floor(Date.now() / 1000) + 3600 })), 'synthetic'].join('.');
      localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'synthetic', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user }));
    }
  }, { user, role, aal, consentSavedAt });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:4100') return route.continue();
    const reply = (data: unknown, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(data) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const delay = async () => { if (state.writeDelay) await new Promise(resolve => setTimeout(resolve, state.writeDelay)); };
    if (url.origin === 'https://readdy.ai' && url.pathname.startsWith('/api/form/')) {
      state.contactWrites.push(request.postData() ?? ''); await delay();
      return state.failContact ? reply({ message: 'Временен проблем. Опитай отново.' }, 503) : reply({ code: 'OK' });
    }
    if (url.origin !== 'http://127.0.0.1:54329') { state.external.push(url.href); return route.abort(); }
    let data: unknown = [];
    if (url.pathname.endsWith('/rpc/claim_customer_welcome')) { state.welcomeClaims++; data = state.welcomeFirst; state.welcomeFirst = false; }
    else if(url.pathname.endsWith('/rpc/end_ride_trip')){const id=request.postDataJSON().p_request_id;const ride=state.rides.find(r=>r.id===id);if(!ride)return reply({message:'not found'},404);ride.trip_ended_at=new Date().toISOString();ride.final_price=ride.estimated_price;ride.updated_at=new Date().toISOString();data=ride;}
    else if(url.pathname.endsWith('/rpc/ride_payment_state')){const id=request.postDataJSON().p_request_id;const ride=state.rides.find(r=>r.id===id);data={request_id:id,eligible:false,ended_at:ride?.trip_ended_at??null,amount:ride?.estimated_price??null,state:'none',payment_status:'pending',payment_method:'cash'};}
    else if (url.pathname.endsWith('/auth/v1/user')) data = user;
    else if (url.pathname.endsWith('/profiles')) {
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON(); state.profileWrites.push(body); await delay();
        if (state.failProfile || body.language && state.failPreferences) return reply({ message: 'Промяната не е потвърдена. Провери връзката.' }, 503);
        Object.assign(state.profile, body);
      }
      data = url.searchParams.get('id')?.startsWith('in.') ? [state.profile] : state.profile;
    } else if (url.pathname.endsWith('/companies')) data = [company];
    else if (url.pathname.endsWith('/drivers')) {
      const row = { id: uiDriver, user_id: uiAccount, company_id: uiCompany, is_online: false, is_verified: true, status: 'offline', rating: 4.8, total_trips: 7, vehicle_id: null };
      data = url.searchParams.has('user_id') ? row : [row];
    } else if (url.pathname.endsWith('/vehicle_types')) data = [{ id: category, company_id: uiCompany, name: 'Стандарт', service_class: 'standard', capacity: 4, multiplier: 1, is_active: true }];
    else if (url.pathname.endsWith('/vehicles')) data = state.cars;
    else if (url.pathname.endsWith('/taxi_requests')) {
      const status = url.searchParams.get('status'); data = state.rides.filter(row => !status || status.includes(String(row.status)));
    } else if (url.pathname.endsWith('/ratings')) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON(); state.ratingWrites.push(body); await delay();
        if (state.failRating) return reply({ message: 'Оценката не е записана. Опитай отново.' }, 503);
        state.ratings.push(body);
        if (state.loseRatingResponse) return route.abort();
      }
      const requestId = url.searchParams.get('request_id');
      data = state.ratings.filter(row => !requestId || requestId === 'eq.' + row.request_id);
    } else if (url.pathname.endsWith('/functions/v1/generate-vapid-keys')) {
      data = { publicKey: Buffer.from('synthetic-web-push-key').toString('base64') };
    } else if (url.pathname.endsWith('/rpc/register_push_subscription')) {
      state.pushRegistrations++; data = null;
    } else if (url.pathname.endsWith('/push_subscriptions')) {
      if (request.method() === 'DELETE') state.pushDeletes++;
      data = [];
    } else if (url.pathname.endsWith('/rpc/notification_inbox_state')) {
      state.notificationStateReads++;
      if (state.failNotificationReads) return reply({ message: 'offline' }, 503);
      data = { unread: state.notices.filter(row => !row.is_read).length, latest_id: state.notices[0]?.id ?? null };
    } else if (url.pathname.endsWith('/rpc/notification_inbox_page')) {
      state.notificationPageReads++;
      if (state.failNotificationReads) return reply({ message: 'offline' }, 503);
      const body = request.postDataJSON(); const before = state.notices.findIndex(row => row.id === body.p_before_id);
      const offset = before < 0 ? 0 : before + 1;
      data = { items: state.notices.slice(offset, offset + 20), has_more: state.notices.length > offset + 20 };
    } else if (url.pathname.endsWith('/rpc/mark_notifications_read')) {
      state.notificationWrites++; await delay();
      if (state.failNotificationWrites) return reply({ message: 'offline' }, 503);
      const changed = state.notices.filter(row => !row.is_read); changed.forEach(row => { row.is_read = true; }); data = changed.length;
    } else if (url.pathname.endsWith('/rpc/open_notification')) {
      const id = request.postDataJSON().p_id; state.notificationOpens.push(id);
      const row = state.notices.find(row => row.id === id);
      if (!row) return reply({ message: 'Forbidden' }, 403);
      row.is_read = true;
      data = row.target ?? (role === 'DRIVER' ? '/driver/profile' : role === 'COMPANY_ADMIN' ? '/admin/drivers' : '/customer/orders');
    } else if (url.pathname.endsWith('/notifications')) {
      if (request.method() === 'PATCH') {
        state.notificationWrites++; await delay();
        if (state.failNotificationWrites) return reply({ message: 'offline' }, 503);
        const ids = url.searchParams.get('id') ?? '';
        const confirmed = state.notices.filter(row => ids.includes(String(row.id)));
        confirmed.forEach(row => { row.is_read = true; }); data = confirmed.map(row => ({ id: row.id }));
      } else {
        if (state.failNotificationReads) return reply({ message: 'offline' }, 503);
        data = state.notices;
      }
    } else if (url.pathname.endsWith('/news_articles')) {
      if (request.method() === 'DELETE') {
        state.articleDeletes++; await delay();
        if (state.failArticleDelete) return reply({ message: 'Изтриването не е потвърдено. Опитай отново.' }, 503);
        state.articles = state.articles.filter(row => url.searchParams.get('id') !== 'eq.' + row.id);
      }
      data = state.articles;
    } else if (url.pathname.endsWith('/save_driver_vehicle')) {
      const body = request.postDataJSON(); state.vehicleWrites.push(body); await delay();
      state.cars.push({ ...body.p_details, id: body.p_id, company_id: uiCompany, is_active: true, created_at: new Date().toISOString() }); data = body.p_id;
    } else if (url.pathname.endsWith('/legal_acceptances')) data = { id: uiAccount };
    else if (url.pathname.endsWith('/company_dashboard')) data = { stats: { totalDrivers: 1, onlineDrivers: 0, activeOrders: 0, completedOrders: 0, cancelledOrders: 0, totalRevenue: 0 }, days: Array.from({ length: 7 }, (_, i) => ({ day: '2026-10-' + String(i + 1).padStart(2, '0'), orders: 0, revenue: 0 })) };
    else if (url.pathname.endsWith('/driver_day_summary')) data = { trips: 7, earnings: 23.5, received: { cash: 10, card: 5, online: 4.23, total: 19.23 } };
    else if (['/company_customers', '/company_fleet', '/company_driver_page'].some(path => url.pathname.endsWith(path))) data = { rows: [], total: 0 };
    else if (url.pathname.endsWith('/operational_health')) data = { checked_at: new Date().toISOString(), stale_online_drivers: 0, flagged_rides_24h: 0, oldest_push_seconds: 0, metrics: [], route_budget: null };
    else if (url.pathname.endsWith('/resolve_partner_access')) data = { status: 'ready', role, company_id: uiCompany, destination: '/admin/dashboard' };
    else if (url.pathname.endsWith('/accounting_report')) {
      const body = request.postDataJSON();
      data = { report_version: 2, currency: 'EUR', generated_at: new Date().toISOString(), period: { from: body.p_from, until: body.p_until, timezone: 'Europe/Sofia' }, scope: { company_id: body.p_company_id ?? uiCompany, driver_id: body.p_driver_id ?? null }, totals: { completed: 0, cancelled: 0, interrupted: 0, booked: 0, missing_amounts: 0, unreported_completed: 0 }, finances: { income: 0, expenses: 0, handed_over: 0, confirmed_handover: 0, confirmed_income: 0, net_income: 0 }, balance: { opening: 0, movement: 0, closing: 0, unconfirmed_handover: 0, unconfirmed_income: 0 }, driver_count: 0, outcome_count: 0, entry_count: 0, outcomes: [], entries: [], reconciliation: [], drivers: [] };
    }
    if (request.headers().accept?.includes('vnd.pgrst.object+json') && Array.isArray(data)) data = data[0] ?? null;
    return reply(data);
  });
  return state;
}

export async function setShortViewport(page: Page, height?: number) {
  await page.evaluate(height => {
    if (height === undefined) delete (window.visualViewport as unknown as { height?: number }).height;
    else Object.defineProperty(window.visualViewport!, 'height', { configurable: true, value: height });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  }, height);
}
