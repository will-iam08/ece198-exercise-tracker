import { useAuth } from './auth.jsx';
import { AuthScreen } from './components/AuthScreen.jsx';
import { PatientApp } from './components/PatientApp.jsx';
import { DoctorApp } from './components/DoctorApp.jsx';
import { currentPortal } from './lib/route.js';

const PatientView = PatientApp;
const DoctorView = DoctorApp;

const portal = currentPortal();

export default function App() {
  const { user, logout } = useAuth();
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="site-header">
        <div className="brand">
          <h1>MotionTrack</h1>
          <p className="portal-label">{portal === 'doctor' ? 'Doctor' : 'Patient'}</p>
        </div>
        {user && (
          <div className="account">
            <p>Signed in as <strong>{user.name}</strong>{user.role === 'staff' ? ' (doctor)' : ''}</p>
            <button type="button" className="button" onClick={logout}>Sign out</button>
          </div>
        )}
      </header>
      <main id="main" tabIndex={-1}>
        {/* Keyed by account so no data survives a change of user. */}
        {!user && <AuthScreen portal={portal} />}
        {user?.role === 'participant' && <PatientView key={user.id} />}
        {user?.role === 'staff' && <DoctorView key={user.id} />}
        {user && !['participant', 'staff'].includes(user.role) && (
          <p className="alert alert-error" role="alert">This account type is not supported. Please sign out.</p>
        )}
      </main>
    </>
  );
}
