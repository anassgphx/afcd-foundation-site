import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'src/admin',
  base: '/studio/',
  plugins: [react()],
  build: {
    outDir: '../../dist/admin',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react';
          if (id.includes('node_modules/@tiptap') || id.includes('node_modules/prosemirror')) return 'editor';
        },
      },
    },
  },
});
