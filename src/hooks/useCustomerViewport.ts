import { useEffect, useRef } from 'react';

/** Keep the sheet above the software keyboard, including iOS Safari's viewport offset. */
export function useCustomerViewport() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame: number | undefined;
    let lastHeight: number | undefined, lastTop: number | undefined;
    const update = () => {
      frame = undefined;
      if (viewport && viewport.scale !== 1) return; // Preserve accessible pinch-to-zoom.
      const element = ref.current;
      if (!element) return;
      const height = Math.round(viewport?.height ?? window.innerHeight);
      const top = Math.max(0, Math.round(viewport?.offsetTop ?? 0));
      if (height !== lastHeight) {
        element.style.setProperty('--customer-height', `${height}px`);
        element.dataset.shortViewport = String(height < 480);
        lastHeight = height;
      }
      if (top !== lastTop) { element.style.setProperty('--customer-top', `${top}px`); lastTop = top; }
    };
    // Mobile keyboards/browser chrome can emit several resize and scroll
    // events per frame. Apply their final geometry once before painting.
    const schedule = () => { frame ??= requestAnimationFrame(update); };
    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);
  return ref;
}
