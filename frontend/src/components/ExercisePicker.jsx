import { useEffect, useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { prescribedReps } from '../lib/carePlan.js';
import { parseTargetReps } from '../lib/exerciseStatus.js';
import { ErrorMessage, Icon } from './common.jsx';

// Used until the list arrives from the server (same values as GET /api/exercises).
const DEFAULT_EXERCISES = [
  { id: 'arm_curl', name: 'Arm Curl', placement: 'forearm' },
  { id: 'shoulder_press', name: 'Shoulder Press', placement: 'upper arm' },
  { id: 'back_row', name: 'Back Row', placement: 'upper arm' },
];

// Choose an exercise and a rep target, then start it on the session's device.
// When the care plan prescribes reps for the chosen exercise, the target is
// filled in with that number (the patient can still change it).
export function ExercisePicker({ sessionId, heading, onStarted, onConflict, plan }) {
  const { api } = useAuth();
  const [exercises, setExercises] = useState(DEFAULT_EXERCISES);
  const [choice, setChoice] = useState(null);
  const [target, setTarget] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api('/api/exercises', { signal: controller.signal })
      .then(data => { if (Array.isArray(data.exercises) && data.exercises.length) setExercises(data.exercises); })
      .catch(() => {}); // Keep the built-in list if this fails.
    return () => controller.abort();
  }, [api]);

  const parsed = parseTargetReps(target);
  const chosen = exercises.find(exercise => exercise.id === choice);
  const prescribed = choice ? prescribedReps(plan, choice) : null;

  function choose(exerciseId) {
    setChoice(exerciseId);
    setError('');
    const reps = prescribedReps(plan, exerciseId);
    if (reps !== null) setTarget(String(reps));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!choice) return setError('Choose an exercise first.');
    if (parsed.error) return setError(parsed.error);
    setBusy(true);
    setError('');
    try {
      const data = await api(`/api/sessions/${sessionId}/exercises`, {
        method: 'POST',
        body: { exercise_id: choice, target_reps: parsed.reps },
      });
      onStarted(data.workout);
    } catch (failure) {
      if (failure.status === 409) {
        setError(failure.message);
        onConflict();
      } else if (failure.status !== 401) setError(describeError(failure));
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="picker-heading">
      <h3 id="picker-heading" className="picker-head">{heading}</h3>
      <fieldset>
        <legend>1. Choose an exercise</legend>
        <div className="exercise-cards">
          {exercises.map(exercise => (
            <label key={exercise.id} className={choice === exercise.id ? 'exercise-card exercise-card-selected' : 'exercise-card'}>
              <input type="radio" name="exercise" value={exercise.id} checked={choice === exercise.id} onChange={() => choose(exercise.id)} />
              <span className="exercise-card-body">
                <strong className="exercise-card-title"><Icon name="dumbbell" />{exercise.name}</strong>
                <span className="placement" aria-hidden="true"><Icon name="device" />{exercise.placement}</span>
                <span className="hint block">Wear the device on your {exercise.placement}.</span>
                {prescribedReps(plan, exercise.id) !== null && (
                  <span className="prescribed block"><Icon name="clipboard" />Doctor’s target: {prescribedReps(plan, exercise.id)} reps</span>
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>2. How many reps?</legend>
        <div className="field">
          <label htmlFor="target-reps">Target reps</label>
          <input
            id="target-reps"
            type="text"
            inputMode="numeric"
            className="input-short"
            value={target}
            onChange={e => setTarget(e.target.value)}
            aria-describedby="target-reps-hint"
            aria-invalid={parsed.error ? true : undefined}
          />
          <p className="hint" id="target-reps-hint">
            A whole number from 1 to 50. The device stops counting at this number.
            {prescribed !== null && ` Your doctor prescribed ${prescribed} reps for ${chosen?.name ?? 'this exercise'}.`}
          </p>
        </div>
      </fieldset>
      {error && <ErrorMessage error={error} />}
      <button type="submit" className="button button-primary button-wide" disabled={busy}>
        {busy ? 'Starting…' : 'Start exercise'}
      </button>
      <p className="hint">After you press Start exercise, follow the steps on the device screen.</p>
    </form>
  );
}
