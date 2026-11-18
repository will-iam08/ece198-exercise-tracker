import { useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { bpmLabel, deviceLine, isStale, notRespondingText } from '../lib/exerciseStatus.js';
import { ErrorMessage } from './common.jsx';

const STEP_INDEX = { before_bpm: 0, counting: 1, after_bpm: 2, done: 3 };

function Steps({ workout }) {
  const current = STEP_INDEX[workout.phase] ?? 0;
  const steps = [
    { label: 'Heart rate before', detail: bpmLabel(workout, 'before') },
    { label: 'Reps', detail: `${workout.repetitions} of ${workout.target_reps}` },
    { label: 'Heart rate after', detail: bpmLabel(workout, 'after') },
  ];
  return (
    <ol className="steps" aria-label="Steps of this exercise">
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'now' : 'next';
        const word = { done: 'Done', now: 'Now', next: 'Next' }[state];
        return (
          <li key={step.label} className={`step step-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="step-state"><span aria-hidden="true">{state === 'done' ? '✓ ' : state === 'now' ? '▶ ' : ''}</span>{word}</span>
            <span className="step-label">{step.label}</span>
            <span className="step-detail">{step.detail}</span>
          </li>
        );
      })}
    </ol>
  );
}

const PHASE_HELP = {
  before_bpm: 'Put your finger on the heart-rate sensor and keep still. Counting starts after the reading.',
  counting: 'Do your repetitions. The device counts them and stops at your target.',
  after_bpm: 'Target reached. Put your finger on the sensor again for the reading after exercise.',
};

// The exercise that is running now: steps, the big rep count, what the device
// is doing, and the Skip reading / Stop exercise actions.
export function LiveExercise({ workout, serverTime, disconnected, onChanged }) {
  const { api } = useAuth();
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inReading = workout.phase === 'before_bpm' || workout.phase === 'after_bpm';
  const stale = !disconnected && isStale(workout, serverTime);

  async function act(path, conflictMessage) {
    setBusy(true);
    setError('');
    try {
      const data = await api(path, { method: 'POST' });
      setConfirmStop(false);
      onChanged(data.workout);
    } catch (failure) {
      if (failure.status === 409) {
        setError(conflictMessage);
        onChanged(null);
      } else if (failure.status !== 401) setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }

  const skip = () => act(`/api/workouts/${workout.id}/skip-reading`, 'That reading has already finished. The screen now shows the latest step.');
  const stop = () => act(`/api/workouts/${workout.id}/cancel`, 'This exercise has already finished.');

  return (
    <section className="live" aria-labelledby="live-heading">
      <h3 id="live-heading" className="live-heading">{workout.exercise_name}</h3>
      <Steps workout={workout} />

      <p className="rep-count">
        <span aria-hidden="true">{workout.repetitions} / {workout.target_reps}</span>
        <span className="visually-hidden">{workout.repetitions} of {workout.target_reps} reps</span>
      </p>
      <p className="rep-count-label" aria-hidden="true">reps</p>

      <p className="device-line" aria-live="polite"><strong>Device:</strong> {deviceLine(workout)}</p>
      {/* Announced once; the visible text below counts up every second. */}
      <p className="visually-hidden" aria-live="polite">{stale ? 'Device not responding.' : ''}</p>
      {stale && (
        <p className="alert alert-warning">
          <span aria-hidden="true">⚠ </span><strong>{notRespondingText(workout, serverTime)}.</strong>{' '}
          Check that the device is switched on and connected to Wi-Fi.
        </p>
      )}
      {PHASE_HELP[workout.phase] && <p>{PHASE_HELP[workout.phase]}</p>}

      {inReading && (
        <div className="skip-box">
          <p className="hint">
            If the reading keeps failing, you can skip it. The exercise will then be saved as Incomplete.
          </p>
          <button type="button" className="button" disabled={busy} onClick={skip}>
            {busy && !confirmStop ? 'Please wait…' : 'Skip reading'}
          </button>
        </div>
      )}

      {error && <ErrorMessage error={error} />}

      {confirmStop ? (
        <div className="alert alert-warning" role="group" aria-label="Confirm stopping the exercise">
          <p>Stop this exercise now? It will be saved as Incomplete with the {workout.repetitions} reps counted so far.</p>
          <div className="button-row">
            <button type="button" className="button button-danger" disabled={busy} onClick={stop}>{busy ? 'Stopping…' : 'Yes, stop exercise'}</button>
            <button type="button" className="button" disabled={busy} onClick={() => setConfirmStop(false)}>No, keep going</button>
          </div>
        </div>
      ) : (
        <div className="button-row">
          <button type="button" className="button button-danger" disabled={busy} onClick={() => { setConfirmStop(true); setError(''); }}>Stop exercise</button>
        </div>
      )}
    </section>
  );
}
