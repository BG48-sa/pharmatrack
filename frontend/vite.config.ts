import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // GitHub Pages serves the app from /pharmatrack/; the Capacitor iOS build
  // serves from the web root, so only switch the base when GH_PAGES is set
  // (the deploy workflow sets it). Local `npm run build`/`npm run ios` stay at '/'.
  base: process.env.GH_PAGES ? '/pharmatrack/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
