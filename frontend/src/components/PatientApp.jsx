import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { TabNav } from './common.jsx';
import { Onboarding } from './Onboarding.jsx';
import { DevicesPanel } from './DevicesPanel.jsx';
import { PatientMessages } from './PatientMessages.jsx';
import { RepProgress } from './RepProgress.jsx';
import { SessionHistory } from './SessionHistory.jsx';
import { SessionScreen } from './SessionScreen.jsx';

const VIEWS = [
  { id: 'session', label: 'Session', icon: 'pulse' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'progress', label: 'Progress', icon: 'chart' },
  { id: 'messages', label: 'Messages', icon: 'mail' },
  { id: 'devices', label: 'My devices', icon: 'device' },
];

export function PatientApp() {
  const { api } = useAuth();
  const [view, setView] = useState('session');
  const [devices, setDevices] = useState(null);
  const [devicesError, setDevicesError] = useState(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const reloadDevices = useCallback(async () => {
    try {
      const data = await api('/api/devices');
      setDevices(data.devices);
      setDevicesError(null);
      // Keep the current choice if it still exists; otherwise pick the first device.
      setSelectedDeviceId(previous => (data.devices.some(device => device.id === previous) ? previous : data.devices[0]?.id ?? null));
    } catch (failure) {
      if (failure.status !== 401) setDevicesError(failure);
    }
  }, [api]);

  useEffect(() => { reloadDevices(); }, [reloadDevices]);

  // The care plan from the patient's doctor, checked again whenever a tab is opened.
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const reloadPlan = useCallback(async () => {
    try {
      setPlan((await api('/api/plan')).plan);
      setPlanError(null);
    } catch (failure) {
      if (failure.status !== 401) setPlanError(failure);
    }
  }, [api]);
  useEffect(() => { reloadPlan(); }, [reloadPlan, view]);

  const onChanged = useCallback(() => setRefreshKey(key => key + 1), []);

  // How many exercises are complete, for the first-visit checklist. It stays
  // hidden (null) until this is known, and is not fetched again once done.
  const [completedExercises, setCompletedExercises] = useState(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  useEffect(() => {
    if (onboardingDismissed || completedExercises > 0) return undefined;
    const controller = new AbortController();
    api('/api/progress', { query: { kind: 'reps' }, signal: controller.signal })
      .then(data => setCompletedExercises(data.completed_workouts ?? 0))
      .catch(() => {});
    return () => controller.abort();
  }, [api, refreshKey, onboardingDismissed, completedExercises]);

  return (
    <>
      <Onboarding
        deviceCount={devices ? devices.length : null}
        completedExercises={completedExercises}
        dismissed={onboardingDismissed}
        onDismiss={() => setOnboardingDismissed(true)}
        onGoToDevices={() => setView('devices')}
        onGoToSession={() => setView('session')}
      />
      <TabNav views={VIEWS} current={view} onChange={setView} label="Main sections" />
      <div className="card">
        {view === 'session' && (
          <SessionScreen
            devices={devices}
            devicesError={devicesError}
            reloadDevices={reloadDevices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
            onGoToDevices={() => setView('devices')}
            onChanged={onChanged}
            plan={plan}
            planError={planError}
            reloadPlan={reloadPlan}
          />
        )}
        {view === 'history' && <SessionHistory devices={devices} refreshKey={refreshKey} plan={plan} />}
        {view === 'progress' && <RepProgress refreshKey={refreshKey} />}
        {view === 'messages' && <PatientMessages />}
        {view === 'devices' && (
          <DevicesPanel
            devices={devices}
            devicesError={devicesError}
            reloadDevices={reloadDevices}
            selectedDeviceId={selectedDeviceId}
            onSelect={setSelectedDeviceId}
            onGoToSession={() => setView('session')}
          />
        )}
      </div>
    </>
  );
}
