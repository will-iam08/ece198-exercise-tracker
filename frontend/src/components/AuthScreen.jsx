import { useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ScreenHeading } from './common.jsx';

export function AuthScreen() {
  const { login, register, notice } = useAuth();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const registering = mode === 'register';

  function switchMode(next) {
    setMode(next);
    setError('');
    setPassword('');
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    if (registering && (!name.trim() || name.trim().length > 80)) return setError('Enter your name (up to 80 characters).');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address, for example name@example.com.');
    if (password.length < 12 || password.length > 128) return setError('Your password must be 12 to 128 characters long.');
    setBusy(true);
    setError('');
    try {
      if (registering) await register(name.trim(), email.trim(), password);
      else await login(email.trim(), password);
    } catch (failure) {
      setPassword('');
      if (failure.status === 401) setError('That email or password is not correct. Please try again.');
      else if (failure.status === 409) setError('An account with this email already exists. Sign in instead.');
      else setError(describeError(failure));
      setBusy(false);
    }
    return undefined;
  }

  return (
    <section className="card card-narrow" aria-labelledby="auth-heading">
      {notice && <p className="alert alert-info" role="status">{notice}</p>}
      <div id="auth-heading">
        <ScreenHeading level={2} key={mode}>{registering ? 'Create your account' : 'Sign in'}</ScreenHeading>
      </div>
      <p>
        {registering
          ? 'Create a participant account to record your workouts.'
          : 'Participants and staff sign in here with their email and password.'}
      </p>
      <form onSubmit={onSubmit} noValidate>
        {registering && (
          <div className="field">
            <label htmlFor="auth-name">Your name</label>
            <input id="auth-name" type="text" autoComplete="name" maxLength={80} value={name} onChange={e => setName(e.target.value)} required />
          </div>
        )}
        <div className="field">
          <label htmlFor="auth-email">Email address</label>
          <input id="auth-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            type="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            maxLength={128}
            value={password}
            onChange={e => setPassword(e.target.value)}
            aria-describedby="auth-password-hint"
            required
          />
          <p className="hint" id="auth-password-hint">Passwords are 12 to 128 characters long.</p>
        </div>
        {error && <p className="alert alert-error" role="alert"><span aria-hidden="true">⚠ </span>{error}</p>}
        <button type="submit" className="button button-primary button-wide" disabled={busy}>
          {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <p className="switch-mode">
        {registering ? 'Already have an account?' : 'New participant?'}{' '}
        <button type="button" className="button button-link" onClick={() => switchMode(registering ? 'login' : 'register')}>
          {registering ? 'Sign in instead' : 'Create an account'}
        </button>
      </p>
      <p className="hint">For your privacy you are signed out when this page is closed or reloaded.</p>
    </section>
  );
}
