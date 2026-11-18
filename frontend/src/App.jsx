import { useAuth } from './auth.jsx';
import { AuthScreen } from './components/AuthScreen.jsx';
import { ParticipantApp } from './components/ParticipantApp.jsx';
import { StaffApp } from './components/StaffApp.jsx';
import { currentPortal } from './lib/route.js';

// Tasks 5-6 replace these two with PatientApp and DoctorApp.
const PatientView = ParticipantApp;
const DoctorView = StaffApp;

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
