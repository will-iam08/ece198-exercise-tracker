import { useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { formatDateTime } from '../lib/format.js';
import { ErrorMessage, Loading, ScreenHeading } from './common.jsx';

export function DevicesPanel({ devices, devicesError, reloadDevices, selectedDeviceId, onSelect }) {
  const { api } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The token is held only in this component's memory until dismissed.
  const [provisioned, setProvisioned] = useState(null);
  const [copied, setCopied] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');

  async function addDevice(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) return setError('Enter a name for the device (up to 80 characters).');
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/devices', { method: 'POST', body: { name: trimmed } });
      setProvisioned({ name: data.device.name, token: data.device_token });
      setCopied(false);
      setName('');
      onSelect(data.device.id);
      await reloadDevices();
    } catch (failure) {
      if (failure.status !== 401) setError(describeError(failure));
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(provisioned.token);
      setCopied(true);
    } catch {
      setCopied(false);
      setError('Copying did not work. Select the token text and copy it by hand.');
    }
  }

  async function removeDevice(id) {
    setRemoveBusy(true);
    setRemoveError('');
    try {
      await api(`/api/devices/${id}`, { method: 'DELETE' });
      setRemovingId(null);
      await reloadDevices();
    } catch (failure) {
      if (failure.status === 404) {
        setRemovingId(null);
        await reloadDevices();
      } else if (failure.status !== 401) setRemoveError(describeError(failure));
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <section aria-labelledby="devices-heading">
      <div id="devices-heading"><ScreenHeading>My devices</ScreenHeading></div>
      <p>Your exercise device (ESP32) counts repetitions and measures heart rate. Add it here once, then choose it when you start a workout.</p>

      {provisioned && (
        <div className="alert alert-warning" role="alert">
          <h3>Device token for “{provisioned.name}”</h3>
          <p><strong>This token is shown only once.</strong> Enter it into the device now. It cannot be shown again; if it is lost, remove the device and add it again.</p>
          <div className="field">
            <label htmlFor="device-token">Device token</label>
            <input id="device-token" type="text" readOnly value={provisioned.token} className="token-field" onFocus={e => e.target.select()} spellCheck={false} autoComplete="off" />
          </div>
          <div className="button-row">
            <button type="button" className="button" onClick={copyToken}>{copied ? 'Copied ✓' : 'Copy token'}</button>
            <button type="button" className="button button-primary" onClick={() => setProvisioned(null)}>I have saved it — hide token</button>
          </div>
          <p className="hint" role="status">{copied ? 'The token was copied.' : ''}</p>
        </div>
      )}

      <h3>Choose the device to use</h3>
      {devicesError && <ErrorMessage error={devicesError} onRetry={reloadDevices} />}
      {devices === null && !devicesError && <Loading label="Loading your devices…" />}
      {devices?.length === 0 && <p className="empty">You have not added a device yet. Add one below.</p>}
      {devices?.length > 0 && (
        <ul className="list">
          {devices.map(device => (
            <li key={device.id} className={device.id === selectedDeviceId ? 'list-item list-item-selected' : 'list-item'}>
              <label className="choice">
                <input type="radio" name="selected-device" checked={device.id === selectedDeviceId} onChange={() => onSelect(device.id)} />
                <span>
                  <strong>{device.name}</strong>
                  <span className="hint block">
                    {device.last_seen_at ? `Last contact: ${formatDateTime(device.last_seen_at)}` : 'The device has not connected yet.'}
                  </span>
                </span>
              </label>
              {removingId === device.id ? (
                <div className="alert alert-warning" role="group" aria-label={`Confirm removing ${device.name}`}>
                  <p>Remove “{device.name}”? Its token stops working and any unfinished workout on it is cancelled. Your past workouts are kept.</p>
                  <div className="button-row">
                    <button type="button" className="button button-danger" disabled={removeBusy} onClick={() => removeDevice(device.id)}>{removeBusy ? 'Removing…' : 'Yes, remove device'}</button>
                    <button type="button" className="button" disabled={removeBusy} onClick={() => setRemovingId(null)}>No, keep it</button>
                  </div>
                  {removeError && <ErrorMessage error={removeError} />}
                </div>
              ) : (
                <button type="button" className="button button-small" onClick={() => { setRemovingId(device.id); setRemoveError(''); }} aria-label={`Remove device ${device.name}`}>Remove device</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Add a device</h3>
      <form onSubmit={addDevice} noValidate className="inline-form">
        <div className="field">
          <label htmlFor="device-name">Device name</label>
          <input id="device-name" type="text" maxLength={80} value={name} onChange={e => setName(e.target.value)} aria-describedby="device-name-hint" />
          <p className="hint" id="device-name-hint">For example “Wrist ESP32”.</p>
        </div>
        <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Adding…' : 'Add device'}</button>
      </form>
      {error && <ErrorMessage error={error} />}
    </section>
  );
}
