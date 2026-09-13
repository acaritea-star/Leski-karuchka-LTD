import { useEffect } from 'react';

export interface SeoHead {
  title: string;
  description: string;
  canonical: string;
  image?: string;
  type?: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
  noindex?: boolean;
  jsonLd?: object[];
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function setJsonLd(id: string, data: object) {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

function clearJsonLd() {
  document.head.querySelectorAll('script[id^="seo-jsonld-"]').forEach((el) => el.remove());
}

/**
 * Client-side SEO head manager for the SPA. Sets title, meta description,
 * canonical, Open Graph, Twitter card and JSON-LD structured data.
 *
 * NOTE: this is a client-side React SPA (Vite). The values are applied after
 * the bundle hydrates — Google renders JavaScript, but there is no server-side
 * prerender here, so a brand-new article requires a rebuild to appear in the
 * static sitemap.xml.
 */
export function useDocumentHead(head: SeoHead | null) {
  useEffect(() => {
    if (!head) return;

    document.title = head.title;

    upsertMeta('name', 'description', head.description);
    upsertMeta('name', 'robots', head.noindex ? 'noindex, follow' : 'index, follow');
    upsertCanonical(head.canonical);

    upsertMeta('property', 'og:title', head.title);
    upsertMeta('property', 'og:description', head.description);
    upsertMeta('property', 'og:url', head.canonical);
    upsertMeta('property', 'og:type', head.type ?? 'website');
    upsertMeta('property', 'og:site_name', 'Лески Каручка');
    upsertMeta('property', 'og:locale', 'bg_BG');
    if (head.image) upsertMeta('property', 'og:image', head.image);

    if (head.type === 'article') {
      if (head.publishedTime) upsertMeta('property', 'article:published_time', head.publishedTime);
      if (head.modifiedTime) upsertMeta('property', 'article:modified_time', head.modifiedTime);
      if (head.author) upsertMeta('property', 'article:author', head.author);
    }

    upsertMeta('name', 'twitter:card', head.image ? 'summary_large_image' : 'summary');
    upsertMeta('name', 'twitter:title', head.title);
    upsertMeta('name', 'twitter:description', head.description);
    if (head.image) upsertMeta('name', 'twitter:image', head.image);

    clearJsonLd();
    if (head.jsonLd && head.jsonLd.length) {
      head.jsonLd.forEach((data, i) => setJsonLd(`seo-jsonld-${i}`, data));
    }
  }, [head]);
}