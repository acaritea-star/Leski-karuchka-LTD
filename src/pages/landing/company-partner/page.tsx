import { Link } from 'react-router-dom';
import PageHero from '@/pages/landing/components/PageHero';
import Reveal from '@/pages/landing/components/Reveal';
import { useDocumentHead } from '@/hooks/useDocumentHead';

const head = {
  title: 'Стани фирма партньор · Лески Каручка',
  description: 'Заявки, шофьори и отчет за твоята таксиметрова фирма. Такса за обслужване към Лески Каручка: 8–12% за завършени и платени курсове, доведени от платформата.',
  canonical: 'https://leskikaruchka.com/company-partner',
};

const benefits = [
  { icon: 'ri-route-line', title: 'Клиентите намират твоята фирма', body: 'Свързваме търсещите транспорт с наличните водачи в обслужвания район. Твоята фирма извършва превоза и определя законната си тарифа.' },
  { icon: 'ri-file-chart-line', title: 'Отчетът е на едно място', body: 'Следи курсовете, записаните приходи, разходите и предадените суми. Сверявай с действителните плащания и документите на фирмата.' },
  { icon: 'ri-steering-2-line', title: 'Ясно и за шофьорите', body: 'Личен профил, кратко обучение и проверка на документите. Всеки водач знае как работи приложението и какво означава таксата.' },
];

const questions = [
  { title: 'За кои курсове се дължи такса?', body: 'За реално завършен и платен курс, чийто клиент е доведен през Лески Каручка. Основата е действително платената сума за превоза, без бакшиши и възстановени суми. Отказана заявка, неизвършен или неплатен курс не създава тази такса.' },
  { title: 'А собствените ни клиенти?', body: 'Курсовете от собствени клиенти на фирмата, записани само за отчетност, са без тази такса за обслужване. Искаме да имаш причина да водиш пълен и честен отчет.' },
  { title: 'Кой плаща — фирмата или шофьорът?', body: 'Таксата се урежда с фирмата партньор по нейния договор с платформата. Тя не е допълнителна сума, която клиентът плаща върху цената на превоза. Разплащането между фирма и водач е по техния договор; приемането на обучението не разрешава автоматична удръжка от личния доход на шофьора.' },
  { title: 'Как стигаме до по-нисък процент?', body: 'Отчитаме активните автомобили и водачи, както и броя и оборота на завършените и платени курсове, доведени през платформата. При по-голям обем договаряме по-ниска ставка в диапазона 8–12%. Периодът за преглед и условията се записват предварително; новият процент важи занапред.' },
  { title: 'Какво покрива таксата?', body: 'Дигиталното посредничество: свързването с клиента, обработката на заявката, използването на платформата, отчетността и поддръжката. Лески Каручка предоставя софтуера; действителният превозвач извършва превоза и издава необходимите платежни документи.' },
];

