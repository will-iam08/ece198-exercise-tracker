import { useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { ErrorMessage, Loading, ScreenHeading, StatusBadge } from './common.jsx';
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

// Read-only dashboard. The server returns only patients assigned to the
// signed-in doctor; nothing here can create or change records.
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

  return (
    <div className="card">
      <section aria-labelledby="patients-heading">
        <div id="patients-heading"><ScreenHeading>Your patients</ScreenHeading></div>
        <p>This list shows only the patients assigned to you. You can view their workouts but not change them.</p>
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
          <ul className="list">
            {patients.map(patient => (
              <li key={patient.id} className="list-item">
                <span>
                  <strong>{patient.name}</strong>
                  <span className="hint block">{patient.email}</span>
                  {patient.active_session_id && <span className="block"><StatusBadge status="active" label="Live now" /></span>}
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
  );
}
