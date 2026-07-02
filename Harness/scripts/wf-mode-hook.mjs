#!/usr/bin/env node
/**
 * wf-mode-hook.mjs — Claude Code hook for WF / WF-MAX enforcement
 *
 * Modes: wf, wf-max, wf-auto, wf-auto-spark, wf-review, wf-learn
 * Roles (wf-max): ceo, ceo-escalated, worker, manager, reviewer
 *
 * NO-DEADLOCK GUARANTEES:
 *   - Stale mode (>30 min) auto-cleared on SessionStart
 *   - Corrupted/missing mode file → no blocking (fail-open)
 *   - Any state → "ceo done" clears everything
 *   - isTaskFile / isHarnessMeta always allowed
 *
 * Hook events:
 *   SessionStart    → auto-clear stale; inject context for fresh mode
 *   UserPromptSubmit→ detect mode activation; goals; escalation commands
 *   PreToolUse      → enforce agentRole + writeSet
 */

import { constants, openSync, readSync, writeSync, closeSync, existsSync, mkdirSync, lstatSync, renameSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = join(__dirname, '..', '.runtime');
const MODE_FILE = join(RUNTIME_DIR, 'current-mode.json');
const GOALS_FILE = join(RUNTIME_DIR, 'goals.json');

const MAX_MODE_BYTES = 16384;
const MAX_GOAL_BYTES = 65536;
const MAX_GOAL_DESC = 500;
const MAX_ESCALATION_FILES = 1;
const MAX_TASKID_BYTES = 128;
const STALE_MODE_MS = 30 * 60 * 1000;

const VALID_MODES = ['wf', 'wf-max', 'wf-auto', 'wf-auto-spark', 'wf-review', 'wf-learn', null];
const VALID_ROLES = ['ceo', 'ceo-escalated', 'worker', 'manager', 'reviewer', null];
const VALID_PHASES = ['W0_EXPLORE', 'W1_ARCHITECTURE', 'W2_IMPLEMENT', 'W2R_REVIEW', 'W3_DEPENDENT', 'INTEGRATION', 'CLOSEOUT', 'REVIEW', 'SPARK', 'AUTO', 'LEARN', null];
const BLOCKED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'Bash'];

// ── Safe I/O ─────────────────────────────────────────────────────────────

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
  } catch { return null; }
}

function safeReadJSON(filePath, maxBytes = MAX_MODE_BYTES) {
  try {
    const safe = safeResolveHarnessPath(filePath);
    if (!safe) return null;
    const st = lstatSync(safe);
    if (!st.isFile() || st.size > maxBytes) return null;
    const O_NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    let fd;
    try {
      fd = openSync(safe, constants.O_RDONLY | O_NOFOLLOW);
      const buf = Buffer.alloc(maxBytes);
      const n = readSync(fd, buf, 0, maxBytes, 0);
      const raw = buf.slice(0, n).toString('utf8').trim();
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!VALID_MODES.includes(parsed.mode)) return null;
      if (parsed.agentRole !== undefined && parsed.agentRole !== '' && !VALID_ROLES.includes(parsed.agentRole)) return null;
      if (parsed.role !== undefined && parsed.role !== '' && !VALID_ROLES.includes(parsed.role)) return null;
      if (parsed.agentRole === '') parsed.agentRole = undefined;
      if (parsed.role === '') parsed.role = undefined;
      if (!parsed.agentRole && parsed.role) parsed.agentRole = parsed.role;
      if (parsed.agentRole === undefined && parsed.role === undefined) parsed.agentRole = null;
      if (parsed.active !== undefined && typeof parsed.active !== 'boolean') return null;
      if (parsed.phase !== undefined && !VALID_PHASES.includes(parsed.phase)) return null;
      if (parsed.explicitInvocation !== undefined && typeof parsed.explicitInvocation !== 'boolean') return null;
      if (parsed.taskId && typeof parsed.taskId === 'string') {
        parsed.taskId = parsed.taskId.replace(/[^\w-]/g, '').slice(0, MAX_TASKID_BYTES);
        if (!parsed.taskId) parsed.taskId = 'current';
      }
      if (parsed.writeSet !== undefined) {
        if (!Array.isArray(parsed.writeSet)) return null;
        if (!parsed.writeSet.every(e => typeof e === 'string' && e.length > 0 && e.length < 1024)) return null;
      }
      if (parsed.forbidden !== undefined) {
        if (!Array.isArray(parsed.forbidden)) return null;
        if (!parsed.forbidden.every(e => typeof e === 'string' && e.length < 1024)) return null;
      }
      return parsed;
    } finally { if (fd !== undefined) closeSync(fd); }
  } catch { return null; }
}

