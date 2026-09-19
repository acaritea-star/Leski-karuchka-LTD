import type { ReactNode } from 'react';
import { useCustomerViewport } from '@/hooks/useCustomerViewport';
import './customer.css';

export default function CustomerLayout({ map, header, notice, children }: {
  map: ReactNode; header: ReactNode; notice?: ReactNode; children: ReactNode;
}) {
  const viewportRef = useCustomerViewport();
  return <div ref={viewportRef} className="customer-experience">
    <div className="customer-map">{map}</div>
    <header className="customer-header">{header}</header>
    {notice && <div className="customer-notice" role="status">{notice}</div>}
    <main className="customer-sheet">{children}</main>
  </div>;
}

export function BookingSkeleton({ label }: { label: string }) {
  return <div className="booking-skeleton" role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span><div className="skeleton-line w-2/3" />
    <div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line w-3/4" />
  </div>;
}
