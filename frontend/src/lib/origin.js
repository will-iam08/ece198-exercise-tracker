// Helpers for vite.config.js, kept here so they can be tested.

// True when a browser Origin header names the same host (and port) the page
// was loaded from. The dev server's /api proxy removes such an Origin before
// forwarding, so phones on the LAN and tunnel domains work without being
// listed in the backend's CORS_ORIGIN. Other origins are passed through and
// checked by the backend as usual.
export function isSameHostOrigin(origin, host) {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === String(host).toLowerCase();
  } catch {
    return false;
  }
}

// "a.example.org, .trycloudflare.com" -> ['a.example.org', '.trycloudflare.com']
export function parseHostList(value) {
  return String(value ?? '').split(',').map(item => item.trim()).filter(Boolean);
}
