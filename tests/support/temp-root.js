import fs from 'node:fs';
import path from 'node:path';

export const harnessTempRoot = path.resolve('Harness', '.temp');

export function makeHarnessTempRoot(prefix) {
  fs.mkdirSync(harnessTempRoot, { recursive: true });
  return fs.mkdtempSync(path.join(harnessTempRoot, prefix));
}

export function snapshotHarnessTemp() {
  try {
    return new Set(fs.readdirSync(harnessTempRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name));
  } catch {
    return new Set();
  }
}
