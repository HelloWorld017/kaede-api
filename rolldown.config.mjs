import { fileURLToPath } from 'node:url';
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'src/index.ts',
  output: { file: 'dist/backend.bundle.js', format: 'esm', sourcemap: true },
  platform: 'browser',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
