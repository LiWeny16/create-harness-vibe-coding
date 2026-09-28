#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  readTaskState,
  writeTaskStateAtomic,
} from './task-state.mjs';
import { scopedPath, scopedProject } from './lib/path-scope.mjs';
import { aggregateBlockers as routeAggregateBlockers } from './lib/task-route.mjs';

const CONTEXT_KEYS = [
  'intent', 'constraints', 'facts', 'assumptions', 'decisions',
  'evidence', 'attempts', 'handoff',
];
const ARRAY_KEYS = ['constraints', 'facts', 'assumptions', 'decisions', 'evidence', 'attempts'];
const RESERVED_TASK_NAMES = new Set(['_template', '_archive', 'continuous']);

class ContextError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContextError';
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, field, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ContextError(`${field} must be a string`);
    return '';
  }
  if (typeof value !== 'string') throw new ContextError(`${field} must be a string`);
  return value.trim();
}

function stringList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new ContextError(`${field} must be an array of strings`);
  }
  return value.map(item => item.trim()).filter(Boolean);
}

function ensureObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContextError(`${field} must be an object`);
  }
  return value;
}

function ensureKnown(value, allowed, field, strict) {
  if (!strict) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ContextError(`${field}.${key} is not supported`);
  }
}

function applicability(item, field) {
  const result = {};
  if (item.roles !== undefined) result.roles = stringList(item.roles, `${field}.roles`);
  if (item.workItems !== undefined) result.workItems = stringList(item.workItems, `${field}.workItems`);
  return result;
}

