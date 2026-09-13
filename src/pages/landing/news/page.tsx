import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/lib/database.types';
import { useDocumentHead } from '@/hooks/useDocumentHead';
import ArticleCard from './components/ArticleCard';
import Reveal from '@/pages/landing/components/Reveal';

const SITE = 'https://leskikaruchka.com';

export default function NewsListPage() {
  const [articles, setArticles] = useState<Tables<'news_articles'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useDocumentHead({
    title: 'Новини | Лески Каручка',
    description:
      'Новини за развитието на Лески Каручка, тестовете в Левски и идеята за по-достъпен местен превоз в малките градове.',
    canonical: `${SITE}/novini`,
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    supabase
      .from('news_articles')
      .select('*')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .then(({ data, error: e }) => {
        if (cancelled) return;
        if (e) setError(e.message);
        else setArticles(data ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  return (
    <>
      <section className="bg-background-50 pt-36 md:pt-48 pb-10 md:pb-14">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-4xl text-center">
          <span className="inline-block text-xs font-semibold uppercase tracking-[0.35em] text-accent-600 mb-7">
            Новини
          </span>
          <h1 className="font-heading font-semibold text-foreground-950 text-3xl leading-[1.12] sm:text-4xl md:text-5xl tracking-tight mb-6">
            Новини от Лески Каручка
          </h1>
          <p className="text-foreground-600 text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
            Какво изграждаме, защо започваме от Левски и как върви пътят дотук. Честно, стъпка по стъпка.
          </p>
        </div>
      </section>

      <section className="bg-background-50 pb-24 md:pb-32">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-6xl">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-background-200 border-t-primary-500 rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-sm text-red-600 mb-4">{error}</p>
              <button
                onClick={() => setReload((r) => r + 1)}
                className="px-5 py-2.5 rounded-full bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                Опитай отново
              </button>
            </div>
          ) : articles.length === 0 ? (
            <div className="text-center py-20">
              <i className="ri-newspaper-line text-4xl text-foreground-300 mb-4" aria-hidden="true" />
              <p className="text-foreground-500">Все още няма публикувани новини.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {articles.map((a, i) => (
                <Reveal key={a.id} delay={i * 80}>
                  <ArticleCard article={a} />
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}