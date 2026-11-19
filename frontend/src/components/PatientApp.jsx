import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { ErrorMessage, TabNav } from './common.jsx';
import { PatientDashboard } from './PatientDashboard.jsx';
import { PatientMessages } from './PatientMessages.jsx';
import { RepProgress } from './RepProgress.jsx';
import { SessionHistory } from './SessionHistory.jsx';

const VIEWS = [
  { id: 'dashboard', label: 'Overview', icon: 'pulse' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'progress', label: 'Progress', icon: 'chart' },
  { id: 'messages', label: 'Messages', icon: 'mail' },
];

export function PatientApp() {
  const { api } = useAuth();
  const [view, setView] = useState('dashboard');
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [planAttempt, setPlanAttempt] = useState(0);
  const [progress, setProgress] = useState(null);
  const [progressError, setProgressError] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [totalSessions, setTotalSessions] = useState(0);
  const [sessionsError, setSessionsError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const loadPlan = useCallback(() => {
    const controller = new AbortController();
    setPlanError(null);
    api('/api/plan', { signal: controller.signal })
      .then(data => setPlan(data.plan ?? null))
      .catch(failure => { if (failure?.name !== 'AbortError' && failure?.status !== 401) setPlanError(failure); });
    return () => controller.abort();
  }, [api]);

  useEffect(() => loadPlan(), [loadPlan, planAttempt, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setProgressError(null);
    api('/api/progress', { query: { kind: 'reps' }, signal: controller.signal })
      .then(setProgress)
      .catch(failure => {
        if (failure?.name !== 'AbortError' && failure?.status !== 401) setProgressError(failure);
      });
    return () => controller.abort();
  }, [api, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setSessionsError(null);
    api('/api/sessions', { query: { limit: 5 }, signal: controller.signal })
      .then(data => {
        setRecentSessions(data.sessions ?? []);
        setTotalSessions(data.total ?? 0);
      })
      .catch(failure => {
        if (failure?.name !== 'AbortError' && failure?.status !== 401) setSessionsError(failure);
      });
    return () => controller.abort();
  }, [api, refreshKey]);

  function reloadDashboard() {
    setRefreshKey(n => n + 1);
  }

  function changeView(next) {
    setView(next);
    if (next === 'dashboard' || next === 'history' || next === 'progress') {
      setRefreshKey(n => n + 1);
    }
  }

  return (
    <>
      <TabNav views={VIEWS} current={view} onChange={changeView} label="Patient sections" />
      <div className="card">
        {planError && view !== 'dashboard' && <ErrorMessage error={planError} onRetry={() => setPlanAttempt(n => n + 1)} />}
        {view === 'dashboard' && (
          <PatientDashboard
            plan={plan}
            planError={planError}
            onRetryPlan={() => setPlanAttempt(n => n + 1)}
            progress={progress}
            progressError={progressError}
            onRetryProgress={reloadDashboard}
            recentSessions={recentSessions}
            sessionsError={sessionsError}
            onRetrySessions={reloadDashboard}
            totalSessions={totalSessions}
            completedExercises={progress?.completed_workouts ?? 0}
            onboardingDismissed={onboardingDismissed}
            onDismissOnboarding={() => setOnboardingDismissed(true)}
            onOpenTab={changeView}
          />
        )}
        {view === 'history' && <SessionHistory refreshKey={refreshKey} plan={plan} />}
        {view === 'progress' && <RepProgress refreshKey={refreshKey} />}
        {view === 'messages' && <PatientMessages />}
      </div>
    </>
  );
}