function safeWriteJSON(filePath, obj) {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    try { if (lstatSync(filePath).isSymbolicLink()) return; } catch (e) { if (e.code !== 'ENOENT') return; }
    const tmp = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    const O_NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    let fd;
    try {
      fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o600);
      writeSync(fd, JSON.stringify(obj, null, 2) + '\n');
    } finally { if (fd !== undefined) closeSync(fd); }
    renameSync(tmp, filePath);
  } catch { /* silent-fail */ }
}

// ── Project root detection ────────────────────────────────────────────────

function getProjectRoot() {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'CLAUDE.md'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(__dirname, '..', '..');
}

const ROOT = getProjectRoot();

function normalizePath(p) {
  return relative(ROOT, resolve(ROOT, p)).replace(/\\/g, '/');
}

// ── File classification ───────────────────────────────────────────────────

function isTaskFile(fp) {
  const n = normalizePath(fp);
  return /^Harness\/tasks\/[^/]+\/(PROGRESS|PLAN)\.md$/.test(n);
}

function isHarnessMeta(fp, agentRole) {
  const n = normalizePath(fp);
  if (/^\.claude\/(settings\.json|rules\/ecc\/.+\.md)$/.test(n)) return true;
  if (/^Harness\/\.runtime\//.test(n)) return true;
  if (/^\.codex\//.test(n)) return true;
  return false;
}

function isInWriteSet(fp, writeSet) {
  const n = normalizePath(fp);
  return writeSet.some(w => {
    const wn = w.replace(/\\/g, '/');
    return n === wn || n.endsWith('/' + wn) || wn.endsWith('/' + basename(n));
  });
}

// ── Goal persistence ──────────────────────────────────────────────────────

function readGoals() {
  try {
    if (!existsSync(GOALS_FILE)) return { goals: [] };
    const raw = readFileSync(GOALS_FILE, 'utf8');
    if (raw.length > MAX_GOAL_BYTES) return { goals: [] };
    return JSON.parse(raw);
  } catch { return { goals: [] }; }
}

function writeGoals(data) {
  safeWriteJSON(GOALS_FILE, data);
}

function getActiveGoals() {
  return readGoals().goals.filter(g => g.status === 'active');
}

// For goals we need readFileSync/writeFileSync (different file, not Harness/)
import { readFileSync, writeFileSync } from 'node:fs';

// ── SessionStart ──────────────────────────────────────────────────────────

function handleSessionStart(event) {
  let mode;
  try { mode = safeReadJSON(MODE_FILE); } catch { mode = null; }

  if (mode?.active && mode.startedAt) {
    const age = Date.now() - new Date(mode.startedAt).getTime();
    if (age > STALE_MODE_MS) {
      // Stale mode from previous session — clear
      try { writeFileSync(MODE_FILE, JSON.stringify({ mode: null, agentRole: null, active: false })); } catch {}
      mode = null;
    }
  } else if (mode?.active && !mode.startedAt) {
    // Missing startedAt = stale
    try { writeFileSync(MODE_FILE, JSON.stringify({ mode: null, agentRole: null, active: false })); } catch {}
    mode = null;
  }

  if (!mode?.active) return;

  const agentRole = mode.agentRole || mode.role || null;
  const phase = mode.phase || 'W0_EXPLORE';

  // Inject mode context
  const lines = [];
  if (mode.mode === 'wf-max') {
    if (agentRole === 'ceo') {
      lines.push(
        'WF-MAX CEO MODE — ORCHESTRATOR, NOT IMPLEMENTER',
        `Task: ${mode.taskId || 'current'} | Phase: ${phase}`,
        '',
        'CEO does NOT write source code. Plan, dispatch Workers, synthesize.',
        'Workers stuck 3x? "ceo escalate <file>" for 1-file exemption.',
        'Exit: "ceo done" clears all enforcement.',
      );
    } else if (agentRole === 'ceo-escalated') {
      lines.push(
        'WF-MAX CEO (ESCALATED) — limited 1-file edit permission',
        `Write set: ${(mode.writeSet || []).join(', ') || 'none'}`,
        'After edit: "ceo deescalate" to return to CEO.',
      );
    }
  } else if (mode.mode === 'wf') {
    lines.push(`WF MODE ACTIVE — ${phase}`, 'Multi-subagent orchestration required.');
  } else if (mode.mode === 'wf-review') {
    lines.push('WF-REVIEW MODE ACTIVE', 'Cross-model peer review. Read and report.');
  } else if (mode.mode === 'wf-auto' || mode.mode === 'wf-auto-spark') {
    lines.push(`${mode.mode.toUpperCase()} — CEO orchestrator`, 'Never writes source code.');
  }

  if (lines.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: lines.join('\n'),
      },
    }));
  }
}

