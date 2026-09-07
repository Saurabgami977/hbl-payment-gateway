/** Small helpers shared by the resource classes. Not part of the public API. */

/**
 * Compares two strings without leaking their contents through timing.
 *
 * The `resultIndicator` returned by the hosted checkout page is effectively a
 * bearer token for "this order was paid", so comparing it with `===` invites a
 * timing oracle. The loop always runs over the longer of the two inputs, so a
 * length difference does not shortcut it either.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Generates a transaction ID when the caller does not supply one.
 *
 * MPGS treats `{orderId, transactionId}` as the idempotency key, so this is
 * deliberately random: a caller who wants a retry to be safe must pass their
 * own stable ID.
 */
export function generateTransactionId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID().replace(/-/g, '');
  if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 12)}`;
}

/** Percent-encodes a path segment so IDs cannot escape the URL structure. */
export function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

/** Drops `undefined` values so they are not serialised into the request body. */
export function compact<T extends Record<string, unknown>>(object: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) result[key] = value;
  }
  return result as T;
}
