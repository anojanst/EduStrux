import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.PORT) || 5173,
    // The API runs on :8787 (`pnpm dev`); same origin in the browser, as in production.
    proxy: { '/api': 'http://localhost:8787' },
  },
});
