/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base має збігатися з реальним шляхом GitLab Pages:
// для project site https://USERNAME.gitlab.io/REPO/ → '/REPO/',
// для root site → '/'. Дивіться docs/SETUP.md.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/video-review/',
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
