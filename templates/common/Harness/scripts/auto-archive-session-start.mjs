#!/usr/bin/env node
/**
 * auto-archive-session-start.mjs
 *
 * SessionStart/Stop hook helper with safe-auto policy.
 *
 * SessionStart: performs reindex + safe auto-archive if policy allows.
 * Stop: dry-run only (detection, no mutation).
 *
 * Safe-auto policy:
 *   - Only archives closed tasks with verified closeout
 *   - Skips tasks with active owner/lease/lock
 *   - Skips the current focus task
 *   - Uses global lock to prevent concurrent moves
 *
 * Configuration:
 *   - HARNESS_SAFE_AUTO_ARCHIVE=1 enables safe-auto (apply mode)
 *   - Default: dry-run (safe for templates)
 *   - Current repo: set env var or use --apply explicitly
 *
 * Usage:
 *   node Harness/scripts/auto-archive-session-start.mjs [--apply] [--json] [--stop]
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const apply = args.includes('--apply') || process.env.HARNESS_SAFE_AUTO_ARCHIVE === '1';
const json = args.includes('--json');
const isStop = args.includes('--stop');

function findProjectRoot() {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, 'Harness', 'scripts', 'task-state.mjs');
    if (fs.existsSync(candidate)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const projectRoot = findProjectRoot();
if (!projectRoot) {
  console.error('auto-archive-session-start: no Harness/scripts/task-state.mjs found from cwd');
  process.exitCode = 0;
  process.exit(0);
}

const taskState = path.join(projectRoot, 'Harness', 'scripts', 'task-state.mjs');
const lockDir = path.join(projectRoot, 'Harness', '.archive-lock');
const lockFile = path.join(lockDir, 'auto-archive.lock');
let ownedLockToken = null;

// Global lock: prevent concurrent auto-archive from multiple sessions
function acquireLock() {
  try {
    fs.mkdirSync(lockDir, { recursive: true });
    // Use exclusive create to detect concurrent runs
    const token = randomUUID();
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      token,
    }), { flag: 'wx' });
    ownedLockToken = token;
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') {
      // A live owner retains the lock regardless of age. A long archive can
      // legitimately run past the old five-minute timeout.
      try {
        const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        const hasOwnerPid = Number.isInteger(lockData.pid) && lockData.pid > 0;
        let ownerAlive = false;
        let ownerConfirmedDead = false;
        if (hasOwnerPid) {
          try {
            process.kill(lockData.pid, 0);
            ownerAlive = true;
          } catch (probeError) {
            ownerConfirmedDead = probeError.code === 'ESRCH';
            ownerAlive = !ownerConfirmedDead;
          }
        }
        if (hasOwnerPid && ownerConfirmedDead && !ownerAlive) {
          // Remove a lock only after confirming its process is not alive. A
          // timestamp or unverifiable PID must never let another SessionStart
          // steal it.
          fs.unlinkSync(lockFile);
          return acquireLock();
        }
      } catch {}
    }
    return false;
  }
}

function releaseLock() {
  if (!ownedLockToken) return;
  try {
    const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    if (lockData.token === ownedLockToken) fs.unlinkSync(lockFile);
  } catch {}
  ownedLockToken = null;
}

// Stop hook: always dry-run
if (isStop) {
  const result = spawnSync(process.execPath, [taskState, 'auto-archive', '--dry-run', '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || 'auto-archive-session-start: task-state auto-archive failed');
    process.exitCode = 0;
    process.exit(0);
  }
  if (!json) {
    try {
      const payload = JSON.parse(result.stdout);
      const eligible = payload.eligible ?? 0;
      const toArchive = payload.toArchive ?? 0;
      if (eligible === 0) {
        console.log('auto-archive-session-start (stop): no closed tasks eligible for archive');
      } else {
        console.log(`auto-archive-session-start (stop): ${toArchive} task(s) eligible for archive (dry-run only)`);
      }
    } catch {
      console.log(result.stdout || '');
    }
    process.exitCode = 0;
    process.exit(0);
  }
  process.stdout.write(result.stdout || '');
  process.exitCode = result.status ?? 0;
  process.exit(0);
}

// SessionStart: lock the full reindex + safe auto-archive sequence.
runSessionStart();

function runSessionStart() {
  let locked = false;
  if (apply) {
    locked = acquireLock();
    if (!locked) {
      console.log('auto-archive-session-start: another session is auto-archiving; skipping');
      process.exitCode = 0;
      return;
    }
  }

  try {
    const reindexResult = spawnSync(process.execPath, [taskState, 'index', '--json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (reindexResult.status !== 0) {
      console.error('auto-archive-session-start: reindex failed:', reindexResult.stderr || reindexResult.stdout);
    }

    const childArgs = ['auto-archive', '--json'];
    if (apply) childArgs.push('--apply');
    const result = spawnSync(process.execPath, [taskState, ...childArgs], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    if (result.status !== 0) {
      console.error(result.stderr || result.stdout || 'auto-archive-session-start: task-state auto-archive failed');
      process.exitCode = 0;
      return;
    }

    if (!json) {
      try {
        const payload = JSON.parse(result.stdout);
        const eligible = payload.eligible ?? 0;
        const toArchive = payload.toArchive ?? 0;
        const archived = (payload.results || []).filter(r => r.action === 'archived');
        const dryRun = payload.dryRun ?? true;
        if (eligible === 0) {
          console.log('auto-archive-session-start: no closed tasks eligible for archive');
        } else if (dryRun) {
          console.log(`auto-archive-session-start: ${toArchive} task(s) eligible for archive (dry-run); run with --apply to archive`);
        } else {
          console.log(`auto-archive-session-start: archived ${archived.length} task(s)`);
        }
        for (const r of archived) {
          console.log(`  - ${r.taskId} -> ${r.archivePath}`);
        }
      } catch {
        console.log(result.stdout || '');
      }
      process.exitCode = 0;
      return;
    }

    process.stdout.write(result.stdout || '');
    process.exitCode = result.status ?? 0;
  } finally {
    if (locked) releaseLock();
  }
}
