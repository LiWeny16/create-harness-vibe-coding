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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Remove a temp project root, waiting out Windows handle-release races.
 *
 * fs.rmSync's maxRetries only covers transient EBUSY/EPERM inside one call;
 * when a just-killed PTY/conpty child is still letting go of files under
 * load, a bounded async backoff is needed or the dir leaks and trips the
 * temp-leak push gate. No-op when the root is already gone.
 */
export async function rmHarnessTempRootRobust(root, { attempts = 20, delayMs = 250 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // keep retrying below
    }
    if (!fs.existsSync(root)) return;
    await sleep(delayMs);
  }
  // Final attempt: surface a hard failure instead of leaking silently.
  fs.rmSync(root, { recursive: true, force: true });
}
