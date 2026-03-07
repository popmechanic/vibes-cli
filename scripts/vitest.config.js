import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ESM support
    include: ['__tests__/**/*.test.{js,ts}'],

    // Environment
    environment: 'node',

    // Globals for describe, it, expect
    globals: true,

    // Coverage (optional, run with --coverage)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['*.js', '*.ts', 'lib/**/*.js', 'server/**/*.ts'],
      exclude: ['__tests__/**', 'vitest.config.js']
    },

    // Timeout for async tests
    testTimeout: 10000,

    // Watch mode settings
    watch: false,
    watchExclude: ['**/node_modules/**', '**/build/**']
  }
});
