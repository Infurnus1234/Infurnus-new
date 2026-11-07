/** Backend monetary boundaries. Rates/components stay in paise; payable totals round once.
 * Decimal input is parsed as a rational BigInt (including exponent notation), never multiplied
 * as binary floating point. Positive half ties round up. Historical stored amounts are not rewritten.
 */
function safe(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Unsupported monetary amount');
  return Number(value);
}
function decimal(value: number | string): [bigint, bigint] {
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new RangeError('Money must be finite and nonnegative');
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? 0) - fraction.length;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100)
    throw new RangeError('Unsupported monetary precision');
  const digits = BigInt(match[1]! + fraction);
  return exponent >= 0
    ? [digits * 10n ** BigInt(exponent), 1n]
    : [digits, 10n ** BigInt(-exponent)];
}
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}
export function rupeesToPaise(value: number | string): number {
  const [n, d] = decimal(value);
  return safe(divideHalfUp(n * 100n, d));
}
export function wholeRupees(value: number | string): number {
  const [n, d] = decimal(value);
  return safe(divideHalfUp(n, d));
}
export function wholeRupeePaise(paise: number): number {
  if (!Number.isSafeInteger(paise) || paise < 0)
    throw new RangeError('Expected nonnegative integer paise');
  return safe(divideHalfUp(BigInt(paise), 100n) * 100n);
}
export function wholeRupeeShare(
  totalPaise: number,
  numerator: number,
  denominator: number,
): number {
  if (
    ![totalPaise, numerator, denominator].every(Number.isSafeInteger) ||
    totalPaise < 0 ||
    numerator < 0 ||
    denominator <= 0
  )
    throw new RangeError('Invalid monetary ratio');
  return safe(
    divideHalfUp(BigInt(totalPaise) * BigInt(numerator), 100n * BigInt(denominator)) * 100n,
  );
}
export function logisticsSplit(totalPaise: number) {
  const total = wholeRupeePaise(totalPaise);
  const upfront = wholeRupeeShare(total, 2, 5);
  return {
    totalPaise: total,
    upfrontPaise: upfront,
    finalPaise: total - upfront,
    currency: 'INR' as const,
  };
}

/** Compare provider and ledger amounts exactly, including historical paise. */
export function sameMoney(left: number | string, right: number | string): boolean {
  try {
    const [ln, ld] = decimal(left),
      [rn, rd] = decimal(right);
    return ln * rd === rn * ld;
  } catch {
    return false;
  }
}
