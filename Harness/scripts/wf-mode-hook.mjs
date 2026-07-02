#!/usr/bin/env node
/**
 * wf-mode-hook.mjs — Claude Code hook for WF-MAX / WF-REVIEW enforcement
 *
 * Three-layer architecture:
 *   Layer 1 — global mode:    mode = wf-max | wf-review | null
 *   Layer 2 — agent role:     agentRole = ceo | manager | worker | reviewer | null
 *   Layer 3 — dispatch perm:  writeSet / forbidden / verification
 *
 * Rules:
 *   - Top-level orchestrator is CEO. CEO reads, plans, dispatches. No source edits.
 *   - Manager scopes/reviews/coordinates. Default: no source edits.
 *   - Worker may edit only files in dispatch.writeSet.
 *   - Reviewer reads and reports. No writes.
 *   - Missing role or writeSet → source edits denied by default.
 *
 * Hook events:
 *   SessionStart    → reads mode file; auto-clears stale mode (>30 min old);
 *                      injects context only for fresh/active mode
 *   UserPromptSubmit→ detects /wf-max, /wf-review; writes mode state;
 *                      emits per-turn role-aware reinforcement
 *   PreToolUse      → enforces by agentRole + writeSet
 *
 * Security: symlink-safe I/O, atomic write, size caps, whitelist validation.
 * Exit 0 = allow. Exit 2 = block with stderr message.
 */

import { constants, openSync, readSync, writeSync, closeSync, readFileSync, writeFileSync, existsSync, mkdirSync, lstatSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname, basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = join(__dirname, '..', '.runtime');
const MODE_FILE = join(RUNTIME_DIR, 'current-mode.json');
const MAX_MODE_BYTES = 16384; // Expanded for writeSet/forbidden/verification fields
const STALE_MODE_MS = 30 * 60 * 1000; // 30 min — clear modes from prior sessions
const GOALS_FILE = join(RUNTIME_DIR, 'goals.json');
const MAX_GOAL_BYTES = 65536;
const MAX_GOAL_DESC = 500;

const VALID_MODES = ['wf', 'wf-max', 'wf-auto', 'wf-auto-spark', 'wf-review', 'wf-learn', null];
const VALID_ROLES = ['ceo', 'manager', 'worker', 'reviewer', null];
const VALID_PHASES = ['W0_EXPLORE', 'W1_ARCHITECTURE', 'W2_IMPLEMENT', 'W2R_REVIEW', 'W3_DEPENDENT', 'INTEGRATION', 'CLOSEOUT', 'REVIEW', 'SPARK', 'AUTO', 'LEARN', null];
const BLOCKED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'Bash'];
const MAX_TASKID_BYTES = 128;

// ── Symlink-safe I/O ───────────────────────────────────────────────────────

function safeResolveHarnessPath(filePath) {
  try {
    const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
    let resolved = '';
    for (const part of parts) {
      if (part === '..') return null;
      resolved = resolved ? join(resolved, part) : (resolved || part);
      try {
        const st = lstatSync(resolved);
        if (st.isSymbolicLink()) return null;
      } catch (e) {
        if (e.code === 'ENOENT' && part !== parts[parts.length - 1]) return null;
      }
    }
    const normalized = resolved.replace(/\\/g, '/');
    if (!normalized.includes('Harness/')) return null;
    return resolved;
  } catch {
    return null;
  }
}

