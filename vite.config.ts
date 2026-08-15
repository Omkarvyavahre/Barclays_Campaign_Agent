import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { barclaysAiApiPlugin } from './server/viteAiApiPlugin';

export default defineConfig({
  plugins: [react(), barclaysAiApiPlugin()],
  server: { host: '0.0.0.0' }
});
