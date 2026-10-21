import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    // Several suites rebuild the catalog in beforeAll, which can exceed the 10 s default when
    // the machine (or CI runner) is busy
    hookTimeout: 60000,
    fileParallelism: false,
    globalSetup: ['./tests/global-setup.ts'],
  },
});
