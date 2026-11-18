import { useEffect, useRef } from 'react';
import { describeError } from '../api.js';
import { STATUS_LABELS } from '../lib/format.js';

export function ErrorMessage({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <p><span aria-hidden="true">⚠ </span>{typeof error === 'string' ? error : describeError(error)}</p>
      {onRetry && <button type="button" className="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return <p className="loading" role="status">{label}</p>;
}

const STATUS_ICONS = { pending: '○', active: '●', completed: '✓', cancelled: '✕', incomplete: '!' };

// `label` overrides the default wording (rep exercises use their own labels).
export function StatusBadge({ status, label }) {
  return (
    <span className={`badge badge-${status}`}>
      <span aria-hidden="true">{STATUS_ICONS[status]} </span>{label ?? STATUS_LABELS[status] ?? status}
    </span>
  );
}

// A heading that takes keyboard focus when its screen appears, so keyboard and
// screen-reader users land at the start of the new content.
export function ScreenHeading({ level = 2, children }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const Tag = `h${level}`;
  return <Tag ref={ref} tabIndex={-1} className="screen-heading">{children}</Tag>;
}

// Newer/older buttons for a paged list (hidden when there is only one page).
export function Pager({ data, page, pageSize, itemCount, onPage, label }) {
  const total = data.total;
  const first = total === 0 ? 0 : data.offset + 1;
  const last = total === 0 ? 0 : data.offset + itemCount;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  return (
    <nav className="pager" aria-label={label}>
      <button type="button" className="button" disabled={page === 0} onClick={() => onPage(page - 1)}>← Newer</button>
      <p role="status">Showing {first}–{last} of {total} (page {page + 1} of {pageCount})</p>
      <button type="button" className="button" disabled={last >= total} onClick={() => onPage(page + 1)}>Older →</button>
    </nav>
  );
}
