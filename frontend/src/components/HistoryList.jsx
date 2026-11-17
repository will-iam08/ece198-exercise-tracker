import { useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { formatClock, formatDateTime, PRESET_EXERCISES, STATUS_LABELS } from '../lib/format.js';
import { ErrorMessage, Loading, ScreenHeading, StatusBadge } from './common.jsx';

const PAGE_SIZE = 10;
const REFRESH_MS = 5000;

function mergeNames(previous, names) {
  const seen = new Map(previous.map(name => [name.toLowerCase(), name]));
  for (const name of names) if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  return seen.size === previous.length ? previous : [...seen.values()];
}

// Paginated workout history. listPath/progressPath differ for participants
// (/api/workouts) and staff (/api/participants/:id/workouts).
export function HistoryList({ listPath, progressPath, refreshKey, onOpen, heading = 'Workout history' }) {
  const { api } = useAuth();
  const [status, setStatus] = useState('');
  const [exercise, setExercise] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [names, setNames] = useState(PRESET_EXERCISES);
  const [attempt, setAttempt] = useState(0);

  // Names for the exercise filter come from completed workouts (progress) and
  // from whatever history pages have been viewed.
  useEffect(() => {
    const controller = new AbortController();
    api(progressPath, { signal: controller.signal })
      .then(progress => setNames(previous => mergeNames(previous, progress.daily.map(row => row.exercise_name))))
      .catch(() => {});
    return () => controller.abort();
  }, [api, progressPath, refreshKey]);

  // History is refreshed on its own slow loop, separate from live polling,
  // because new workouts shift the page offsets.
  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let timer;
    (async () => {
      while (!stopped) {
        try {
          const result = await api(listPath, {
            query: { limit: PAGE_SIZE, offset: page * PAGE_SIZE, status, exercise_name: exercise },
            signal: controller.signal,
          });
          if (stopped) return;
          if (result.workouts.length === 0 && result.total > 0) {
            setPage(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1));
            return;
          }
          setData(result);
          setError(null);
          setNames(previous => mergeNames(previous, result.workouts.map(workout => workout.exercise_name)));
        } catch (failure) {
          if (stopped || failure?.name === 'AbortError' || failure?.status === 401) return;
          setError(failure);
          if (failure.status !== 0 && failure.status < 500) return;
        }
        await new Promise(resolve => { timer = setTimeout(resolve, REFRESH_MS); });
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, listPath, page, status, exercise, refreshKey, attempt]);

  function changeFilter(setter) {
    return event => {
      setter(event.target.value);
      setPage(0);
      setData(null);
    };
  }

  const total = data?.total ?? 0;
  const first = total === 0 ? 0 : data.offset + 1;
  const last = total === 0 ? 0 : data.offset + data.workouts.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section aria-labelledby="history-heading">
      <div id="history-heading"><ScreenHeading>{heading}</ScreenHeading></div>
      <div className="filters">
        <div className="field">
          <label htmlFor="history-exercise">Exercise</label>
          <select id="history-exercise" value={exercise} onChange={changeFilter(setExercise)}>
            <option value="">All exercises</option>
            {names.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="history-status">Status</label>
          <select id="history-status" value={status} onChange={changeFilter(setStatus)}>
            <option value="">All workouts</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>

      {error && <ErrorMessage error={error} onRetry={() => setAttempt(n => n + 1)} />}
      {!data && !error && <Loading label="Loading workouts…" />}
      {data && total === 0 && (
        <p className="empty">{status || exercise ? 'No workouts match these choices.' : 'There are no workouts yet.'}</p>
      )}
      {data && total > 0 && (
        <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Workout history table">
            <table className="table-stack">
              <thead>
                <tr>
                  <th scope="col">Date</th><th scope="col">Exercise</th><th scope="col">Status</th>
                  <th scope="col">Repetitions</th><th scope="col">Time</th><th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.workouts.map(workout => (
                  <tr key={workout.id}>
                    <td data-label="Date">{formatDateTime(workout.started_at ?? workout.created_at)}</td>
                    <td data-label="Exercise">{workout.exercise_name}</td>
                    <td data-label="Status"><StatusBadge status={workout.status} /></td>
                    <td data-label="Repetitions">{workout.repetitions}</td>
                    <td data-label="Time">{formatClock(workout.elapsed_seconds)} <span className="hint">of {formatClock(workout.target_duration_seconds)}</span></td>
                    <td>
                      <button type="button" className="button button-small" onClick={() => onOpen(workout.id)} aria-label={`View ${workout.exercise_name} workout from ${formatDateTime(workout.started_at ?? workout.created_at)}`}>
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="pager" aria-label="History pages">
            <button type="button" className="button" disabled={page === 0} onClick={() => setPage(page - 1)}>← Newer</button>
            <p role="status">Showing {first}–{last} of {total} (page {page + 1} of {pageCount})</p>
            <button type="button" className="button" disabled={last >= total} onClick={() => setPage(page + 1)}>Older →</button>
          </nav>
        </>
      )}
    </section>
  );
}
