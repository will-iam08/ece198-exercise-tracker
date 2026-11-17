import { useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useLiveWorkout } from '../hooks/useLiveWorkout.js';
import { useNow } from '../hooks/useNow.js';
import { formatAge, formatClock, formatDateTime, formatDurationWords, formatTime, isFinished } from '../lib/format.js';
import { heartRateState, STALE_AFTER_MS } from '../lib/heartRate.js';
import { HeartRateChart } from './Charts.jsx';
import { ErrorMessage, Loading, ScreenHeading, StatusBadge } from './common.jsx';

const STALE_SECONDS = STALE_AFTER_MS / 1000;

function HeartRateTile({ state }) {
  if (state.kind === 'none') {
    return (
      <div className="tile tile-muted">
        <p className="tile-label">Heart rate</p>
        <p className="tile-value tile-value-text">No reading</p>
        <p className="tile-note">The device has not sent a heart rate.</p>
      </div>
    );
  }
  if (state.kind === 'live') {
    return (
      <div className="tile">
        <p className="tile-label">Heart rate</p>
        <p className="tile-value">{state.bpm} <span className="tile-unit">bpm</span></p>
        <p className="tile-note tile-note-good"><span aria-hidden="true">♥ </span>Live reading</p>
      </div>
    );
  }
  const when = state.receivedAt ? `${formatAge(state.ageMs)} (at ${formatTime(state.receivedAt)})` : 'at an unknown time';
  if (state.kind === 'final') {
    return (
      <div className="tile">
        <p className="tile-label">Last heart rate recorded</p>
        <p className="tile-value">{state.bpm} <span className="tile-unit">bpm</span></p>
        <p className="tile-note">Recorded {state.receivedAt ? formatDateTime(state.receivedAt) : 'at an unknown time'}</p>
      </div>
    );
  }
  return (
    <div className="tile tile-stale">
      <p className="tile-label">Heart rate</p>
      <p className="tile-value tile-value-text"><span aria-hidden="true">⚠ </span>No current reading</p>
      <p className="tile-note">
        Last reading was <strong>{state.bpm} bpm</strong>, {when}. A reading older than {STALE_SECONDS} seconds is not shown as current.
      </p>
    </div>
  );
}

