import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

let locks = 0;
let previousOverflow = '';

export default function Modal({ label, labelledBy, onClose, busy = false, className = '', children }: {
  label?: string; labelledBy?: string; onClose: () => void; busy?: boolean; className?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (locks++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    const viewport = window.visualViewport;
    const measure = () => {
      if (viewport && viewport.scale !== 1) return;
      const height = viewport?.height ?? window.innerHeight, top = viewport?.offsetTop ?? 0;
      element.style.setProperty('--modal-height', `${height}px`);
      element.style.setProperty('--modal-top', `${top}px`);
      element.style.setProperty('--modal-bottom', `${Math.max(0, window.innerHeight - top - height)}px`);
    };
    measure(); window.addEventListener('resize', measure);
    viewport?.addEventListener('resize', measure); viewport?.addEventListener('scroll', measure);
    return () => {
      window.removeEventListener('resize', measure);
      viewport?.removeEventListener('resize', measure); viewport?.removeEventListener('scroll', measure);
      if (typeof element.close === 'function') element.close();
      if (previousFocus && previousFocus !== document.body && previousFocus.isConnected && !previousFocus.matches(':disabled') && previousFocus.getClientRects().length) {
        previousFocus.focus({ preventScroll: true });
      }
      if (--locks === 0) document.body.style.overflow = previousOverflow;
    };
  }, []);
  return createPortal(<dialog ref={ref} aria-label={label} aria-labelledby={labelledBy} aria-modal="true" aria-busy={busy}
    className={`app-dialog ${className}`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || busy) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}><fieldset disabled={busy} className="min-w-0">{children}</fieldset></dialog>, document.body);
}
