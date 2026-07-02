#!/usr/bin/env node
/**
 * wf-mode-hook.mjs - Harness workflow hook for Claude Code/Codex.
 *
 * Authority model:
 * - Harness/.runtime/current-mode.json is observable workflow state only.
 * - Per-agent dispatch context is the authority for source-write permissions.
 * - Dispatch context may arrive on the hook event or via HARNESS_* env vars.
 */

import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = join(__dirname, '..', '.runtime');
const MODE_FILE = join(RUNTIME_DIR, 'current-mode.json');
const GOALS_FILE = join(RUNTIME_DIR, 'goals.json');

const MAX_MODE_BYTES = 16 * 1024;
const MAX_GOAL_BYTES = 64 * 1024;
const MAX_GOAL_DESC = 500;
const MAX_TASKID_BYTES = 128;
const MAX_ESCALATION_FILES = 1;
const STALE_MODE_MS = 30 * 60 * 1000;

const VALID_MODES = new Set(['wf', 'wf-max', 'wf-auto', 'wf-auto-spark', 'wf-review', 'wf-learn', null]);
const VALID_ROLES = new Set(['ceo', 'ceo-escalated', 'manager', 'worker', 'reviewer', null]);
const VALID_PHASES = new Set([
  'W0_EXPLORE',
  'W1_ARCHITECTURE',
  'W2_IMPLEMENT',
  'W2R_REVIEW',
  'W3_DEPENDENT',
  'INTEGRATION',
  'CLOSEOUT',
  'REVIEW',
  'SPARK',
  'AUTO',
  'LEARN',
  null,
]);
const GUARDED_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'Bash']);
const SAFE_BASH = /^(ls|dir|tree|git\s+status|git\s+diff|git\s+log|git\s+branch|node\s+Harness\/scripts\/[a-z0-9_.-]+\.mjs|which|echo|type|codex|claude|npm\s+test|npm\s+run|npx\s+playwright\s+test)(\s+[^;&|>`$]*)?$/i;

const PROJECT_ROOT = findProjectRoot();

function findProjectRoot() {
  let current = resolve(__dirname);
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(current, 'CLAUDE.md')) || existsSync(join(current, 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(__dirname, '..', '..');
}

function hasTraversal(rawPath) {
  return String(rawPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .some((part) => part === '..');
}

function normalizeProjectPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  if (hasTraversal(filePath)) return null;

  const absolutePath = isAbsolute(filePath) ? resolve(filePath) : resolve(PROJECT_ROOT, filePath);
  const relativePath = relative(PROJECT_ROOT, absolutePath).replace(/\\/g, '/');
  if (!relativePath || relativePath === '.') return '';
  if (relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)) return null;
  return relativePath;
}

function isSafeRuntimeTarget(filePath) {
  const normalized = normalizeProjectPath(filePath);
  return normalized === 'Harness/.runtime/current-mode.json' || normalized === 'Harness/.runtime/goals.json';
}

function readJSONFile(filePath, maxBytes = MAX_MODE_BYTES) {
  try {
    const normalized = normalizeProjectPath(filePath);
    if (!normalized) return null;
    const absolutePath = resolve(PROJECT_ROOT, normalized);
    const stat = lstatSync(absolutePath);
    if (!stat.isFile() || stat.size > maxBytes) return null;

    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    let fd;
    try {
      fd = openSync(absolutePath, constants.O_RDONLY | noFollow);
      const buffer = Buffer.alloc(maxBytes);
      const bytes = readSync(fd, buffer, 0, maxBytes, 0);
      const raw = buffer.subarray(0, bytes).toString('utf8').trim();
      if (!raw) return null;
      return JSON.parse(raw);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  } catch {
    return null;
  }
}

function writeJSONFile(filePath, value) {
  try {
    if (!isSafeRuntimeTarget(filePath)) return false;
    const normalized = normalizeProjectPath(filePath);
    const absolutePath = resolve(PROJECT_ROOT, normalized);
    mkdirSync(dirname(absolutePath), { recursive: true });
    try {
      if (lstatSync(absolutePath).isSymbolicLink()) return false;
    } catch (error) {
      if (error.code !== 'ENOENT') return false;
    }

    const tmpPath = join(dirname(absolutePath), `.${basename(absolutePath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    let fd;
    try {
      fd = openSync(tmpPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
      writeSync(fd, JSON.stringify(value, null, 2) + '\n');
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    renameSync(tmpPath, absolutePath);
    return true;
  } catch {
    return false;
  }
}

function validateMode(rawMode) {
  if (!rawMode || typeof rawMode !== 'object') return null;
  const mode = { ...rawMode };
  if (!VALID_MODES.has(mode.mode ?? null)) return null;
  if (mode.active !== undefined && typeof mode.active !== 'boolean') return null;
  if (!VALID_PHASES.has(mode.phase ?? null)) return null;
  if (mode.agentRole !== undefined && mode.agentRole !== '' && !VALID_ROLES.has(mode.agentRole)) return null;
  if (mode.role !== undefined && mode.role !== '' && !VALID_ROLES.has(mode.role)) return null;
  if (mode.explicitInvocation !== undefined && typeof mode.explicitInvocation !== 'boolean') return null;

  if (mode.agentRole === '') delete mode.agentRole;
  if (mode.role === '') delete mode.role;
  if (!mode.agentRole && mode.role) mode.agentRole = mode.role;

  if (typeof mode.taskId === 'string') {
    mode.taskId = sanitizeTaskId(mode.taskId);
  }
  if (mode.writeSet !== undefined) {
    const writeSet = parseList(mode.writeSet);
    if (!writeSet) return null;
    mode.writeSet = writeSet;
  }
  if (mode.forbidden !== undefined) {
    const forbidden = parseList(mode.forbidden);
    if (!forbidden) return null;
    mode.forbidden = forbidden;
  }
  return mode;
}

function readMode() {
  return validateMode(readJSONFile(MODE_FILE, MAX_MODE_BYTES));
}

function clearMode() {
  writeJSONFile(MODE_FILE, {
    active: false,
    mode: null,
    agentRole: null,
    phase: null,
    clearedAt: new Date().toISOString(),
  });
}

function sanitizeTaskId(value) {
  const sanitized = String(value).replace(/[^\w-]/g, '').slice(0, MAX_TASKID_BYTES);
  return sanitized || 'current';
}

function parseList(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === 'string' && item.length > 0 && item.length < 1024)) return null;
    return value.map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value !== 'string' || value.length >= 8192) return null;
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      return parseList(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  return trimmed.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeRole(role) {
  if (role === undefined || role === null || role === '') return null;
  const normalized = String(role).trim().toLowerCase();
  return VALID_ROLES.has(normalized) ? normalized : null;
}

function pickObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readDispatchContext(event) {
  const toolInput = pickObject(event.tool_input || event.input);
  const candidates = [
    pickObject(event.dispatch),
    pickObject(event.harness),
    pickObject(event.permission),
    pickObject(event.context),
    pickObject(toolInput.dispatch),
    pickObject(toolInput.harness),
    pickObject(toolInput.permission),
    event,
  ];

  const merged = {};
  for (const candidate of candidates) {
    for (const key of ['agentRole', 'role', 'writeSet', 'forbidden', 'verification', 'taskId', 'phase']) {
      if (candidate[key] !== undefined && merged[key] === undefined) {
        merged[key] = candidate[key];
      }
    }
  }

  if (process.env.HARNESS_AGENT_ROLE || process.env.HARNESS_ROLE) {
    merged.agentRole = process.env.HARNESS_AGENT_ROLE || process.env.HARNESS_ROLE;
  }
  if (process.env.HARNESS_WRITE_SET !== undefined) merged.writeSet = process.env.HARNESS_WRITE_SET;
  if (process.env.HARNESS_FORBIDDEN !== undefined) merged.forbidden = process.env.HARNESS_FORBIDDEN;
  if (process.env.HARNESS_VERIFICATION !== undefined) merged.verification = process.env.HARNESS_VERIFICATION;
  if (process.env.HARNESS_TASK_ID !== undefined) merged.taskId = process.env.HARNESS_TASK_ID;
  if (process.env.HARNESS_PHASE !== undefined) merged.phase = process.env.HARNESS_PHASE;

  const agentRole = normalizeRole(merged.agentRole ?? merged.role);
  if (!agentRole) return null;

  const writeSet = parseList(merged.writeSet);
  const forbidden = parseList(merged.forbidden);
  const verification = parseList(merged.verification);
  if (!writeSet || !forbidden || !verification) return null;

  return {
    agentRole,
    writeSet,
    forbidden,
    verification,
    taskId: typeof merged.taskId === 'string' ? sanitizeTaskId(merged.taskId) : undefined,
    phase: VALID_PHASES.has(merged.phase ?? null) ? merged.phase : undefined,
    source: 'dispatch',
  };
}

function readEmergencyEscalation(mode) {
  if (mode?.active && mode.agentRole === 'ceo-escalated') {
    return {
      agentRole: 'ceo-escalated',
      writeSet: mode.writeSet || [],
      forbidden: mode.forbidden || [],
      verification: [],
      taskId: mode.taskId,
      phase: mode.phase,
      source: 'escalation',
    };
  }
  return null;
}

function isModeActive(mode) {
  return Boolean(mode?.active && mode.mode);
}

function isTaskArtifact(relativePath) {
  return /^Harness\/tasks\/[^/]+\/(PLAN|PROGRESS|ARTIFACTS|NOTES)\.md$/.test(relativePath)
    || relativePath === 'Harness/PROGRESS.md'
    || relativePath === 'Harness/MEMORY.md'
    || /^Harness\/memory\/[^/]+\.md$/.test(relativePath);
}

function isForbiddenPath(relativePath, forbidden) {
  return forbidden.some((entry) => pathMatches(relativePath, entry));
}

function isInWriteSet(relativePath, writeSet) {
  return writeSet.some((entry) => pathMatches(relativePath, entry));
}

function pathMatches(relativePath, pattern) {
  const normalizedPattern = normalizeProjectPath(pattern);
  if (!normalizedPattern) return false;
  return relativePath === normalizedPattern || relativePath.startsWith(normalizedPattern + '/');
}

function isGuardedSourcePath(relativePath) {
  if (!relativePath) return false;
  if (relativePath.startsWith('Harness/.runtime/')) return true;
  if (isTaskArtifact(relativePath)) return false;
  return true;
}

function isSafeBash(command) {
  const trimmed = String(command || '').trim();
  if (!trimmed) return true;
  if (/[\r\n\0]/.test(trimmed)) return false;
  if (/[;&|>`$]/.test(trimmed)) return false;
  return SAFE_BASH.test(trimmed);
}

function outputContext(hookEventName, additionalContext) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName,
      additionalContext,
    },
  }));
}

function readEvent() {
  if (process.argv[3]) {
    try {
      return JSON.parse(process.argv[3]);
    } catch {
      return {};
    }
  }
  if (process.argv[2] && process.argv[2].trim().startsWith('{')) {
    try {
      return JSON.parse(process.argv[2]);
    } catch {
      return {};
    }
  }
  try {
    const raw = readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function eventName(event) {
  return event.hook_event_name || event.event || event.type || process.argv[2] || '';
}

function goalData() {
  const parsed = readJSONFile(GOALS_FILE, MAX_GOAL_BYTES);
  if (!parsed || !Array.isArray(parsed.goals)) return { goals: [] };
  parsed.goals = parsed.goals.filter((goal) =>
    goal
    && typeof goal.id === 'string'
    && typeof goal.description === 'string'
    && ['active', 'completed', 'abandoned'].includes(goal.status)
  );
  return parsed;
}

function writeGoals(data) {
  writeJSONFile(GOALS_FILE, data);
}

function activeGoalText() {
  const goals = goalData().goals.filter((goal) => goal.status === 'active');
  if (goals.length === 0) return '';
  if (goals.length === 1) return `GOAL TRACKING: Active goal [${goals[0].id}] ${goals[0].description}.`;
  return `GOAL TRACKING: Active goals ${goals.map((goal) => `[${goal.id}] ${goal.description}`).join(' | ')}.`;
}

function handleSessionStart(event) {
  let mode = readMode();
  if (mode?.active) {
    const startedAt = Date.parse(mode.startedAt || '');
    if (!startedAt || Date.now() - startedAt > STALE_MODE_MS) {
      clearMode();
      mode = null;
    }
  }
  if (!isModeActive(mode)) return;

  const dispatch = readDispatchContext(event);
  const role = dispatch?.agentRole || mode.agentRole || mode.role || 'observer';
  const phase = dispatch?.phase || mode.phase || 'W0_EXPLORE';
  const taskId = dispatch?.taskId || mode.taskId || 'current';

  if (mode.mode === 'wf-review') {
    outputContext('SessionStart', `WF-REVIEW MODE ACTIVE\nTask: ${taskId} | Phase: ${phase}\nUse the OTHER CLI. Never self-review.`);
    return;
  }

  if (mode.mode === 'wf-max') {
    const writeSet = dispatch?.writeSet?.length ? `\nwriteSet: ${dispatch.writeSet.join(', ')}` : '';
    outputContext('SessionStart', `WF-MAX ACTIVE\nTask: ${taskId} | Phase: ${phase}\nRole: ${role}${writeSet}\nMode file is status only; dispatch context grants source-write authority.`);
    return;
  }

  outputContext('SessionStart', `${String(mode.mode).toUpperCase()} ACTIVE\nTask: ${taskId} | Phase: ${phase}`);
}

function handleGoalCommands(prompt) {
  const setMatch = prompt.match(/(?:^|\n)\s*goal\s+set\s+(.+)/i);
  const completeMatch = prompt.match(/(?:^|\n)\s*goal\s+complete\s+(\S+)/i);
  const abandonMatch = prompt.match(/(?:^|\n)\s*goal\s+abandon\s+(\S+)/i);

  if (setMatch) {
    const data = goalData();
    data.goals.push({
      id: 'g' + Date.now().toString(36),
      description: setMatch[1].trim().slice(0, MAX_GOAL_DESC),
      status: 'active',
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    writeGoals(data);
  }

  for (const [match, status] of [[completeMatch, 'completed'], [abandonMatch, 'abandoned']]) {
    if (!match) continue;
    const data = goalData();
    const goal = data.goals.find((item) => item.id === match[1] && item.status === 'active');
    if (goal) {
      goal.status = status;
      goal.completedAt = new Date().toISOString();
      writeGoals(data);
    }
  }
}

function handleEscalationCommands(prompt) {
  if (/(?:^|\n)\s*ceo\s+done\b/i.test(prompt)) {
    clearMode();
    return true;
  }

  const escalateMatch = prompt.match(/(?:^|\n)\s*ceo\s+escalate\s+(\S+(?:\s*,\s*\S+)*)(?:\s+"(.+?)")?/i);
  if (escalateMatch) {
    const mode = readMode();
    const files = parseList(escalateMatch[1]);
    if (!mode?.active || !files || files.length !== MAX_ESCALATION_FILES || files.some((file) => !normalizeProjectPath(file))) {
      outputContext('UserPromptSubmit', 'CEO escalation denied. Provide exactly one project-relative file path.');
      return true;
    }
    writeJSONFile(MODE_FILE, {
      ...mode,
      agentRole: 'ceo-escalated',
      writeSet: files,
      escalationReason: (escalateMatch[2] || 'Worker retry limit exceeded').slice(0, 200),
      escalatedAt: new Date().toISOString(),
    });
    outputContext('UserPromptSubmit', `CEO escalation active for ${files[0]}. Say "ceo deescalate" when finished.`);
    return true;
  }

  if (/(?:^|\n)\s*ceo\s+deescalate\b/i.test(prompt)) {
    const mode = readMode();
    if (mode?.active) {
      const { writeSet, forbidden, escalationReason, escalatedAt, ...rest } = mode;
      writeJSONFile(MODE_FILE, {
        ...rest,
        agentRole: 'ceo',
        deescalatedAt: new Date().toISOString(),
      });
    }
    outputContext('UserPromptSubmit', 'CEO escalation cleared. Source writes are blocked again.');
    return true;
  }

  return false;
}

function detectMode(prompt) {
  const lower = prompt.toLowerCase();
  const configs = [
    { triggers: ['/wf-auto-spark', 'wf auto spark', 'spark mode'], mode: 'wf-auto-spark', taskId: 'wf-auto-spark-current', phase: 'SPARK' },
    { triggers: ['/wf-max', 'wf max'], mode: 'wf-max', taskId: 'wf-max-current-task', phase: 'W0_EXPLORE' },
    { triggers: ['/wf-auto', 'wf auto', 'auto mode'], mode: 'wf-auto', taskId: 'wf-auto-current', phase: 'AUTO' },
    { triggers: ['/wf-review', 'wf review'], mode: 'wf-review', taskId: 'wf-review-current', phase: 'REVIEW' },
    { triggers: ['/wf-learn', 'wf learn'], mode: 'wf-learn', taskId: 'wf-learn-current', phase: 'LEARN' },
    { triggers: ['/wf', 'wf mode', 'workflow mode', 'wk mode'], mode: 'wf', taskId: 'wf-current-task', phase: 'W0_EXPLORE' },
  ];

  for (const config of configs) {
    if (config.triggers.some((trigger) => lower.includes(trigger))) {
      writeJSONFile(MODE_FILE, {
        active: true,
        mode: config.mode,
        agentRole: 'ceo',
        taskId: config.taskId,
        phase: config.phase,
        explicitInvocation: true,
        startedAt: new Date().toISOString(),
      });
      return config;
    }
  }
  return null;
}

function handleUserPromptSubmit(event) {
  const prompt = String(event.prompt || event.text || '').trim();
  if (!prompt) return;

  handleGoalCommands(prompt);
  if (handleEscalationCommands(prompt)) return;
  detectMode(prompt);

  const goalText = activeGoalText();
  const mode = readMode();
  if (!goalText && !isModeActive(mode)) return;

  const dispatch = readDispatchContext(event);
  const contextLines = [];
  if (goalText) contextLines.push(goalText);
  if (isModeActive(mode)) {
    if (mode.mode === 'wf-review') {
      contextLines.push('WF-REVIEW ACTIVE. Use the OTHER CLI. Never self-review.');
    } else if (mode.mode === 'wf-max') {
      const role = dispatch?.agentRole || mode.agentRole || 'observer';
      contextLines.push(`WF-MAX ACTIVE. Role: ${role}. Source-write authority comes from dispatch context, not the mode file.`);
    } else {
      contextLines.push(`${String(mode.mode).toUpperCase()} ACTIVE.`);
    }
  }
  if (contextLines.length) outputContext('UserPromptSubmit', contextLines.join('\n'));
}

function allowTaskArtifact(agentRole, relativePath) {
  if (!isTaskArtifact(relativePath)) return false;
  return agentRole === 'ceo' || agentRole === 'manager' || agentRole === 'ceo-escalated';
}

function block(message) {
  process.stderr.write(message + '\n');
  process.exit(2);
}

function enforceFileTool(agentRole, relativePath, context) {
  if (!relativePath) block('[BLOCK] Invalid or unsafe file path.');
  if (isForbiddenPath(relativePath, context.forbidden || [])) {
    block(`[FORBIDDEN BLOCK] ${relativePath} matches forbidden scope.`);
  }
  if (!isGuardedSourcePath(relativePath) && allowTaskArtifact(agentRole, relativePath)) return;

  if (agentRole === 'reviewer') {
    block(`[REVIEWER BLOCK] ${relativePath} cannot be edited by reviewer.`);
  }
  if (agentRole === 'ceo') {
    block(`[CEO BLOCK] ${relativePath} is a source write. Delegate to a Worker or use ceo escalate <file>.`);
  }
  if (agentRole === 'worker' || agentRole === 'manager' || agentRole === 'ceo-escalated') {
    if (isInWriteSet(relativePath, context.writeSet || [])) return;
    const label = agentRole === 'ceo-escalated' ? 'ESCALATED BLOCK' : `${agentRole.toUpperCase()} BLOCK`;
    block(`[${label}] ${relativePath} is outside writeSet [${(context.writeSet || []).join(', ')}].`);
  }
  block(`[ROLE BLOCK] ${relativePath} blocked for role ${agentRole}.`);
}

function enforceBash(agentRole, command) {
  if (isSafeBash(command)) return;
  block(`[${agentRole.toUpperCase()} BLOCK] Bash command is outside the safe command policy.`);
}

function handlePreToolUse(event) {
  const mode = readMode();
  const dispatch = readDispatchContext(event);
  const emergencyEscalation = dispatch ? null : readEmergencyEscalation(mode);
  const context = dispatch || emergencyEscalation;

  if (!context && !isModeActive(mode)) return;

  const toolName = event.tool_name || event.tool || '';
  if (!GUARDED_TOOLS.has(toolName)) return;

  const toolInput = pickObject(event.tool_input || event.input);
  const command = toolInput.command || '';
  const relativePath = normalizeProjectPath(toolInput.file_path || '');

  if (!context) {
    if (toolName === 'Bash' && isSafeBash(command)) return;
    if (relativePath && isTaskArtifact(relativePath)) return;
    block(`[WF-MAX BLOCK] ${toolName} blocked: no dispatch role/writeSet authority is present.`);
  }

  if (toolName === 'Bash') {
    enforceBash(context.agentRole, command);
    return;
  }

  enforceFileTool(context.agentRole, relativePath, context);
}

function handlePostToolUse() {
  return;
}

function handleStop() {
  return;
}

const event = readEvent();

switch (eventName(event)) {
  case 'SessionStart':
    handleSessionStart(event);
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
