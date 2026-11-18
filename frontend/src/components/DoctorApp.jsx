import { useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { Avatar, ErrorMessage, Icon, LiveBadge, Loading, ScreenHeading } from './common.jsx';
import { MessageInbox } from './MessageInbox.jsx';
import { PatientDetail } from './PatientDetail.jsx';

const REFRESH_MS = 5000;

// The assigned patients, refreshed every 5 seconds with an awaited loop.
// The last list stays on screen if a refresh fails.
function usePatients(api) {
  const [patients, setPatients] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let timer;
    (async () => {
      while (!stopped) {
        try {
          const data = await api('/api/participants', { signal: controller.signal });
          if (stopped) return;
          setPatients(data.participants);
          setError(null);
        } catch (failure) {
          if (stopped || failure?.name === 'AbortError' || failure?.status === 401) return;
          setError(failure);
          if (failure.status !== 0 && failure.status !== 429 && failure.status < 500) return;
        }
        await new Promise(resolve => { timer = setTimeout(resolve, REFRESH_MS); });
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, attempt]);

  return { patients, error, retry: () => setAttempt(n => n + 1) };
}

// The doctor dashboard: the message inbox, then the assigned patients. The
// server returns only patients assigned to the signed-in doctor. Exercise
// records are read only; doctors can reply to messages and set care plans.
export function DoctorApp() {
  const { api } = useAuth();
  const { patients, error, retry } = usePatients(api);
  const [selectedId, setSelectedId] = useState(null);
  const selected = patients?.find(patient => patient.id === selectedId) ?? null;

  if (selectedId) {
    return (
      <PatientDetail
        patient={selected}
        listError={error}
        onRetry={retry}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  const liveCount = patients?.filter(patient => patient.active_session_id).length ?? 0;

  return (
    <>
      <MessageInbox onOpenPatient={setSelectedId} />
      <div className="card">
        <section aria-labelledby="patients-heading">
          <div className="console-head">
            <div id="patients-heading"><ScreenHeading>Your patients</ScreenHeading></div>
            <span className="badge badge-readonly"><Icon name="lock" />Records read only</span>
          </div>
          <p>
            This list shows only the patients assigned to you. You can view their workouts but not change them, and you
            can set each patient’s care plan.
          </p>
          {patients?.length > 0 && (
            <div className="stat-strip" role="group" aria-label="Summary">
              <div className="tile">
                <p className="tile-label"><Icon name="users" />Assigned patients</p>
                <p className="tile-value">{patients.length}</p>
              </div>
              <div className="tile">
                <p className="tile-label"><Icon name="pulse" />Live now</p>
                <p className="tile-value">{liveCount}</p>
              </div>
            </div>
          )}
          {error && patients && (
            <p className="alert alert-warning" role="status">
              <span aria-hidden="true">⚠ </span><strong>Could not refresh the list.</strong> Trying again automatically.
              What you see may be out of date.
            </p>
          )}
          {error && !patients && <ErrorMessage error={error} onRetry={retry} />}
          {!patients && !error && <Loading label="Loading your patients…" />}
          {patients?.length === 0 && <p className="empty">No patients are assigned to you yet.</p>}
          {patients?.length > 0 && (
            <ul className="list roster" aria-label="Assigned patients">
              <li className="roster-head" aria-hidden="true"><span>Patient</span><span>Status</span><span /></li>
              {patients.map(patient => (
                <li key={patient.id} className={patient.active_session_id ? 'roster-row roster-row-live' : 'roster-row'}>
                  <span className="person">
                    <Avatar name={patient.name} />
                    <span className="person-text">
                      <strong className="block">{patient.name}</strong>
                      <span className="hint block">{patient.email}</span>
                    </span>
                  </span>
                  <span>
                    {patient.active_session_id
                      ? <LiveBadge />
                      : <span className="idle-text"><Icon name="clock" />No session running</span>}
                  </span>
                  <button
                    type="button"
                    className="button button-primary"
                    aria-label={`View workouts for ${patient.name}`}
                    onClick={() => setSelectedId(patient.id)}
                  >
                    View workouts
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
