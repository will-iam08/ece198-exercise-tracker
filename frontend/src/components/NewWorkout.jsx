import { useCallback, useEffect, useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { formatDurationWords, minutesToSeconds, PRESET_EXERCISES, STATUS_LABELS } from '../lib/format.js';
import { ErrorMessage, Loading, ScreenHeading } from './common.jsx';

const CUSTOM = '__custom__';

// Pending and active workouts for the signed-in participant.
export async function fetchUnfinished(api, signal) {
  const [pending, active] = await Promise.all([
    api('/api/workouts', { query: { status: 'pending', limit: 100 }, signal }),
    api('/api/workouts', { query: { status: 'active', limit: 100 }, signal }),
  ]);
  return [...active.workouts, ...pending.workouts];
}

export function NewWorkout({ devices, devicesError, reloadDevices, selectedDeviceId, onSelectDevice, onOpenWorkout, onGoToDevices }) {
  const { api } = useAuth();
  const [exercises, setExercises] = useState(PRESET_EXERCISES);
  const [choice, setChoice] = useState(PRESET_EXERCISES[0]);
  const [customName, setCustomName] = useState('');
  const [minutes, setMinutes] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(null); // unfinished workout blocking the chosen device
  const [unfinished, setUnfinished] = useState([]);
  const [notice, setNotice] = useState('');

  const loadUnfinished = useCallback(async signal => {
    try {
      setUnfinished(await fetchUnfinished(api, signal));
    } catch {
      // The list is a convenience; creating a workout still reports conflicts.
    }
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    api('/api/exercises', { signal: controller.signal })
      .then(data => { if (Array.isArray(data.exercises) && data.exercises.length) setExercises(data.exercises); })
      .catch(() => {}); // Keep the three standard names if the list cannot be loaded.
    loadUnfinished(controller.signal);
    return () => controller.abort();
  }, [api, loadUnfinished]);

  const preview = minutesToSeconds(minutes);

  async function onSubmit(event) {
    event.preventDefault();
    setNotice('');
    setConflict(null);
    if (!selectedDeviceId) return setError('Choose a device first.');
    const exerciseName = (choice === CUSTOM ? customName : choice).trim();
    if (!exerciseName || exerciseName.length > 80) return setError('Enter a name for your exercise (up to 80 characters).');
    if (preview.error) return setError(preview.error);
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/workouts', {
        method: 'POST',
        body: { device_id: selectedDeviceId, exercise_name: exerciseName, target_duration_seconds: preview.seconds },
      });
      onOpenWorkout(data.workout.id);
    } catch (failure) {
      if (failure.status === 409) {
        let blocking = null;
        try {
          blocking = (await fetchUnfinished(api)).find(workout => workout.device_id === selectedDeviceId) ?? null;
        } catch { /* fall through to the general message */ }
        if (blocking) setConflict(blocking);
        else setError('This device already has an unfinished workout. Finish or cancel it before starting another.');
      } else if (failure.status === 404) {
        setError('That device is no longer available. Choose another device.');
        reloadDevices();
      } else if (failure.status !== 401) setError(describeError(failure));
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  async function cancelWorkout(workout) {
    setError('');
    try {
      await api(`/api/workouts/${workout.id}/cancel`, { method: 'POST' });
      setConflict(null);
      setNotice(`The unfinished ${workout.exercise_name} workout was cancelled. You can start a new workout now.`);
      await loadUnfinished();
    } catch (failure) {
      if (failure.status !== 401) setError(describeError(failure));
    }
  }

  const deviceName = id => devices?.find(device => device.id === id)?.name ?? 'a removed device';

  return (
    <section aria-labelledby="new-workout-heading">
      <div id="new-workout-heading"><ScreenHeading>Start a workout</ScreenHeading></div>

      {unfinished.length > 0 && !conflict && (
        <div className="alert alert-info">
          <h3>Unfinished workouts</h3>
          <ul className="list">
            {unfinished.map(workout => (
              <li key={workout.id} className="list-item">
                <span><strong>{workout.exercise_name}</strong> on {deviceName(workout.device_id)} — {STATUS_LABELS[workout.status]}</span>
                <span className="button-row">
                  <button type="button" className="button button-primary" onClick={() => onOpenWorkout(workout.id)} aria-label={`Resume ${workout.exercise_name} workout`}>Resume</button>
                  <button type="button" className="button button-danger" onClick={() => cancelWorkout(workout)} aria-label={`Cancel ${workout.exercise_name} workout`}>Cancel it</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {notice && <p className="alert alert-success" role="status">{notice}</p>}

      <form onSubmit={onSubmit} noValidate>
        <fieldset>
          <legend>1. Choose your device</legend>
          {devicesError && <ErrorMessage error={devicesError} onRetry={reloadDevices} />}
          {devices === null && !devicesError && <Loading label="Loading your devices…" />}
          {devices?.length === 0 && (
            <div className="empty">
              <p>You need to add your exercise device before you can start.</p>
              <button type="button" className="button button-primary" onClick={onGoToDevices}>Add a device</button>
            </div>
          )}
          {devices?.map(device => (
            <label key={device.id} className="choice">
              <input type="radio" name="workout-device" checked={device.id === selectedDeviceId} onChange={() => onSelectDevice(device.id)} />
              <span>{device.name}</span>
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>2. Choose your exercise</legend>
          {exercises.map(exercise => (
            <label key={exercise} className="choice">
              <input type="radio" name="workout-exercise" checked={choice === exercise} onChange={() => setChoice(exercise)} />
              <span>{exercise}</span>
            </label>
          ))}
          <label className="choice">
            <input type="radio" name="workout-exercise" checked={choice === CUSTOM} onChange={() => setChoice(CUSTOM)} />
            <span>Another exercise (type its name)</span>
          </label>
          {choice === CUSTOM && (
            <div className="field field-indented">
              <label htmlFor="custom-exercise">Name of your exercise</label>
              <input id="custom-exercise" type="text" maxLength={80} value={customName} onChange={e => setCustomName(e.target.value)} aria-describedby="custom-exercise-hint" />
              <p className="hint" id="custom-exercise-hint">Up to 80 characters, for example “Leg lifts”.</p>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>3. How long do you plan to exercise?</legend>
          <div className="field">
            <label htmlFor="planned-minutes">Planned time in minutes</label>
            <input id="planned-minutes" type="text" inputMode="decimal" className="input-short" value={minutes} onChange={e => setMinutes(e.target.value)} aria-describedby="planned-minutes-hint" />
            <p className="hint" id="planned-minutes-hint">
              {preview.error ? 'Enter a number of minutes, from 1 second (0.02) up to 1440.' : `That is ${formatDurationWords(preview.seconds)}.`}{' '}
              This is your goal. The workout ends when you press stop on the device.
            </p>
          </div>
        </fieldset>

        {error && <ErrorMessage error={error} />}
        {conflict && (
          <div className="alert alert-warning" role="alert">
            <p>
              <strong>{deviceName(conflict.device_id)} already has an unfinished workout:</strong> {conflict.exercise_name} ({STATUS_LABELS[conflict.status]}).
              A device can have only one workout at a time.
            </p>
            <div className="button-row">
              <button type="button" className="button button-primary" onClick={() => onOpenWorkout(conflict.id)}>Resume that workout</button>
              <button type="button" className="button button-danger" onClick={() => cancelWorkout(conflict)}>Cancel that workout</button>
            </div>
          </div>
        )}
        <button type="submit" className="button button-primary button-wide" disabled={busy || !devices?.length}>
          {busy ? 'Setting up…' : 'Set up workout'}
        </button>
        <p className="hint">After this, press the start button on your device to begin counting.</p>
      </form>
    </section>
  );
}
