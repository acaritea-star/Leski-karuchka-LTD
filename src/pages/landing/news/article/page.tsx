import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/lib/database.types';
import { useDocumentHead } from '@/hooks/useDocumentHead';
import MarkdownRenderer from '@/components/feature/MarkdownRenderer';
import { formatDate, readingTime } from '@/lib/news';
import { LOGO_URL } from '@/lib/logo';
import ArticleCard from '../components/ArticleCard';
import Reveal from '@/pages/landing/components/Reveal';

const SITE = 'https://leskikaruchka.com';

export default function NewsArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const [article, setArticle] = useState<Tables<'news_articles'> | null>(null);
  const [related, setRelated] = useState<Tables<'news_articles'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setArticle(null);
    setRelated([]);

    supabase
      .from('news_articles')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setArticle(data);
        setLoading(false);

        supabase
          .from('news_articles')
          .select('*')
          .eq('status', 'published')
          .neq('id', data.id)
          .order('published_at', { ascending: false })
          .limit(2)
          .then((res) => {
            if (!cancelled && res.data) setRelated(res.data);
          });
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const canonical = `${SITE}/novini/${slug ?? ''}`;
  const seoTitle = article?.seo_title || (article ? `${article.title} | Лески Каручка` : '');
  const seoDescription = article?.seo_description || article?.excerpt || '';
  const ogImage = article?.featured_image_url || LOGO_URL;

  useDocumentHead(
    notFound
      ? {
          title: 'Статията не е намерена | Лески Каручка',
          description: 'Статията не е намерена.',
          canonical,
          noindex: true,
        }
      : article
        ? {
            title: seoTitle,
            description: seoDescription,
            canonical,
            image: ogImage,
            type: 'article',
            publishedTime: article.published_at ?? undefined,
            modifiedTime: article.updated_at ?? undefined,
            author: article.author_name,
            jsonLd: [
              {
                '@context': 'https://schema.org',
                '@type': 'Article',
                headline: article.title,
                description: seoDescription,
                image: [ogImage],
                datePublished: article.published_at,
                dateModified: article.updated_at,
                author: { '@type': 'Organization', name: article.author_name },
                publisher: {
                  '@type': 'Organization',
                  name: 'Лески Каручка',
                  logo: { '@type': 'ImageObject', url: LOGO_URL },
                },
                mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
              },
              {
                '@context': 'https://schema.org',
                '@type': 'BreadcrumbList',
                itemListElement: [
                  { '@type': 'ListItem', position: 1, name: 'Начало', item: `${SITE}/` },
                  { '@type': 'ListItem', position: 2, name: 'Новини', item: `${SITE}/novini` },
                  { '@type': 'ListItem', position: 3, name: article.title },
                ],
              },
            ],
          }
        : null,
  );

  if (loading) {
    return (
      <div className="bg-background-50 min-h-[60vh] flex items-center justify-center pt-32">
        <div className="w-8 h-8 border-2 border-background-200 border-t-primary-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !article) {
    return (
      <section className="bg-background-50 pt-36 md:pt-48 pb-24 text-center">
        <div className="mx-auto w-full px-4 max-w-lg">
          <h1 className="font-heading font-semibold text-foreground-950 text-3xl md:text-4xl mb-4">
            404
          </h1>
          <p className="text-foreground-500 mb-8">Статията, която търсиш, не е намерена.</p>
          <Link
            to="/novini"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary-500 hover:bg-primary-600 text-white font-semibold text-sm transition-colors whitespace-nowrap"
          >
            <i className="ri-arrow-left-line" aria-hidden="true" />
            Всички новини
          </Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <article className="bg-background-50 pt-32 md:pt-44 pb-16 md:pb-24">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-3xl">
          {/* Breadcrumb */}
          <nav className="flex flex-wrap items-center gap-1.5 text-sm text-foreground-400 mb-8" aria-label="breadcrumb">
            <Link to="/" className="hover:text-primary-600 transition-colors">
              Начало
            </Link>
            <i className="ri-arrow-right-s-line text-xs" aria-hidden="true" />
            <Link to="/novini" className="hover:text-primary-600 transition-colors">
              Новини
            </Link>
            <i className="ri-arrow-right-s-line text-xs" aria-hidden="true" />
            <span className="text-foreground-600 truncate max-w-[220px]">{article.title}</span>
          </nav>

          {article.category && (
            <span className="inline-flex px-3 py-1 rounded-full bg-accent-100 text-accent-900 text-xs font-semibold mb-5">
              {article.category}
            </span>
          )}

          <h1 className="font-heading font-semibold text-foreground-950 text-3xl leading-[1.15] sm:text-4xl md:text-5xl tracking-tight mb-6">
            {article.title}
          </h1>

          <p className="text-foreground-600 text-base md:text-lg leading-relaxed mb-8">
            {article.excerpt}
          </p>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-foreground-400 pb-8 mb-10 border-b border-background-200">
            <span className="flex items-center gap-1.5">
              <i className="ri-user-line" aria-hidden="true" />
              {article.author_name}
            </span>
            <span className="flex items-center gap-1.5">
              <i className="ri-calendar-line" aria-hidden="true" />
              {formatDate(article.published_at)}
            </span>
            <span className="flex items-center gap-1.5">
              <i className="ri-time-line" aria-hidden="true" />
              {readingTime(article.content)} мин четене
            </span>
          </div>

          {article.featured_image_url && (
            <img
              src={article.featured_image_url}
              alt={article.featured_image_alt || article.title}
              className="w-full h-auto max-h-[480px] object-cover object-top rounded-lg mb-12"
            />
          )}

          <MarkdownRenderer content={article.content} />

          {article.updated_at !== article.published_at && (
            <p className="text-xs text-foreground-400 mt-12 pt-6 border-t border-background-200">
              Последна актуализация: {formatDate(article.updated_at)}
            </p>
          )}

          <div className="mt-12 flex items-center justify-between gap-4">
            <Link
              to="/novini"
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary-600 hover:text-primary-700 transition-colors whitespace-nowrap"
            >
              <i className="ri-arrow-left-line" aria-hidden="true" />
              Всички новини
            </Link>
          </div>
        </div>
      </article>

      {/* Related */}
      {related.length > 0 && (
        <section className="bg-background-100 py-16 md:py-24">
          <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-6xl">
            <Reveal className="mb-10">
              <h2 className="font-heading font-semibold text-foreground-950 text-2xl md:text-3xl tracking-tight">
                Още от каручката
              </h2>
            </Reveal>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {related.map((r, i) => (
                <Reveal key={r.id} delay={i * 100}>
                  <ArticleCard article={r} />
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="bg-background-50 py-16 md:py-24">
        <div className="mx-auto w-full px-4 md:px-6 lg:px-10 max-w-3xl text-center">
          <h2 className="font-heading font-medium text-foreground-950 text-2xl md:text-3xl leading-snug tracking-tight mb-8">
            Имаш въпрос или идея?
          </h2>
          <Link
            to="/contact"
            className="inline-flex items-center justify-center px-10 py-4 rounded-full bg-accent-500 hover:bg-accent-600 active:scale-[0.98] text-white font-semibold text-base transition-all whitespace-nowrap cursor-pointer"
          >
            Свържи се с нас
          </Link>
        </div>
      </section>
    </>
  );
}