// Live and historical view of one workout. Participants and assigned staff
// both use it; only participants may cancel.
export function WorkoutView({ workoutId, canCancel, onFinished, onBack, backLabel }) {
  const { api } = useAuth();
  const { workout, readings, loading, disconnected, error, live } = useLiveWorkout(api, workoutId, onFinished);
  const now = useNow(1000, live);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  async function cancel() {
    setCancelling(true);
    setCancelError('');
    try {
      await api(`/api/workouts/${workoutId}/cancel`, { method: 'POST' });
      setConfirming(false);
      // The next poll (within a second) shows the cancelled workout.
    } catch (failure) {
      if (failure.status !== 401) setCancelError(failure.status === 409 ? 'This workout already finished, so it cannot be cancelled.' : describeError(failure));
    } finally {
      setCancelling(false);
    }
  }

  const back = <button type="button" className="button" onClick={onBack}>{backLabel}</button>;

  if (loading) return <Loading label="Loading workout…" />;
  if (!workout) {
    return (
      <section>
        <ErrorMessage error={error} />
        {back}
      </section>
    );
  }

  const finished = isFinished(workout.status);
  const heartRate = heartRateState({ workout, readings, now, disconnected });
  const deviceAgeMs = Math.max(0, now - Date.parse(workout.updated_at));
  const deviceQuiet = workout.status === 'active' && !disconnected && deviceAgeMs > STALE_AFTER_MS;
  const reachedPlan = workout.status === 'active' && workout.elapsed_seconds >= workout.target_duration_seconds;

  return (
    <section aria-labelledby="workout-heading">
      <div id="workout-heading" className="heading-row">
        <ScreenHeading>{workout.exercise_name}</ScreenHeading>
        <StatusBadge status={workout.status} />
      </div>

      <div aria-live="polite">
        {disconnected && (
          <p className="alert alert-warning">
            <span aria-hidden="true">⚠ </span><strong>Disconnected from the server.</strong> Trying again automatically. The numbers below are the last ones received and may be out of date.
          </p>
        )}
        {!live && error && !disconnected && <ErrorMessage error={error} />}
        {workout.status === 'pending' && (
          <p className="alert alert-info">
            <strong>Ready.</strong> Press the start button on your device to begin. Nothing is counted until the device starts.
          </p>
        )}
        {deviceQuiet && (
          <p className="alert alert-warning">
            <span aria-hidden="true">⚠ </span><strong>No recent update from the device.</strong> The last update arrived {formatAge(deviceAgeMs)}. Check that the device is on and connected to Wi-Fi.
          </p>
        )}
        {reachedPlan && (
          <p className="alert alert-info"><strong>Planned time reached.</strong> Press the stop button on the device to finish the workout.</p>
        )}
        {workout.status === 'completed' && <p className="alert alert-success"><span aria-hidden="true">✓ </span><strong>Workout complete.</strong> It has been saved to the history.</p>}
        {workout.status === 'cancelled' && <p className="alert alert-info"><strong>This workout was cancelled.</strong> It is kept in the history but does not count toward progress.</p>}
      </div>

      <div className="tiles">
        <div className="tile">
          <p className="tile-label">Repetitions</p>
          <p className="tile-value">{workout.repetitions}</p>
          <p className="tile-note">Counted by the device</p>
        </div>
        <div className="tile">
          <p className="tile-label">Time</p>
          <p className="tile-value">{formatClock(workout.elapsed_seconds)}</p>
          <p className="tile-note">Planned: {formatClock(workout.target_duration_seconds)} ({formatDurationWords(workout.target_duration_seconds)})</p>
        </div>
        <HeartRateTile state={heartRate} />
      </div>

      {workout.status === 'active' && !disconnected && !deviceQuiet && (
        <p className="hint"><span aria-hidden="true">● </span>Receiving updates from the device. Last update {formatAge(deviceAgeMs)}.</p>
      )}

      <div className="button-row">
        {canCancel && !finished && !confirming && (
          <button type="button" className="button button-danger" onClick={() => setConfirming(true)}>Cancel workout</button>
        )}
        {(finished || !canCancel) && back}
      </div>
      {canCancel && !finished && confirming && (
        <div className="alert alert-warning" role="group" aria-label="Confirm cancelling the workout">
          <p>Cancel this workout? It will be kept in your history as cancelled and will not count toward your progress.</p>
          <div className="button-row">
            <button type="button" className="button button-danger" onClick={cancel} disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Yes, cancel workout'}</button>
            <button type="button" className="button" onClick={() => setConfirming(false)} disabled={cancelling}>No, keep going</button>
          </div>
        </div>
      )}
      {cancelError && <ErrorMessage error={cancelError} />}

      <h3>Heart rate during this workout</h3>
      <HeartRateChart readings={readings} />

      <details className="details">
        <summary>Show all readings as a table ({readings.length})</summary>
        {readings.length === 0 ? <p className="empty">No readings yet.</p> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Readings table">
            <table>
              <thead>
                <tr><th scope="col">Workout time</th><th scope="col">Repetitions</th><th scope="col">Heart rate</th><th scope="col">Received</th></tr>
              </thead>
              <tbody>
                {readings.map(reading => (
                  <tr key={reading.sequence}>
                    <td>{formatClock(reading.elapsed_seconds)}</td>
                    <td>{reading.repetitions}</td>
                    <td>{reading.heart_rate_bpm == null ? 'No reading' : `${reading.heart_rate_bpm} bpm`}</td>
                    <td>{formatTime(reading.received_at)}{reading.completed === 1 ? ' (final)' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>

      <dl className="facts">
        <div><dt>Created</dt><dd>{formatDateTime(workout.created_at)}</dd></div>
        <div><dt>First update received</dt><dd>{formatDateTime(workout.started_at)}</dd></div>
        <div><dt>Ended</dt><dd>{formatDateTime(workout.ended_at)}</dd></div>
      </dl>
      {canCancel && !finished && (
        <div className="button-row">
          <button type="button" className="button" onClick={onBack}>Leave this screen (the workout stays open)</button>
        </div>
      )}
    </section>
  );
}
