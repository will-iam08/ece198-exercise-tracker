// Which sign-in entry point the page was opened on: /doctor (or below) is the
// doctor portal; every other path is the patient portal.
export function currentPortal(pathname = window.location.pathname) {
  return pathname === '/doctor' || pathname.startsWith('/doctor/') ? 'doctor' : 'patient';
}
