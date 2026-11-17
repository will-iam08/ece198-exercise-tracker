import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { ErrorMessage, Loading, ScreenHeading } from './common.jsx';
import { HistoryList } from './HistoryList.jsx';
import { ProgressView } from './ProgressView.jsx';
import { WorkoutView } from './WorkoutView.jsx';

// Read-only dashboard. The server returns only participants assigned to the
// signed-in staff member; nothing here can create or change records.
export function StaffApp() {
  const { api } = useAuth();
  const [participants, setParticipants] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('history');
  const [workoutId, setWorkoutId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api('/api/participants');
      setParticipants(data.participants);
    } catch (failure) {
      if (failure.status !== 401) setError(failure);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);
  const onFinished = useCallback(() => setRefreshKey(key => key + 1), []);

  if (!selected) {
    return (
      <div className="card">
        <section aria-labelledby="participants-heading">
          <div id="participants-heading"><ScreenHeading>Your participants</ScreenHeading></div>
          <p>This list shows only the participants assigned to you. You can view their workouts but not change them.</p>
          {error && <ErrorMessage error={error} onRetry={load} />}
          {!participants && !error && <Loading label="Loading participants…" />}
          {participants?.length === 0 && (
            <p className="empty">No participants are assigned to you yet. Assignments are made by the project administrator.</p>
          )}
          {participants?.length > 0 && (
            <ul className="list">
              {participants.map(participant => (
                <li key={participant.id} className="list-item">
                  <span><strong>{participant.name}</strong><span className="hint block">{participant.email}</span></span>
                  <button type="button" className="button button-primary" onClick={() => { setSelected(participant); setTab('history'); setWorkoutId(null); }} aria-label={`View workouts for ${participant.name}`}>
                    View workouts
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="button-row"><button type="button" className="button" onClick={load}>Refresh list</button></div>
        </section>
      </div>
    );
  }

  const base = `/api/participants/${selected.id}`;
  return (
    <>
      <div className="context-bar">
        <button type="button" className="button" onClick={() => { setSelected(null); load(); }}>← All participants</button>
        <p>Viewing <strong>{selected.name}</strong> ({selected.email}) — read only</p>
      </div>
      <nav className="nav" aria-label={`Sections for ${selected.name}`}>
        {[['history', 'Workouts'], ['progress', 'Progress']].map(([id, label]) => (
          <button key={id} type="button" className="nav-button" aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id); setWorkoutId(null); }}>
            {label}
          </button>
        ))}
      </nav>
      <div className="card">
        {tab === 'history' && (workoutId ? (
          <WorkoutView key={workoutId} workoutId={workoutId} canCancel={false} onFinished={onFinished} onBack={() => setWorkoutId(null)} backLabel="← Back to workouts" />
        ) : (
          <HistoryList listPath={`${base}/workouts`} progressPath={`${base}/progress`} refreshKey={refreshKey} onOpen={setWorkoutId} heading={`Workouts for ${selected.name}`} />
        ))}
        {tab === 'progress' && <ProgressView progressPath={`${base}/progress`} refreshKey={refreshKey} heading={`Progress for ${selected.name}`} />}
      </div>
    </>
  );
}
