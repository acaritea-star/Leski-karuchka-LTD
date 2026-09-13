interface PageHeroProps {
  badge: string;
  title: string;
  subtitle: string;
}

export default function PageHero({ badge, title, subtitle }: PageHeroProps) {
  return (
    <section className="bg-background-50 pt-36 md:pt-48 pb-16 md:pb-24">
      <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-4xl text-center">
        <span className="inline-block text-xs font-semibold uppercase tracking-[0.35em] text-primary-600 mb-7">
          {badge}
        </span>
        <h1 className="font-heading font-semibold text-foreground-950 text-3xl leading-[1.12] sm:text-4xl md:text-5xl tracking-tight mb-6">
          {title}
        </h1>
        <p className="text-foreground-600 text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
          {subtitle}
        </p>
      </div>
    </section>
  );
}