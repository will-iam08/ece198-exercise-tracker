import { useAuth } from '../auth.jsx';
import { usePagedList } from '../hooks/usePagedList.js';
import { formatClock, formatDateTime } from '../lib/format.js';
import { ErrorMessage, Loading, Pager, StatusBadge } from './common.jsx';

const PAGE_SIZE = 10;
const QUERY = { kind: 'timed' };

// Workouts recorded before sessions existed. Read-only.
export function TimedHistory({ path = '/api/workouts', refreshKey, owner = 'You have' }) {
  const { api } = useAuth();
  const { data, error, page, setPage, retry } = usePagedList(api, path, QUERY, PAGE_SIZE, refreshKey);

  return (
    <>
      <h3>Earlier timed workouts</h3>
      <p className="hint">Workouts from before workout sessions were added. They are read-only and cannot be changed.</p>
      {error && <ErrorMessage error={error} onRetry={retry} />}
      {!data && !error && <Loading label="Loading earlier workouts…" />}
      {data && data.total === 0 && <p className="empty">{owner} no earlier timed workouts.</p>}
      {data && data.total > 0 && (
        <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Earlier timed workouts">
            <table className="table-stack">
              <thead>
                <tr>
                  <th scope="col">Date</th><th scope="col">Exercise</th><th scope="col">Status</th>
                  <th scope="col">Repetitions</th><th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.workouts.map(workout => (
                  <tr key={workout.id}>
                    <td data-label="Date">{formatDateTime(workout.started_at ?? workout.created_at)}</td>
                    <td data-label="Exercise">{workout.exercise_name}</td>
                    <td data-label="Status"><StatusBadge status={workout.status} /></td>
                    <td data-label="Repetitions">{workout.repetitions}</td>
                    <td data-label="Time">
                      {formatClock(workout.elapsed_seconds)}
                      {workout.target_duration_seconds != null && <span className="hint"> of {formatClock(workout.target_duration_seconds)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager data={data} page={page} pageSize={PAGE_SIZE} itemCount={data.workouts.length} onPage={setPage} label="Earlier workout pages" />
        </>
      )}
    </>
  );
}