function normalizeItems(value, field, kind, strict, { partial = false } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ContextError(`${field} must be an array`);
  return value.map((raw, index) => {
    const item = ensureObject(raw, `${field}[${index}]`);
    const itemField = `${field}[${index}]`;
    const has = key => Object.prototype.hasOwnProperty.call(item, key);
    const id = text(item.id, `${itemField}.id`, { required: true });
    if (kind === 'fact') {
      ensureKnown(item, ['id', 'text', 'source', 'status', 'roles', 'workItems'], itemField, strict);
      const result = { id };
      if (!partial || has('text')) result.text = text(item.text, `${itemField}.text`, { required: !partial });
      if (!partial || has('source')) result.source = text(item.source, `${itemField}.source`);
      if (!partial || has('status')) result.status = text(item.status, `${itemField}.status`) || 'unconfirmed';
      Object.assign(result, applicability(item, itemField));
      return result;
    }
    if (kind === 'assumption') {
      ensureKnown(item, ['id', 'text', 'status', 'evidenceRefs', 'roles', 'workItems'], itemField, strict);
      const result = { id };
      if (!partial || has('text')) result.text = text(item.text, `${itemField}.text`, { required: !partial });
      if (!partial || has('status')) result.status = text(item.status, `${itemField}.status`) || 'open';
      if (!partial || has('evidenceRefs')) result.evidenceRefs = stringList(item.evidenceRefs, `${itemField}.evidenceRefs`);
      Object.assign(result, applicability(item, itemField));
      return result;
    }
    if (kind === 'decision') {
      ensureKnown(item, ['id', 'decision', 'reason', 'rejectedAlternatives', 'evidenceRefs', 'roles', 'workItems'], itemField, strict);
      const result = { id };
      if (!partial || has('decision')) result.decision = text(item.decision, `${itemField}.decision`, { required: !partial });
      if (!partial || has('reason')) result.reason = text(item.reason, `${itemField}.reason`);
      if (!partial || has('rejectedAlternatives')) result.rejectedAlternatives = stringList(item.rejectedAlternatives, `${itemField}.rejectedAlternatives`);
      if (!partial || has('evidenceRefs')) result.evidenceRefs = stringList(item.evidenceRefs, `${itemField}.evidenceRefs`);
      Object.assign(result, applicability(item, itemField));
      return result;
    }
    if (kind === 'evidence') {
      ensureKnown(item, ['id', 'path', 'url', 'path/url', 'claim', 'status', 'roles', 'workItems'], itemField, strict);
      const result = { id };
      const hasPath = has('path');
      const hasUrl = has('url');
      const hasLegacyLocation = has('path/url');
      const evidencePath = hasPath ? text(item.path, `${itemField}.path`) : '';
      const url = hasUrl ? text(item.url, `${itemField}.url`) : '';
      const legacyLocation = hasLegacyLocation ? text(item['path/url'], `${itemField}.path/url`) : '';
      if (evidencePath) result.path = evidencePath;
      if (url) result.url = url;
      if (!evidencePath && !url && legacyLocation) {
        if (/^[a-z][a-z\d+.-]*:\/\//i.test(legacyLocation)) result.url = legacyLocation;
        else result.path = legacyLocation;
      }
      if (!partial && !result.path && !result.url) throw new ContextError(`${itemField} requires path or url`);
      if (partial && (hasPath || hasUrl || hasLegacyLocation) && !result.path && !result.url) {
        throw new ContextError(`${itemField} requires a non-empty path or url`);
      }
      if (!partial || has('claim')) result.claim = text(item.claim, `${itemField}.claim`);
      if (!partial || has('status')) result.status = text(item.status, `${itemField}.status`) || 'unverified';
      Object.assign(result, applicability(item, itemField));
      return result;
    }
    ensureKnown(item, ['id', 'action', 'outcome', 'evidenceRefs', 'roles', 'workItems'], itemField, strict);
    const result = { id };
    if (!partial || has('action')) result.action = text(item.action, `${itemField}.action`, { required: !partial });
    if (!partial || has('outcome')) result.outcome = text(item.outcome, `${itemField}.outcome`);
    if (!partial || has('evidenceRefs')) result.evidenceRefs = stringList(item.evidenceRefs, `${itemField}.evidenceRefs`);
    Object.assign(result, applicability(item, itemField));
    return result;
  });
}

function normalizeContext(raw, { strict = false, partial = false } = {}) {
  const source = raw === undefined || raw === null ? {} : ensureObject(raw, 'context');
  ensureKnown(source, CONTEXT_KEYS, 'context', strict);
  const out = {};

  if (source.intent !== undefined) {
    const intent = ensureObject(source.intent, 'context.intent');
    ensureKnown(intent, ['original', 'current', 'changes'], 'context.intent', strict);
    out.intent = {
      ...(intent.original !== undefined ? { original: text(intent.original, 'context.intent.original') } : {}),
      ...(intent.current !== undefined ? { current: text(intent.current, 'context.intent.current') } : {}),
      ...((!partial || intent.changes !== undefined) ? { changes: (intent.changes === undefined ? [] : intent.changes).map((change, index) => {
        const item = ensureObject(change, `context.intent.changes[${index}]`);
        ensureKnown(item, ['summary', 'reason', 'source'], `context.intent.changes[${index}]`, strict);
        return {
          summary: text(item.summary, `context.intent.changes[${index}].summary`, { required: true }),
          reason: text(item.reason, `context.intent.changes[${index}].reason`),
          source: text(item.source, `context.intent.changes[${index}].source`),
        };
      }) } : {}),
    };
  }
  if (source.constraints !== undefined) out.constraints = stringList(source.constraints, 'context.constraints');
  if (source.facts !== undefined) out.facts = normalizeItems(source.facts, 'context.facts', 'fact', strict, { partial });
  if (source.assumptions !== undefined) out.assumptions = normalizeItems(source.assumptions, 'context.assumptions', 'assumption', strict, { partial });
  if (source.decisions !== undefined) out.decisions = normalizeItems(source.decisions, 'context.decisions', 'decision', strict, { partial });
  if (source.evidence !== undefined) out.evidence = normalizeItems(source.evidence, 'context.evidence', 'evidence', strict, { partial });
  if (source.attempts !== undefined) out.attempts = normalizeItems(source.attempts, 'context.attempts', 'attempt', strict, { partial });
  if (source.handoff !== undefined) {
    const handoff = ensureObject(source.handoff, 'context.handoff');
    ensureKnown(handoff, ['summary', 'unresolved'], 'context.handoff', strict);
    out.handoff = partial
      ? {
        ...(handoff.summary !== undefined ? { summary: text(handoff.summary, 'context.handoff.summary') } : {}),
        ...(handoff.unresolved !== undefined ? { unresolved: stringList(handoff.unresolved, 'context.handoff.unresolved') } : {}),
      }
      : {
        summary: text(handoff.summary, 'context.handoff.summary'),
        unresolved: stringList(handoff.unresolved, 'context.handoff.unresolved'),
      };
  }
  return out;
}

function completeContext(raw) {
  const source = normalizeContext(raw, { strict: false });
  return {
    intent: {
      original: source.intent?.original || '',
      current: source.intent?.current || source.intent?.original || '',
      changes: source.intent?.changes || [],
    },
    constraints: source.constraints || [],
    facts: source.facts || [],
    assumptions: source.assumptions || [],
    decisions: source.decisions || [],
    evidence: source.evidence || [],
    attempts: source.attempts || [],
    handoff: source.handoff || { summary: '', unresolved: [] },
  };
}

function mergeById(existing, incoming) {
  const result = (existing || []).map(clone);
  const positions = new Map(result.map((item, index) => [item.id, index]));
  for (const item of incoming || []) {
    if (positions.has(item.id)) result[positions.get(item.id)] = { ...result[positions.get(item.id)], ...clone(item) };
    else {
      positions.set(item.id, result.length);
      result.push(clone(item));
    }
  }
  return result;
}

function mergeContext(existingRaw, incomingRaw, warnings, { fallbackOriginal = '' } = {}) {
  const existing = completeContext(existingRaw);
  const incoming = normalizeContext(incomingRaw, { strict: true, partial: true });
  const merged = clone(existing);
  if (!merged.intent.original) {
    const existingCurrent = existing.intent.current;
    const explicitOriginal = incoming.intent?.original || '';
    const firstCurrent = incoming.intent?.current || '';
    const original = existingCurrent || explicitOriginal || firstCurrent || text(fallbackOriginal, 'canonical PLAN goal');
    if (!original) throw new ContextError('context intent original cannot be established: provide intent.original, intent.current, or a non-empty canonical PLAN goal');
    merged.intent.original = original;
  }
  if (incoming.intent) {
    if (incoming.intent.original && merged.intent.original && incoming.intent.original !== merged.intent.original) {
      warnings.push('context.intent.original is immutable; incoming replacement was retained as a change, not applied');
      const change = {
        summary: 'Original intent replacement rejected',
        reason: `Incoming original differed from immutable value: ${incoming.intent.original}`,
        source: 'task-context.update',
      };
      if (!merged.intent.changes.some(item => item.summary === change.summary && item.reason === change.reason)) merged.intent.changes.push(change);
    }
    if (incoming.intent.current !== undefined) merged.intent.current = incoming.intent.current;
    for (const change of incoming.intent.changes || []) {
      if (!merged.intent.changes.some(item => JSON.stringify(item) === JSON.stringify(change))) merged.intent.changes.push(change);
    }
  }
  if (Object.prototype.hasOwnProperty.call(incoming, 'constraints') && incoming.constraints.length === 0) {
    merged.constraints = [];
  } else if (incoming.constraints) {
    for (const constraint of incoming.constraints) if (!merged.constraints.includes(constraint)) merged.constraints.push(constraint);
  }
  for (const key of ARRAY_KEYS.slice(1)) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
    merged[key] = incoming[key].length === 0 ? [] : mergeById(merged[key], incoming[key]);
  }
  if (incoming.handoff) merged.handoff = { ...merged.handoff, ...clone(incoming.handoff) };
  if (!merged.intent.current) merged.intent.current = merged.intent.original;

  // A fact without a source cannot be represented as confirmed/verified.
  for (const fact of merged.facts) {
    if (!fact.source && ['verified', 'confirmed'].includes(fact.status.toLowerCase())) {
      fact.status = 'unconfirmed';
      warnings.push(`fact ${fact.id} has no source; status downgraded to unconfirmed`);
    }
  }
  normalizeContext(merged, { strict: true });
  return merged;
}

