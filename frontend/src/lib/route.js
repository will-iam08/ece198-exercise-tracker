// Which sign-in entry point the page was opened on: /doctor and /admin (or
// anything below them) are the doctor and admin portals; every other path is
// the patient portal.
export function currentPortal(pathname = window.location.pathname) {
  for (const portal of ['doctor', 'admin']) {
    if (pathname === `/${portal}` || pathname.startsWith(`/${portal}/`)) return portal;
  }
  return 'patient';
}
