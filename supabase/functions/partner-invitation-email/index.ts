import { admin, authorize, cors, json } from '../_shared/auth.ts';
import { deliverInvitation, type InvitationMail } from '../_shared/partnerInvitationEmail.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  // Public readiness exposes only a boolean, never a credential or recipient.
  if (req.method === 'GET') return json({ ready: !!Deno.env.get('RESEND_API_KEY') });
  if (req.method !== 'POST') return json({ message: 'Method not allowed' }, 405);
  try {
    const actor = await authorize(req); // Validated Auth user + active server profile + rate limit.
    const body = await req.json();
    const apiKey = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('RESEND_INVITES_FROM_EMAIL') || 'Лески Каручка <pokani@leskikaruchka.com>';
    const replyTo = Deno.env.get('RESEND_REPLY_TO_EMAIL') || 'support@leskikaruchka.com';
    if (body.action === 'configuration') {
      if (actor.role !== 'SUPER_ADMIN') return json({ message: 'Administrator required' }, 403);
      return json({ configured: !!apiKey, from, reply_to: replyTo });
    }
    const id = body.invitation_id;
    if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return json({ message: 'Невалидна покана.' }, 400);
    const { data, error } = await admin.rpc('claim_partner_invitation_email', { p_id: id, p_actor: actor.id, p_resend: body.resend === true });
    if (error) return json({ message: error.code === '42501' ? 'Нямате права за тази покана.' : 'Поканата не може да бъде изпратена сега. Проверете статуса или използвайте личния линк.' }, error.code === '42501' ? 403 : 409);
    if (!data?.claimed) return json({ status: data?.status || 'pending' });
    let messageId: string | null = null;
    try {
      if (!apiKey) throw new Error('email_not_configured');
      messageId = await deliverInvitation({ id, kind: data.kind, email: data.email, company_name: data.company_name, attempt: data.attempt } as InvitationMail, apiKey, from, replyTo);
    } catch {
      const { error: failedWrite } = await admin.rpc('finish_partner_invitation_email', { p_id: id, p_lease: data.lease, p_message: null, p_error: apiKey ? 'Изпращането не е потвърдено. Използвайте личния линк или опитайте отново.' : 'RESEND_API_KEY не е настроен в Edge Function Secrets.' });
      return json({ status: failedWrite ? 'sending' : 'failed', message: 'Поканата е запазена, но имейлът не е потвърден. Можете да копирате личния линк.' });
    }
    const { data: recorded, error: recordError } = await admin.rpc('finish_partner_invitation_email', { p_id: id, p_lease: data.lease, p_message: messageId, p_error: null });
    return json({ status: !recordError && recorded ? 'sent' : 'sending' });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ message: 'Услугата за покани не е достъпна. Поканата е запазена; проверете статуса.' }, 503);
  }
});
