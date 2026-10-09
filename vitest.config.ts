import { defineConfig } from 'vitest/config';
import 'dotenv/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 15000,
    // Database suites temporarily change global policy/catalog fixtures.
    // Keep their files isolated; concurrency assertions inside each test remain enabled.
    fileParallelism: ![
      'RIDE_DB_TESTS',
      'PROVIDER_DB_TESTS',
      'DRIVER_IMPLEMENTATION_DB_TESTS',
      'COUPON_DB_TESTS',
      'RENTAL_DB_TESTS',
    ].some((flag) => process.env[flag] === 'true'),
  },
});