function safeReadJSON(filePath, maxBytes = MAX_MODE_BYTES) {
  try {
    const safe = safeResolveHarnessPath(filePath);
    if (!safe) return null;

    const st = lstatSync(safe);
    if (!st.isFile()) return null;
    if (st.size > maxBytes) return null;

    const O_NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    let fd;
    try {
      fd = openSync(safe, constants.O_RDONLY | O_NOFOLLOW);
      const buf = Buffer.alloc(maxBytes);
      const n = readSync(fd, buf, 0, maxBytes, 0);
      const raw = buf.slice(0, n).toString('utf8').trim();
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Whitelist validation
      if (!VALID_MODES.includes(parsed.mode)) return null;
      // Normalize: agentRole takes precedence; fall back to legacy 'role' field
      if (parsed.agentRole !== undefined && parsed.agentRole !== '' && !VALID_ROLES.includes(parsed.agentRole)) return null;
      if (parsed.role !== undefined && parsed.role !== '' && !VALID_ROLES.includes(parsed.role)) return null;
      // Treat empty string agentRole as "not set"
      if (parsed.agentRole === '') parsed.agentRole = undefined;
      if (parsed.role === '') parsed.role = undefined;
      if (!parsed.agentRole && parsed.role) {
        parsed.agentRole = parsed.role;
      }
      // If no role at all, still allow the mode object — enforcement will deny source edits
      if (parsed.agentRole === undefined && parsed.role === undefined) {
        parsed.agentRole = null;
      }
      if (parsed.active !== undefined && typeof parsed.active !== 'boolean') return null;
      if (parsed.phase !== undefined && !VALID_PHASES.includes(parsed.phase)) return null;
      if (parsed.explicitInvocation !== undefined && typeof parsed.explicitInvocation !== 'boolean') return null;
      // Sanitize free-text fields
      if (parsed.taskId && typeof parsed.taskId === 'string') {
        parsed.taskId = parsed.taskId.replace(/[^\w-]/g, '').slice(0, MAX_TASKID_BYTES);
        if (!parsed.taskId) parsed.taskId = 'current';
      }
      // Validate writeSet if present
      if (parsed.writeSet !== undefined) {
        if (!Array.isArray(parsed.writeSet)) return null;
        if (!parsed.writeSet.every(e => typeof e === 'string' && e.length > 0 && e.length < 1024)) return null;
      }
      // Validate forbidden if present
      if (parsed.forbidden !== undefined) {
        if (!Array.isArray(parsed.forbidden)) return null;
        if (!parsed.forbidden.every(e => typeof e === 'string' && e.length < 1024)) return null;
      }
      return parsed;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  } catch {
    return null;
  }
}

function safeWriteJSON(filePath, obj) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });

    try {
      if (lstatSync(filePath).isSymbolicLink()) return;
    } catch (e) {
      if (e.code !== 'ENOENT') return;
    }

    const tmp = join(dirname(filePath),
      `.${basename(filePath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    const O_NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    let fd;
    try {
      fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o600);
      const content = JSON.stringify(obj, null, 2) + '\n';
      writeSync(fd, content);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    renameSync(tmp, filePath);
  } catch {
    // Silent-fail
  }
}

// ── Goal persistence (survives Claude Code goal auto-clear) ───────────────

function readGoals() {
  try {
    if (!existsSync(GOALS_FILE)) return { goals: [] };
    const st = lstatSync(GOALS_FILE);
    if (!st.isFile() || st.size > MAX_GOAL_BYTES) return { goals: [] };
    const raw = readFileSync(GOALS_FILE, 'utf8').trim();
    if (!raw) return { goals: [] };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.goals)) return { goals: [] };
    parsed.goals = parsed.goals.filter(g =>
      typeof g.id === 'string' && g.id.length > 0 && g.id.length < 128 &&
      typeof g.description === 'string' && g.description.length > 0 &&
      ['active', 'completed', 'abandoned'].includes(g.status)
    );
    return parsed;
  } catch { return { goals: [] }; }
}

function writeGoals(goalsObj) {
  try {
    mkdirSync(dirname(GOALS_FILE), { recursive: true });
    const tmp = join(dirname(GOALS_FILE),
      `.${basename(GOALS_FILE)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    const O_NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    let fd;
    try {
      fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o600);
      writeSync(fd, JSON.stringify(goalsObj, null, 2) + '\n');
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    renameSync(tmp, GOALS_FILE);
  } catch {}
}

function getActiveGoals() {
  const data = readGoals();
  return data.goals.filter(g => g.status === 'active');
}

// ── Path normalization (fixed for Windows absolute paths) ──────────────────

