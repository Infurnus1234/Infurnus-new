import { ipKeyGenerator } from 'express-rate-limit';
import * as limiters from '../middleware/rate-limit.middleware.js';

// Each test represents a fresh client's budget. Keep the real limiters active
// within a test, including all negative/attempt-limit assertions.
export async function resetAuthTestRateLimits() {
  const keys = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'].map((ip) => ipKeyGenerator(ip)));
  for (const value of Object.values(limiters)) {
    const limiter = value as { resetKey?: (key: string) => void | Promise<void> };
    if (typeof limiter.resetKey === 'function') {
      for (const key of keys) await limiter.resetKey(key);
    }
  }
}
