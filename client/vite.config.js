import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The dev proxy keeps the refresh cookie first-party (same origin as the SPA),
// so no CORS or SameSite workarounds are needed locally.
//
// DEV_PROXY_TARGET (no VITE_ prefix: it is only read here, never shipped to the browser)
// is where the proxy forwards /api and /socket.io. Defaults to the local API on :5000.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.DEV_PROXY_TARGET || 'http://localhost:5000';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.DEV_PORT) || 5173,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/socket.io': { target, ws: true },
      },
    },
  };
});
