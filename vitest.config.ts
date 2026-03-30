import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**'],
    alias: {
      '@dao/shared': path.resolve(__dirname, '../node_modules/@dao/shared'),
    },
  },
});
