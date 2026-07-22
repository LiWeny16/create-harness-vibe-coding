#!/usr/bin/env node
/**
 * probe-worker-channels.mjs
 *
 * Probes WF-MAX Worker execution channels and reports:
 *   - availability (per-channel outcome)
 *   - timeout behavior (every probe bounded to <=15s via Promise.race)
 *   - independence level (independent vs inprocess)
 *
 * Channels:
 *   claude           peer-cli       independent   (exists + `claude --version`)
 *   codex            peer-cli       independent   (exists + `codex --version`)
 *   opencode         peer-cli       independent   (exists + `opencode --version`)
 *   native-subagent  native-subagent independent  (NOT auto-probable; available="controller-evidence"
 *                                                   -- the CEO fills availability from successful
 *                                                   Agent-tool dispatch)
 *   mcp              mcp            inprocess     (CRITICAL: CEO-thread tool calls; never counted as
 *                                                   Worker execution. Static label only -- we do NOT
 *                                                   invoke mcp tools from this probe.)
 *
 * North Star hard-constraint enforced by this probe's labeling:
 *   in-process tool calls must NEVER be counted as Worker execution.
 *   Hence mcp is labeled `inprocess`, not `independent`.
 *
 * Usage:
 *   node Harness/scripts/probe-worker-channels.mjs           # human-readable table
 *   node Harness/scripts/probe-worker-channels.mjs --json    # JSON object on stdout
 *   node Harness/scripts/probe-worker-channels.mjs --help
 *
 * Exit code is always 0. Per-channel errors go into the row, not the process exit.
 * Zero dependencies: Node built-ins only (child_process, os).
 */

import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';

const IS_WIN32 = platform() === 'win32';
const VERSION_TIMEOUT_MS = 15_000;
const EXISTS_TIMEOUT_MS = 5_000;

// ── Stage 1: exists ──────────────────────────────────────────────────
// Resolve a CLI on PATH via the OS-appropriate resolver. shell:true so that
// Windows .cmd shims under npm-global are resolved correctly.
function resolveOnPath(name) {
  const resolver = IS_WIN32 ? 'where' : 'which';
  // name is a static, controller-owned channel identifier (not user input),
  // so concatenation into the shell command string is safe and avoids DEP0190.
  const result = spawnSync(`${resolver} ${name}`, {
    shell: true,
    encoding: 'utf-8',
    timeout: EXISTS_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error) return { path: null, error: result.error.message };
  if (result.status !== 0) return { path: null, error: `${resolver} exit ${result.status}` };
  const first = (result.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return { path: first || null, error: null };
}

// ── Stage 2: callable ────────────────────────────────────────────────
// Spawn `<cli> --version` wrapped in Promise.race with a 15s timeout.
// On timeout the child is killed. Returns one of:
//   available | unavailable-timeout | unavailable-error | unavailable-missing
function spawnVersionBounded(name, timeoutMs) {
  const start = Date.now();
  let childRef = null;
  let timerRef = null;

  const work = new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';

    const child = spawn(`${name} --version`, {
      shell: true,
      encoding: 'utf-8',
      windowsHide: true,
    });
    childRef = child;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timerRef) clearTimeout(timerRef);
      resolve({ ...payload, elapsed_ms: Date.now() - start });
    };

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      const code = err && err.code;
      if (code === 'ENOENT') {
        finish({ outcome: 'unavailable-missing', detail: err.message });
      } else {
        finish({ outcome: 'unavailable-error', detail: err.message });
      }
    });

    child.on('close', (code, signal) => {
      if (signal) {
        finish({ outcome: 'unavailable-error', detail: `signal ${signal}` });
        return;
      }
      const out = stdout.trim();
      if (code === 0 && out) {
        finish({ outcome: 'available', detail: out });
      } else {
        const tail = stderr.trim() ? `: ${stderr.trim()}` : '';
        finish({ outcome: 'unavailable-error', detail: `exit ${code}${tail}` });
      }
    });
  });

  const timeout = new Promise((resolve) => {
    timerRef = setTimeout(() => {
      if (childRef) {
        try {
          childRef.kill('SIGKILL');
        } catch {
          /* best-effort kill */
        }
      }
      resolve({ outcome: 'unavailable-timeout', elapsed_ms: Date.now() - start });
    }, timeoutMs);
  });

  return Promise.race([work, timeout]);
}

