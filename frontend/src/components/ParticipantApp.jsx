import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { DevicesPanel } from './DevicesPanel.jsx';
import { HistoryList } from './HistoryList.jsx';
import { fetchUnfinished, NewWorkout } from './NewWorkout.jsx';
import { ProgressView } from './ProgressView.jsx';
import { WorkoutView } from './WorkoutView.jsx';

const VIEWS = [
  { id: 'workout', label: 'Workout' },
  { id: 'devices', label: 'My devices' },
  { id: 'history', label: 'History' },
  { id: 'progress', label: 'Progress' },
];

export function ParticipantApp() {
  const { api } = useAuth();
  const [view, setView] = useState('workout');
  const [devices, setDevices] = useState(null);
  const [devicesError, setDevicesError] = useState(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [currentWorkoutId, setCurrentWorkoutId] = useState(null);
  const [historyWorkoutId, setHistoryWorkoutId] = useState(null);
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

  useEffect(() => {
    reloadDevices();
    // After signing in again, return to a workout that is still unfinished.
    const controller = new AbortController();
    fetchUnfinished(api, controller.signal)
      .then(unfinished => { if (unfinished.length === 1) setCurrentWorkoutId(previous => previous ?? unfinished[0].id); })
      .catch(() => {});
    return () => controller.abort();
  }, [api, reloadDevices]);

  const onFinished = useCallback(() => setRefreshKey(key => key + 1), []);

  function go(next) {
    setView(next);
    setHistoryWorkoutId(null);
  }

  return (
    <>
      <nav className="nav" aria-label="Main sections">
        {VIEWS.map(item => (
          <button key={item.id} type="button" className="nav-button" aria-current={view === item.id ? 'page' : undefined} onClick={() => go(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="card">
        {view === 'workout' && (currentWorkoutId ? (
          <WorkoutView
            key={currentWorkoutId}
            workoutId={currentWorkoutId}
            canCancel
            onFinished={onFinished}
            onBack={() => { setCurrentWorkoutId(null); reloadDevices(); }}
            backLabel="Start another workout"
          />
        ) : (
          <NewWorkout
            devices={devices}
            devicesError={devicesError}
            reloadDevices={reloadDevices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
            onOpenWorkout={setCurrentWorkoutId}
            onGoToDevices={() => go('devices')}
          />
        ))}
        {view === 'devices' && (
          <DevicesPanel devices={devices} devicesError={devicesError} reloadDevices={reloadDevices} selectedDeviceId={selectedDeviceId} onSelect={setSelectedDeviceId} />
        )}
        {view === 'history' && (historyWorkoutId ? (
          <WorkoutView key={historyWorkoutId} workoutId={historyWorkoutId} canCancel onFinished={onFinished} onBack={() => setHistoryWorkoutId(null)} backLabel="← Back to history" />
        ) : (
          <HistoryList listPath="/api/workouts" progressPath="/api/progress" refreshKey={refreshKey} onOpen={setHistoryWorkoutId} />
        ))}
        {view === 'progress' && <ProgressView progressPath="/api/progress" refreshKey={refreshKey} />}
      </div>
    </>
  );
}
