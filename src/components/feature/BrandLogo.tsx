import { useState, type ImgHTMLAttributes } from 'react';
import { LOGO_URL } from '@/lib/logo';

/** Retain the brand image, with the bundled PWA mark when its CDN is unavailable. */
export default function BrandLogo({ alt = '', ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'>) {
  const [fallback, setFallback] = useState(false);
  return <img {...props} alt={alt} src={fallback ? `${import.meta.env.BASE_URL}pwa-icon.svg` : LOGO_URL}
    onError={fallback ? undefined : () => setFallback(true)} />;
}
