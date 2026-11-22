import { defineConfig } from 'vitest/config';
export default defineConfig({ root: '.', test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000, pool: 'forks' } });