function getProjectRoot() {
  // Walk up from __dirname to find the repo root (where CLAUDE.md lives)
  try {
    let dir = resolve(__dirname);
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(dir, 'CLAUDE.md'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}
  // Fallback: assume Harness/scripts/ is two levels below root
  return resolve(__dirname, '..', '..');
}

function normalizePath(filePath) {
  try {
    // Resolve to absolute, then make relative to project root
    const abs = resolve(filePath);
    const root = getProjectRoot();
    const rel = relative(root, abs).replace(/\\/g, '/');
    if (rel.startsWith('..')) return null; // Outside project
    if (rel.includes('..')) return null;   // Traversal
    // Prefix with / so patterns match uniformly
    return '/' + rel;
  } catch { return null; }
}

function isTaskFile(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized) return false;
  return /^\/Harness\/tasks\/[^/]+\/(PLAN|PROGRESS|ARTIFACTS|NOTES)\.md$/.test(normalized);
}

function isHarnessMeta(filePath, agentRole) {
  const normalized = normalizePath(filePath);
  if (!normalized) return false;
  const isMeta = /^\/Harness\/(memory\/|MEMORY\.md$|PROGRESS\.md$|\.runtime\/)/.test(normalized);
  if (!isMeta) return false;
  // .runtime/ writes (current-mode.json) — CEO only (prevents privilege escalation)
  if (/^\/Harness\/\.runtime\//.test(normalized) && agentRole !== 'ceo') return false;
  return true;
}

/**
 * Check if filePath is within the agent's writeSet.
 * writeSet entries are relative paths from project root (e.g., "CLAUDE.md", "Harness/scripts/wf-mode-hook.mjs").
 */
function isInWriteSet(filePath, writeSet) {
  if (!writeSet || writeSet.length === 0) return false;
  try {
    const abs = resolve(filePath);
    const root = getProjectRoot();
    const rel = relative(root, abs).replace(/\\/g, '/');
    if (rel.startsWith('..')) return false;
    return writeSet.some(entry => {
      const normalizedEntry = entry.replace(/\\/g, '/');
      // Exact match only — list each file explicitly (e.g., both "CLAUDE.md" and "templates/common/CLAUDE.md")
      return rel === normalizedEntry;
    });
  } catch { return false; }
}

// ── stdin ─────────────────────────────────────────────────────────────────

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString().trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// ── Event handlers ─────────────────────────────────────────────────────────

function handleSessionStart() {
  // ── Goal persistence: re-inject active goals even if Claude Code cleared them ──
  const activeGoals = getActiveGoals();
  if (activeGoals.length > 0) {
    const goalLines = activeGoals.map((g, i) => `${i + 1}. [${g.id}] ${g.description}`);
    process.stdout.write([
      `ACTIVE GOALS (${activeGoals.length}) — Harness-persisted, will NOT auto-clear:`,
      ...goalLines,
      'To complete a goal: "goal complete <id>" or "goal done <id>".',
      'To abandon: "goal abandon <id>".',
      '',
    ].join('\n'));
  }

  let mode;
  try { mode = safeReadJSON(MODE_FILE); } catch {}

  if (!mode?.active) return;

  // Auto-clear stale modes. Missing startedAt → treat as stale (legacy/manual mode files)
  if (!mode.startedAt) {
    safeWriteJSON(MODE_FILE, { active: false });
    return;
  }
  try {
    const age = Date.now() - new Date(mode.startedAt).getTime();
    if (age > STALE_MODE_MS) {
      safeWriteJSON(MODE_FILE, { active: false });
      return;
    }
  } catch {
    // Invalid date → treat as stale
    safeWriteJSON(MODE_FILE, { active: false });
    return;
  }

  const agentRole = mode.agentRole || mode.role || null;
  // If no valid role, don't inject — enforcement will deny source edits
  if (!agentRole) return;
  const phase = mode.phase || 'W0_EXPLORE';

  if (mode.mode === 'wf-max') {
    if (agentRole === 'ceo') {
      process.stdout.write([
        'WF-MAX MODE ACTIVE — Top-level orchestrator is CEO.',
        `Task: ${mode.taskId || 'current'} | Phase: ${phase}`,
        '',
        'CEO RULES (delegated Workers follow their dispatch packet):',
        '1. Spawn read-only subagents in ONE message for exploration',
        '2. NEVER Edit/Write/MultiEdit source files — delegate to Workers via Agent tool',
        '3. Bash: only ls/dir/tree/git status/git diff, and harness scripts',
        '4. PLAN.md and PROGRESS.md writes are your ONLY write exceptions',
        '5. Any temptation to Read/Edit a source file → STOP. Spawn a Worker.',
      ].join('\n'));
    } else if (agentRole === 'worker') {
      const ws = mode.writeSet ? ` [writeSet: ${mode.writeSet.join(', ')}]` : ' [no writeSet]';
      process.stdout.write([
        `WF-MAX WORKER ACTIVE — Edit only assigned writeSet.${ws}`,
        `Task: ${mode.taskId || 'current'} | Phase: ${phase}`,
        '',
        'WORKER RULES:',
        '1. Edit only files in your dispatch writeSet.',
        '2. Do NOT edit files outside writeSet.',
        '3. If writeSet is empty/missing, source edits are blocked.',
      ].join('\n'));
    } else if (agentRole === 'manager') {
      process.stdout.write([
        'WF-MAX MANAGER ACTIVE — Scope, review, coordinate.',
        `Task: ${mode.taskId || 'current'} | Phase: ${phase}`,
        '',
        'MANAGER RULES:',
        '1. Partition domain, dispatch Workers, synthesize results.',
        '2. Do NOT edit source files directly.',
        '3. Report to CEO with synthesized findings.',
      ].join('\n'));
    } else if (agentRole === 'reviewer') {
      process.stdout.write([
        'WF-MAX REVIEWER ACTIVE — Read and report only.',
        `Task: ${mode.taskId || 'current'} | Phase: ${phase}`,
        '',
        'REVIEWER RULES:',
        '1. Read files, analyze, report findings.',
        '2. Do NOT edit any files.',
      ].join('\n'));
    }
  } else if (mode.mode === 'wf-review') {
    process.stdout.write([
      'WF-REVIEW MODE ACTIVE — Cross-model peer review.',
      'Use Bash to invoke the OTHER CLI (codex/claude). NEVER self-review.',
      'Your role: prepare context, invoke peer, synthesize findings.',
    ].join('\n'));
  } else if (mode.mode === 'wf') {
    process.stdout.write([
      'WF MODE ACTIVE — Task-bounded workflow with heartbeat and recovery loop.',
    ].join('\n'));
  } else if (mode.mode === 'wf-auto') {
    process.stdout.write([
      'WF-AUTO MODE ACTIVE — Perpetual auto-optimization. Never stops until 8-angle exhaustion.',
    ].join('\n'));
  } else if (mode.mode === 'wf-auto-spark') {
    process.stdout.write([
      'WF-AUTO-SPARK MODE ACTIVE — Perpetual inspiration. External spark search. Roadmap-anchored.',
    ].join('\n'));
  } else if (mode.mode === 'wf-learn') {
    process.stdout.write([
      'WF-LEARN MODE ACTIVE — Force learning cycle: context-master -> memory-master.',
    ].join('\n'));
  }
}

function handleUserPromptSubmit(event) {
  const prompt = (event.prompt || event.input || '').toString();
  const lower = prompt.toLowerCase();

  // ── Goal command detection (Harness-persisted, NOT pattern-match auto-clear) ──
  const goalSetMatch = prompt.match(/(?:^|\n)\s*(?:goal\s+set|goal\s+add|\/goal)\s+(.+?)(?:\n|$)/i);
  const goalCompleteMatch = prompt.match(/(?:^|\n)\s*goal\s+(?:complete|done)\s+(\S+)/i);
  const goalAbandonMatch = prompt.match(/(?:^|\n)\s*goal\s+abandon\s+(\S+)/i);

  if (goalSetMatch) {
    const desc = goalSetMatch[1].trim().slice(0, MAX_GOAL_DESC);
    const data = readGoals();
    const id = 'g' + Date.now().toString(36);
    data.goals.push({ id, description: desc, status: 'active', createdAt: new Date().toISOString(), completedAt: null });
    writeGoals(data);
  }

  if (goalCompleteMatch) {
    const id = goalCompleteMatch[1];
    const data = readGoals();
    const g = data.goals.find(g => g.id === id && g.status === 'active');
    if (g) { g.status = 'completed'; g.completedAt = new Date().toISOString(); writeGoals(data); }
  }

  if (goalAbandonMatch) {
    const id = goalAbandonMatch[1];
    const data = readGoals();
    const g = data.goals.find(g => g.id === id && g.status === 'active');
    if (g) { g.status = 'abandoned'; g.completedAt = new Date().toISOString(); writeGoals(data); }
  }

  // ── Mode activation detection ──
  try {
    const modeConfigs = [
      { trigger: ['/wf-auto-spark', 'wf auto spark', 'spark mode'], mode: 'wf-auto-spark', taskId: 'wf-auto-spark-current', phase: 'SPARK' },
      { trigger: ['/wf-max', 'wf max'], mode: 'wf-max', taskId: 'wf-max-current-task', phase: 'W0_EXPLORE' },
      { trigger: ['/wf-auto', 'wf auto', 'auto mode'], mode: 'wf-auto', taskId: 'wf-auto-current', phase: 'AUTO' },
      { trigger: ['/wf-review', 'wf review'], mode: 'wf-review', taskId: 'wf-review-current', phase: 'REVIEW' },
      { trigger: ['/wf-learn', 'wf learn'], mode: 'wf-learn', taskId: 'wf-learn-current', phase: 'LEARN' },
      { trigger: ['/wf', 'wf mode', 'workflow mode', 'wk mode'], mode: 'wf', taskId: 'wf-current-task', phase: 'W0_EXPLORE' },
    ];
    for (const cfg of modeConfigs) {
      if (cfg.trigger.some(t => lower.includes(t))) {
        safeWriteJSON(MODE_FILE, {
          active: true,
          mode: cfg.mode,
          agentRole: 'ceo',
          role: 'ceo',
          taskId: cfg.taskId,
          phase: cfg.phase,
          explicitInvocation: true,
          startedAt: new Date().toISOString(),
        });
        break;
      }
    }
  } catch {}

  // ── Per-turn reinforcement ──
  try {
    // Active goal reminder (always shown, independent of mode)
    const activeGoals = getActiveGoals();
    if (activeGoals.length > 0) {
      const goalReminder = activeGoals.length === 1
        ? `Active goal: [${activeGoals[0].id}] ${activeGoals[0].description}`
        : `Active goals (${activeGoals.length}): ` + activeGoals.map(g => `[${g.id}] ${g.description}`).join(' | ');
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: `GOAL TRACKING: ${goalReminder}. Say "goal complete <id>" when done, "goal abandon <id>" to drop.`,
        },
      }));
    }

    const mode = safeReadJSON(MODE_FILE);
    if (!mode?.active) return;

    const agentRole = mode.agentRole || mode.role;
    if (!agentRole) return;

    if (mode.mode === 'wf-max') {
      const roleText = agentRole === 'ceo'
        ? `WF-MAX ACTIVE — Top-level orchestrator is CEO (${mode.phase || 'W0_EXPLORE'}). Spawn Workers. NEVER Edit/Write/MultiEdit source files. Bash only: ls/dir/tree/git. PLAN.md/PROGRESS.md writes allowed.`
        : agentRole === 'worker'
        ? `WF-MAX WORKER — Edit only files in dispatch writeSet${mode.writeSet ? ': ' + mode.writeSet.join(', ') : ' (none)'}.`
        : agentRole === 'manager'
        ? `WF-MAX MANAGER — Coordinate and synthesize. No source edits.`
        : agentRole === 'reviewer'
        ? `WF-MAX REVIEWER — Read and report only. No edits.`
        : `WF-MAX ACTIVE — Role: ${agentRole}.`;

      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: roleText,
        },
      }));
    } else if (mode.mode === 'wf-review') {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: 'WF-REVIEW ACTIVE. Use Bash to invoke the OTHER CLI. NEVER self-review.',
        },
      }));
    } else if (mode.mode === 'wf') {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: 'WF MODE ACTIVE — Task-bounded workflow with heartbeat and recovery loop.',
        },
      }));
    } else if (mode.mode === 'wf-auto') {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: 'WF-AUTO MODE ACTIVE — Perpetual auto-optimization. Never stops until 8-angle exhaustion.',
        },
      }));
    } else if (mode.mode === 'wf-auto-spark') {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: 'WF-AUTO-SPARK MODE ACTIVE — Perpetual inspiration. External spark search. Roadmap-anchored.',
        },
      }));
    } else if (mode.mode === 'wf-learn') {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: 'WF-LEARN MODE ACTIVE — Force learning cycle: context-master -> memory-master.',
        },
      }));
    }
  } catch {}
}

