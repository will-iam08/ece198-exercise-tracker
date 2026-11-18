import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { Icon } from './common.jsx';
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

  return (
    <>
      <nav className="nav" aria-label="Main sections">
        {VIEWS.map(item => (
          <button key={item.id} type="button" className="nav-button" aria-current={view === item.id ? 'page' : undefined} onClick={() => setView(item.id)}>
            <Icon name={item.icon} />{item.label}
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
