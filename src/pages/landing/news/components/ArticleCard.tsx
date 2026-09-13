import { Link } from 'react-router-dom';
import type { Tables } from '@/lib/database.types';
import { formatDate, readingTime } from '@/lib/news';
import { LOGO_URL } from '@/lib/logo';

type Article = Tables<'news_articles'>;

export default function ArticleCard({ article }: { article: Article }) {
  return (
    <Link
      to={`/novini/${article.slug}`}
      className="group flex flex-col h-full overflow-hidden rounded-lg bg-background-100 border border-background-200/70 hover:-translate-y-1 hover:border-primary-300 transition-all duration-300 cursor-pointer"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-background-200/40">
        {article.featured_image_url ? (
          <img
            src={article.featured_image_url}
            alt={article.featured_image_alt || article.title}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-primary-100 to-accent-100">
            <img src={LOGO_URL} alt="Лески Каручка" className="h-12 w-auto rounded opacity-85" />
          </div>
        )}
      </div>

      <div className="flex flex-col flex-1 p-5 md:p-6">
        {article.category && (
          <span className="inline-flex self-start px-3 py-1 rounded-full bg-accent-100 text-accent-900 text-xs font-semibold mb-3">
            {article.category}
          </span>
        )}
        <h3 className="font-heading font-semibold text-foreground-950 text-base md:text-lg leading-snug mb-2 group-hover:text-primary-600 transition-colors">
          {article.title}
        </h3>
        <p className="text-sm text-foreground-500 leading-relaxed mb-4 line-clamp-3">
          {article.excerpt}
        </p>

        <div className="mt-auto flex items-center justify-between text-xs text-foreground-400">
          <span>{formatDate(article.published_at)}</span>
          <span>{readingTime(article.content)} мин четене</span>
        </div>

        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600">
          Прочети повече
          <i className="ri-arrow-right-line" aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}