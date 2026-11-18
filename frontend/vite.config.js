import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { isSameHostOrigin, parseHostList } from './src/lib/origin.js';

// The website calls the API at /api on its own address, and this server
// forwards those calls to the backend. That way a phone or laptop on the same
// network (`npm run dev:lan`) or a tunnel domain only needs to reach this one
// server.
//   VITE_API_TARGET     where /api is forwarded (default http://127.0.0.1:3000)
//   VITE_ALLOWED_HOSTS  extra host names to serve, e.g. a tunnel domain
//                       (comma-separated; ".example.org" allows its subdomains)
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const allowedHosts = parseHostList(env.VITE_ALLOWED_HOSTS);
  const proxy = {
    '/api': {
      target: env.VITE_API_TARGET || 'http://127.0.0.1:3000',
      configure(server) {
        // A browser sends Origin on POST/PUT/PATCH/DELETE even to its own
        // address. The backend only knows its CORS_ORIGIN list, so a
        // same-address Origin is removed here; any other Origin is passed on
        // and the backend still rejects it.
        server.on('proxyReq', (proxyReq, req) => {
          if (isSameHostOrigin(req.headers.origin, req.headers.host)) proxyReq.removeHeader('origin');
        });
      },
    },
  };
  const shared = { port: 5173, strictPort: true, proxy, ...(allowedHosts.length ? { allowedHosts } : {}) };
  return {
    plugins: [react()],
    server: { host: 'localhost', ...shared },
    preview: { host: 'localhost', ...shared },
  };
});