// ── Three-stage peer-CLI probe ───────────────────────────────────────
async function probePeerCli(name) {
  const exists = resolveOnPath(name);
  if (!exists.path) {
    // Stage 1 already failed: do not spawn. Fast return, well under the 15s cap.
    return {
      name,
      type: 'peer-cli',
      available: 'unavailable-missing',
      timeout_ms: 0,
      independence: 'independent',
      detail: `not found on PATH (${exists.error || 'unresolved'})`,
    };
  }

  const probed = await spawnVersionBounded(name, VERSION_TIMEOUT_MS);
  let detail;
  if (probed.outcome === 'available') {
    detail = `${probed.detail} (path: ${exists.path})`;
  } else if (probed.outcome === 'unavailable-timeout') {
    detail = `no response within ${VERSION_TIMEOUT_MS}ms (killed; path: ${exists.path})`;
  } else {
    detail = `${probed.detail || probed.outcome} (path: ${exists.path})`;
  }
  return {
    name,
    type: 'peer-cli',
    available: probed.outcome,
    timeout_ms: Math.round(probed.elapsed_ms ?? 0),
    independence: 'independent',
    detail,
  };
}

// ── Static channels ──────────────────────────────────────────────────
// native-subagent cannot be probed from inside the controller thread without
// recursing into the very channel we are measuring. Its availability is
// established by the CEO as live evidence: a successfully returned Agent-tool
// dispatch (this very script running as a Worker is that evidence).
const nativeSubagentChannel = {
  name: 'native-subagent',
  type: 'native-subagent',
  available: 'controller-evidence',
  timeout_ms: 0,
  independence: 'independent',
  detail:
    'not auto-probable; availability is filled by the CEO from successful Agent-tool dispatch',
};

// mcp tools execute inside the CEO/controller thread. They are in-process tool
// calls, NOT independent Worker executions. We deliberately do NOT invoke them.
const mcpChannel = {
  name: 'mcp',
  type: 'mcp',
  available: 'static-label',
  timeout_ms: 0,
  independence: 'inprocess',
  detail:
    'CEO-thread tool calls; never counted as Worker execution (inprocess). Not invoked by this probe.',
};

// ── Output ───────────────────────────────────────────────────────────
function printTable(result) {
  const header = [
    'channel',
    'type',
    'available',
    'timeout_ms',
    'independence',
    'detail',
  ];
  const rows = result.channels.map((c) => [
    c.name,
    c.type,
    String(c.available),
    String(c.timeout_ms),
    c.independence,
    c.detail,
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );
  const sep =
    '+-' + widths.map((w) => '-'.repeat(w)).join('-+-') + '-+';
  const fmt = (cells) =>
    '| ' +
    cells.map((c, i) => c.padEnd(widths[i])).join(' | ') +
    ' |';

  process.stdout.write(
    `probe-worker-channels — probed ${result.probed_at} (node ${result.node_version}, platform ${result.platform})\n\n`
  );
  process.stdout.write(sep + '\n');
  process.stdout.write(fmt(header) + '\n');
  process.stdout.write(sep + '\n');
  for (const r of rows) process.stdout.write(fmt(r) + '\n');
  process.stdout.write(sep + '\n');
}

// ── Main ─────────────────────────────────────────────────────────────
async function run() {
  const args = new Set(process.argv.slice(2));

  if (args.has('--help') || args.has('-h')) {
    process.stdout.write(
      `Usage: node Harness/scripts/probe-worker-channels.mjs [--json]

Probes WF-MAX Worker execution channels and reports availability, timeout
behavior, and independence level. Exit code is always 0; per-channel errors
go into the row.

  --json   print a JSON object on stdout
  --help   show this help

Channels: claude, codex, opencode (peer-cli, independent);
native-subagent (independent, available="controller-evidence");
mcp (inprocess, never counted as Worker).
`
    );
    return;
  }

  const asJson = args.has('--json');

  const channels = [];
  channels.push(await probePeerCli('claude'));
  channels.push(await probePeerCli('codex'));
  channels.push(await probePeerCli('opencode'));
  channels.push(nativeSubagentChannel);
  channels.push(mcpChannel);

  const result = {
    probed_at: new Date().toISOString(),
    node_version: process.version,
    platform: platform(),
    channels,
  };

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printTable(result);
  }
}

run().catch(() => {
  // Probing never "fails" -- any unexpected error still exits 0.
}).finally(() => {
  process.exit(0);
});
