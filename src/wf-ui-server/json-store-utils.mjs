import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class JsonStoreError extends Error {
  constructor(message, { code = 'JSON_STORE_ERROR', statusCode = 500, filePath = '', cause = null } = {}) {
    super(message, { cause });
    this.name = 'JsonStoreError';
    this.code = code;
    this.statusCode = statusCode;
    this.filePath = filePath;
  }
}

export function isJsonStoreParseError(error) {
  return error instanceof JsonStoreError && error.code === 'CORRUPT_JSON';
}

export function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const body = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new JsonStoreError(`Corrupt JSON store file: ${filePath}`, {
      code: 'CORRUPT_JSON',
      statusCode: 500,
      filePath,
      cause: error,
    });
  }
}

export function writeJsonFileAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const dir = path.dirname(filePath);
  const name = path.basename(filePath);
  const tempPath = path.join(dir, `.${name}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {}
    throw error;
  }
}
