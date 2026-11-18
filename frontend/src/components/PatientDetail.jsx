import { useEffect } from 'react';
import { useAuth } from '../auth.jsx';
import { useSession } from '../hooks/useSession.js';
import { deviceLine, isOpen, isStale, notRespondingText } from '../lib/exerciseStatus.js';
import { formatDateTime } from '../lib/format.js';
import { ErrorMessage, Loading, StatusBadge } from './common.jsx';
import { SessionHistory } from './SessionHistory.jsx';
import { SessionTable } from './SessionTable.jsx';

const RECHECK_MS = 5000;

// The session the patient is doing now. It refreshes every second while an
// exercise is open, and every 5 seconds between exercises so the next one
// appears. Read-only: no buttons that change anything.
function LiveSession({ sessionId, patientName }) {
  const { api } = useAuth();
  const { session, serverTime, loading, disconnected, error, reload } = useSession(api, sessionId, { live: true });
  const openWorkout = session?.workouts.find(isOpen) ?? null;
  const waiting = session?.status === 'active' && !openWorkout && !disconnected;

  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => reload(), RECHECK_MS);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  const stale = !disconnected && openWorkout && isStale(openWorkout, serverTime);

  return (
    <section aria-labelledby="live-heading" className="live-block">
      <h3 id="live-heading">Live session <StatusBadge status="active" label="Live now" /></h3>
      {loading && <Loading label="Loading the live session…" />}
      {disconnected && (
        <p className="alert alert-warning" role="status">
          <span aria-hidden="true">⚠ </span><strong>Lost connection to the server.</strong> Trying again automatically.
          The numbers below are the last ones received and may be out of date.
        </p>
      )}
      {!disconnected && error && <ErrorMessage error={error} onRetry={() => reload()} />}
      {session && (
        <>
          <p className="context-line">Started {formatDateTime(session.created_at)}.</p>
          {openWorkout ? (
            <>
              <p className="device-line" aria-live="polite">
                <strong>{openWorkout.exercise_name}:</strong> {deviceLine(openWorkout)}
              </p>
              <p className="visually-hidden" aria-live="polite">{stale ? 'Device not responding.' : ''}</p>
              {stale && (
                <p className="alert alert-warning">
                  <span aria-hidden="true">⚠ </span><strong>{notRespondingText(openWorkout, serverTime)}.</strong>{' '}
                  {patientName} may need to check that the device is switched on and connected to Wi-Fi.
                </p>
              )}
            </>
          ) : (
            session.status === 'active' && <p className="hint">No exercise is running at the moment.</p>
          )}
          <SessionTable session={session} serverTime={serverTime} caption={`Live exercises for ${patientName}`} />
        </>
      )}
    </section>
  );
}

export function PatientDetail({ patient, listError, onRetry, onBack }) {
  const back = (
    <div className="context-bar">
      <button type="button" className="button" onClick={onBack}>← All patients</button>
      {patient && <p>Viewing <strong>{patient.name}</strong> ({patient.email}), read only</p>}
    </div>
  );

  if (!patient) {
    return (
      <>
        {back}
        <div className="card">
          {listError
            ? <ErrorMessage error={listError} onRetry={onRetry} />
            : <p className="empty">This patient is no longer assigned to you.</p>}
        </div>
      </>
    );
  }

  const base = `/api/participants/${patient.id}`;
  return (
    <>
      {back}
      <div className="card">
        {listError && (
          <p className="alert alert-warning" role="status">
            <span aria-hidden="true">⚠ </span><strong>Could not check for a live session.</strong> Trying again automatically.
          </p>
        )}
        {patient.active_session_id && (
          <LiveSession key={patient.active_session_id} sessionId={patient.active_session_id} patientName={patient.name} />
        )}
        <SessionHistory
          path={`${base}/sessions`}
          timedPath={`${base}/workouts`}
          owner="This patient has"
          heading={`Workouts for ${patient.name}`}
        />
      </div>
    </>
  );
}
