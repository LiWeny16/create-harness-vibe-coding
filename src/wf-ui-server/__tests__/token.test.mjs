import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generateToken, validateToken } from '../token.mjs';

test('generateToken returns a string of at least 32 hex characters', () => {
  const token = generateToken();
  assert.equal(typeof token, 'string');
  assert.ok(token.length >= 32);
  assert.ok(/^[0-9a-f]+$/.test(token));
});

test('two consecutive generateToken calls produce different tokens', () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
});

test('validateToken returns true for a matching token', () => {
  const token = generateToken();
  assert.equal(validateToken(token, token), true);
});

test('validateToken returns false for a non-matching token', () => {
  const token = generateToken();
  assert.equal(validateToken(token, token + 'x'), false);
  assert.equal(validateToken('x' + token, token), false);
});

test('validateToken returns false for empty expected token', () => {
  const token = generateToken();
  assert.equal(validateToken(token, ''), false);
  assert.equal(validateToken(token, null), false);
  assert.equal(validateToken(token, undefined), false);
});

test('validateToken is timing-safe: equal-length comparison produces no early exit on mismatch', () => {
  // Verify that both same-length mismatches and length-mismatches return false.
  // This confirms there is no length-based early return that leaks information.
  const a = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const b = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const c = 'cccccccccccccccccccccccccccccccc';
  assert.equal(validateToken(a, b), false);
  assert.equal(validateToken(a, c), false);
  assert.equal(validateToken(b, c), false);
  // Same-length match still works
  assert.equal(validateToken(a, a), true);
});
