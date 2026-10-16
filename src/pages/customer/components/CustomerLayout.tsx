import EmergencyHelp from '@/components/feature/EmergencyHelp';
import type { ReactNode } from 'react';
import { useCustomerViewport } from '@/hooks/useCustomerViewport';
import './customer.css';

export type CarrierPanelView = 'preview' | 'all' | 'selected' | 'details';

export default function CustomerLayout({ map, header, notice, mapControls, children, expanded = false, offers = false, offerView = 'preview' }: {
  map: ReactNode; header: ReactNode; notice?: ReactNode; mapControls?: ReactNode; children: ReactNode; expanded?: boolean; offers?: boolean; offerView?: CarrierPanelView;
}) {
  const viewportRef = useCustomerViewport();
  return <div ref={viewportRef} className="customer-experience" data-expanded={expanded} data-offers={offers} data-offer-view={offerView}>
    <div className="customer-map">{map}</div>
    <header className="customer-header">{header}<EmergencyHelp /></header>
    {notice && <div className="customer-notice" role="status">{notice}</div>}
    {mapControls && <div className="customer-route-controls">{mapControls}</div>}
    <main className="customer-sheet"><div className="customer-short-emergency"><EmergencyHelp /></div>{children}</main>
  </div>;
}

export function BookingSkeleton({ label }: { label: string }) {
  return <div className="booking-skeleton" role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span><div className="skeleton-line w-2/3" />
    <div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line w-3/4" />
  </div>;
}