function projectInfo(projectRoot) {
  let project;
  try { project = scopedProject(projectRoot); }
  catch (error) { throw new ContextError(error.message); }
  const tasks = path.join(project, 'Harness', 'tasks');
  try { scopedPath(project, tasks, { mustExist: true, label: 'Harness/tasks' }); }
  catch (error) { throw new ContextError(error.message); }
  return { project, tasks };
}

function validateTaskId(taskId, tasksDir) {
  if (!taskId || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(taskId) || RESERVED_TASK_NAMES.has(taskId)) {
    throw new ContextError(`Invalid task id "${taskId || ''}"; path traversal is not allowed`);
  }
  const taskDir = path.resolve(tasksDir, taskId);
  try { scopedPath(tasksDir, taskDir, { label: 'Task path' }); }
  catch (error) { throw new ContextError(error.message); }
  return taskDir;
}

function loadTask(projectRoot, taskId) {
  const { project, tasks } = projectInfo(projectRoot);
  const taskDir = validateTaskId(taskId, tasks);
  try { scopedPath(tasks, path.join(taskDir, 'STATE.json'), { mustExist: true, label: 'Task STATE.json' }); }
  catch (error) { throw new ContextError(error.message); }
  const read = readTaskState(project, taskId);
  if (read.error) throw new ContextError(read.error);
  if (!read.state) throw new ContextError(`Task "${taskId}" not found under ${tasks}`);
  return { project, tasks, taskDir, statePath: read.path, state: read.state };
}

