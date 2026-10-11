// Dependency-free transactional HTML + plain text; no tracking SDK or remote image.
export type InvitationMail = { id: string; kind: 'company' | 'driver'; email: string; company_name?: string | null; attempt: number };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function invitationEmail(mail: InvitationMail) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(mail.id) || !['company', 'driver'].includes(mail.kind)) throw new Error('Invalid invitation');
  const url = 'https://leskikaruchka.com/' + (mail.kind === 'company' ? 'company/login' : 'driver/login') + '?invite=' + mail.id;
  const title = mail.kind === 'company' ? 'Твоята фирма в Лески Каручка' : 'Покана за шофьор в Лески Каручка';
  const intro = mail.kind === 'company' ? 'Поканен си да настроиш фирмения си панел. След входа попълни фирмените данни и тарифите, добави автомобилите и покани шофьорите.'
    : `${mail.company_name || 'Твоята фирма'} те кани да работиш с Лески Каручка. След входа виж правата и задълженията си, премини краткото обучение и качи документите. Фирмата преглежда всичко с едно одобрение.`;
  const instructions = `Влез с Google или Facebook с този потвърден имейл: ${mail.email}. При Facebook без същия имейл използвай Google. Линкът сам по себе си не дава права. Поканата важи 14 дни от създаването ѝ.`;
  const text = `${title}\n\n${intro}\n\nОтвори поканата: ${url}\n\n${instructions}\n\nАко не очакваш тази покана, можеш да я игнорираш. За помощ: support@leskikaruchka.com\n\nЛески Каручка · leskikaruchka.com`;
  const html = `<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f7f7f5;font-family:Arial,sans-serif;color:#1f2937"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px"><tr><td style="padding:28px"><p style="font-size:14px;font-weight:bold;margin:0 0 20px">ЛЕСКИ КАРУЧКА</p><h1 style="font-size:24px;line-height:32px;margin:0 0 20px">${escapeHtml(title)}</h1><p style="font-size:16px;line-height:26px">${escapeHtml(intro)}</p><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#E8B42D" style="border-radius:10px"><a href="${url}" style="display:inline-block;padding:14px 22px;color:#1f2937;text-decoration:none;font-size:16px;font-weight:bold">Отвори поканата</a></td></tr></table><p style="font-size:16px;line-height:26px">${escapeHtml(instructions)}</p><p style="font-size:13px;line-height:20px;color:#4b5563">Ако бутонът не работи, копирай адреса:<br><a href="${url}" style="color:#1f2937;word-break:break-all">${url}</a></p><p style="font-size:13px;line-height:20px;color:#4b5563">Ако не очакваш тази покана, можеш да я игнорираш. За помощ: <a href="mailto:support@leskikaruchka.com" style="color:#1f2937">support@leskikaruchka.com</a></p><p style="font-size:12px;color:#6b7280">Лески Каручка · leskikaruchka.com</p></td></tr></table></td></tr></table></body></html>`;
  return { subject: title, text, html, url, key: `partner-invitation/${mail.id}/${mail.attempt}` };
}
export async function deliverInvitation(mail: InvitationMail, apiKey: string, from: string, replyTo: string, fetcher: typeof fetch = fetch) {
  const rendered = invitationEmail(mail);
  const payload = { from, to: [mail.email], reply_to: replyTo, subject: rendered.subject, html: rendered.html, text: rendered.text };
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetcher('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': rendered.key }, body: JSON.stringify(payload), signal: controller.signal });
      const result = await response.json().catch(() => null);
      if (response.ok && typeof result?.id === 'string') return result.id as string;
      if (!([429, 500, 502, 503, 504].includes(response.status)) || attempt === 1) throw new Error('email_delivery_failed');
      const delay = Number(response.headers.get('retry-after') ?? 1);
      if (!Number.isFinite(delay) || delay > 3) throw new Error('email_rate_limited');
      await new Promise(resolve => setTimeout(resolve, Math.max(500, delay * 1000)));
    } catch (e) {
      if (attempt === 1 || e instanceof Error && ['email_delivery_failed', 'email_rate_limited'].includes(e.message)) throw e;
      await new Promise(resolve => setTimeout(resolve, 700));
    } finally { clearTimeout(timer); }
  }
  throw new Error('email_delivery_failed');
}
