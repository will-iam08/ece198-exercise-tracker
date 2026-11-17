import { useAuth } from './auth.jsx';
import { AuthScreen } from './components/AuthScreen.jsx';
import { ParticipantApp } from './components/ParticipantApp.jsx';
import { StaffApp } from './components/StaffApp.jsx';

export default function App() {
  const { user, logout } = useAuth();
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="site-header">
        <h1>Exercise Tracker</h1>
        {user && (
          <div className="account">
            <p>Signed in as <strong>{user.name}</strong>{user.role === 'staff' ? ' (staff)' : ''}</p>
            <button type="button" className="button" onClick={logout}>Sign out</button>
          </div>
        )}
      </header>
      <main id="main" tabIndex={-1}>
        {/* Keyed by account so no data survives a change of user. */}
        {!user && <AuthScreen />}
        {user?.role === 'participant' && <ParticipantApp key={user.id} />}
        {user?.role === 'staff' && <StaffApp key={user.id} />}
        {user && !['participant', 'staff'].includes(user.role) && (
          <p className="alert alert-error" role="alert">This account type is not supported. Please sign out.</p>
        )}
      </main>
    </>
  );
}
