import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

let locks = 0;
let previousOverflow = '';

export default function Modal({ label, labelledBy, onClose, busy = false, className = '', children, allowExternalOverlays = false }: {
  label?: string; labelledBy?: string; onClose: () => void; busy?: boolean; className?: string; children: ReactNode; allowExternalOverlays?: boolean;
}) {
  const ref = useRef<HTMLDialogElement | HTMLDivElement>(null);
  const active = useRef(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    active.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (locks++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    if (!allowExternalOverlays) {
      const dialog = element as HTMLDialogElement;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else {
      (element.querySelector<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') ?? element).focus({ preventScroll: true });
    }
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
      active.current = false;
      window.removeEventListener('resize', measure);
      viewport?.removeEventListener('resize', measure); viewport?.removeEventListener('scroll', measure);
      if (element instanceof HTMLDialogElement && typeof element.close === 'function') element.close();
      if (previousFocus && previousFocus !== document.body && previousFocus.isConnected && !previousFocus.matches(':disabled') && previousFocus.getClientRects().length) {
        previousFocus.focus({ preventScroll: true });
      }
      if (--locks === 0) document.body.style.overflow = previousOverflow;
    };
  }, [allowExternalOverlays]);
  useLayoutEffect(() => {
    if (!allowExternalOverlays) return;
    const element = ref.current;
    if (!element) return;
    const focusable = () => Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), iframe, [tabindex="0"]'))
      .filter(node => node.getClientRects().length > 0);
    const keydown = (event: KeyboardEvent) => {
      if (!active.current || busy) return; // Stripe owns focus while a wallet/bank challenge is active.
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusable(), first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); element.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => {
      if (active.current && !busy && event.target instanceof Node && !element.contains(event.target)) (focusable()[0] ?? element).focus({ preventScroll: true });
    };
    document.addEventListener('keydown', keydown); document.addEventListener('focusin', focusin);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin); };
  }, [allowExternalOverlays, busy, onClose]);
  if (allowExternalOverlays) return createPortal(<>
    <div className="app-dialog-scrim" aria-hidden="true" onClick={() => { if (!busy) onClose(); }} />
    <div ref={node => { ref.current = node; }} role="dialog" aria-label={label} aria-labelledby={labelledBy} aria-modal="true" aria-busy={busy}
      tabIndex={-1} className={`app-dialog app-dialog-external ${className}`}>
      <fieldset disabled={busy} className="min-w-0">{children}</fieldset>
    </div>
  </>, document.body);
  return createPortal(<dialog ref={node => { ref.current = node; }} aria-label={label} aria-labelledby={labelledBy} aria-modal="true" aria-busy={busy}
    className={`app-dialog ${className}`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || busy) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}><fieldset disabled={busy} className="min-w-0">{children}</fieldset></dialog>, document.body);
}
