import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { aiApiPlugin, imagesApiPlugin } from './server/vitePlugin.ts';

/**
 * Runtime artifacts live under `.generated/`: Firefly assets, screenshots and
 * throwaway browser profiles. A write there must never reach a dev client,
 * because a reload restarts the scripted campaign and that spends live Gemini
 * and Firefly calls. Vite appends this to its own ignore list, so the defaults
 * still apply. Assets stay served by `/api/images/asset/:id`, which reads them
 * from disk and needs no watcher.
 */
export const WATCH_IGNORED = ['**/.generated/**'];

export default defineConfig({
  plugins: [react(), aiApiPlugin(), imagesApiPlugin()],
  server: { host: '0.0.0.0', watch: { ignored: WATCH_IGNORED } }
});
