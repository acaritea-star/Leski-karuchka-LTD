import { useEffect, useRef } from 'react';

/** Keep the sheet above the software keyboard, including iOS Safari's viewport offset. */
export function useCustomerViewport() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      if (viewport && viewport.scale !== 1) return; // Preserve accessible pinch-to-zoom.
      ref.current?.style.setProperty('--customer-height', `${viewport?.height ?? window.innerHeight}px`);
      ref.current?.style.setProperty('--customer-top', `${viewport?.offsetTop ?? 0}px`);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return ref;
}
