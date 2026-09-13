import { toArticleStatus } from '@/lib/news';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/lib/database.types';
import { formatDate, type ArticleStatus } from '@/lib/news';
import AdminLayout from '@/pages/admin/components/AdminLayout';

type Article = Tables<'news_articles'>;

const STATUS_LABEL: Record<ArticleStatus, string> = {
  draft: 'Чернова',
  published: 'Публикувана',
  archived: 'Архивирана',
};

function StatusBadge({ status }: { status: ArticleStatus }) {
  const cls =
    status === 'published'
      ? 'bg-primary-100 text-primary-700'
      : status === 'draft'
        ? 'bg-secondary-100 text-secondary-900'
        : 'bg-background-200 text-foreground-500';
  return (
    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function AdminNews() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [deleting, setDeleting] = useState<Article | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    supabase
      .from('news_articles')
      .select('*')
      .order('updated_at', { ascending: false })
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

  const categories = useMemo(
    () => Array.from(new Set(articles.map((a) => a.category).filter(Boolean))) as string[],
    [articles],
  );

  const filtered = useMemo(() => {
    let list = articles;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => a.title.toLowerCase().includes(q));
    }
    if (statusFilter) list = list.filter((a) => a.status === statusFilter);
    if (categoryFilter) list = list.filter((a) => a.category === categoryFilter);
    return [...list].sort((a, b) => {
      const da = new Date(a.published_at || a.updated_at).getTime();
      const db = new Date(b.published_at || b.updated_at).getTime();
      return sortDir === 'desc' ? db - da : da - db;
    });
  }, [articles, search, statusFilter, categoryFilter, sortDir]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3000);
  }

  async function changeStatus(article: Article, status: ArticleStatus) {
    setBusy(true);
    const payload: Partial<Article> = { status };
    if (status === 'published' && !article.published_at) {
      payload.published_at = new Date().toISOString();
    }
    const { error: e } = await supabase.from('news_articles').update(payload).eq('id', article.id);
    setBusy(false);
    if (e) {
      showToast(`Грешка: ${e.message}`);
      return;
    }
    showToast('Статусът е обновен.');
    setReload((r) => r + 1);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    const { error: e } = await supabase.from('news_articles').delete().eq('id', deleting.id);
    setBusy(false);
    setDeleting(null);
    if (e) {
      showToast(`Грешка: ${e.message}`);
      return;
    }
    showToast('Статията е изтрита.');
    setReload((r) => r + 1);
  }

  return (
    <AdminLayout title="Новини">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-foreground-950 text-background-50 text-sm font-medium px-5 py-3 rounded-lg">
          {toast}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Търсене по заглавие..."
              className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-white border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>
          <Link
            to="/admin/news/new"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
          >
            <i className="ri-add-line" />
            Нова статия
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white border border-background-200 text-sm text-foreground-800 cursor-pointer"
          >
            <option value="">Всички статуси</option>
            <option value="draft">Чернова</option>
            <option value="published">Публикувана</option>
            <option value="archived">Архивирана</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white border border-background-200 text-sm text-foreground-800 cursor-pointer"
          >
            <option value="">Всички категории</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <button
            onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-background-200 text-sm text-foreground-800 cursor-pointer whitespace-nowrap"
          >
            <i className="ri-arrow-up-down-line" />
            {sortDir === 'desc' ? 'Най-нови първо' : 'Най-стари първо'}
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-4 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error}
          <button
            onClick={() => setReload((r) => r + 1)}
            className="ml-auto text-xs font-semibold underline cursor-pointer whitespace-nowrap"
          >
            Опитай отново
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <i className="ri-newspaper-line text-4xl text-foreground-300 mb-3" />
          <p className="text-sm text-foreground-500">
            {articles.length === 0 ? 'Все още няма статии.' : 'Няма резултати за този филтър.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-background-100 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-foreground-400 border-b border-background-100">
                  <th className="px-4 py-3 font-semibold">Заглавие</th>
                  <th className="px-4 py-3 font-semibold">Статус</th>
                  <th className="px-4 py-3 font-semibold">Категория</th>
                  <th className="px-4 py-3 font-semibold">Публикувана</th>
                  <th className="px-4 py-3 font-semibold">Редактирана</th>
                  <th className="px-4 py-3 font-semibold">Featured</th>
                  <th className="px-4 py-3 font-semibold text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-b border-background-100 last:border-0 hover:bg-background-50">
                    <td className="px-4 py-3 font-medium text-foreground-950 max-w-[280px] truncate">
                      {a.title}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={toArticleStatus(a.status)} />
                    </td>
                    <td className="px-4 py-3 text-foreground-600">{a.category || '—'}</td>
                    <td className="px-4 py-3 text-foreground-600 whitespace-nowrap">
                      {formatDate(a.published_at) || '—'}
                    </td>
                    <td className="px-4 py-3 text-foreground-600 whitespace-nowrap">
                      {formatDate(a.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      {a.is_featured ? (
                        <i className="ri-star-fill text-accent-500" aria-label="Featured" />
                      ) : (
                        <span className="text-foreground-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          to={`/admin/news/${a.id}`}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-500 hover:bg-background-100 cursor-pointer"
                          title="Редактирай"
                        >
                          <i className="ri-edit-line" />
                        </Link>
                        {a.status === 'published' && (
                          <Link
                            to={`/novini/${a.slug}`}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-500 hover:bg-background-100 cursor-pointer"
                            title="Преглед"
                          >
                            <i className="ri-eye-line" />
                          </Link>
                        )}
                        {a.status !== 'published' && (
                          <button
                            onClick={() => changeStatus(a, 'published')}
                            disabled={busy}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-primary-600 hover:bg-primary-50 cursor-pointer disabled:opacity-50"
                            title="Публикувай"
                          >
                            <i className="ri-send-plane-line" />
                          </button>
                        )}
                        {a.status !== 'archived' && (
                          <button
                            onClick={() => changeStatus(a, 'archived')}
                            disabled={busy}
                            className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-500 hover:bg-background-100 cursor-pointer disabled:opacity-50"
                            title="Архивирай"
                          >
                            <i className="ri-archive-line" />
                          </button>
                        )}
                        <button
                          onClick={() => setDeleting(a)}
                          disabled={busy}
                          className="w-8 h-8 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                          title="Изтрий"
                        >
                          <i className="ri-delete-bin-line" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full">
            <h3 className="font-heading font-semibold text-foreground-950 text-lg mb-2">
              Изтриване на статия
            </h3>
            <p className="text-sm text-foreground-500 mb-6">
              Сигурен ли си, че искаш да изтриеш „{deleting.title}“? Това действие е необратимо.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleting(null)}
                className="px-4 py-2 rounded-lg border border-background-200 text-sm font-semibold text-foreground-700 hover:bg-background-100 cursor-pointer whitespace-nowrap"
              >
                Отказ
              </button>
              <button
                onClick={confirmDelete}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                Изтрий
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}