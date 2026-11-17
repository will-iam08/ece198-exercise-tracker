import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend only accepts browser requests from http://localhost:5173
// (its CORS_ORIGIN), so the dev and preview servers are pinned to that origin.
export default defineConfig({
  plugins: [react()],
  server: { host: 'localhost', port: 5173, strictPort: true },
  preview: { host: 'localhost', port: 5173, strictPort: true },
});
