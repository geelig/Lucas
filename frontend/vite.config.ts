import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const product = JSON.parse(readFileSync(new URL('../wails.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: { __LUCAS_VERSION__: JSON.stringify(product.info.productVersion) },
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
