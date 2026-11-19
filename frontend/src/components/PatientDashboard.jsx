import { useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { API_BASE_URL } from '../api.js';
import { deviceLine, isOpen, isStale, notRespondingText, statusLabel } from '../lib/exerciseStatus.js';
import { formatDateTime } from '../lib/format.js';
import { CarePlanCard } from './CarePlan.jsx';
import { CopyButton, ErrorMessage, Icon, LiveBadge, Loading, ScreenHeading, StatusBadge } from './common.jsx';
import { Onboarding } from './Onboarding.jsx';
import { SessionTable } from './SessionTable.jsx';

const LIVE_POLL_MS = 3000;
const IDLE_POLL_MS = 10000;

function serverOriginUrl() {
  if (API_BASE_URL) return API_BASE_URL;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}

function LiveAppBanner({ plan }) {
  const { api } = useAuth();
  const [live, setLive] = useState({ session: null, serverTime: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let timer;

    (async () => {
      while (!stopped) {
        let hasActive = false;
        try {
          const data = await api('/api/sessions', { query: { status: 'active', limit: 1 }, signal: controller.signal });
          if (stopped) return;
          const session = data.sessions?.[0] ?? null;
          hasActive = Boolean(session?.workouts?.some(isOpen));
          setLive({ session, serverTime: data.server_time, error: null });
        } catch (failure) {
          if (stopped || failure?.name === 'AbortError' || failure?.status === 401) return;
          setLive(previous => ({ ...previous, error: failure }));
        }
        await new Promise(resolve => { timer = setTimeout(resolve, hasActive ? LIVE_POLL_MS : IDLE_POLL_MS); });
      }
    })();

    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [api]);

  if (!live.session) return null;
  const openWorkout = live.session.workouts?.find(isOpen) ?? null;
  const stale = openWorkout && isStale(openWorkout, live.serverTime);

  return (
    <section aria-labelledby="patient-live-heading" className="live-block">
      <h3 id="patient-live-heading">Live from Motion Log <LiveBadge /></h3>
      <p className="context-line">Started {formatDateTime(live.session.created_at)}.</p>
      {openWorkout && (
        <>
          <div className={`sensor-banner ${stale ? 'sensor-stale' : 'sensor-ok'}`}>
            <Icon name={stale ? 'alert' : 'signal'} />
            <p className="device-line" aria-live="polite">
              <strong>{openWorkout.exercise_name}:</strong> {deviceLine(openWorkout)}
            </p>
          </div>
          {stale && (
            <p className="alert alert-warning stale-callout" role="status">
              <span aria-hidden="true">⚠ </span><strong>{notRespondingText(openWorkout, live.serverTime)}.</strong>{' '}
              Check the Motion Log app on your phone. Finished sets queue offline and sync when reconnected.
            </p>
          )}
        </>
      )}
      <SessionTable session={live.session} serverTime={live.serverTime} plan={plan} caption="Current exercise from Motion Log" />
    </section>
  );
}

export function PatientDashboard({
  plan,
  planError,
  onRetryPlan,
  progress,
  progressError,
  onRetryProgress,
  recentSessions,
  sessionsError,
  onRetrySessions,
  totalSessions,
  completedExercises,
  onboardingDismissed,
  onDismissOnboarding,
  onOpenTab,
}) {
  const serverUrl = serverOriginUrl();
  const latestWorkouts = recentSessions.flatMap(session =>
    (session.workouts ?? []).map(workout => ({ ...workout, session_source: session.source })),
  ).slice(0, 5);

  return (
    <section aria-labelledby="dashboard-heading">
      <div id="dashboard-heading"><ScreenHeading>Overview</ScreenHeading></div>
      <Onboarding
        syncedSets={totalSessions}
        completedExercises={completedExercises}
        dismissed={onboardingDismissed}
        onDismiss={onDismissOnboarding}
      />

      <LiveAppBanner plan={plan} />

      <CarePlanCard plan={plan} error={planError} onRetry={onRetryPlan} />

      <section className="app-sync-card" aria-labelledby="app-guide-heading">
        <div className="plan-card-head">
          <span className="feature-icon"><Icon name="device" /></span>
          <div>
            <h3 id="app-guide-heading">Record exercises with the Motion Log app</h3>
            <p className="hint">Your tracker connects over Bluetooth to Motion Log on your iPhone, then syncs every set here.</p>
          </div>
        </div>
        <ol className="app-steps">
          <li>Open <strong>Motion Log</strong> on your iPhone, pick <strong>My tracker</strong> and connect your tracker over Bluetooth.</li>
          <li>Tap <strong>Sign in</strong> (or <strong>Account</strong>), enter the server URL below and sign in with this patient email and password.</li>
          <li>Pick Biceps curl, Shoulder press, or Back row (1–50 reps). Finished and stopped sets queue offline and sync here automatically.</li>
        </ol>
        {serverUrl && (
          <div className="field app-url-field">
            <label htmlFor="app-server-url">Server URL for the Motion Log app</label>
            <div className="app-url-row">
              <input id="app-server-url" type="text" readOnly value={serverUrl} onFocus={event => event.target.select()} />
              <CopyButton text={serverUrl} label="Copy server URL" copiedLabel="Copied server URL" />
            </div>
          </div>
        )}
      </section>

      {progressError && <ErrorMessage error={progressError} onRetry={onRetryProgress} />}
      {!progress && !progressError && <Loading label="Loading exercise summary…" />}
      {progress && (
        <div className="tiles" role="group" aria-label="Synced workout totals">
          <div className="tile">
            <p className="tile-label"><Icon name="check" />Completed exercises</p>
            <p className="tile-value">{progress.completed_workouts ?? 0}</p>
          </div>
          <div className="tile">
            <p className="tile-label"><Icon name="dumbbell" />Total repetitions</p>
            <p className="tile-value">{progress.total_repetitions ?? 0}</p>
          </div>
          <div className="tile">
            <p className="tile-label"><Icon name="history" />Synced sessions</p>
            <p className="tile-value">{totalSessions}</p>
          </div>
        </div>
      )}

      <div className="recent-head">
        <h3>Recent synced sets</h3>
        <div className="button-row">
          <button type="button" className="button" onClick={() => onOpenTab('history')}>
            <Icon name="history" />Full history
          </button>
          <button type="button" className="button" onClick={() => onOpenTab('progress')}>
            <Icon name="chart" />Progress charts
          </button>
        </div>
      </div>

      {sessionsError && <ErrorMessage error={sessionsError} onRetry={onRetrySessions} />}
      {!sessionsError && latestWorkouts.length === 0 && (
        <p className="empty">No sets synced yet. Record an exercise in the Motion Log iPhone app and it will appear here.</p>
      )}
      {latestWorkouts.length > 0 && (
        <ul className="list">
          {latestWorkouts.map(workout => (
            <li key={workout.id} className="list-item">
              <div className="session-row-main">
                <strong>{workout.exercise_name}</strong>
                <span className="session-meta">
                  <StatusBadge status={workout.status} label={statusLabel(workout)} />
                  <span>{workout.repetitions} of {workout.target_reps} reps</span>
                  <span>Before: {workout.before_bpm !== null ? `${workout.before_bpm} bpm` : workout.before_skipped ? 'Skipped' : 'No reading'}</span>
                  <span>After: {workout.after_bpm !== null ? `${workout.after_bpm} bpm` : workout.after_skipped ? 'Skipped' : 'No reading'}</span>
                  <span>{formatDateTime(workout.started_at ?? workout.created_at)}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
