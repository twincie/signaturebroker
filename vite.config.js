import 'dotenv/config';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const frontendDir = fileURLToPath(new URL('./frontend', import.meta.url));

export default defineConfig({
  root: frontendDir,
  publicDir: fileURLToPath(new URL('./frontend/public', import.meta.url)),
  server: {
    port: Number(process.env.FRONTEND_PORT || 5173),
    fs: {
      // The admin dashboard imports a module from ../shared.
      allow: [frontendDir, fileURLToPath(new URL('.', import.meta.url))],
    },
    proxy: {
      '/api': `http://localhost:${process.env.PORT || process.env.SIGNATURE_PORT || 3000}`,
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL('./frontend/index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./frontend/admin.html', import.meta.url)),
      },
    },
  },
});
