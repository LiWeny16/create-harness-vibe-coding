import crypto from 'node:crypto';

/**
 * Generate a cryptographically random token as a hex string.
 * @returns {string} Hex string of at least 32 characters (128 bits).
 */
export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Timing-safe comparison of two tokens using `crypto.timingSafeEqual`.
 *
 * Both arguments are coerced to strings. If lengths differ, or either value
 * is null/undefined, returns false without leaking the length mismatch
 * source in the return path (the comparison still runs via a synthetic buffer).
 *
 * @param {string} token - The token to validate.
 * @param {string} expectedToken - The expected token to compare against.
 * @returns {boolean} True if both tokens are equal; false otherwise.
 */
export function validateToken(token, expectedToken) {
  if (typeof token !== 'string' || typeof expectedToken !== 'string') {
    return false;
  }

  // Use timingSafeEqual even on different-length inputs to avoid leaking
  // length information through the return path. We compare the provided
  // token against itself when lengths don't match, so the crypto call
  // always takes the same form.
  const bufToken = Buffer.from(token, 'utf8');
  const bufExpected = Buffer.from(expectedToken, 'utf8');

  if (bufToken.length !== bufExpected.length) {
    // Dummy comparison to maintain timing invariants (no data leak)
    crypto.timingSafeEqual(bufToken, bufToken);
    return false;
  }

  return crypto.timingSafeEqual(bufToken, bufExpected);
}
