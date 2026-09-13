import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/lib/database.types';
import ArticleCard from '@/pages/landing/news/components/ArticleCard';
import Reveal from '@/pages/landing/components/Reveal';

export default function NewsSection() {
  const [articles, setArticles] = useState<Tables<'news_articles'>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .from('news_articles')
      .select('*')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(3)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data) setArticles(data);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="bg-background-50 py-24 md:py-32">
      <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-6xl">
        <Reveal className="max-w-2xl mb-12 md:mb-16">
          <span className="inline-block text-xs font-semibold uppercase tracking-[0.3em] text-accent-600">
            ОТ КАРУЧКАТА
          </span>
          <h2 className="font-heading font-semibold text-foreground-950 text-2xl md:text-4xl tracking-tight mt-3 mb-4">
            Последни новини
          </h2>
          <p className="text-foreground-500 text-base md:text-lg leading-relaxed">
            Какво изграждаме, защо започваме от Левски и как върви пътят дотук.
          </p>
        </Reveal>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-background-200 border-t-primary-500 rounded-full animate-spin" />
          </div>
        ) : articles.length === 0 ? (
          <p className="text-foreground-400 text-sm">Скоро ще има новини.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {articles.map((a, i) => (
              <Reveal key={a.id} delay={i * 100}>
                <ArticleCard article={a} />
              </Reveal>
            ))}
          </div>
        )}

        <Reveal className="mt-10 md:mt-12">
          <Link
            to="/novini"
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary-600 hover:text-primary-700 transition-colors"
          >
            Виж всички новини
            <i className="ri-arrow-right-line" aria-hidden="true" />
          </Link>
        </Reveal>
      </div>
    </section>
  );
}