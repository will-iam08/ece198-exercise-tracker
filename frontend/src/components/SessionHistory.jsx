import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { usePagedList } from '../hooks/usePagedList.js';
import { formatDateTime } from '../lib/format.js';
import { ErrorMessage, Loading, Pager, ScreenHeading, StatusBadge } from './common.jsx';
import { SessionTable } from './SessionTable.jsx';
import { TimedHistory } from './TimedHistory.jsx';

const PAGE_SIZE = 10;

function summary(session) {
  const total = session.workouts.length;
  const complete = session.workouts.filter(workout => workout.status === 'completed').length;
  if (total === 0) return 'No exercises';
  return `${total} exercise${total === 1 ? '' : 's'}, ${complete} complete`;
}

// Workout sessions, newest first, each expandable to its exercise table; then
// the read-only list of earlier timed workouts.
export function SessionHistory({
  devices, refreshKey, path = '/api/sessions', timedPath, owner = 'You have', heading = 'History', headingLevel = 2, plan,
}) {
  const { api } = useAuth();
  const { data, error, page, setPage, retry } = usePagedList(api, path, {}, PAGE_SIZE, refreshKey);
  const [expanded, setExpanded] = useState(() => new Set());
  const deviceText = id => (devices ? ` · ${devices.find(device => device.id === id)?.name ?? 'a removed device'}` : '');

  function toggle(id) {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section aria-labelledby="history-heading">
      <div id="history-heading"><ScreenHeading level={headingLevel}>{heading}</ScreenHeading></div>
      <h3>Workout sessions</h3>
      {error && <ErrorMessage error={error} onRetry={retry} />}
      {!data && !error && <Loading label="Loading sessions…" />}
      {data && data.total === 0 && <p className="empty">
          {owner === 'You have' ? 'You have no workout sessions yet. Start one on the Session tab.' : `${owner} no workout sessions yet.`}
        </p>}
      {data && data.total > 0 && (
        <>
          <ul className="list">
            {data.sessions.map(session => {
              const open = expanded.has(session.id);
              const tableId = `session-${session.id}`;
              const when = formatDateTime(session.created_at);
              return (
                <li key={session.id} className="list-item session-item">
                  <span className="session-row-main">
                    <strong className="block">{when}</strong>
                    <span className="session-meta">
                      {session.status === 'active'
                        ? <StatusBadge status="active" label="In progress" />
                        : <StatusBadge status="completed" label="Ended" />}
                      <span>{summary(session)}{deviceText(session.device_id)}</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className="button button-small"
                    aria-expanded={open}
                    aria-controls={tableId}
                    aria-label={`${open ? 'Hide' : 'Show'} exercises for the session of ${when}`}
                    onClick={() => toggle(session.id)}
                  >
                    {open ? 'Hide exercises' : 'Show exercises'}
                  </button>
                  {open && (
                    <div id={tableId} className="session-detail">
                      <SessionTable session={session} plan={plan} caption={`Exercises in the session of ${when}`} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Pager data={data} page={page} pageSize={PAGE_SIZE} itemCount={data.sessions.length} onPage={setPage} label="Session pages" />
        </>
      )}
      <TimedHistory path={timedPath} refreshKey={refreshKey} owner={owner} />
    </section>
  );
}
