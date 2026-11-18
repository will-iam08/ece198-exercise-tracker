import { formatTime } from '../lib/format.js';
import { bpmLabel, deviceLine, isOpen, isStale, notRespondingText, statusLabel } from '../lib/exerciseStatus.js';
import { StatusBadge } from './common.jsx';

function BpmCell({ workout, which }) {
  const at = workout[`${which}_bpm_at`];
  return (
    <>
      {bpmLabel(workout, which)}
      {workout[`${which}_bpm`] != null && at && <span className="hint block">at {formatTime(at)}</span>}
    </>
  );
}

function TimesCell({ workout }) {
  const open = isOpen(workout);
  return (
    <>
      <span className="block">Started: {workout.started_at ? formatTime(workout.started_at) : 'Not yet'}</span>
      <span className="block">Ended: {workout.ended_at ? formatTime(workout.ended_at) : open ? 'Not yet' : '—'}</span>
    </>
  );
}

// The exercises of one session. Patients and doctors see the same columns.
// Pass `serverTime` (from the latest poll) to show the device status and the
// not-responding warning on an unfinished exercise.
export function SessionTable({ session, serverTime, caption = 'Exercises in this session' }) {
  if (session.workouts.length === 0) {
    return <p className="empty">No exercises in this session{session.status === 'active' ? ' yet' : ''}.</p>;
  }
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="table-stack">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Exercise</th>
            <th scope="col">Target reps</th>
            <th scope="col">Reps done</th>
            <th scope="col">Heart rate before</th>
            <th scope="col">Heart rate after</th>
            <th scope="col">Started / ended</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {session.workouts.map(workout => {
            const live = serverTime && isOpen(workout);
            const stale = live && isStale(workout, serverTime);
            return (
              <tr key={workout.id}>
                <td data-label="Exercise"><strong>{workout.exercise_name}</strong></td>
                <td data-label="Target reps">{workout.target_reps}</td>
                <td data-label="Reps done">{workout.repetitions}</td>
                <td data-label="Heart rate before"><BpmCell workout={workout} which="before" /></td>
                <td data-label="Heart rate after"><BpmCell workout={workout} which="after" /></td>
                <td data-label="Started / ended"><TimesCell workout={workout} /></td>
                <td data-label="Status">
                  <StatusBadge status={workout.status} label={statusLabel(workout)} />
                  {live && <span className="hint block">{deviceLine(workout)}</span>}
                  {stale && (
                    <span className="stale-note block">
                      <span aria-hidden="true">⚠ </span>
                      {notRespondingText(workout, serverTime)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
