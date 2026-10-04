import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LOGO_URL } from '@/lib/logo';
import { dataController, LEGAL_IDENTITY_READY, legalOperator } from '@/config/legal';
import { openCookieSettings } from '@/lib/cookieConsent';

export function DataControllerDetails() {
  return <div className="space-y-2">
    <p><strong>Търговска марка:</strong> {legalOperator.brand} · {legalOperator.website}</p>
    <p><strong>Администратор на личните данни и отговорно лице:</strong> {dataController.name}</p>
    <p><strong>Държава:</strong> {dataController.country}</p>
    <p><strong>Контакт за лични данни и права:</strong> <a className="underline" href={'mailto:' + dataController.email}>{dataController.email}</a></p>
  </div>;
}

export function OperatorDetails() {
  return <div className="space-y-2">
    <DataControllerDetails />
    {LEGAL_IDENTITY_READY ? <>
      <p><strong>Оператор:</strong> {legalOperator.legalName}</p>
      <p><strong>ЕИК / регистрационен номер:</strong> {legalOperator.registrationNumber}</p>
      <p><strong>Седалище и адрес на управление:</strong> {legalOperator.registeredAddress}</p>
      {legalOperator.correspondenceAddress && <p><strong>Адрес за кореспонденция:</strong> {legalOperator.correspondenceAddress}</p>}
      {legalOperator.vatNumber && <p><strong>ДДС номер:</strong> {legalOperator.vatNumber}</p>}
    </> : null}
    <p><strong>Телефон за контакт:</strong> <a className="underline" href={'tel:' + legalOperator.phone}>{legalOperator.phone}</a></p>
  </div>;
}

export default function LegalPage({ title, children, version = legalOperator.termsVersion }: { title: string; children: ReactNode; version?: string }) {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  return <main className="brand-scope min-h-[100dvh] bg-background-50">
    <div className="mx-auto max-w-4xl px-4 md:px-6 py-10 md:py-16">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-primary-700 mb-8 underline">
        <i className="ri-arrow-left-line" aria-hidden="true" /> Към началото
      </Link>
      <div className="flex items-center gap-3 mb-6">
        <img src={LOGO_URL} alt="Лески Каручка" className="h-10 w-auto rounded-lg" />
        <h1 className="text-2xl md:text-3xl font-bold text-foreground-950 font-heading">{title}</h1>
      </div>
      <article className="bg-white rounded-2xl border border-background-200 p-5 md:p-8 space-y-8 text-base text-foreground-800 leading-relaxed [&_h2]:font-semibold [&_h2]:text-foreground-950 [&_h2]:mb-3 [&_p+p]:mt-3 [&_li]:mb-2">
        {children}
        <p className="text-sm pt-4 border-t border-background-200">Версия: {version} · Актуализация: {legalOperator.updatedAt}</p>
      </article>
      <nav aria-label="Правна информация" className="flex flex-wrap gap-x-5 gap-y-3 mt-6 text-sm text-primary-700">
        <Link className="underline" to="/terms">Общи условия</Link>
        <Link className="underline" to="/privacy">Поверителност</Link>
        <a className="underline" href="/data-deletion.html">Изтриване на данни</a>
        <Link className="underline" to="/cookies">Бисквитки</Link>
        <button type="button" className="underline cursor-pointer" onClick={openCookieSettings}>Настройки за бисквитки</button>
      </nav>
    </div>
  </main>;
}
