import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizeProjectPath, safeResolve, validateTaskId } from '../security.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('canonicalizeProjectPath resolves a relative path to absolute', () => {
  const abs = canonicalizeProjectPath('.');
  assert.equal(typeof abs, 'string');
  assert.ok(path.isAbsolute(abs));
});

test('canonicalizeProjectPath throws on null, undefined, and empty string', () => {
  assert.throws(() => canonicalizeProjectPath(null), { name: 'TypeError' });
  assert.throws(() => canonicalizeProjectPath(undefined), { name: 'TypeError' });
  assert.throws(() => canonicalizeProjectPath(''), { name: 'Error' });
});

test('safeResolve resolves a valid relative path within base', () => {
  const base = path.resolve('/tmp/test-base');
  const resolved = safeResolve(base, 'sub/dir');
  assert.equal(resolved, path.resolve(base, 'sub/dir'));
});

test('safeResolve throws on path traversal attempting to escape base', () => {
  const base = path.resolve('/tmp/test-base');
  assert.throws(() => safeResolve(base, '../etc/passwd'), { name: 'Error' });
  assert.throws(() => safeResolve(base, 'sub/../../etc'), { name: 'Error' });
});

test('safeResolve throws on absolute path argument outside base', () => {
  const base = path.resolve('/tmp/test-base');
  assert.throws(() => safeResolve(base, '/etc/passwd'), { name: 'Error' });
});

test('safeResolve throws on null byte in path', () => {
  const base = path.resolve('/tmp/test-base');
  assert.throws(() => safeResolve(base, 'sub\0dir'), { name: 'Error' });
});

test('validateTaskId accepts a valid task ID', () => {
  assert.equal(validateTaskId('task-wf-ui-control-0729'), true);
});

test('validateTaskId rejects path traversal sequences', () => {
  assert.equal(validateTaskId('../'), false);
  assert.equal(validateTaskId('..'), false);
  assert.equal(validateTaskId('a/../b'), false);
});

test('validateTaskId rejects null byte in task ID', () => {
  assert.equal(validateTaskId('task\0id'), false);
});

test('validateTaskId rejects empty string', () => {
  assert.equal(validateTaskId(''), false);
});