function readPlanGoal(taskDir, state) {
  const planPath = path.join(taskDir, 'PLAN.md');
  if (fs.existsSync(planPath)) {
    scopedPath(taskDir, planPath, { mustExist: true, label: 'Task PLAN.md' });
    const plan = fs.readFileSync(planPath, 'utf8');
    const match = plan.match(/(?:^|\n)##\s+Goal\s*\r?\n+([^\r\n#]+)/i);
    if (match?.[1]?.trim()) return match[1].trim();
    const titleGoal = plan.match(/^Goal:\s*(.+)$/mi);
    if (titleGoal?.[1]?.trim()) return titleGoal[1].trim();
  }
  return text(state.goal, 'state.goal') || '';
}

function contextForRead(task) {
  if (task.state.context !== undefined && task.state.context !== null) return completeContext(task.state.context);
  const goal = readPlanGoal(task.taskDir, task.state) || `Resume task ${task.state.taskId || ''}`.trim();
  return completeContext({
    intent: { original: goal, current: goal, changes: [] },
    handoff: { summary: 'Legacy context reconstructed read-only from PLAN.md/STATE.json', unresolved: [] },
  });
}

function parseArgs(argv) {
  const command = argv[0] || '';
  const taskId = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
  const values = {};
  const flags = new Set();
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const equals = arg.indexOf('=');
    if (equals > -1) {
      values[arg.slice(0, equals)] = arg.slice(equals + 1);
    } else if (['--project', '--input', '--role', '--work-item', '--budget-bytes'].includes(arg)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new ContextError(`${arg} requires a value`);
      values[arg] = argv[++i];
    } else flags.add(arg);
  }
  return { command, taskId, values, flags };
}

function budgetValue(raw, required) {
  if (raw === undefined) {
    if (required) throw new ContextError('--budget-bytes is required');
    return null;
  }
  if (!/^\d+$/.test(String(raw))) throw new ContextError('--budget-bytes must be a non-negative integer');
  const budget = Number(raw);
  if (!Number.isSafeInteger(budget)) throw new ContextError('--budget-bytes is out of range');
  return budget;
}

