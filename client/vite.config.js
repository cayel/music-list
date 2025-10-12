import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Utiliser une fonction pour accéder aux variables .env (Vite charge après évaluation du config statique)
export default ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // charge toutes les vars (pas seulement prefixées) puis on filtrera
  const apiBase = env.VITE_API_BASE || process.env.VITE_API_BASE || '';
  if (apiBase) {
    // eslint-disable-next-line no-console
    console.log('[vite] VITE_API_BASE détectée, désactivation du proxy local /api ->', apiBase);
  } else {
    // eslint-disable-next-line no-console
    console.log('[vite] Aucune VITE_API_BASE, activation proxy /api -> http://localhost:3000');
  }
  return defineConfig({
    plugins: [react()],
    build: {
      outDir: '../dist',
      emptyOutDir: true
    },
    server: {
      port: 5173,
      proxy: apiBase ? undefined : { '/api': 'http://localhost:3000' }
    }
  });
};
