import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { aiApiPlugin } from './server/vitePlugin.ts';

export default defineConfig({
  plugins: [react(), aiApiPlugin()],
  server: { host: '0.0.0.0' }
});
