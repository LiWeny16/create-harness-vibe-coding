// spawn-gate.mjs
//
// Bounds concurrent PTY spawns. Each spawn boots a heavy CLI process
// (claude/codex/opencode — hundreds of MB each), and clients can request many
// starts at once (canvas auto-start, CLI batches, agent fan-out). A small
// sliding window keeps the machine from being stampeded: excess starts queue
// FIFO and enter as earlier spawns settle.

export const DEFAULT_MAX_CONCURRENT_SPAWNS = 2;
export const DEFAULT_SPAWN_TIMEOUT_MS = 120_000;

export function createSpawnGate({
  maxConcurrent = DEFAULT_MAX_CONCURRENT_SPAWNS,
  timeoutMs = DEFAULT_SPAWN_TIMEOUT_MS,
} = {}) {
  let active = 0;
  const waiters = [];

  const release = () => {
    const next = waiters.shift();
    if (next) next();
  };

  return async function withSlot(fn) {
    if (active >= maxConcurrent) {
      await new Promise((resolve) => waiters.push(resolve));
    }
    active += 1;
    let timer = null;
    try {
      // Deadlock breaker: a hung spawn must not hold the window forever. On
      // timeout the caller gets an error and the slot frees; the abandoned
      // spawn settles (or not) in the background.
      return await Promise.race([
        fn(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`PTY spawn timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      active -= 1;
      release();
    }
  };
}
