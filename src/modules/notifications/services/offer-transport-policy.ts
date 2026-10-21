/** Bound provider storage to the authoritative offer window. No invented delay. */
export function offerTransportPolicy(expiresAt: string | undefined, now = Date.now()) {
  if (expiresAt === undefined) return undefined;
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires) || expires <= now) throw new Error('OFFER_EXPIRED');
  return {
    // FCM Android TTL is milliseconds. APNs expiration is Unix seconds.
    ttl: Math.max(0, Math.floor(expires - now)),
    apnsExpiration: String(Math.floor(expires / 1000)),
  };
}
