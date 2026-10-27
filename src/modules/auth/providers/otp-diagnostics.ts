/** Explicit allowlist: never pass provider bodies, errors, recipients or tokens here. */
export function otpDiagnostic(event: {
  correlationId: string;
  channel: 'sms' | 'email';
  provider: string;
  operation: 'send' | 'verify' | 'resend';
  outcome: 'accepted' | 'verified' | 'invalid' | 'failed' | 'fallback';
  httpStatus?: number | undefined;
  failureCategory?: 'timeout' | 'network' | 'rejected' | 'unexpected_response';
  messageId?: unknown;
}) {
  const { messageId, ...safe } = event;
  console.info(
    JSON.stringify({
      event: 'otp_provider',
      ...safe,
      ...(typeof messageId === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(messageId)
        ? { messageId }
        : {}),
      ...(event.outcome === 'accepted' ? { deliveryStatus: 'unconfirmed' } : {}),
    }),
  );
}