// ── UserPromptSubmit ──────────────────────────────────────────────────────

function handleUserPromptSubmit(event) {
  const prompt = (event.prompt || event.text || '').trim();
  if (!prompt) return;
  const lower = prompt.toLowerCase();

  // ── Goals ──
  const goalSetMatch = prompt.match(/(?:^|\n)\s*goal\s+set\s+(.+)/i);
  const goalCompleteMatch = prompt.match(/(?:^|\n)\s*goal\s+complete\s+(\S+)/i);
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

  // ── Emergency escape: "ceo done" clears everything ──
  const doneMatch = prompt.match(/(?:^|\n)\s*ceo\s+done/i);
  if (doneMatch) {
    try { writeFileSync(MODE_FILE, JSON.stringify({ mode: null, agentRole: null, active: false })); } catch {}
    return;
  }

  // ── Escalate / Deescalate ──
  const escalateMatch = prompt.match(/(?:^|\n)\s*ceo\s+escalate\s+(\S+(?:\s*,\s*\S+)*)(?:\s+"(.+?)")?/i);
  const deescalateMatch = prompt.match(/(?:^|\n)\s*ceo\s+deescalate/i);

  if (escalateMatch) {
    try {
      const mode = safeReadJSON(MODE_FILE);
      if (mode && mode.agentRole === 'ceo') {
        const files = escalateMatch[1].split(',').map(f => f.trim()).filter(Boolean);
        const reason = (escalateMatch[2] || 'Worker retry limit exceeded').slice(0, 200);
        if (files.length <= MAX_ESCALATION_FILES) {
          safeWriteJSON(MODE_FILE, {
            ...mode,
            agentRole: 'ceo-escalated',
            writeSet: files,
            escalationReason: reason,
            escalatedAt: new Date().toISOString(),
          });
        }
      }
    } catch {}
  }

  if (deescalateMatch) {
    try {
      const mode = safeReadJSON(MODE_FILE);
      if (mode) {
        const { escalationReason, escalatedAt, writeSet, forbidden, ...rest } = mode;
        safeWriteJSON(MODE_FILE, {
          ...rest,
          agentRole: 'ceo',
          writeSet: undefined,
          forbidden: undefined,
        });
      }
    } catch {}
  }

  // ── Mode activation ──
  try {
    const modeConfigs = [
      { triggers: ['/wf-auto-spark', 'wf auto spark', 'spark mode'], mode: 'wf-auto-spark', phase: 'SPARK' },
      { triggers: ['/wf-max', 'wf max'], mode: 'wf-max', phase: 'W0_EXPLORE' },
      { triggers: ['/wf-auto', 'wf auto', 'auto mode'], mode: 'wf-auto', phase: 'AUTO' },
      { triggers: ['/wf-review', 'wf review'], mode: 'wf-review', phase: 'REVIEW' },
      { triggers: ['/wf-learn', 'wf learn'], mode: 'wf-learn', phase: 'LEARN' },
      { triggers: ['/wf', 'wf mode', 'workflow mode', 'wk mode'], mode: 'wf', phase: 'W0_EXPLORE' },
    ];
    for (const cfg of modeConfigs) {
      if (cfg.triggers.some(t => lower.includes(t))) {
        safeWriteJSON(MODE_FILE, {
          active: true,
          mode: cfg.mode,
          agentRole: 'ceo',
          taskId: `wf-${cfg.mode}-current`,
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
    const activeGoals = getActiveGoals();
    if (activeGoals.length > 0) {
      const goalReminder = activeGoals.length === 1
        ? `Active goal: [${activeGoals[0].id}] ${activeGoals[0].description}`
        : `Active goals (${activeGoals.length}): ` + activeGoals.map(g => `[${g.id}] ${g.description}`).join(' | ');
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: `GOAL TRACKING: ${goalReminder}. "goal complete <id>" to finish, "goal abandon <id>" to drop.`,
        },
      }));
    }

    const mode = safeReadJSON(MODE_FILE);
    if (!mode?.active) return;

    const agentRole = mode.agentRole || mode.role;
    if (!agentRole) return;

    const writeSetInfo = mode.writeSet?.length ? ` [writeSet: ${mode.writeSet.join(', ')}]` : '';
    let roleText = '';

    if (mode.mode === 'wf-max') {
      if (agentRole === 'ceo') {
        roleText = `WF-MAX CEO (${mode.phase || 'W0_EXPLORE'})${writeSetInfo} — Plan and delegate. NOT implementer. "ceo escalate <file>" for 1-file exemption. "ceo done" to exit.`;
      } else if (agentRole === 'ceo-escalated') {
        roleText = `WF-MAX CEO (ESCALATED)${writeSetInfo} — 1-file exemption active. Edit ONLY escalated file. "ceo deescalate" when done.`;
      }
    } else if (agentRole === 'ceo') {
      roleText = `${mode.mode.toUpperCase()} CEO — Orchestrate. Do not write source code.`;
    }

    if (roleText) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: roleText,
        },
      }));
    }
  } catch {}
}

