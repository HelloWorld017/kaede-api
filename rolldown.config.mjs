import { fileURLToPath } from 'node:url';
import { defineConfig } from 'rolldown';

export default defineConfig([
  {
    input: 'src/index.ts',
    output: { file: 'dist/backend.bundle.js', format: 'esm', sourcemap: true },
    platform: 'browser',
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  },
  {
    input: 'scripts/password.ts',
    output: { file: 'dist/password.bundle.js', format: 'esm' },
    platform: 'browser',
  },
]);