export default function CompanyPartnerPage() {
  useDocumentHead(head);
  return <>
    <PageHero badge="За таксиметрови фирми" title="Стани фирма партньор" subtitle="Ти познаваш града и хората. Ние помагаме клиентите да те намерят, а ти да виждаш какво се случва с курсовете и парите." />
    <section className="bg-background-50 pb-16 md:pb-20">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="grid gap-5 md:grid-cols-3">
          {benefits.map((benefit, index) => <Reveal key={benefit.title} delay={index * 70}>
            <article className="h-full rounded-2xl border border-background-200 bg-white p-6">
              <i className={benefit.icon + ' text-2xl text-primary-600'} aria-hidden="true" />
              <h2 className="font-heading mt-4 mb-3 text-lg font-semibold text-foreground-950">{benefit.title}</h2>
              <p className="text-base leading-relaxed text-foreground-700">{benefit.body}</p>
            </article>
          </Reveal>)}
        </div>
      </div>
    </section>
    <section className="border-y border-background-200 bg-background-100 py-16 md:py-20" aria-labelledby="partner-fee">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <div>
            <p className="mb-4 text-sm font-semibold text-primary-700">Такса за обслужване към Лески Каручка</p>
            <h2 id="partner-fee" className="font-heading text-3xl font-semibold leading-tight text-foreground-950 md:text-4xl">Повече курсове.<br />По-малък процент.</h2>
            <p className="font-heading my-6 text-5xl font-semibold tracking-tight text-primary-600 md:text-6xl">8–12%</p>
            <p className="text-base leading-relaxed text-foreground-700">От платения оборот на курсовете, които платформата ти е довела. Капацитетът на фирмата и реалният обем работа участват в договарянето на процента.</p>
            <p className="mt-4 text-sm leading-relaxed text-foreground-700">Точната ставка, периодът за преглед и сроковете за плащане се уговарят преди започване на платеното партньорство. Диапазонът е за пълната такса за обслужване, с включен ДДС, когато е приложим. Промени важат занапред и се съобщават предварително.</p>
          </div>
          <div className="rounded-2xl border border-background-200 bg-white p-5 md:p-7">
            <h3 className="font-heading text-xl font-semibold text-foreground-950">Пример с 100 € платен оборот</h3>
            <p className="mt-3 text-sm leading-relaxed text-foreground-700">Само от курсове, доведени през платформата. Трите ставки са пример за сметката, а не автоматични нива.</p>
            <table className="mt-5 w-full text-left text-sm">
              <caption className="sr-only">Примерна такса и остатък за фирмата при 100 евро платен оборот</caption>
              <thead><tr className="border-b border-background-200 text-foreground-600"><th scope="col" className="py-3 pr-2">Ставка</th><th scope="col" className="py-3 px-2">Такса</th><th scope="col" className="py-3 pl-2 text-right">За фирмата</th></tr></thead>
              <tbody>{[{ rate: 12, fee: 12, remainder: 88 }, { rate: 10, fee: 10, remainder: 90 }, { rate: 8, fee: 8, remainder: 92 }].map(example => <tr key={example.rate} className="border-b border-background-100 text-foreground-950"><th scope="row" className="py-4 pr-2 font-semibold">{example.rate}%</th><td className="py-4 px-2">{example.fee} €</td><td className="py-4 pl-2 text-right font-semibold">{example.remainder} €</td></tr>)}</tbody>
            </table>
            <p className="mt-4 text-sm leading-relaxed text-foreground-600">Остатъкът е преди разходите, данъците и разплащането с водачите. Това е оборот след таксата, а не чиста печалба.</p>
          </div>
        </div>
      </div>
    </section>
    <section className="bg-background-50 py-16 md:py-20" aria-labelledby="partner-questions">
      <div className="mx-auto max-w-3xl px-4 md:px-6">
        <h2 id="partner-questions" className="font-heading mb-7 text-2xl font-semibold text-foreground-950 md:text-3xl">Да е ясно от самото начало.</h2>
        <div className="space-y-3">{questions.map(question => <details key={question.title} className="rounded-2xl border border-background-200 bg-white p-5">
          <summary className="cursor-pointer text-base font-semibold text-foreground-950">{question.title}</summary>
          <p className="mt-4 text-base leading-relaxed text-foreground-700">{question.body}</p>
        </details>)}</div>
      </div>
    </section>
    <section className="bg-background-100 py-16 md:py-20">
      <div className="mx-auto max-w-3xl px-4 text-center md:px-6">
        <h2 className="font-heading text-2xl font-semibold text-foreground-950 md:text-3xl">Кажи ни за твоята фирма.</h2>
        <p className="mt-4 text-base leading-relaxed text-foreground-700">В кой град работите, с колко автомобила и водачи? Обсъждаме условията, подготвяме фирмения достъп и минаваме през документите и обучението заедно.</p>
        <Link to="/contact?subject=partner" className="mt-7 inline-block rounded-full bg-primary-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-primary-700">Да поговорим за партньорство</Link>
        <p className="mt-5 text-sm text-foreground-700">Вече сте партньор? <Link to="/company/login" className="font-semibold text-primary-700 underline">Вход за фирми</Link></p>
        <p className="mt-6 text-sm leading-relaxed text-foreground-600">Запитването не създава платен договор. Наличните заявки зависят от търсенето и водачите в района. <Link to="/terms" className="underline">Общи условия</Link> · <Link to="/privacy" className="underline">Поверителност</Link></p>
      </div>
    </section>
  </>;
}