function handlePreToolUse(event) {
  let mode;
  try { mode = safeReadJSON(MODE_FILE); } catch {}
  if (!mode?.active) return;

  const toolName = event.tool_name || event.tool || '';
  if (!BLOCKED_TOOLS.includes(toolName)) return;

  const input = event.tool_input || event.input || {};
  const filePath = input.file_path || '';
  const command = input.command || '';

  const agentRole = mode.agentRole || mode.role || null;

  // ── No role → deny source edits by default ──
  if (!agentRole) {
    if (filePath && (isTaskFile(filePath) || isHarnessMeta(filePath, agentRole))) return; // allow meta
    if (toolName === 'Bash') {
      const trimmed = command.trim();
      if (/^((ls|dir|tree|git\s+status|git\s+diff|git\s+log|git\s+branch|node\s+Harness\/scripts\/[a-z0-9_.-]+\.mjs|which|echo|type|codex|claude)(\s+[^;&|>`$]*)?)$/.test(trimmed)) return;
    }
    process.stderr.write(`[WF-MAX BLOCK] ${toolName} blocked: no agentRole set. Define agentRole and writeSet before editing.\n`);
    process.exit(2);
  }

  // ── CEO: block all source edits ──
  if (agentRole === 'ceo') {
    if (toolName === 'Bash') {
      const trimmed = command.trim();
      if (/[\r\n\0]/.test(trimmed)) {
        process.stderr.write('[CEO BLOCK] Bash command contains newlines or control characters.\n');
        process.exit(2);
      }
      if (/[;&|>`$]/.test(trimmed)) {
        process.stderr.write('[CEO BLOCK] Bash command contains shell metacharacters. Use a Worker.\n');
        process.exit(2);
      }
      const allowed = /^(ls|dir|tree|git\s+status|git\s+diff|git\s+log|git\s+branch|node\s+Harness\/scripts\/[a-z0-9_.-]+\.mjs|which|echo|type|codex|claude)(\s+[^;&|>`$]*)?$/;
      if (allowed.test(trimmed)) return;
    }

    if (filePath) {
      if (isTaskFile(filePath) || isHarnessMeta(filePath, agentRole)) return;
    }

    process.stderr.write(`[WF-MAX CEO BLOCK] ${toolName} on source files is forbidden for CEO. Delegate to a Worker via Agent tool. File: ${filePath || command}\n`);
    process.exit(2);
  }

  // ── Worker: allow writeSet files only ──
  if (agentRole === 'worker') {
    const writeSet = mode.writeSet || [];

    if (toolName === 'Bash') {
      const trimmed = command.trim();
      if (/[\r\n\0]/.test(trimmed)) {
        process.stderr.write('[WORKER BLOCK] Bash command contains control characters.\n');
        process.exit(2);
      }
      // Block shell chaining and redirects (same as CEO)
      if (/[;&|>`$]/.test(trimmed)) {
        process.stderr.write('[WORKER BLOCK] Bash command contains shell metacharacters.\n');
        process.exit(2);
      }
      return; // Allow safe bash for workers (test running, build, etc.)
    }

    if (filePath) {
      if (isTaskFile(filePath) || isHarnessMeta(filePath, agentRole)) return;
      if (isInWriteSet(filePath, writeSet)) return;
      process.stderr.write(`[WF-MAX WORKER BLOCK] ${toolName} on "${filePath}" is outside writeSet [${writeSet.join(', ')}].\n`);
      process.exit(2);
    }

    // No filePath? Allow (tool call without file target)
    return;
  }

  // ── Manager: no source edits (like CEO but can run more bash) ──
  if (agentRole === 'manager') {
    if (toolName === 'Bash') {
      const trimmed = command.trim();
      if (/[\r\n\0]/.test(trimmed)) {
        process.stderr.write('[MANAGER BLOCK] Bash command contains control characters.\n');
        process.exit(2);
      }
      if (/[;&|>`$]/.test(trimmed)) {
        process.stderr.write('[MANAGER BLOCK] Bash command contains shell metacharacters.\n');
        process.exit(2);
      }
      const allowed = /^(ls|dir|tree|git\s+status|git\s+diff|git\s+log|git\s+branch|node\s+Harness\/scripts\/[a-z0-9_.-]+\.mjs|which|echo|type|codex|claude)(\s+[^;&|>`$]*)?$/;
      if (allowed.test(trimmed)) return;
    }

    if (filePath) {
      if (isTaskFile(filePath) || isHarnessMeta(filePath, agentRole)) return;
    }

    process.stderr.write(`[WF-MAX MANAGER BLOCK] ${toolName} on source files is forbidden for Manager. Delegate to Workers.\n`);
    process.exit(2);
  }

  // ── Reviewer: no edits at all ──
  if (agentRole === 'reviewer') {
    if (toolName === 'Bash') {
      const trimmed = command.trim();
      if (/[\r\n\0]/.test(trimmed)) {
        process.stderr.write('[REVIEWER BLOCK] Bash command contains control characters.\n');
        process.exit(2);
      }
      const allowed = /^(ls|dir|tree|git\s+status|git\s+diff|git\s+log|git\s+branch|which|echo|type)(\s+[^;&|>`$]*)?$/;
      if (allowed.test(trimmed)) return;
    }

    if (filePath) {
      if (isTaskFile(filePath) || isHarnessMeta(filePath, agentRole)) return;
    }

    process.stderr.write(`[WF-MAX REVIEWER BLOCK] ${toolName} is forbidden for Reviewer. Read and report only.\n`);
    process.exit(2);
  }
}

// ── Memory auto-capture (PostToolUse) ──────────────────────────────────────

const MEMORY_DIR = join(__dirname, '..', 'memory');
const MEMORY_FILES = {
  toolReflections: join(MEMORY_DIR, 'tool-usage-reflections.md'),
  userCorrections: join(MEMORY_DIR, 'user-corrections-preferences.md'),
  agentLessons:    join(MEMORY_DIR, 'agent-lessons-patterns.md'),
};
const EPISODE_BUFFER = []; // Batched significant events
const EPISODE_FLUSH_SIZE = 5;
const SESSION_EVENTS = []; // Tracked for Stop hook summary

// Captured in UserPromptSubmit: last user prompt text
let _lastPrompt = '';

function isSignificantError(stderr, stdout) {
  const combined = (stderr + stdout).toLowerCase();
  const patterns = [
    /\berror\b/, /\bfail(?:ed|ure)?\b/, /\bexception\b/, /\btraceback\b/,
    /\bpanic\b/, /\bfatal\b/, /\btimeout\b/, /\bdenied\b/, /\bblock(?:ed)?\b/,
    /\bpermission denied\b/, /\bnot found\b/i, /\bout of memory\b/i,
  ];
  return patterns.some(p => p.test(combined));
}

function isTestResult(stdout) {
  return /\b(tests?|pass(?:ed)?|fail(?:ed)?)\s+\d+/i.test(stdout) ||
         /(\d+)\s+(passed|failed)/i.test(stdout);
}

function isUserCorrectionIntent(prompt) {
  const patterns = [
    /记住|记下来|别忘了|don'?t\s+forget|remember\s+this/i,
    /我(说了|告诉过).*记住/i, /correction/i,
    /不要.*再|别再|以后.*不要|下次.*不要/i,
  ];
  return patterns.some(p => p.test(prompt));
}

function appendMemory(filePath, entry) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const header = `\n### ${ts} — auto-captured by wf-mode-hook\n\n${entry}\n`;
    const fd = openSync(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND, 0o644);
    writeSync(fd, header);
    closeSync(fd);
  } catch {}
}

function flushEpisodeBuffer() {
  if (EPISODE_BUFFER.length === 0) return;
  const batch = EPISODE_BUFFER.splice(0);
  const entry = batch.map(e => `- [${e.type}] ${e.tool}: ${e.summary.slice(0, 200)}`).join('\n');
  appendMemory(MEMORY_FILES.toolReflections, `**Batch (${batch.length} events)**\n${entry}`);
  SESSION_EVENTS.push({ type: 'batch', count: batch.length, summary: batch[0]?.summary });
}

function handlePostToolUse(event) {
  try {
    const toolName = event.tool_name || event.tool || '';
    const stderr = (event.stderr || event.tool_stderr || '').toString();
    const stdout = (event.stdout || event.tool_stdout || '').toString();

    // ── Error auto-capture ──
    if (isSignificantError(stderr, stdout)) {
      const summary = stderr.slice(0, 300).replace(/\n/g, ' ').trim() ||
                      stdout.slice(0, 300).replace(/\n/g, ' ').trim();
      EPISODE_BUFFER.push({ type: 'error', tool: toolName, summary, ts: Date.now() });

      // Immediate write for critical errors (exit code 2 = blocked by hook)
      if (stderr.includes('BLOCK') || stderr.includes('exit 2') || event.exit_code === 2) {
        appendMemory(MEMORY_FILES.toolReflections,
          `**Hook blocked**: \`${toolName}\` — ${summary}\n` +
          `> Reason: ${stderr.slice(0, 200)}\n`);
      }
    }

    // ── Test result capture ──
    if (isTestResult(stdout)) {
      const lines = stdout.split('\n').filter(l => /\b(pass|fail|test)/i.test(l));
      if (lines.length > 0) {
        appendMemory(MEMORY_FILES.agentLessons,
          `**Test run** (\`${toolName}\`):\n${lines.slice(0, 5).map(l => `> ${l.trim()}`).join('\n')}\n`);
      }
    }

    // ── Flush buffer when full ──
    if (EPISODE_BUFFER.length >= EPISODE_FLUSH_SIZE) {
      flushEpisodeBuffer();
    }

    // ── User correction capture (checked against last prompt) ──
    if (_lastPrompt && isUserCorrectionIntent(_lastPrompt)) {
      appendMemory(MEMORY_FILES.userCorrections,
        `**User directive**: ${_lastPrompt.slice(0, 300)}\n` +
        `> Context: after \`${toolName}\` tool call\n`);
      _lastPrompt = ''; // Reset — one correction per trigger
    }
  } catch {}
}

function handleStop() {
  try {
    // Flush remaining buffer
    flushEpisodeBuffer();

    // Write session summary if significant events occurred
    if (SESSION_EVENTS.length > 0) {
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const summary = [
        `## Session Summary — ${ts}`,
        `- Events captured: ${SESSION_EVENTS.length}`,
        ...SESSION_EVENTS.slice(0, 10).map(e =>
          `  - ${e.type}: ${(e.summary || '').slice(0, 100)}`),
        '',
      ].join('\n');
      appendMemory(MEMORY_FILES.toolReflections, summary);
    }
  } catch {}
}

// ── main ───────────────────────────────────────────────────────────────────

const event = await readStdin();
const eventType = event.hook_event_name || event.event || event.type || '';

// Capture user prompt for PostToolUse correlation
if (eventType === 'UserPromptSubmit') {
  _lastPrompt = (event.prompt || event.input || '').toString();
}

switch (eventType) {
  case 'SessionStart':
    handleSessionStart();
    break;
  case 'UserPromptSubmit':
    handleUserPromptSubmit(event);
    break;
  case 'PreToolUse':
    handlePreToolUse(event);
    break;
  case 'PostToolUse':
    handlePostToolUse(event);
    break;
  case 'Stop':
    handleStop(event);
    break;
  default:
    break;
}

process.exit(0);
