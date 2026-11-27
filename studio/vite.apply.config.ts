// Builds the public application form script (src/public/apply.ts → ../assets/apply.js) for the website. One IIFE file,
// no dependencies; it shares the form engine with the server (src/server/modules/apply/engine.ts).
import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  build: {
    lib: { entry: 'src/public/apply.ts', name: 'AfcdApply', formats: ['iife'], fileName: () => 'apply.js' },
    outDir: '../assets', emptyOutDir: false, target: 'es2019', minify: true, sourcemap: false,
  },
});
