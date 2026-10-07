import { describe, expect, it, vi } from 'vitest';
import { selectOtpProvider } from '../providers/otp-provider-selection.js';
import type { ResendOtpProvider } from '../providers/resend-otp.provider.js';
import type { OtpProvider } from '../providers/otp.provider.js';
import { FallbackOtpProvider } from '../providers/fallback-otp.provider.js';

describe('production OTP bootstrap safeguards', () => {
  it('refuses a development OTP provider in production/staging', () => {
    const development = vi.fn();
    expect(() => selectOtpProvider(undefined, undefined, development, true)).toThrow(
      'Production authentication provider is not configured',
    );
    expect(development).not.toHaveBeenCalled();
  });
  it('does not treat an email-only fallback as a production SMS provider', () => {
    const fallback = {} as ResendOtpProvider;
    const development = vi.fn();
    expect(() => selectOtpProvider(undefined, fallback, development, true)).toThrow(
      'Production authentication provider is not configured',
    );
    expect(development).not.toHaveBeenCalled();
  });
  it('preserves primary/fallback composition and development-only behavior', () => {
    const primary = {} as OtpProvider,
      fallback = {} as ResendOtpProvider;
    expect(selectOtpProvider(primary, fallback, vi.fn(), true)).toBeInstanceOf(FallbackOtpProvider);
    const development = vi.fn(() => primary);
    expect(selectOtpProvider(undefined, undefined, development, false)).toBe(primary);
  });
});
