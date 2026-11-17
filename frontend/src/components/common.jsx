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

const STATUS_ICONS = { pending: '○', active: '●', completed: '✓', cancelled: '✕' };

export function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status}`}>
      <span aria-hidden="true">{STATUS_ICONS[status]} </span>{STATUS_LABELS[status] ?? status}
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