// ── PreToolUse ────────────────────────────────────────────────────────────

function handlePreToolUse(event) {
  let mode;
  try { mode = safeReadJSON(MODE_FILE); } catch { return; /* fail-open */ }
  if (!mode?.active) return;

  const toolName = event.tool_name || event.tool || '';
  if (!BLOCKED_TOOLS.includes(toolName)) return;

  const input = event.tool_input || event.input || {};
  const filePath = input.file_path || '';
  const command = input.command || '';
  const agentRole = mode.agentRole || mode.role || null;

  // ── No role → allow (default mode, not enforcing) ──
  if (!agentRole) return;

  // ── Bash safety filter (applies to all roles) ──
  if (toolName === 'Bash') {
    const trimmed = command.trim();
    if (/[\r\n\0]/.test(trimmed)) {
      process.stderr.write(`[BLOCK] Bash command contains control characters.\n`);
      process.exit(2);
    }
    // Allowed safe commands (all roles)
    const safeBash = /^(ls|dir|tree|git\s+status|git\s+diff|git\s+log|git\s+branch|git\s+push|git\s+commit|which|echo|type|node|npm|npx|pnpm|yarn)(\s+.*)?$/;
    if (safeBash.test(trimmed)) return;
  }

  if (filePath) {
    // Task files and harness meta always allowed
    if (isTaskFile(filePath) || isHarnessMeta(filePath, agentRole)) return;
  }

  // ── CEO: no source edits (escalate for exemption) ──
  if (agentRole === 'ceo') {
    process.stderr.write(`[CEO BLOCK] Source edits forbidden. "ceo escalate <file>" for 1-file exemption after Workers stuck 3x.\n`);
    process.exit(2);
  }

  // ── CEO-Escalated: edit only escalated file ──
  if (agentRole === 'ceo-escalated') {
    const writeSet = mode.writeSet || [];
    if (filePath && isInWriteSet(filePath, writeSet)) return;
    process.stderr.write(`[ESCALATED BLOCK] File "${filePath}" not in escalation set [${writeSet.join(', ')}]. "ceo deescalate" to return.\n`);
    process.exit(2);
  }

  // ── Manager: no source edits ──
  if (agentRole === 'manager') {
    if (filePath) {
      process.stderr.write(`[MANAGER BLOCK] Source edits forbidden. Delegate to Workers.\n`);
      process.exit(2);
    }
    return;
  }

  // ── Reviewer: no edits at all ──
  if (agentRole === 'reviewer') {
    if (filePath) {
      process.stderr.write(`[REVIEWER BLOCK] Edits forbidden. Read and report only.\n`);
      process.exit(2);
    }
    return;
  }

  // ── Worker: edit only within writeSet ──
  if (agentRole === 'worker') {
    const writeSet = mode.writeSet || [];
    if (filePath && isInWriteSet(filePath, writeSet)) return;
    process.stderr.write(`[WORKER BLOCK] "${filePath}" outside writeSet [${writeSet.join(', ')}].\n`);
    process.exit(2);
  }
}

// ── PostToolUse: memory auto-capture ──────────────────────────────────────

function handlePostToolUse(event) {
  // Stub: auto-capture significant errors and user corrections
  // See original implementation for full logic
}

// ── Stop ──────────────────────────────────────────────────────────────────

function handleStop(event) {
  // Stub: auto-capture on session stop
}

// ── Dispatch ──────────────────────────────────────────────────────────────

const eventName = process.argv[2];
const raw = process.argv[3] || '{}';

switch (eventName) {
  case 'SessionStart':
    handleSessionStart(JSON.parse(raw));
    break;
  case 'UserPromptSubmit':
    handleUserPromptSubmit(JSON.parse(raw));
    break;
  case 'PreToolUse':
    handlePreToolUse(JSON.parse(raw));
    break;
  case 'PostToolUse':
    handlePostToolUse(JSON.parse(raw));
    break;
  case 'Stop':
    handleStop(JSON.parse(raw));
    break;
  default:
    break;
}
