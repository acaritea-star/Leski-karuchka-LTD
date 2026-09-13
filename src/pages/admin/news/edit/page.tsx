import { toArticleStatus } from '@/lib/news';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { Tables } from '@/lib/database.types';
import { slugify, type ArticleStatus } from '@/lib/news';
import MarkdownRenderer from '@/components/feature/MarkdownRenderer';
import AdminLayout from '@/pages/admin/components/AdminLayout';

type Article = Tables<'news_articles'>;

const SITE = 'https://leskikaruchka.com';

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface FormState {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  category: string;
  featured_image_url: string;
  featured_image_alt: string;
  author_name: string;
  seo_title: string;
  seo_description: string;
  status: ArticleStatus;
  published_at: string;
  is_featured: boolean;
}

const EMPTY: FormState = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  category: '',
  featured_image_url: '',
  featured_image_alt: '',
  author_name: 'Лески Каручка',
  seo_title: '',
  seo_description: '',
  status: 'draft',
  published_at: '',
  is_featured: false,
};

export default function AdminNewsEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle');
  const [toast, setToast] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);
  const slugTouchedRef = useRef(!isNew);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from('news_articles')
      .select('*')
      .eq('id', id!)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setLoadError('Статията не е намерена.');
          setLoading(false);
          return;
        }
        setForm({
          title: data.title,
          slug: data.slug,
          excerpt: data.excerpt,
          content: data.content,
          category: data.category ?? '',
          featured_image_url: data.featured_image_url ?? '',
          featured_image_alt: data.featured_image_alt ?? '',
          author_name: data.author_name,
          seo_title: data.seo_title ?? '',
          seo_description: data.seo_description ?? '',
          status: toArticleStatus(data.status),
          published_at: toLocalInput(data.published_at),
          is_featured: data.is_featured,
        });
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  // Warn on leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3000);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  }

  function handleTitle(v: string) {
    setForm((f) => {
      const next = { ...f, title: v };
      if (!slugTouchedRef.current) next.slug = slugify(v);
      return next;
    });
    setDirty(true);
  }

  function handleSlug(v: string) {
    slugTouchedRef.current = true;
    setForm((f) => ({ ...f, slug: slugify(v) }));
    setDirty(true);
    setSlugStatus('idle');
  }

  async function checkSlug() {
    if (!form.slug.trim()) return;
    setSlugStatus('checking');
    let q = supabase.from('news_articles').select('id').eq('slug', form.slug);
    if (!isNew) q = q.neq('id', id!);
    const { data, error } = await q.maybeSingle();
    if (error) {
      setSlugStatus('idle');
      return;
    }
    setSlugStatus(data ? 'taken' : 'ok');
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('Файлът е по-голям от 5 MB.');
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (!allowed.includes(file.type)) {
      showToast('Позволени формати: JPG, PNG, WebP и AVIF.');
      return;
    }
    setUploading(true);
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('news-images').upload(name, file);
    if (error) {
      setUploading(false);
      showToast(`Грешка при качване: ${error.message}`);
      return;
    }
    const { data: urlData } = supabase.storage.from('news-images').getPublicUrl(name);
    setUploading(false);
    update('featured_image_url', urlData.publicUrl);
    showToast('Снимката е качена.');
    e.target.value = '';
  }

  function buildPayload(): import('@/lib/database.types').TablesInsert<'news_articles'> {
    const published_at = form.published_at ? new Date(form.published_at).toISOString() : null;
    return {
      title: form.title.trim(),
      slug: form.slug.trim(),
      excerpt: form.excerpt.trim(),
      content: form.content,
      category: form.category.trim() || null,
      featured_image_url: form.featured_image_url || null,
      featured_image_alt: form.featured_image_alt.trim() || null,
      author_name: form.author_name.trim() || 'Лески Каручка',
      seo_title: form.seo_title.trim() || null,
      seo_description: form.seo_description.trim() || null,
      status: form.status,
      is_featured: form.is_featured,
      published_at,
    };
  }

  function validate(): string | null {
    if (!form.title.trim()) return 'Заглавието е задължително.';
    if (!form.slug.trim()) return 'Slug-ът е задължителен.';
    if (!form.excerpt.trim()) return 'Краткото описание е задължително.';
    if (!form.content.trim()) return 'Съдържанието е задължително.';
    return null;
  }

  async function save(status: ArticleStatus) {
    const err = validate();
    if (err) {
      showToast(err);
      return;
    }
    setSaving(true);
    let payload = buildPayload();
    payload.status = status;
    if (status === 'published' && !payload.published_at) {
      payload.published_at = new Date().toISOString();
    }

    let error: { message: string } | null = null;
    if (isNew) {
      const res = await supabase.from('news_articles').insert(payload).select('id').single();
      error = res.error;
      if (!res.error && res.data) {
        setDirty(false);
        showToast(status === 'published' ? 'Статията е публикувана.' : 'Статията е запазена.');
        navigate(`/admin/news/${res.data.id}`, { replace: true });
      }
    } else {
      const res = await supabase.from('news_articles').update(payload).eq('id', id!);
      error = res.error;
      if (!res.error) {
        setDirty(false);
        setForm((f) => ({
          ...f,
          status,
          published_at: payload.published_at ? toLocalInput(payload.published_at) : f.published_at,
        }));
        showToast(status === 'published' ? 'Статията е публикувана.' : 'Статията е запазена.');
      }
    }
    setSaving(false);
    if (error) showToast(`Грешка: ${error.message}`);
  }

  async function handleDelete() {
    if (isNew) return;
    setSaving(true);
    const { error } = await supabase.from('news_articles').delete().eq('id', id!);
    setSaving(false);
    setConfirmDelete(false);
    if (error) {
      showToast(`Грешка: ${error.message}`);
      return;
    }
    showToast('Статията е изтрита.');
    navigate('/admin/news');
  }

  const inputCls =
    'w-full px-4 py-2.5 rounded-lg bg-white border border-background-200 text-sm text-foreground-950 focus:outline-none focus:ring-2 focus:ring-primary-200';
  const labelCls = 'block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider';

  if (loading) {
    return (
      <AdminLayout title="Редактор на статия">
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AdminLayout>
    );
  }

  if (loadError) {
    return (
      <AdminLayout title="Редактор на статия">
        <div className="bg-red-50 text-red-600 text-sm rounded-xl px-4 py-4">{loadError}</div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title={isNew ? 'Нова статия' : 'Редактиране на статия'}>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-foreground-950 text-background-50 text-sm font-medium px-5 py-3 rounded-lg">
          {toast}
        </div>
      )}

      <div className="max-w-5xl space-y-6">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/admin/news"
            className="inline-flex items-center gap-2 text-sm font-medium text-foreground-600 hover:text-foreground-950 cursor-pointer whitespace-nowrap"
          >
            <i className="ri-arrow-left-line" />
            Назад към новините
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => save('draft')}
              disabled={saving}
              className="px-4 py-2.5 rounded-lg border border-background-200 text-sm font-semibold text-foreground-700 hover:bg-background-100 cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              Запази като чернова
            </button>
            <button
              onClick={() => save('published')}
              disabled={saving}
              className="px-5 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              Публикувай
            </button>
            {!isNew && form.status !== 'archived' && (
              <button
                onClick={() => save('archived')}
                disabled={saving}
                className="px-4 py-2.5 rounded-lg border border-background-200 text-sm font-semibold text-foreground-700 hover:bg-background-100 cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                Архивирай
              </button>
            )}
          </div>
        </div>

        {/* Main fields */}
        <div className="bg-white border border-background-100 rounded-xl p-5 md:p-6 space-y-5">
          <div>
            <label className={labelCls}>Заглавие *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => handleTitle(e.target.value)}
              className={inputCls}
              placeholder="Заглавие на статията"
            />
          </div>

          <div>
            <label className={labelCls}>Slug *</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={form.slug}
                onChange={(e) => handleSlug(e.target.value)}
                onBlur={checkSlug}
                className={inputCls}
                placeholder="kakvo-e-leski-karuchka"
              />
              {slugStatus === 'checking' && (
                <span className="text-xs text-foreground-400 whitespace-nowrap">Проверка...</span>
              )}
              {slugStatus === 'ok' && (
                <span className="text-xs text-green-600 whitespace-nowrap">Свободен ✓</span>
              )}
              {slugStatus === 'taken' && (
                <span className="text-xs text-red-600 whitespace-nowrap">Зает — избери друг</span>
              )}
            </div>
            <p className="text-xs text-foreground-400 mt-1">URL: {SITE}/novini/{form.slug || '…'}</p>
          </div>

          <div>
            <label className={labelCls}>Кратко описание *</label>
            <textarea
              value={form.excerpt}
              onChange={(e) => update('excerpt', e.target.value)}
              rows={2}
              className={`${inputCls} resize-none`}
              placeholder="Кратко резюме на статията"
            />
          </div>

          <div>
            <label className={labelCls}>Категория</label>
            <input
              type="text"
              value={form.category}
              onChange={(e) => update('category', e.target.value)}
              className={inputCls}
              placeholder="Напр. За проекта"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Автор</label>
              <input
                type="text"
                value={form.author_name}
                onChange={(e) => update('author_name', e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Дата на публикуване</label>
              <input
                type="datetime-local"
                value={form.published_at}
                onChange={(e) => update('published_at', e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white border border-background-100 rounded-xl p-5 md:p-6">
          <label className={labelCls}>Съдържание (Markdown) *</label>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-1">
            <textarea
              value={form.content}
              onChange={(e) => update('content', e.target.value)}
              rows={18}
              className={`${inputCls} resize-y font-mono text-[13px] leading-relaxed`}
              placeholder={'Напиши в Markdown.\n\n## Подзаглавие\n\n**Удебелен** текст и [линк](/about).\n\n* точка 1\n* точка 2'}
            />
            <div className="border border-background-100 rounded-lg p-5 bg-background-50 overflow-auto max-h-[480px]">
              {form.content.trim() ? (
                <MarkdownRenderer content={form.content} />
              ) : (
                <p className="text-sm text-foreground-300">Прегледът ще се покаже тук.</p>
              )}
            </div>
          </div>
        </div>

        {/* Featured image */}
        <div className="bg-white border border-background-100 rounded-xl p-5 md:p-6 space-y-4">
          <div>
            <label className={labelCls}>Featured изображение</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={handleImageUpload}
              className="block w-full text-sm text-foreground-600 file:mr-4 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-primary-500 file:text-white file:text-sm file:font-semibold file:cursor-pointer"
            />
            {uploading && <p className="text-xs text-foreground-400 mt-2">Качване...</p>}
          </div>
          {form.featured_image_url && (
            <div className="flex items-start gap-3">
              <img
                src={form.featured_image_url}
                alt="Featured"
                className="w-32 h-20 object-cover object-top rounded-lg border border-background-200"
              />
              <button
                onClick={() => update('featured_image_url', '')}
                className="text-xs font-semibold text-red-500 hover:text-red-600 cursor-pointer whitespace-nowrap"
              >
                Премахни
              </button>
            </div>
          )}
          <div>
            <label className={labelCls}>Alt текст на изображението</label>
            <input
              type="text"
              value={form.featured_image_alt}
              onChange={(e) => update('featured_image_alt', e.target.value)}
              className={inputCls}
              placeholder="Описание на изображението"
            />
          </div>
        </div>

        {/* SEO */}
        <div className="bg-white border border-background-100 rounded-xl p-5 md:p-6 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-foreground-700 uppercase tracking-wider">
                SEO заглавие
              </label>
              <span className={`text-xs ${form.seo_title.length > 60 ? 'text-red-500' : 'text-foreground-400'}`}>
                {form.seo_title.length}/60
              </span>
            </div>
            <input
              type="text"
              value={form.seo_title}
              onChange={(e) => update('seo_title', e.target.value)}
              className={inputCls}
              placeholder="Остави празно, за да се използва заглавието"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-foreground-700 uppercase tracking-wider">
                Meta описание
              </label>
              <span className={`text-xs ${form.seo_description.length > 160 ? 'text-red-500' : 'text-foreground-400'}`}>
                {form.seo_description.length}/160
              </span>
            </div>
            <textarea
              value={form.seo_description}
              onChange={(e) => update('seo_description', e.target.value)}
              rows={2}
              className={`${inputCls} resize-none`}
              placeholder="Остави празно, за да се използва краткото описание"
            />
          </div>
        </div>

        {/* Options */}
        <div className="bg-white border border-background-100 rounded-xl p-5 md:p-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_featured}
              onChange={(e) => update('is_featured', e.target.checked)}
              className="w-4 h-4 rounded border-background-300 text-primary-600 focus:ring-primary-400"
            />
            <span className="text-sm font-medium text-foreground-800">
              Отбележи като featured (показва се на видно място)
            </span>
          </label>
        </div>

        {/* Danger zone */}
        {!isNew && (
          <div className="flex justify-end">
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold text-red-500 hover:bg-red-50 cursor-pointer whitespace-nowrap"
            >
              Изтрий статията
            </button>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full">
            <h3 className="font-heading font-semibold text-foreground-950 text-lg mb-2">
              Изтриване на статия
            </h3>
            <p className="text-sm text-foreground-500 mb-6">
              Сигурен ли си, че искаш да изтриеш тази статия? Това действие е необратимо.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 rounded-lg border border-background-200 text-sm font-semibold text-foreground-700 hover:bg-background-100 cursor-pointer whitespace-nowrap"
              >
                Отказ
              </button>
              <button
                onClick={handleDelete}
                disabled={saving}
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