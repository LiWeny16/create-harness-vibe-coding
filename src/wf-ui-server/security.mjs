import path from 'node:path';

/**
 * Resolve an arbitrary path string to an absolute filesystem path.
 *
 * @param {string} rawPath - Path to canonicalize.
 * @returns {string} Absolute path.
 * @throws {TypeError} If rawPath is null or undefined.
 * @throws {Error} If rawPath is an empty string.
 */
export function canonicalizeProjectPath(rawPath) {
  if (rawPath === null || rawPath === undefined) {
    throw new TypeError('Path must be a non-null string');
  }
  if (rawPath === '') {
    throw new Error('Path must not be empty');
  }
  return path.resolve(rawPath);
}

/**
 * Resolve a relative path against a base directory, ensuring the result
 * stays within the base directory (no path traversal escapes).
 *
 * @param {string} basePath - The base directory (must be absolute).
 * @param {string} relativePath - The relative path to resolve.
 * @returns {string} The resolved absolute path within basePath.
 * @throws {Error} If the resolved path escapes basePath, if the relativePath
 *   contains null bytes, or if the relativePath is absolute.
 */
export function safeResolve(basePath, relativePath) {
  if (relativePath.includes('\0')) {
    throw new Error('Path must not contain null bytes');
  }

  const target = path.resolve(basePath, relativePath);

  // Reject if the resolved path is not within the base directory
  if (!target.startsWith(basePath + path.sep) && target !== basePath) {
    throw new Error('Path traversal detected: resolved path escapes base');
  }

  return target;
}

/**
 * Validate a task ID string.
 *
 * Allowed characters: alphanumeric, dash, underscore.
 * Rejects empty strings, path traversal sequences (.., /, \), and null bytes.
 *
 * @param {string} taskId - The task ID to validate.
 * @returns {boolean} True if the task ID is valid; false otherwise.
 */
export function validateTaskId(taskId) {
  if (typeof taskId !== 'string' || taskId === '') {
    return false;
  }

  // Reject path traversal sequences and null bytes
  if (taskId.includes('..') || taskId.includes('/') || taskId.includes('\\') || taskId.includes('\0')) {
    return false;
  }

  // Must match: alphanumeric, dash, underscore only
  return /^[a-zA-Z0-9_-]+$/.test(taskId);
}
