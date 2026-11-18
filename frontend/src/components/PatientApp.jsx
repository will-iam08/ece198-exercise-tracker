import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { DevicesPanel } from './DevicesPanel.jsx';
import { RepProgress } from './RepProgress.jsx';
import { SessionHistory } from './SessionHistory.jsx';
import { SessionScreen } from './SessionScreen.jsx';

const VIEWS = [
  { id: 'session', label: 'Session' },
  { id: 'history', label: 'History' },
  { id: 'progress', label: 'Progress' },
  { id: 'devices', label: 'My devices' },
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

  const onChanged = useCallback(() => setRefreshKey(key => key + 1), []);

  return (
    <>
      <nav className="nav" aria-label="Main sections">
        {VIEWS.map(item => (
          <button key={item.id} type="button" className="nav-button" aria-current={view === item.id ? 'page' : undefined} onClick={() => setView(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
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
          />
        )}
        {view === 'history' && <SessionHistory devices={devices} refreshKey={refreshKey} />}
        {view === 'progress' && <RepProgress refreshKey={refreshKey} />}
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
