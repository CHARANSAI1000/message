import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev backend address. Override with: API_URL=http://localhost:9000 npm run dev
const API_URL = process.env.API_URL ?? 'http://localhost:8010';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Proxying keeps the browser on one origin, exactly like production.
    proxy: { '/api': API_URL, '/healthz': API_URL },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    modulePreload: { polyfill: false }, // no inline scripts: the CSP forbids them
  },
});
