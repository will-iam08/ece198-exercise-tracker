import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useSession } from '../hooks/useSession.js';
import { formatDateTime } from '../lib/format.js';
import { bpmLabel, isOpen, statusLabel, withWorkout } from '../lib/exerciseStatus.js';
import { createChimePlayer, cueEvents } from '../lib/soundCues.js';
import { CarePlanCard } from './CarePlan.jsx';
import { ErrorMessage, Icon, Loading, ScreenHeading } from './common.jsx';
import { ExercisePicker } from './ExercisePicker.jsx';
import { LiveExercise } from './LiveExercise.jsx';
import { SessionTable } from './SessionTable.jsx';

// Old timed workouts that are still open block new exercises on their device.
async function fetchOpenTimed(api, signal) {
  const [pending, active] = await Promise.all([
    api('/api/workouts', { query: { kind: 'timed', status: 'pending', limit: 100 }, signal }),
    api('/api/workouts', { query: { kind: 'timed', status: 'active', limit: 100 }, signal }),
  ]);
  return [...active.workouts, ...pending.workouts];
}

function OpenTimedAlert({ workouts, deviceName, onCancelled }) {
  const { api } = useAuth();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  if (workouts.length === 0) return null;

  async function cancel(workout) {
    setBusyId(workout.id);
    setError('');
    try {
      await api(`/api/workouts/${workout.id}/cancel`, { method: 'POST' });
      onCancelled();
    } catch (failure) {
      if (failure.status === 409) onCancelled();
      else if (failure.status !== 401) setError(describeError(failure));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="alert alert-warning" role="alert">
      <h3><span aria-hidden="true">⚠ </span>An old workout is still open</h3>
      <p>
        This old timed workout was never finished. A device can run only one workout at a time, so cancel the old
        one before you start a new exercise on that device. It stays in your history.
      </p>
      <ul className="list">
        {workouts.map(workout => (
          <li key={workout.id} className="list-item">
            <span>
              <strong>{workout.exercise_name}</strong> on {deviceName(workout.device_id)}
              <span className="hint block">Set up {formatDateTime(workout.created_at)}</span>
            </span>
            <button type="button" className="button button-danger" disabled={busyId === workout.id} onClick={() => cancel(workout)} aria-label={`Cancel old ${workout.exercise_name} workout`}>
              {busyId === workout.id ? 'Cancelling…' : 'Cancel old workout'}
            </button>
          </li>
        ))}
      </ul>
      {error && <ErrorMessage error={error} />}
    </div>
  );
}

function resultLine(workout) {
  return `${workout.exercise_name}: ${statusLabel(workout)}. ${workout.repetitions} of ${workout.target_reps} reps. `
    + `Heart rate before: ${bpmLabel(workout, 'before')}. Heart rate after: ${bpmLabel(workout, 'after')}.`;
}

function StartSession({ devices, devicesError, reloadDevices, selectedDeviceId, onSelectDevice, onGoToDevices, onStarted }) {
  const { api } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    if (!selectedDeviceId) return setError('Choose a device first.');
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/sessions', { method: 'POST', body: { device_id: selectedDeviceId } });
      onStarted(data.session.id, '');
    } catch (failure) {
      if (failure.status === 409 && failure.details?.session_id) {
        onStarted(failure.details.session_id, 'You already have a workout session in progress, so it is shown here.');
      } else if (failure.status === 404) {
        setError('That device is no longer available. Choose another device.');
        reloadDevices();
      } else if (failure.status !== 401) setError(describeError(failure));
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  if (devicesError) return <ErrorMessage error={devicesError} onRetry={reloadDevices} />;
  if (devices === null) return <Loading label="Loading your devices…" />;
  if (devices.length === 0) {
    return (
      <div className="empty">
        <p>You need to add your exercise device before you can start a workout session.</p>
        <button type="button" className="button button-primary" onClick={onGoToDevices}>Add a device</button>
      </div>
    );
  }
  return (
    <>
      <p>A workout session holds the exercises you do today. You choose each exercise and how many reps to do after the session starts.</p>
      {devices.length === 1 ? (
        <p>Device: <strong>{devices[0].name}</strong></p>
      ) : (
        <fieldset>
          <legend>Which device are you wearing?</legend>
          {devices.map(device => (
            <label key={device.id} className="choice">
              <input type="radio" name="session-device" checked={device.id === selectedDeviceId} onChange={() => onSelectDevice(device.id)} />
              <span>{device.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      {error && <ErrorMessage error={error} />}
      <button type="button" className="button button-primary button-wide" disabled={busy} onClick={start}>
        {busy ? 'Starting…' : 'Start workout session'}
      </button>
    </>
  );
}

// Ends the session. If an exercise is still running, the server saves it as
// Incomplete, so the confirm step says so.
function EndSession({ session, openWorkout, onEnded }) {
  const { api } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function end() {
    setBusy(true);
    setError('');
    try {
      const data = await api(`/api/sessions/${session.id}/end`, { method: 'POST' });
      onEnded(data.session);
    } catch (failure) {
      if (failure.status !== 401) setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <div className="button-row">
        <button type="button" className="button" onClick={() => { setConfirming(true); setError(''); }}>End session</button>
      </div>
    );
  }
  return (
    <div className="alert alert-warning" role="group" aria-label="Confirm ending the session">
      <p>
        End this workout session?{' '}
        {openWorkout && (
          <strong>
            The {openWorkout.exercise_name} exercise that is running now will be saved as Incomplete, with the{' '}
            {openWorkout.repetitions} rep{openWorkout.repetitions === 1 ? '' : 's'} counted so far.{' '}
          </strong>
        )}
        You can start a new session at any time.
      </p>
      <div className="button-row">
        <button type="button" className="button button-danger" disabled={busy} onClick={end}>{busy ? 'Ending…' : 'Yes, end session'}</button>
        <button type="button" className="button" disabled={busy} onClick={() => setConfirming(false)}>No, keep going</button>
      </div>
      {error && <ErrorMessage error={error} />}
    </div>
  );
}

// The Session tab: start a session, choose exercises one at a time, follow the
// running exercise, and end the session.
export function SessionScreen({
  devices, devicesError, reloadDevices, selectedDeviceId, onSelectDevice, onGoToDevices, onChanged, plan, planError, reloadPlan,
}) {
  const { api } = useAuth();
  const [sessionId, setSessionId] = useState(null);
  const [finding, setFinding] = useState(true);
  const [findError, setFindError] = useState(null);
  const [notice, setNotice] = useState('');
  const [openTimed, setOpenTimed] = useState([]);
  const [findAttempt, setFindAttempt] = useState(0);
  const { session, serverTime, loading, disconnected, error, reload } = useSession(api, sessionId, { live: true });

  // Return to a session that is still active (after signing in again or
  // coming back to this tab).
  useEffect(() => {
    const controller = new AbortController();
    setFinding(true);
    setFindError(null);
    api('/api/sessions', { query: { status: 'active', limit: 1 }, signal: controller.signal })
      .then(data => {
        setSessionId(previous => previous ?? data.sessions[0]?.id ?? null);
        setFinding(false);
      })
      .catch(failure => {
        if (failure?.name === 'AbortError') return;
        if (failure?.status !== 401) setFindError(failure);
        setFinding(false);
      });
    return () => controller.abort();
  }, [api, findAttempt]);

  const loadOpenTimed = useCallback(async signal => {
    try {
      setOpenTimed(await fetchOpenTimed(api, signal));
    } catch {
      // This list is a convenience; starting an exercise still reports the conflict.
    }
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    loadOpenTimed(controller.signal);
    return () => controller.abort();
  }, [loadOpenTimed]);

  const openWorkout = session?.workouts.find(isOpen) ?? null;
  const lastWorkout = session?.workouts.at(-1) ?? null;

  // Refresh history and progress once an exercise finishes.
  const openId = openWorkout?.id ?? null;
  const [watchedId, setWatchedId] = useState(null);
  useEffect(() => {
    if (openId !== watchedId) {
      if (watchedId) onChanged();
      setWatchedId(openId);
    }
  }, [openId, watchedId, onChanged]);

  // Optional sound cues for when the patient's arm is away from the screen.
  // The setting lives only in memory, like everything else on this site.
  const [soundOn, setSoundOn] = useState(false);
  const playerRef = useRef(null);
  const previousRef = useRef(null);
  useEffect(() => () => playerRef.current?.close(), []);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = lastWorkout;
    if (!soundOn || !playerRef.current) return;
    for (const cue of cueEvents(previous, lastWorkout)) playerRef.current.play(cue);
  }, [lastWorkout, soundOn]);

  function toggleSound() {
    if (soundOn) return setSoundOn(false);
    // Browsers only allow audio after a tap, so the player starts here.
    playerRef.current ??= createChimePlayer();
    playerRef.current.play('rep');
    return setSoundOn(true);
  }

  const deviceName = id => devices?.find(device => device.id === id)?.name ?? 'a removed device';

  function startSession(id, message) {
    setNotice(message);
    setSessionId(id);
    onChanged();
  }

  function newSession() {
    setNotice('');
    setSessionId(null);
    reloadDevices();
  }

  const updateWorkout = workout => (workout && session ? reload(withWorkout(session, workout)) : reload());

  let body;
  if (finding || (sessionId && loading)) {
    body = <Loading label="Loading your workout session…" />;
  } else if (findError && !sessionId) {
    body = <ErrorMessage error={findError} onRetry={() => setFindAttempt(n => n + 1)} />;
  } else if (!sessionId) {
    body = (
      <StartSession
        devices={devices}
        devicesError={devicesError}
        reloadDevices={reloadDevices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={onSelectDevice}
        onGoToDevices={onGoToDevices}
        onStarted={startSession}
      />
    );
  } else if (!session) {
    body = (
      <>
        <ErrorMessage error={error} onRetry={() => reload()} />
        <div className="button-row"><button type="button" className="button" onClick={newSession}>Start a new session</button></div>
      </>
    );
  } else {
    const ended = session.status === 'ended';
    body = (
      <>
        <p className="context-line">
          <Icon name="device" />
          Session started {formatDateTime(session.created_at)} on <strong>{deviceName(session.device_id)}</strong>.
        </p>
        {disconnected && (
          <p className="alert alert-warning" role="status">
            <span aria-hidden="true">⚠ </span><strong>Lost connection to the server.</strong> Trying again automatically.
            The numbers below are the last ones received and may be out of date.
          </p>
        )}
        {!disconnected && error && <ErrorMessage error={error} onRetry={() => reload()} />}

        {ended && (
          <>
            <p className="alert alert-success" role="status">
              <span aria-hidden="true">✓ </span><strong>This workout session has ended.</strong> It is saved in your history.
            </p>
            <div className="button-row">
              <button type="button" className="button button-primary" onClick={newSession}>Start a new session</button>
            </div>
          </>
        )}

        {!ended && openWorkout && (
          <LiveExercise
            key={openWorkout.id}
            workout={openWorkout}
            serverTime={serverTime}
            disconnected={disconnected}
            onChanged={updateWorkout}
            soundOn={soundOn}
            onToggleSound={toggleSound}
          />
        )}

        {!ended && !openWorkout && (
          <>
            {lastWorkout && (
              <p className={lastWorkout.status === 'completed' ? 'alert alert-success' : 'alert alert-info'} role="status">
                <span aria-hidden="true">{lastWorkout.status === 'completed' ? '✓ ' : '! '}</span>
                <strong>Last exercise finished.</strong> {resultLine(lastWorkout)}
              </p>
            )}
            <ExercisePicker
              sessionId={session.id}
              plan={plan}
              heading={lastWorkout ? 'Choose next exercise' : 'Choose your first exercise'}
              onStarted={updateWorkout}
              onConflict={() => { reload(); loadOpenTimed(); }}
            />
          </>
        )}

        {!ended && (
          <EndSession session={session} openWorkout={openWorkout} onEnded={endedSession => { reload(endedSession); onChanged(); }} />
        )}

        <h3>Exercises in this session</h3>
        <SessionTable session={session} plan={plan} />
      </>
    );
  }

  return (
    <section aria-labelledby="session-heading">
      <div id="session-heading"><ScreenHeading>Workout session</ScreenHeading></div>
      <OpenTimedAlert workouts={openTimed} deviceName={deviceName} onCancelled={() => loadOpenTimed()} />
      {notice && <p className="alert alert-info" role="status">{notice}</p>}
      <CarePlanCard plan={plan} error={planError} onRetry={reloadPlan} />
      {body}
    </section>
  );
}