function readInput(inputPath, projectRoot) {
  if (!inputPath) throw new ContextError('--input is required for update');
  const candidate = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(projectRoot, inputPath);
  try {
    scopedPath(projectRoot, candidate, { mustExist: true, label: '--input' });
    return JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch (err) {
    throw new ContextError(`Unable to read --input JSON: ${err.message}`);
  }
}

function validateUpdateInput(input) {
  const source = ensureObject(input, 'input');
  ensureKnown(source, ['context', 'nextAction'], 'input', true);
  if (source.context === undefined && source.nextAction === undefined) throw new ContextError('input requires context or root nextAction');
  if (source.nextAction !== undefined) text(source.nextAction, 'input.nextAction', { required: true });
  if (source.context !== undefined) normalizeContext(source.context, { strict: true, partial: true });
  return source;
}

function updateTask(projectRoot, taskId, inputPath, apply) {
  const task = loadTask(projectRoot, taskId);
  const input = validateUpdateInput(readInput(inputPath, task.project));
  const warnings = [];
  const updated = clone(task.state);
  if (input.context !== undefined) {
    updated.context = mergeContext(updated.context, input.context, warnings, {
      fallbackOriginal: readPlanGoal(task.taskDir, task.state),
    });
  }
  if (input.nextAction !== undefined) updated.nextAction = text(input.nextAction, 'input.nextAction', { required: true });
  if (!updated.nextAction) updated.nextAction = readPlanGoal(task.taskDir, updated) || 'Review task state.';
  updated.updatedAt = new Date().toISOString();
  if (apply) writeTaskStateAtomic(task.project, taskId, updated);
  return {
    ok: true,
    command: 'update',
    action: apply ? 'updated' : 'dry-run',
    dryRun: !apply,
    taskId,
    state: updated,
    warnings,
  };
}

function showTask(projectRoot, taskId) {
  const task = loadTask(projectRoot, taskId);
  const context = contextForRead(task);
  return {
    ok: true,
    command: 'show',
    taskId,
    state: task.state,
    context,
    nextAction: task.state.nextAction || 'Review task state.',
    legacyContext: task.state.context === undefined || task.state.context === null,
    warnings: [],
  };
}

function appliesTo(item, role, workItem) {
  const roles = item.roles ?? item.role;
  const workItems = item.workItems ?? item.workItemIds ?? item.workItemId ?? item.workItem;
  const roleList = roles === undefined ? null : (Array.isArray(roles) ? roles : [roles]).map(String);
  const workList = workItems === undefined ? null : (Array.isArray(workItems) ? workItems : [workItems]).map(String);
  return (!roleList || roleList.length === 0 || roleList.includes(role))
    && (!workList || workList.length === 0 || (workItem && workList.includes(workItem)));
}

function formatList(values, formatter = value => String(value)) {
  return values.length ? values.map(value => `- ${formatter(value)}`).join('\n') : '- (none)';
}

function packSection(title, body) {
  return `## ${title}\n${body}\n`;
}

function buildTaskHeader(projectRoot, task) {
  // task-route.mjs is the unified blocker source. It validates task ids
  // strictly; malformed ids fall through to a header with no blockers so
  // the pack remains available for inspection.
  let blockers = [];
  try {
    const blockerItems = routeAggregateBlockers(projectRoot, task.state.taskId);
    blockers = (blockerItems.items || []).map(item => String(item.text));
  } catch {
    blockers = [];
  }
  const dependencies = task.state.links?.dependsOn || [];
  return buildTaskHeaderText(task.state, blockers, dependencies);
}

function buildTaskHeaderText(state, blockers, dependencies) {
  const status = String(state.status || 'active');
  const phase = String(state.phase || '-');
  const gate = state.gate ? String(state.gate) : '-';
  const nextAction = state.nextAction || '';
  const lines = [];
  lines.push('## Task Header');
  lines.push(`- status: ${status}`);
  lines.push(`- phase: ${phase}`);
  lines.push(`- gate: ${gate}`);
  if (state.activeQuestion) lines.push(`- activeQuestion: ${state.activeQuestion}`);
  if (nextAction) lines.push(`- nextAction: ${nextAction}`);
  if (blockers.length > 0) {
    lines.push('- blockers:');
    for (const b of blockers) lines.push(`  - ${b}`);
  }
  if (dependencies.length > 0) {
    lines.push(`- dependencies: ${dependencies.join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function buildTaskContextPack({ projectRoot, taskId, role, workItem = '', budgetBytes, input } = {}) {
  if (!role || typeof role !== 'string') throw new ContextError('pack requires --role');
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0) throw new ContextError('--budget-bytes must be a non-negative integer');
  const task = loadTask(projectRoot, taskId);
  let context = contextForRead(task);
  let nextAction = task.state.nextAction || 'Review task state.';
  if (input && typeof input === 'object') {
    if (input.context !== undefined) context = mergeContext(context, input.context, [], {
      fallbackOriginal: readPlanGoal(task.taskDir, task.state),
    });
    if (typeof input.nextAction === 'string' && input.nextAction.trim()) nextAction = input.nextAction.trim();
  }

  const header = buildTaskHeader(projectRoot, task);

  const filtered = {};
  for (const key of ['facts', 'assumptions', 'decisions', 'attempts', 'evidence']) filtered[key] = context[key].filter(item => appliesTo(item, role, workItem));
  const unresolved = [...context.handoff.unresolved];
  for (const assumption of filtered.assumptions) {
    if (assumption.status && !['resolved', 'verified', 'closed'].includes(assumption.status.toLowerCase()) && !unresolved.includes(assumption.text)) unresolved.push(assumption.text);
  }

  const mandatory = [
    header,
    packSection('Current Intent', context.intent.current || context.intent.original || task.state.goal || 'No intent recorded.'),
    packSection('Constraints', formatList(context.constraints)),
    packSection('Unresolved', formatList(unresolved)),
    packSection('Next Action', nextAction),
  ];
  const mandatoryText = mandatory.join('');
  const mandatoryBytes = Buffer.byteLength(mandatoryText, 'utf8');
  if (mandatoryBytes > budgetBytes) throw new ContextError(`Minimum required context cannot fit budget: requires ${mandatoryBytes} UTF-8 bytes, limit is ${budgetBytes}`);

  let pack = mandatoryText;
  const omitted = [];
  const references = [];
  const optional = [
    ['Facts', filtered.facts, item => `[${item.id}] ${item.text} (${item.status}; source: ${item.source || 'unconfirmed'})`, 'facts'],
    ['Assumptions', filtered.assumptions, item => `[${item.id}] ${item.text} (${item.status})`, 'assumptions'],
    ['Decisions', filtered.decisions, item => `[${item.id}] ${item.decision}${item.reason ? ` -- ${item.reason}` : ''}${item.rejectedAlternatives.length ? `; rejected: ${item.rejectedAlternatives.join(', ')}` : ''}`, 'decisions'],
    ['Attempts', filtered.attempts, item => `[${item.id}] ${item.action} -> ${item.outcome}`, 'attempts'],
    ['Evidence Pointers', filtered.evidence, item => `[${item.id}] ${item.path || item.url}${item.claim ? ` -- ${item.claim}` : ''} (${item.status})`, 'evidence'],
    ['Handoff', context.handoff.summary ? [context.handoff.summary] : [], item => String(item), 'handoff'],
  ];
  for (const [title, items, formatter, key] of optional) {
    const section = packSection(title, formatList(items, formatter));
    if (Buffer.byteLength(pack + section, 'utf8') <= budgetBytes) {
      pack += section;
      if (key === 'evidence') for (const evidence of items) references.push(evidence.id);
    } else {
      omitted.push(`${key}: omitted because it would exceed the byte budget`);
    }
  }
  if (context.facts.length !== filtered.facts.length || context.assumptions.length !== filtered.assumptions.length || context.decisions.length !== filtered.decisions.length || context.attempts.length !== filtered.attempts.length || context.evidence.length !== filtered.evidence.length) {
    omitted.push('role/work-item filtered entries: excluded because they are not applicable');
  }
  const usedBytes = Buffer.byteLength(pack, 'utf8');
  const hash = `sha256:${crypto.createHash('sha256').update(pack, 'utf8').digest('hex')}`;
  return {
    taskId,
    role,
    pack,
    references,
    omitted,
    budget: { limitBytes: budgetBytes, usedBytes },
    hash,
  };
}

function printPayload(payload, jsonOutput) {
  if (jsonOutput || payload.command === 'pack' || payload.ok === false) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(payload.message || `${payload.command}: ${payload.action || 'ok'}`);
}

async function main(argv = process.argv.slice(2)) {
  const { command, taskId, values, flags } = parseArgs(argv);
  const jsonOutput = flags.has('--json');
  if (!['update', 'show', 'pack'].includes(command)) throw new ContextError('Usage: node Harness/scripts/task-context.mjs update|show|pack <taskId> --project <absolutePath> [--input FILE] [--role ROLE] [--work-item ID] [--budget-bytes N] [--apply] [--json]');
  if (!taskId) throw new ContextError(`${command} requires <task-id>`);
  const projectRoot = values['--project'];
  const project = projectInfo(projectRoot).project;
  validateTaskId(taskId, path.join(project, 'Harness', 'tasks'));
  if (command === 'update') {
    if (!flags.has('--apply')) {
      const payload = { ok: false, command, dryRun: true, errors: ['update requires --apply to write; no files were changed'], warnings: [] };
      printPayload(payload, jsonOutput);
      process.exitCode = 1;
      return;
    }
    const payload = updateTask(project, taskId, values['--input'], true);
    printPayload(payload, jsonOutput);
    return;
  }
  if (command === 'show') {
    printPayload(showTask(project, taskId), jsonOutput);
    return;
  }
  const role = values['--role'];
  if (!role) throw new ContextError('pack requires --role');
  const budget = budgetValue(values['--budget-bytes'], true);
  let input;
  if (values['--input']) input = readInput(values['--input'], project);
  const payload = await buildTaskContextPack({ projectRoot: project, taskId, role, workItem: values['--work-item'] || '', budgetBytes: budget, input });
  printPayload(payload, true);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    const command = process.argv[2] || 'task-context';
    printPayload({ ok: false, command, errors: [err instanceof Error ? err.message : String(err)], warnings: [] }, process.argv.includes('--json'));
    process.exitCode = 1;
  });
}

export {
  buildTaskContextPack,
  completeContext,
  contextForRead,
  mergeContext,
  normalizeContext,
};
