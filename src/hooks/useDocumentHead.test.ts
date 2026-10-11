// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useDocumentHead, type SeoHead } from './useDocumentHead';

afterEach(() => { cleanup(); document.head.innerHTML = ''; });
const page: SeoHead = { title: 'Фирми', description: 'Партньорство', canonical: 'https://leskikaruchka.com/company-partner' };

describe('route metadata ownership', () => {
  it('restores the site defaults after leaving a page, retaining unrelated head entries', () => {
    document.head.innerHTML = '<title>Начало</title><meta name="description" content="Сайт"><link rel="canonical" href="https://leskikaruchka.com/"><meta name="theme-color" content="#abc">';
    const { unmount } = renderHook(() => useDocumentHead(page));
    expect(document.title).toBe('Фирми');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(page.canonical);
    unmount();
    expect(document.title).toBe('Начало');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Сайт');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://leskikaruchka.com/');
    expect(document.querySelector('meta[property="og:url"]')).toBeNull();
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#abc');
  });

  it('does not leak article dates, images or structured data into the next page', () => {
    document.head.innerHTML = '<title>Начало</title><script id="seo-jsonld-0" type="application/ld+json">{"name":"base"}</script>';
    const article: SeoHead = { ...page, type: 'article', publishedTime: '2026-10-11', image: '/article.png', jsonLd: [{ name: 'article' }] };
    const { rerender } = renderHook(({ head }: { head: SeoHead | null }) => useDocumentHead(head), { initialProps: { head: article as SeoHead | null } });
    expect(document.querySelector('meta[property="article:published_time"]')).not.toBeNull();
    rerender({ head: page });
    expect(document.querySelector('meta[property="article:published_time"]')).toBeNull();
    expect(document.querySelector('meta[property="og:image"]')).toBeNull();
    expect(document.querySelector('[id^="seo-jsonld-"]')).toBeNull();
    rerender({ head: null });
    expect(document.title).toBe('Начало');
    expect(document.querySelector('#seo-jsonld-0')?.textContent).toBe('{"name":"base"}');
  });
});
