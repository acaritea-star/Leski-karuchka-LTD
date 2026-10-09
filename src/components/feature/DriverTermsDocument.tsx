import type { DriverPreparationDocument } from '@/lib/driverPreparation';
export default function DriverTermsDocument({ document }: { document: DriverPreparationDocument }) {
  return <article className="space-y-5 text-sm leading-relaxed text-foreground-700">
    <p className="text-xs text-foreground-500">Версия {document.termsVersion} · {document.updatedAt}</p>
    <p>{document.intro}</p>
    {document.sections.map(section => <section key={section.id} className="space-y-2">
      <h3 className="font-semibold text-foreground-950">{section.title}</h3>
      {section.paragraphs.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
    </section>)}
  </article>;
}
