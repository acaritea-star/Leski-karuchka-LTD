import { Link } from 'react-router-dom';

/** Reserves the shape of the content without a full-page spinner or fake progress. */
export function ContentSkeleton({ label = 'Подготвяме съдържанието…', rows = 3 }: { label?: string; rows?: number }) {
  return <div className="content-skeleton" role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, index) => <div className="content-skeleton-card" key={index} aria-hidden="true">
      <div className="content-skeleton-heading"><span className="content-skeleton-mark" /><span className="content-skeleton-line" /></div>
      <span className="content-skeleton-line" /><span className="content-skeleton-line content-skeleton-short" />
    </div>)}
  </div>;
}

export default function PageLoading({ title = 'Лески Каручка', label, backTo }: { title?: string; label?: string; backTo?: string }) {
  return <div className="page-loading">
    <header className="page-loading-header">
      {backTo && <Link to={backTo} className="page-loading-back" aria-label="Назад"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></Link>}
      <span className="page-loading-brand" aria-hidden="true">ЛК</span><strong>{title}</strong>
    </header>
    <div className="page-loading-body"><p>{label ?? 'Подготвяме твоя екран…'}</p><ContentSkeleton label={label} /></div>
  </div>;
}
