import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { invitationId, partnerEntryPath } from '@/lib/authReturn';
import { invitationLoginPath } from '@/lib/partnerAccess';

export default function DriverJoin() {
  const { session, loading } = useAuth(); const location = useLocation();
  const invite = invitationId(location.search);
  if (session && !loading) return <Navigate to={partnerEntryPath('driver', invite)} replace />;
  return <section className="max-w-2xl mx-auto px-4 py-16 space-y-5">
    <h1 className="text-3xl font-heading font-semibold">Карай с Лески Каручка</h1>
    <p className="text-foreground-600">Твоята фирма изпраща лична покана по имейл. Влез с поканения акаунт, запознай се с правата и задълженията, премини краткото обучение и качи документите си.</p>
    <p className="text-sm text-foreground-500">Фирмата проверява целия комплект и автомобила. След одобрението получаваш достъп до онлайн режима и заявките.</p>
    <Link to={invitationLoginPath('driver', invite)} className="inline-block rounded-xl bg-primary-500 text-white px-6 py-3">Вход за шофьори</Link>
    <p className="text-sm">Нямаш покана? Поискай я от твоята фирма.</p>
  </section>;
}
