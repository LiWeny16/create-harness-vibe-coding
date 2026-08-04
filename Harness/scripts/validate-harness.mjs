#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const strict = args.has('--strict') || args.has('--post-bootstrap');
const manifestAudit = args.has('--manifest-audit');

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: node Harness/scripts/validate-harness.mjs [--strict] [--manifest-audit]

Default mode checks scaffold structure, links, agents, and skills.
--strict also fails when project fact docs still contain unresolved {{TOKEN}} placeholders.
--manifest-audit cross-references ownership.manifest.json against disk: flags missing framework files (manifest-to-disk) and extra files in harness directories (disk-to-manifest).`);
  process.exit(0);
}

let commandSurfaceLoadError = null;

function loadCommandSurface() {
  const rel = path.join(root, 'Harness', 'specs', 'runtime', 'command-surface.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(rel, 'utf8'));
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.commands)) {
      commandSurfaceLoadError = 'Harness/specs/runtime/command-surface.json must have schemaVersion 1 and commands[]';
      return { commands: [] };
    }
    return parsed;
  } catch (err) {
    commandSurfaceLoadError = `Harness/specs/runtime/command-surface.json is not valid JSON: ${err.message}`;
    return { commands: [] };
  }
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

const commandSurface = loadCommandSurface();
const commandDefinitions = commandSurface.commands;
const commandSkillNames = commandDefinitions
  .filter(command => command.surfaces?.claudeSkill || command.surfaces?.codexSkill)
  .map(command => command.id);

const commonAgents = [
  'task-scribe',
  'codebase-explorer',
  'researcher',
  'docs-researcher',
  'planner',
  'architect',
  'test-writer',
  'implementer',
  'debugger',
  'reviewer',
  'verifier',
  'reflector',
  'memory-master',
  'context-master',
  'explore-manager',
  'architect-manager',
  'implement-manager',
  'review-manager',
];

const commonSkills = [
  'tdd',
  'subagent-orchestrator',
  'wf-agents-docs',
  ...commandSkillNames,
];

const workflowCommands = commandDefinitions
  .filter(command => command.classification === 'workflow' && command.surfaces?.claudeCommand)
  .map(command => command.id);

const directCommands = commandDefinitions
  .filter(command => command.classification === 'direct')
  .map(command => command.id);

const opencodeWorkflowCommands = commandDefinitions
  .filter(command => command.classification === 'workflow' && command.surfaces?.opencodeCommand)
  .map(command => command.id);

const cacheDisciplinedSkills = commonSkills.filter(skill => (
  skill === 'subagent-orchestrator' || skill === 'wf-agents-docs' || workflowCommands.includes(skill)
));

const memoryFiles = [
  'Harness/memory/startup-hints.md',
  'Harness/memory/routes.md',
  'Harness/memory/tool-usage-reflections.md',
  'Harness/memory/user-corrections-preferences.md',
  'Harness/memory/agent-lessons-patterns.md',
];

const required = [
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'Harness/MEMORY.md',
  'Harness/specs/workflows/WF.md',
  'Harness/specs/workflows/WF-MAX.md',
  'Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md',
  'Harness/specs/protocols/AGENT_ISOLATION.md',
  'Harness/specs/protocols/HARNESS_BRIDGE.md',
  'Harness/specs/protocols/DEBUG_PROTOCOL.md',
  'Harness/specs/protocols/MEMORY_PROTOCOL.md',
  'Harness/wf-browser/README.md',
  'Harness/templates/PRD.template.md',
  'Harness/templates/ACCEPTANCE.template.md',
  'Harness/templates/UI_CONTRACT.template.md',
  'Harness/templates/API_CONTRACT.template.md',
  'Harness/templates/TEST_PLAN.template.md',
  'Harness/templates/PLAYWRIGHT_SPEC.template.ts',
  'Harness/templates/VALIDATION_REPORT.template.md',
  ...memoryFiles,
  '.codex/config.toml',
  '.codex/hooks.json',
  'opencode.json',
  '.claude/settings.json',
  ...commandDefinitions
    .filter(command => command.surfaces?.claudeCommand)
    .map(command => `.claude/commands/${command.id}.md`),
  ...commandDefinitions
    .filter(command => command.surfaces?.opencodeCommand)
    .map(command => `.opencode/commands/${command.id}.md`),
  '.opencode/plugins/harness-wf-status.mjs',
  '.claude/rules/ecc/common.md',
  ...commonAgents.map(agent => `.claude/agents/${agent}.md`),
  ...commonAgents.map(agent => `.opencode/agents/${agent}.md`),
  ...commonSkills.map(skill => `.claude/skills/${skill}/SKILL.md`),
  ...commonSkills.map(skill => `.agents/skills/${skill}/SKILL.md`),
  'Harness/README.md',
  'Harness/settings.json',
  'Harness/specs/guides/SETUP.md',
  'Harness/PROGRESS.md',
  'Harness/specs/guides/lifecycle.md',
  'Harness/specs/runtime/subagents.md',
  'Harness/specs/runtime/dispatch.md',
  'Harness/specs/guides/extension.md',
  'Harness/specs/runtime/context-loading.md',
  'Harness/specs/runtime/command-surface.json',
  'Harness/ownership.manifest.json',
  'Harness/specs/workflows/WF-KERNEL.md',
  'Harness/specs/runtime/agent-workflow.md',
  'Harness/project/architecture.md',
  'Harness/research/README.md',
  'Harness/research/research-results.md',
  'Harness/research/PRD.md',
  'Harness/scripts/context-budget.mjs',
  'Harness/scripts/l2-cache-telemetry.mjs',
  'Harness/scripts/wf-update-check.mjs',
  'Harness/scripts/wf-update-runner.mjs',
  'Harness/scripts/wf-remove.mjs',
  'Harness/scripts/scan-clean.mjs',
  'Harness/scripts/sync-host-global.mjs',
  'Harness/scripts/task-state.mjs',
  'Harness/scripts/archive-tasks.mjs',
  'Harness/specs/workflows/WF-STATE.md',
  'Harness/specs/protocols/TASK_ARCHIVE.md',
  'Harness/.harness-version',
];

const projectFacts = [
  'Harness/PROGRESS.md',
  'Harness/research/PRD.md',
  'Harness/research/research-results.md',
  'Harness/project/architecture.md',
];

const contextPacks = [
  'Explorer Pass:',
  'Planner:',
  'Researcher:',
  'Docs Researcher:',
  'Architect:',
  'Test Writer:',
  'Implementer', // matches "Implementer:", "Implementer (Frontend):", "Implementer (Backend):"
  'Reviewer:',
  'Debugger:',
  'Verifier:',
  'Memory Master:',
  'Context Master:',
];

const durableCommunicationDocs = [
  'Harness/README.md',
  'Harness/specs/runtime/subagents.md',
  'Harness/specs/runtime/dispatch.md',
  'Harness/specs/runtime/context-loading.md',
];

const legacyRootSpecDocs = [
  'Harness/ACCEPTANCE_PROTOCOL.md',
  'Harness/AGENT_ISOLATION.md',
  'Harness/DEBUG_PROTOCOL.md',
  'Harness/ECC-GUIDE.md',
  'Harness/HARNESS_BRIDGE.md',
  'Harness/MEMORY_PROTOCOL.md',
  'Harness/SETUP.md',
  'Harness/TASK_ARCHIVE.md',
  'Harness/TDD-GUIDE.md',
  'Harness/WF-AUTO-ANGLES.md',
  'Harness/WF-AUTO-SPARK.md',
  'Harness/WF-AUTO.md',
  'Harness/WF-KERNEL.md',
  'Harness/WF-MAX.md',
  'Harness/WF-STATE.md',
  'Harness/WF.md',
  'Harness/agent-workflow.md',
  'Harness/context-loading.md',
  'Harness/dispatch.md',
  'Harness/extension.md',
  'Harness/lifecycle.md',
  'Harness/subagents.md',
];

const errors = [];

function read(rel) {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function readJson(rel) {
  const body = read(rel);
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function sameResolvedPath(a, b) {
  if (!a || !b) return false;
  const resolvedA = path.resolve(a);
  const resolvedB = path.resolve(b);
  return process.platform === 'win32'
    ? resolvedA.toLowerCase() === resolvedB.toLowerCase()
    : resolvedA === resolvedB;
}

function isGlobalRuntimeProjectStatePath(rel) {
  return rel === 'Harness/PROGRESS.md'
    || rel === 'Harness/tasks'
    || rel.startsWith('Harness/tasks/')
    || rel === 'Harness/research'
    || rel.startsWith('Harness/research/')
    || rel === 'Harness/project'
    || rel.startsWith('Harness/project/');
}

function validateRequiredFiles(files, label = 'file') {
  for (const rel of files) {
    if (!fs.existsSync(path.join(root, rel))) {
      errors.push(`missing required ${label}: ${rel}`);
    }
  }
}

function resolveMetadataPath(value) {
  if (!value || typeof value !== 'string') return '';
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

function containsPath(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  const rel = path.relative(resolvedParent, resolvedChild);
  return rel === '' || (rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveUnder(base, rel) {
  if (!rel || typeof rel !== 'string' || path.isAbsolute(rel)) return null;
  const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.some(part => part === '..')) return null;
  const resolved = path.resolve(base, ...parts);
  return containsPath(base, resolved) ? resolved : null;
}

function sha256Content(content) {
  return 'sha256-' + createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex');
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return sha256Content(fs.readFileSync(filePath, 'utf8'));
}

function sourceDestForHostFile(host, file) {
  const normalized = String(file || '').replace(/\\/g, '/');
  if (host === 'claude') {
    if (normalized === 'settings.json') return '.claude/settings.json';
    if (/^(commands|skills|agents|rules)\//.test(normalized)) return `.claude/${normalized}`;
  }
  if (host === 'codex') {
    if (normalized === 'config.toml') return '.codex/config.toml';
    if (normalized === 'hooks.json') return '.codex/hooks.json';
    if (normalized.startsWith('skills/')) return `.agents/${normalized}`;
  }
  if (host === 'opencode') {
    if (normalized === 'opencode.json') return 'opencode.json';
    if (/^(commands|agents|plugins)\//.test(normalized)) return `.opencode/${normalized}`;
  }
  return null;
}

function requireText(rel, text, label = text) {
  const body = read(rel);
  if (body && !body.includes(text)) errors.push(`${rel} missing ${label}`);
}

function forbidText(rel, text, label = text) {
  const body = read(rel);
  if (body && body.includes(text)) errors.push(`${rel} contains forbidden ${label}`);
}

const installMetadata = readJson('Harness/.harness-version');
const isGlobalInstall = installMetadata?.installScope === 'global';
const isGlobalRuntimeRoot = isGlobalInstall && sameResolvedPath(root, installMetadata.globalDir);
const isGlobalProjectBridge = isGlobalInstall && !isGlobalRuntimeRoot;

function finishValidation() {
  if (errors.length) {
    console.error(`Harness validation failed${strict ? ' (strict)' : ''}:`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Harness validation passed${strict ? ' (strict)' : ''}.`);
  if (!strict) {
    console.log('Tip: run `node Harness/scripts/validate-harness.mjs --strict` after bootstrap to check unresolved project placeholders.');
  }
}

function validateHostGlobalTargets() {
  if (!isGlobalInstall) return;

  if (installMetadata?.copyMode !== 'copy') {
    errors.push('Harness/.harness-version global install metadata must use copyMode "copy"');
  }

  const hostGlobal = installMetadata?.hostGlobal;
  if (!hostGlobal || hostGlobal.copyMode !== 'copy' || !hostGlobal.targets || typeof hostGlobal.targets !== 'object') {
    errors.push('Harness/.harness-version missing hostGlobal copy targets');
    return;
  }

  const minimumFiles = {
    claude: ['commands/wf.md', 'commands/wf-ui.md', 'skills/wf/SKILL.md', 'skills/wf-ui/SKILL.md'],
    codex: ['skills/wf/SKILL.md', 'skills/wf-ui/SKILL.md'],
    opencode: ['commands/wf.md', 'commands/wf-ui.md'],
  };
  const runtimeRoot = isGlobalRuntimeRoot ? root : resolveMetadataPath(installMetadata.globalDir);

  for (const [host, requiredFiles] of Object.entries(minimumFiles)) {
    const target = hostGlobal.targets[host];
    if (!target || typeof target !== 'object') {
      errors.push(`Harness/.harness-version missing hostGlobal target: ${host}`);
      continue;
    }

    const hostRoot = resolveMetadataPath(target.root);
    if (!hostRoot) {
      errors.push(`Harness/.harness-version hostGlobal ${host} missing root`);
      continue;
    }

    const files = Array.isArray(target.files) ? target.files : [];
    for (const requiredFile of requiredFiles) {
      if (!files.includes(requiredFile)) {
        errors.push(`Harness/.harness-version hostGlobal ${host} missing required file target: ${requiredFile}`);
      }
    }

    for (const file of files) {
      if (typeof file !== 'string' || path.isAbsolute(file) || file.split('/').includes('..')) {
        errors.push(`Harness/.harness-version hostGlobal ${host} has invalid relative file target: ${String(file)}`);
        continue;
      }
      const filePath = path.join(hostRoot, ...file.split('/'));
      let stat;
      try {
        stat = fs.lstatSync(filePath);
        if (stat.isSymbolicLink()) {
          errors.push(`host-global ${host} copied file is a symlink, not a real copy: ${file}`);
          continue;
        }
        if (!stat.isFile()) {
          errors.push(`host-global ${host} copied file is not a regular file: ${file}`);
          continue;
        }
      } catch {
        errors.push(`missing host-global ${host} copied file: ${file}`);
        continue;
      }

      const sourceDest = sourceDestForHostFile(host, file);
      const sourcePath = sourceDest && runtimeRoot ? resolveUnder(runtimeRoot, sourceDest) : null;
      if (!sourceDest || !sourcePath) {
        errors.push(`host-global ${host} copied file has no runtime source mapping: ${file}`);
        continue;
      }
      if (!fs.existsSync(sourcePath)) {
        errors.push(`host-global ${host} copied file source is missing: ${file} -> ${sourceDest}`);
        continue;
      }
      const sourceHash = sha256File(sourcePath);
      const targetHash = sha256File(filePath);
      if (sourceHash && targetHash && sourceHash !== targetHash) {
        errors.push(`host-global ${host} copied file is stale: ${file} (source ${sourceDest})`);
      }
    }
  }
}

function validateGlobalRuntimeRoot() {
  validateCommandSurface();
  validateRequiredFiles(required.filter(rel => !isGlobalRuntimeProjectStatePath(rel)), 'global-runtime file');

  for (const rel of ['Harness/PROGRESS.md', 'Harness/tasks', 'Harness/research', 'Harness/project']) {
    if (fs.existsSync(path.join(root, rel))) {
      errors.push(`global runtime must not contain project-local state: ${rel}`);
    }
  }

  if (installMetadata?.projectState?.tasks !== 'Harness/tasks/') {
    errors.push('Harness/.harness-version global runtime metadata must keep projectState.tasks project-local');
  }
  if (installMetadata?.projectState?.progress !== 'Harness/PROGRESS.md') {
    errors.push('Harness/.harness-version global runtime metadata must keep projectState.progress project-local');
  }
  if (installMetadata?.settingsScopes?.precedence?.join('>') !== 'project>global') {
    errors.push('Harness/.harness-version global runtime metadata must define project>global settings precedence');
  }

  validateHostGlobalTargets();
  requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Project/Global Settings Boundary', 'project/global settings boundary section');
  requireText('Harness/specs/guides/SETUP.md', 'copy Claude Code, Codex, and OpenCode command/skill surfaces', 'setup three-host global copy');

  finishValidation();
  process.exit(0);
}

function validateGlobalProjectBridge() {
  const bridgeRequired = [
    'AGENTS.md',
    'CLAUDE.md',
    'Harness/README.md',
    'Harness/MEMORY.md',
    'Harness/settings.json',
    'Harness/specs/guides/SETUP.md',
    'Harness/.harness-version',
    'Harness/PROGRESS.md',
    'Harness/research/README.md',
    'Harness/research/PRD.md',
    'Harness/research/research-results.md',
    'Harness/project/architecture.md',
    ...memoryFiles,
  ];

  for (const rel of bridgeRequired) {
    if (!fs.existsSync(path.join(root, rel))) {
      errors.push(`missing required global-project-bridge file: ${rel}`);
    }
  }

  const taskTemplateDir = path.join(root, 'Harness', 'tasks', '_template');
  if (!fs.existsSync(taskTemplateDir)) {
    errors.push('missing directory: Harness/tasks/_template/');
  } else {
    for (const f of ['PROGRESS.md', 'PLAN.md']) {
      if (!fs.existsSync(path.join(taskTemplateDir, f))) {
        errors.push(`missing task template file: Harness/tasks/_template/${f}`);
      }
    }
  }

  requireText('CLAUDE.md', 'global Harness runtime', 'global runtime bridge pointer');
  requireText('Harness/README.md', 'Never discover task context from the global runtime', 'project-local task authority');
  requireText('Harness/specs/guides/SETUP.md', 'Read the full setup guide from', 'global setup bridge pointer');
  requireText('Harness/MEMORY.md', 'Global memory lives under', 'global memory bridge pointer');
  validateHostGlobalTargets();

  finishValidation();
  process.exit(0);
}

function activeToml(rel) {
  return read(rel)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .join('\n');
}

function forbidActiveToml(rel, pattern, label) {
  const body = activeToml(rel);
  if (body && pattern.test(body)) errors.push(`${rel} contains active forbidden ${label}`);
}

function frontmatterField(text, field) {
  const match = text.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

function listDirectories(rel) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);
}

function listMarkdownFiles(rel) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  const normalizedRel = rel.replaceAll(path.sep, '/');
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => `${normalizedRel}/${entry.name}`);
}

// Task naming convention: task-<verb>-<noun>[-detail], kebab-case, ≤46 chars
// Prefix "task-" required for new tasks. Existing tasks without prefix grandfathered (warning only).
// Reserved: _template (system), auto (auto-mode capsule)
const TASK_NAME_RE = /^task-[a-z]+(-[a-z0-9]+){1,4}$/;
const TASK_NAME_MAX = 46; // "task-" (5) + ≤40 chars body + 1 safety = 46
const TASK_RESERVED = new Set(['_template', 'auto', '_archive', 'continuous']);
const TASK_SAFE_ARCHIVE_STATUSES = new Set(['complete', 'verified', 'archived', 'abandoned', 'obsolete', 'done', 'closed', 'closeout']);
const TASK_NEVER_ARCHIVE_STATUSES = new Set(['active', 'blocked', 'in_progress', 'running', 'pending', 'needs-user-decision']);
const TASK_PHASE_ALIASES = new Map([
  ['implementation', 'implement'],
  ['build', 'implement'],
  ['validation', 'verify'],
  ['complete', 'verified'],
  ['done', 'verified'],
  ['closed', 'closeout'],
]);
const TASK_STATUS_ALIASES = new Map([
  ['in-progress', 'in_progress'],
  ['inprogress', 'in_progress'],
  ['needs_user_decision', 'needs-user-decision'],
  ['needs-user', 'needs-user-decision'],
]);
const TASK_VALID_PHASES = new Set([
  'intake', 'clarify', 'requirements', 'prd', 'acceptance', 'plan', 'explore',
  'implement', 'verify', 'review', 'fix', 'reflect', 'closeout', 'blocked',
  'archived', 'verified',
]);
const TASK_VALID_STATUSES = new Set([...TASK_SAFE_ARCHIVE_STATUSES, ...TASK_NEVER_ARCHIVE_STATUSES, 'skipped', 'failed']);
const VALID_TASK_CAPSULE_POLICIES = new Set([
  'none',
  'required',
  'auto-capsule-required',
  'use-current-or-create-when-needed',
  'creates-or-updates',
]);

function validateTaskName(name, strict) {
  if (TASK_RESERVED.has(name)) return null;
  if (name.startsWith('_')) return `Task name "${name}" — leading underscore reserved for system dirs`;
  if (name.length > TASK_NAME_MAX) return `Task name "${name}" — ${name.length} chars, max ${TASK_NAME_MAX}`;
  if (!TASK_NAME_RE.test(name)) {
    // Grandfather: existing tasks without "task-" prefix get a warning, not an error
    if (/^[a-z]+(-[a-z0-9]+){1,4}$/.test(name)) {
      if (strict) return `Task name "${name}" — missing "task-" prefix (required for new tasks). Rename to "task-${name}".`;
      return null; // non-strict: allow grandfathered names
    }
    return `Task name "${name}" — must be task-<verb>-<noun>[-detail], kebab-case, 2-5 words after prefix`;
  }
  return null;
}

function normalizeTaskToken(value, validSet, aliasMap) {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim().toLowerCase();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '-');
  const direct = aliasMap.get(compact) || compact;
  if (validSet.has(direct)) return direct;
  const tokens = raw
    .replace(/[`*_()[\]{}:]/g, ' ')
    .replace(/[^a-z0-9_-]+/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const canonical = aliasMap.get(token) || token;
    if (validSet.has(canonical)) return canonical;
  }
  return '';
}

function normalizeTaskStatus(value) {
  return normalizeTaskToken(value, TASK_VALID_STATUSES, TASK_STATUS_ALIASES);
}

function normalizeTaskPhase(value) {
  return normalizeTaskToken(value, TASK_VALID_PHASES, TASK_PHASE_ALIASES);
}

function taskStateIssue(message) {
  if (strict) errors.push(message);
  else console.warn(`Warning: ${message}`);
}

function parseRootTaskProgress(text) {
  const activeMatch = text.match(/## Active Task\s*\r?\n+(?:\s*\r?\n)?\s*-\s*([^\r\n]+)/);
  const rawActive = activeMatch ? activeMatch[1].trim() : '';
  const activeTask = rawActive && !/^none$/i.test(rawActive) ? rawActive : null;
  const rows = [];
  const taskIndexMatch = text.match(/## Task Index\s*\r?\n([\s\S]*?)(?=\r?\n## |\s*$)/);
  if (taskIndexMatch) {
    for (const line of taskIndexMatch[1].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|')) continue;
      if (/^\|\s*-+/.test(trimmed) || /^\|\s*ID\s*\|/i.test(trimmed)) continue;
      const cells = trimmed.split('|').slice(1, -1).map(cell => cell.trim());
      if (cells.length >= 4 && cells[0]) rows.push({ id: cells[0], phase: cells[2] });
    }
  }
  return { activeTask, rows };
}

function unresolvedTemplatePlaceholders(text) {
  const placeholders = [];
  const pattern = /\{\{([^{}\r\n]+)\}\}/g;

  for (const match of text.matchAll(pattern)) {
    const token = match[1].trim();
    if (token === '...') continue;
    placeholders.push(`{{${token}}}`);
  }

  return [...new Set(placeholders)];
}

function registeredSkillFiles(...texts) {
  const files = new Set();
  const pattern = /(?:\.\.\/)?((?:\.claude|\.agents)\/skills\/[a-z0-9-]+\/SKILL\.md)/g;

  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      files.add(match[1]);
    }
  }

  return [...files].sort();
}

function registeredWorkflowFiles(...texts) {
  const files = new Set();
  const pattern = /(?:Harness\/)?workflows\/([A-Za-z0-9._-]+\.md)/g;

  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      files.add(`Harness/workflows/${match[1]}`);
    }
  }

  return [...files].sort();
}

function listedWorkflowCommands(...texts) {
  const commands = new Set();
  const pattern = /`\/(wf(?:-[a-z0-9]+)*)(?:\s+[^`]*)?`/g;

  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      const command = `/${match[1]}`;
      if (command === '/wf-help') continue;
      commands.add(command);
    }
  }

  return [...commands].sort();
}

function extractStringArray(text, name) {
  const match = text.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (!match) return null;
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]));
}

function expectedCommandAliases(id) {
  return [`/${id}`, `$${id}`, `/skills ${id}`];
}

function validateCommandSurface() {
  if (commandSurfaceLoadError) {
    errors.push(commandSurfaceLoadError);
    return;
  }

  const seen = new Set();
  const claudeRouter = read('CLAUDE.md');
  const readmeRouter = read('Harness/README.md');
  const ecc = read('.claude/rules/ecc/common.md');
  const eccExemptionLine = ecc.split(/\r?\n/).find(line => line.includes('excluding')) || '';
  const claudeHelp = read('.claude/commands/wf-help.md');
  const opencodeHelp = read('.opencode/commands/wf-help.md');
  const removeScript = read('Harness/scripts/wf-remove.mjs');
  const removeSkillRegistry = extractStringArray(removeScript, 'BUILT_IN_SKILL_NAMES');
  const removeCommandRegistry = extractStringArray(removeScript, 'BUILT_IN_COMMAND_NAMES');
  const cleanupDirs = extractStringArray(removeScript, 'CLEANUP_DIRS');

  if (!removeSkillRegistry) errors.push('Harness/scripts/wf-remove.mjs missing BUILT_IN_SKILL_NAMES registry');
  if (!removeCommandRegistry) errors.push('Harness/scripts/wf-remove.mjs missing BUILT_IN_COMMAND_NAMES registry');
  if (!cleanupDirs) errors.push('Harness/scripts/wf-remove.mjs missing CLEANUP_DIRS registry');

  for (const command of commandDefinitions) {
    const id = command?.id;
    const surfaces = command?.surfaces || {};
    if (!id || !/^wf(?:-[a-z0-9]+)*$/.test(id)) {
      errors.push(`command-surface has invalid command id: ${JSON.stringify(id)}`);
      continue;
    }
    if (seen.has(id)) errors.push(`command-surface duplicate command id: ${id}`);
    seen.add(id);

    if (!['direct', 'workflow'].includes(command.classification)) {
      errors.push(`command-surface ${id} has invalid classification: ${JSON.stringify(command.classification)}`);
    }
    if (command.entersWf !== (command.classification === 'workflow')) {
      errors.push(`command-surface ${id} entersWf must match classification`);
    }

    for (const alias of expectedCommandAliases(id)) {
      if (!Array.isArray(command.aliases) || !command.aliases.includes(alias)) {
        errors.push(`command-surface ${id} missing alias ${alias}`);
      }
    }

    const claudeCommand = `.claude/commands/${id}.md`;
    const opencodeCommand = `.opencode/commands/${id}.md`;
    const claudeSkill = `.claude/skills/${id}/SKILL.md`;
    const codexSkill = `.agents/skills/${id}/SKILL.md`;

    if (surfaces.claudeCommand && !fs.existsSync(path.join(root, claudeCommand))) {
      errors.push(`command-surface ${id} missing Claude command: ${claudeCommand}`);
    }
    if (surfaces.opencodeCommand && !fs.existsSync(path.join(root, opencodeCommand))) {
      errors.push(`command-surface ${id} missing OpenCode command: ${opencodeCommand}`);
    }
    if (surfaces.claudeSkill && !fs.existsSync(path.join(root, claudeSkill))) {
      errors.push(`command-surface ${id} missing Claude skill: ${claudeSkill}`);
    }
    if (surfaces.codexSkill && !fs.existsSync(path.join(root, codexSkill))) {
      errors.push(`command-surface ${id} missing Codex skill: ${codexSkill}`);
    }
    if (surfaces.helpRow) {
      const rowMarker = `| \`/${id}`;
      if (!claudeHelp.includes(rowMarker)) errors.push(`.claude/commands/wf-help.md missing command-surface help row for /${id}`);
      if (!opencodeHelp.includes(rowMarker)) errors.push(`.opencode/commands/wf-help.md missing command-surface help row for /${id}`);
    }

    if (command.classification === 'direct') {
      for (const alias of command.aliases || []) {
        if (!claudeRouter.includes(`\`${alias}\``)) errors.push(`CLAUDE.md missing direct/compat alias ${alias}`);
        if (!readmeRouter.includes(alias)) errors.push(`Harness/README.md missing direct/compat alias ${alias}`);
        if (!eccExemptionLine.includes(`\`${alias}\``)) errors.push(`.claude/rules/ecc/common.md missing ECC direct command exemption ${alias}`);
      }
      for (const rel of [claudeCommand, opencodeCommand]) {
        const text = read(rel);
        if (text && id !== 'wf-help') {
          if (!/direct command/i.test(text)) errors.push(`${rel} missing DIRECT command classification`);
          if (!text.includes('Do not invoke a skill')) errors.push(`${rel} missing direct no-skill boundary`);
        }
      }
    }

    if (command.classification === 'workflow') {
      for (const alias of command.aliases || []) {
        if (eccExemptionLine.includes(`\`${alias}\``)) {
          errors.push(`.claude/rules/ecc/common.md incorrectly exempts workflow command ${alias}`);
        }
      }
      for (const rel of [claudeCommand, opencodeCommand]) {
        const text = read(rel);
        if (!text) continue;
        if (!text.includes('workflow command')) errors.push(`${rel} missing workflow command classification`);
        if (!text.includes('Harness/MEMORY.md')) errors.push(`${rel} missing workflow router load`);
      }
    }

    if (['wf', 'wf-max', 'wf-command-create'].includes(id)) {
      const text = `${read(claudeCommand)}\n${read(claudeSkill)}`;
      if (!text.includes('task capsule')) errors.push(`${id} missing required task capsule instruction`);
      if (!text.includes('task-<verb>-<noun>')) errors.push(`${id} missing task id convention`);
    }

    if (surfaces.claudeSkill || surfaces.codexSkill) {
      if (removeSkillRegistry && !removeSkillRegistry.has(id)) {
        errors.push(`Harness/scripts/wf-remove.mjs BUILT_IN_SKILL_NAMES missing ${id}`);
      }
      if (cleanupDirs) {
        if (!cleanupDirs.has(`.claude/skills/${id}`)) errors.push(`Harness/scripts/wf-remove.mjs CLEANUP_DIRS missing .claude/skills/${id}`);
        if (!cleanupDirs.has(`.agents/skills/${id}`)) errors.push(`Harness/scripts/wf-remove.mjs CLEANUP_DIRS missing .agents/skills/${id}`);
      }
    }
    if ((surfaces.claudeCommand || surfaces.opencodeCommand) && removeCommandRegistry && !removeCommandRegistry.has(id)) {
      errors.push(`Harness/scripts/wf-remove.mjs BUILT_IN_COMMAND_NAMES missing ${id}`);
    }
  }

  // Validate taskCapsulePolicy enum
  for (const cmd of commandDefinitions) {
    if (!cmd.taskCapsulePolicy || !VALID_TASK_CAPSULE_POLICIES.has(cmd.taskCapsulePolicy)) {
      errors.push(`command-surface ${cmd.id}: invalid taskCapsulePolicy "${cmd.taskCapsulePolicy}". Valid: ${[...VALID_TASK_CAPSULE_POLICIES].join(', ')}`);
    }
  }
}

if (isGlobalRuntimeRoot) {
  validateGlobalRuntimeRoot();
}

if (isGlobalProjectBridge) {
  validateGlobalProjectBridge();
}

validateCommandSurface();

validateRequiredFiles(required);

for (const rel of legacyRootSpecDocs) {
  if (fs.existsSync(path.join(root, rel))) {
    errors.push(`legacy root Harness spec doc should be migrated to Harness/specs/**: ${rel}`);
  }
}

function auditManifestCoverage() {
  const manifestText = read('Harness/ownership.manifest.json');
  if (!manifestText) {
    errors.push('Harness/ownership.manifest.json not found — cannot run manifest audit');
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (err) {
    errors.push(`Harness/ownership.manifest.json is not valid JSON: ${err.message}`);
    return;
  }

  const frameworkOwned = manifest.frameworkOwned || [];
  const manifestFileSet = new Set(frameworkOwned.map(e => e && e.path).filter(Boolean));
  const preserveGlobs = manifest.preserve || [];
  const mergeSet = new Set(manifest.merge || []);

  // 1. Manifest → Disk: frameworkOwned files must exist (always checked)
  for (const entry of frameworkOwned) {
    if (!entry || typeof entry.path !== 'string') continue;
    if (!fs.existsSync(path.join(root, ...entry.path.split('/')))) {
      errors.push(`ownership manifest frameworkOwned file missing: ${entry.path}`);
    }
  }

  // 2. Only run Disk → Manifest scan when --manifest-audit is passed
  if (!manifestAudit) return;

  // Directories that Harness framework owns (for disk→manifest scan)
  const harnessOwnedDirs = [
    '.claude/agents/',
    '.claude/commands/',
    '.claude/skills/',
    '.claude/rules/ecc/',
    '.opencode/agents/',
    '.opencode/commands/',
    '.opencode/plugins/',
    '.agents/skills/',
    '.codex/',
    'Harness/scripts/',
    'Harness/specs/',
    'Harness/templates/',
    'Harness/research/',
  ];

  // Root-level harness-owned files (not in subdirectories)
  const harnessRootFiles = [
    'opencode.json',
    'AGENTS.md',
    'CLAUDE.md',
    '.claude/settings.json',
  ];

  const extraFiles = [];

  // Scan harness-owned directories
  for (const dir of harnessOwnedDirs) {
    const dirPath = path.join(root, dir);
    if (!fs.existsSync(dirPath)) continue;
    scanDir(dirPath, dir, extraFiles);
  }

  // Scan root-level harness files
  for (const rel of harnessRootFiles) {
    const filePath = path.join(root, rel);
    if (!fs.existsSync(filePath)) continue;
    if (!manifestFileSet.has(rel) && !mergeSet.has(rel)) {
      extraFiles.push(rel);
    }
  }

  // Also scan for top-level files like .harness-version, ownership.manifest.json
  const versionFile = 'Harness/.harness-version';
  if (fs.existsSync(path.join(root, versionFile)) && !manifestFileSet.has(versionFile)) {
    // .harness-version is special — always framework-owned
  }
  const manifestFile = 'Harness/ownership.manifest.json';
  if (fs.existsSync(path.join(root, manifestFile)) && !manifestFileSet.has(manifestFile)) {
    // ownership.manifest.json is special — always framework-owned
  }

  // Check if extra files are user-owned (preserve/merge) or already in manifest
  for (const file of extraFiles) {
    // Skip files already registered in the manifest (correctly tracked)
    if (manifestFileSet.has(file)) continue;

    const isPreserve = preserveGlobs.some(g => {
      const re = new RegExp('^' + g.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
      return re.test(file);
    });
    if (isPreserve || mergeSet.has(file)) continue; // User file, skip

    // Check if it's in the .harness-version checksums (tracked but maybe not in manifest)
    const checksums = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(root, 'Harness', '.harness-version'), 'utf8')).checksums || {}; }
      catch { return {}; }
    })();
    const isTracked = Object.prototype.hasOwnProperty.call(checksums, file);

    if (isTracked) {
      // File is in .harness-version but NOT in ownership manifest → manifest coverage gap
      errors.push(`manifest coverage gap: ${file} is in .harness-version checksums but NOT in ownership.manifest.json frameworkOwned`);
    } else {
      // File is NOT tracked at all → truly extra/stale
      const content = (() => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return ''; } })();
      const hasHarnessMarker = /harness:|Harness\/|create-harness-vibe-coding/i.test(content);
      if (hasHarnessMarker) {
        errors.push(`extra harness-owned file not in manifest: ${file} (has Harness content marker — likely stale framework file)`);
      } else {
        // File in harness directory but no harness marker → could be user file, warn only
        console.warn(`Warning: untracked file in harness directory: ${file} (no Harness content marker — may be user file)`);
      }
    }
  }
}

function scanDir(dirPath, prefix, results) {
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch { return; }

  for (const entry of entries) {
    const relPath = `${prefix}${entry.name}`;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      scanDir(fullPath, `${relPath}/`, results);
    } else if (entry.isFile()) {
      // Normalize path separator
      const normalized = relPath.replace(/\\/g, '/');
      results.push(normalized);
    }
  }
}

// Run manifest audit (basic manifest→disk always; --manifest-audit adds disk→manifest)
auditManifestCoverage();

const removedHookArtifacts = [
  'Harness/HOOK_PROTOCOL.md',
  'Harness/scripts/wf-mode-hook.mjs',
  'Harness/scripts/wf-statusline.sh',
  'Harness/scripts/wf-statusline.ps1',
  'tests/e2e-wf-hooks.test.mjs',
];

for (const rel of removedHookArtifacts) {
  if (fs.existsSync(path.join(root, rel))) {
    errors.push(`removed hook artifact should not exist: ${rel}`);
  }
}

// Task capsule template files
const taskTemplateDir = path.join(root, 'Harness', 'tasks', '_template');
if (!fs.existsSync(taskTemplateDir)) {
  errors.push('missing directory: Harness/tasks/_template/');
} else {
  for (const f of ['PROGRESS.md', 'PLAN.md']) {
    if (!fs.existsSync(path.join(taskTemplateDir, f))) {
      errors.push(`missing task template file: Harness/tasks/_template/${f}`);
    }
  }
}

// Cross-reference: DONE files in task PLAN.md must exist on disk
const taskDirs = fs.existsSync(path.join(root, 'Harness', 'tasks'))
  ? fs.readdirSync(path.join(root, 'Harness', 'tasks'), { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name !== '_template')
      .map(e => e.name)
  : [];
for (const taskDir of taskDirs) {
  // Validate task naming convention
  const nameErr = validateTaskName(taskDir, strict);
  if (nameErr) errors.push(nameErr);

  const planPath = `Harness/tasks/${taskDir}/PLAN.md`;
  const planText = read(planPath);
  if (!planText) continue;
  const donePattern = /`([^`]+\.(?:md|mjs|js|ts|json|html|css))`[^\n]*DONE/gi;
  for (const match of planText.matchAll(donePattern)) {
    const claimedFile = match[1];
    if (!fs.existsSync(path.join(root, claimedFile))) {
      errors.push(`${planPath} claims '${claimedFile}' is DONE but file does not exist`);
    }
  }
}

// M2: MCP-as-Worker fake-compliance guard.
// Task capsules MUST NOT record mcp__codex.codex_implement / mcp__claude.claude_implement
// as Worker execution. Historical do-not-repeat references are allowed only when the
// file is marked ANTI-PATTERN. See Harness/specs/workflows/WF-MAX.md "Worker Channel Degradation & Independence".
const MCP_AS_WORKER_RE = /mcp__(?:codex)\.codex_implement|mcp__(?:claude)\.claude_implement/;
for (const taskDir of taskDirs) {
  if (!taskDir.startsWith('task-')) continue;
  for (const f of ['PLAN.md', 'PROGRESS.md']) {
    const rel = `Harness/tasks/${taskDir}/${f}`;
    const text = read(rel);
    if (!text) continue;
    if (MCP_AS_WORKER_RE.test(text) && !/ANTI-PATTERN/i.test(text)) {
      errors.push(`${rel} records mcp__*.implement as Worker execution (fake compliance; see WF-MAX.md "Worker Channel Degradation & Independence"). Mark historical references with "ANTI-PATTERN" or remove the tool call.`);
    }
  }
}

if (fs.existsSync(path.join(root, 'Harness/research/scaffolds.md'))) {
  errors.push('legacy research file should be renamed: Harness/research/scaffolds.md -> Harness/research/research-results.md');
}

if (strict) {
  console.log('Strict placeholder scope:');
  for (const rel of projectFacts) {
    console.log(`- ${rel}`);
  }

  for (const rel of projectFacts) {
    const text = read(rel);
    for (const placeholder of unresolvedTemplatePlaceholders(text)) {
      errors.push(`template placeholder remains in project fact file: ${rel}: ${placeholder}`);
    }
  }
}

const docsReadme = read('Harness/README.md');
if (docsReadme) {
  for (const marker of ['## Keyword Routing', '## Load By Task', 'When to Read', 'Keywords']) {
    if (!docsReadme.includes(marker)) errors.push(`Harness/README.md missing router marker: ${marker}`);
  }
}

for (const rel of durableCommunicationDocs) {
  requireText(rel, 'project files are the only durable communication channel', 'durable filesystem communication invariant');
  requireText(rel, 'chat/subagent transcript state is non-authoritative', 'non-authoritative transcript invariant');
}

requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'L1/L2/L3 Memory Architecture', 'L2/L3 memory architecture section');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Memory Candidate Detection', 'memory candidate detection section');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'explicit user preference', 'explicit user preference immediate write rule');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Memory Routing (L3)', 'memory routing section');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Scenario pack', 'route scoring scenario pack');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Project/Global Memory Boundary', 'project/global memory boundary section');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Harness/tasks/` and `Harness/PROGRESS.md` are always project-local', 'global install keeps task state project-local');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Project memory lives in `Harness/memory/`', 'project memory scope rule');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Global memory must never store project task state', 'global memory task-state exclusion');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Project/Global Settings Boundary', 'project/global settings boundary section');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Project settings live in `Harness/settings.json` and override global settings', 'project settings override global settings');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'copied, not symlinked, into Claude Code, Codex, and OpenCode', 'host-global copy mode');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Existing user-authored config, command, skill, or agent files are user-owned', 'user-owned host file rule');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'same tool or command pattern fails 3+ times', 'tool reflection trigger');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'user corrects the same assumption or preference 2+ times', 'user correction reflection trigger');
requireText('CLAUDE.md', 'startup-hints.md', 'CLAUDE startup-hints routing');
requireText('.claude/rules/ecc/common.md', 'startup-hints.md', 'ECC startup-hints routing');
requireText('.claude/rules/ecc/common.md', 'memory candidates', 'ECC memory candidate detection');
requireText('.claude/rules/ecc/common.md', 'remember', 'ECC explicit memory trigger');
requireText('.claude/agents/memory-master.md', 'remember', 'memory-master explicit trigger');
requireText('.claude/agents/memory-master.md', 'compact format', 'memory-master compact format');
requireText('.claude/agents/memory-master.md', 'superseded', 'memory-master date only for superseded');
requireText('.opencode/agents/memory-master.md', 'remember', 'OpenCode memory-master explicit trigger');
requireText('.claude/skills/wf-learn/SKILL.md', 'without waiting for', 'wf-learn explicit preference immediate write');
requireText('.agents/skills/wf-learn/SKILL.md', 'without waiting for', 'Codex wf-learn explicit preference immediate write');
requireText('Harness/memory/startup-hints.md', 'Memory Candidate Detection', 'startup-hints memory candidate section');
requireText('Harness/memory/startup-hints.md', '记住', 'startup-hints chinese triggers');
requireText('Harness/memory/routes.md', 'signals', 'routes has signals column');
requireText('Harness/memory/routes.md', 'avoid', 'routes has avoid column');
requireText('Harness/memory/user-corrections-preferences.md', 'supersedes', 'memory template date only for superseded');
requireText('Harness/memory/tool-usage-reflections.md', 'supersedes', 'tool reflections template date rule');
requireText('Harness/memory/agent-lessons-patterns.md', 'supersedes', 'agent lessons template date rule');
requireText('Harness/MEMORY.md', 'startup-hints.md', 'MEMORY.md startup-hints registration');
requireText('Harness/MEMORY.md', 'Memory routes', 'MEMORY.md routes.md registration');
requireText('Harness/MEMORY.md', '../.claude/commands/wf-update.md', 'MEMORY.md wf-update direct command registration');
requireText('CLAUDE.md', 'If `Harness/` exists, this repository is governed by the Harness contract', 'Harness binding contract');
requireText('CLAUDE.md', 'memory and resource router', 'memory/resource router');
requireText('CLAUDE.md', '## 5a. Low-Noise Progress', 'low-noise progress section');
requireText('CLAUDE.md', "Match the user's language for all user-facing prose", 'user-facing language match rule');
requireText('CLAUDE.md', 'Keep intermediate user updates to 1-2 short sentences', 'low-noise intermediate update rule');
requireText('.claude/rules/ecc/common.md', '## Low-Noise Progress', 'ECC low-noise progress section');
requireText('.claude/rules/ecc/common.md', "Match the user's language for user-facing prose", 'ECC user-facing language match rule');
requireText('.claude/rules/ecc/common.md', 'Do not recap plans, paste logs, or narrate obvious file reads', 'ECC low-noise no-recap rule');
requireText('Harness/specs/runtime/command-surface.json', '"wf-command-create"', 'command surface registry wf-command-create entry');
requireText('Harness/README.md', 'Load By Task', 'Harness task router');
requireText('Harness/README.md', 'Need context/cache/token efficiency', 'cache/token router row');
requireText('Harness/specs/runtime/context-loading.md', 'Context Tiers', 'context tier load budget section');
requireText('Harness/specs/runtime/context-loading.md', 'automatic route profiles, not user-selected modes', 'context tiers are automatic route profiles');
requireText('Harness/specs/runtime/context-loading.md', 'Budgets are regression guards, not exclusion rules', 'context budgets do not block required files');
requireText('Harness/specs/runtime/context-loading.md', 'Do not skip required rules', 'context budget correctness priority');
requireText('Harness/specs/runtime/context-loading.md', 'Escalation rule', 'context-loading targeted escalation rule');
requireText('Harness/specs/runtime/context-loading.md', 'Thin startup', 'thin startup context tier');
requireText('Harness/specs/runtime/context-loading.md', 'Routed skill/doc', 'routed skill/doc lazy tier');
requireText('Harness/specs/runtime/context-loading.md', 'Cache-First Context Contract', 'cache-first context contract');
requireText('Harness/specs/runtime/context-loading.md', 'Cache Validation Levels', 'cache validation levels');
requireText('Harness/specs/runtime/context-loading.md', 'Do not claim real cache hits', 'real cache telemetry boundary');
requireText('Harness/specs/runtime/context-loading.md', 'cached_tokens', 'OpenAI cache telemetry field');
requireText('Harness/specs/runtime/context-loading.md', 'cache_read_input_tokens', 'Anthropic cache telemetry field');
requireText('Harness/specs/workflows/WF.md', 'Cache Discipline', 'WF cache discipline');
requireText('Harness/specs/workflows/WF-KERNEL.md', 'Cache-First Context Contract', 'WF-KERNEL cache-first contract');
requireText('Harness/specs/runtime/dispatch.md', 'Cache-first dispatch', 'dispatch cache-first discipline');
requireText('Harness/specs/runtime/subagents.md', 'Cache-first discipline', 'subagents cache-first discipline');
forbidText('CLAUDE.md', 'Harness/specs/guides/SETUP.md', 'CLAUDE.md SETUP reference');
forbidText('CLAUDE.md', 'follow it before normal project work', 'installed-project SETUP hot-path routing');
requireText('Harness/specs/guides/SETUP.md', 'Harness/specs/protocols/MEMORY_PROTOCOL.md', 'setup memory protocol reference');
requireText('Harness/specs/guides/SETUP.md', '--install-scope project', 'setup project install scope');
requireText('Harness/specs/guides/SETUP.md', '--install-scope global', 'setup global install scope');
requireText('Harness/specs/guides/SETUP.md', '--global-dir <dir>', 'setup global dir flag');
requireText('Harness/specs/guides/SETUP.md', '--host-global-dir <dir>', 'setup host-global dir flag');
requireText('Harness/specs/guides/SETUP.md', 'copy Claude Code, Codex, and OpenCode command/skill surfaces', 'setup three-host global copy');
requireText('Harness/specs/guides/SETUP.md', 'Project settings in `Harness/settings.json` override global settings defaults', 'setup settings precedence');
requireText('Harness/specs/guides/SETUP.md', 'no startup dependency on this setup reference', 'SETUP startup boundary');
forbidText('Harness/specs/guides/SETUP.md', 'bootstrap contract line', 'stale SETUP-to-CLAUDE bootstrap contract');
forbidText('Harness/specs/runtime/context-loading.md', 'Always keep:', 'ambiguous always-load context rule');
requireText('Harness/scripts/context-budget.mjs', 'thin-startup', 'context-budget thin startup route');
requireText('Harness/scripts/context-budget.mjs', 'cache-diagnostics-route', 'context-budget cache diagnostics route');
requireText('Harness/scripts/context-budget.mjs', 'not runtime exclusion rules', 'context-budget non-exclusion guard');
requireText('Harness/scripts/context-budget.mjs', 'approxTokens', 'context-budget approximate token output');
requireText('Harness/specs/runtime/context-loading.md', 'Harness/scripts/l2-cache-telemetry.mjs', 'L2 telemetry script reference');
requireText('Harness/README.md', 'scripts/l2-cache-telemetry.mjs', 'Harness README L2 telemetry script route');
requireText('Harness/scripts/l2-cache-telemetry.mjs', 'cache_read_input_tokens', 'L2 telemetry cache-read field');
requireText('Harness/scripts/l2-cache-telemetry.mjs', 'cache_creation_input_tokens', 'L2 telemetry cache-creation field');
requireText('Harness/scripts/l2-cache-telemetry.mjs', 'claimGate', 'L2 telemetry claim gate');
requireText('Harness/scripts/l2-cache-telemetry.mjs', '--strict-mcp-config', 'L2 telemetry strict MCP isolation');
requireText('Harness/scripts/l2-cache-telemetry.mjs', '--max-budget-usd', 'L2 telemetry per-turn budget');
requireText('Harness/scripts/l2-cache-telemetry.mjs', '--resume', 'L2 telemetry session resume');
forbidText('Harness/scripts/l2-cache-telemetry.mjs', '--bare', 'L2 telemetry bare mode');
requireText('Harness/README.md', 'subagent', 'subagent orchestrator entry trigger');
requireText('Harness/README.md', 'PROGRESS.md', 'PROGRESS global task index');
requireText('CLAUDE.md', 'Harness/tasks/', 'task capsule directory reference');
requireText('Harness/specs/runtime/subagents.md', 'Subagents are readers and reporters', 'subagent state committer rule');
for (const heading of ['## 2. Think Before Coding', '## 3. Simplicity First', '## 4. Surgical Changes', '## 5. Goal-Driven Execution']) {
  requireText('CLAUDE.md', heading, `Karpathy-style rule heading: ${heading}`);
}

// Root PROGRESS.md structure check
const progress = read('Harness/PROGRESS.md');
if (progress) {
  for (const heading of ['## Active Task', '## Task Index', '## Cross-Task Decisions']) {
    if (!progress.includes(heading)) errors.push(`Harness/PROGRESS.md missing heading: ${heading}`);
  }
}

// Legacy PLAN.md deprecation check (removed — stub only)

const dispatch = read('Harness/specs/runtime/dispatch.md');
if (dispatch) {
  for (const agent of commonAgents) {
    if (!dispatch.includes(`\`${agent}\``)) errors.push(`Harness/specs/runtime/dispatch.md missing common agent: ${agent}`);
  }
  if (!dispatch.includes('## Handoff Format')) errors.push('Harness/specs/runtime/dispatch.md missing heading: ## Handoff Format');
}

const contextLoading = read('Harness/specs/runtime/context-loading.md');
if (contextLoading) {
  if (!contextLoading.includes('Harness/README.md` is the primary Harness documentation router')) {
    errors.push('Harness/specs/runtime/context-loading.md must declare Harness/README.md as the primary Harness documentation router');
  }
  for (const pack of contextPacks) {
    if (!contextLoading.includes(pack)) errors.push(`Harness/specs/runtime/context-loading.md missing subagent pack: ${pack}`);
  }
}

const memory = read('Harness/MEMORY.md');
if (memory) {
  for (const agent of commonAgents) {
    const rel = `.claude/agents/${agent}.md`;
    if (!memory.includes(rel)) errors.push(`Harness/MEMORY.md missing agent registration: ${rel}`);
  }
  for (const skill of commonSkills) {
    const rel = `.claude/skills/${skill}/SKILL.md`;
    if (!memory.includes(rel)) errors.push(`Harness/MEMORY.md missing skill registration: ${rel}`);
  }
  for (const rel of memoryFiles) {
    const relativeRel = rel.replace(/^Harness\//, '');
    if (!memory.includes(rel) && !memory.includes(relativeRel)) {
      errors.push(`Harness/MEMORY.md missing memory file registration: ${rel}`);
    }
  }
}

for (const workflow of listMarkdownFiles('Harness/workflows')) {
  const relativeWorkflow = workflow.replace(/^Harness\//, '');
  if (!docsReadme.includes(workflow) && !docsReadme.includes(relativeWorkflow) && !memory.includes(workflow) && !memory.includes(relativeWorkflow)) {
    errors.push(`workflow is not registered in Harness/README.md or Harness/MEMORY.md: ${workflow}`);
  }
}

for (const skillFile of registeredSkillFiles(docsReadme, memory)) {
  if (!fs.existsSync(path.join(root, skillFile))) {
    errors.push(`registered skill file is missing: ${skillFile}`);
  }
}

for (const command of listedWorkflowCommands(docsReadme, read('.claude/commands/wf-help.md'))) {
  const skill = command.slice(1);
  const claudeSkill = `.claude/skills/${skill}/SKILL.md`;
  const codexSkill = `.agents/skills/${skill}/SKILL.md`;
  if (!fs.existsSync(path.join(root, claudeSkill))) {
    errors.push(`command docs list missing Claude skill: ${command} -> ${claudeSkill}`);
  }
  if (!fs.existsSync(path.join(root, codexSkill))) {
    errors.push(`command docs list missing Codex skill: ${command} -> ${codexSkill}`);
  }
}

for (const workflowFile of registeredWorkflowFiles(docsReadme, memory)) {
  if (!fs.existsSync(path.join(root, workflowFile))) {
    // Optional workflows (ts-react-frontend, ui-ux-review, etc.) may not be installed
    continue;
  }
}

function requireUiSelectorContract(rel) {
  const text = read(rel);
  if (!text) return;

  const markers = [
    'data-testid',
    'accessible labels/roles',
    'inputs, buttons, filters, rows, empty/error/loading states',
  ];

  if (markers.some(marker => !text.includes(marker))) {
    errors.push(`${rel} missing stable UI selector contract`);
  }
}

requireUiSelectorContract('.claude/skills/wf-browser/SKILL.md');
requireUiSelectorContract('.agents/skills/wf-browser/SKILL.md');
requireUiSelectorContract('Harness/workflows/ts-react-frontend.md');

if (fs.existsSync(path.join(root, 'Harness/workflows/browser-e2e.md'))) {
  errors.push('retired optional workflow must not exist: Harness/workflows/browser-e2e.md');
}

for (const skill of commonSkills) {
  const rel = `.claude/skills/${skill}/SKILL.md`;
  const text = read(rel);
  if (!text) continue;
  if (frontmatterField(text, 'name') !== skill) errors.push(`${rel} frontmatter name does not match directory`);
  if (!frontmatterField(text, 'description')) errors.push(`${rel} missing frontmatter field: description`);
}

for (const skill of commonSkills) {
  const claudeRel = `.claude/skills/${skill}/SKILL.md`;
  const codexRel = `.agents/skills/${skill}/SKILL.md`;
  const claudeText = read(claudeRel);
  const codexText = read(codexRel);
  if (!claudeText || !codexText) continue;
  if (claudeText !== codexText) errors.push(`${codexRel} must mirror ${claudeRel}`);
}

for (const skill of listDirectories('.claude/skills')) {
  if (commonSkills.includes(skill)) continue;

  const rel = `.claude/skills/${skill}/SKILL.md`;
  const text = read(rel);
  if (!text) continue;

  if (frontmatterField(text, 'name') !== skill) errors.push(`${rel} frontmatter name does not match directory`);
  if (!frontmatterField(text, 'description')) errors.push(`${rel} missing frontmatter field: description`);
}

for (const skill of listDirectories('.agents/skills')) {
  const rel = `.agents/skills/${skill}/SKILL.md`;
  const text = read(rel);
  if (!text) continue;

  if (frontmatterField(text, 'name') !== skill) errors.push(`${rel} frontmatter name does not match directory`);
  if (!frontmatterField(text, 'description')) errors.push(`${rel} missing frontmatter field: description`);

  const claudeMirror = `.claude/skills/${skill}/SKILL.md`;
  if (fs.existsSync(path.join(root, claudeMirror)) && text !== read(claudeMirror)) {
    errors.push(`${rel} must mirror ${claudeMirror}`);
  }
}

for (const agent of commonAgents) {
  const rel = `.claude/agents/${agent}.md`;
  const text = read(rel);
  if (!text) continue;

  for (const field of ['name', 'description', 'tools', 'model']) {
    if (!frontmatterField(text, field)) errors.push(`${rel} missing frontmatter field: ${field}:`);
  }

  if (frontmatterField(text, 'name') !== agent) {
    errors.push(`${rel} frontmatter name does not match filename`);
  }

  const skill = frontmatterField(text, 'skills');
  if (skill && !commonSkills.includes(skill)) {
    errors.push(`${rel} references unknown skill: ${skill}`);
  }

  if (skill && !fs.existsSync(path.join(root, `.claude/skills/${skill}/SKILL.md`))) {
    errors.push(`${rel} references missing skill file: .claude/skills/${skill}/SKILL.md`);
  }
}

for (const agent of commonAgents) {
  const rel = `.opencode/agents/${agent}.md`;
  const text = read(rel);
  if (!text) continue;

  for (const field of ['description', 'mode']) {
    if (!frontmatterField(text, field)) errors.push(`${rel} missing frontmatter field: ${field}:`);
  }

  const mode = frontmatterField(text, 'mode');
  if (mode && mode !== 'subagent') {
    errors.push(`${rel} frontmatter mode should be subagent (got: ${mode})`);
  }
}

// OpenCode mirror sync: .claude is the only editable source; .opencode files are
// format-converted mirrors. Frontmatter is platform-specific, but description and
// markdown body must match the .claude source exactly (edit .claude, then copy).
function markdownBody(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/\r\n/g, '\n').trim();
}

for (const opencodeRel of listMarkdownFiles('.opencode/agents')) {
  const fileName = opencodeRel.split('/').pop();
  const claudeRel = `.claude/agents/${fileName}`;
  const opencodeText = read(opencodeRel);
  if (!opencodeText) continue;
  const claudeText = read(claudeRel);
  if (!claudeText) {
    errors.push(`${opencodeRel} has no .claude source: ${claudeRel} (add the .claude agent first)`);
    continue;
  }
  if (frontmatterField(opencodeText, 'description') !== frontmatterField(claudeText, 'description')) {
    errors.push(`${opencodeRel} description must mirror ${claudeRel} (edit the .claude source, then copy)`);
  }
  if (markdownBody(opencodeText) !== markdownBody(claudeText)) {
    errors.push(`${opencodeRel} body must mirror ${claudeRel} (edit the .claude source, then copy)`);
  }
}

for (const claudeRel of listMarkdownFiles('.claude/commands')) {
  const fileName = claudeRel.split('/').pop();
  const opencodeRel = `.opencode/commands/${fileName}`;
  const claudeText = read(claudeRel);
  if (!claudeText) continue;
  const opencodeText = read(opencodeRel);
  if (!opencodeText) {
    errors.push(`missing OpenCode command mirror: ${opencodeRel} (copy from ${claudeRel})`);
    continue;
  }
  if (markdownBody(opencodeText) !== markdownBody(claudeText)) {
    errors.push(`${opencodeRel} body must mirror ${claudeRel} (edit the .claude source, then copy)`);
  }
}

requireText('Harness/specs/guides/extension.md', 'Skills should extend the harness');
requireText('Harness/specs/runtime/agent-workflow.md', 'Harness/tasks/<task-id>/PROGRESS.md');
requireText('Harness/README.md', 'Task records are compact by default', 'compact task record router rule');
requireText('Harness/specs/runtime/agent-workflow.md', 'AC record size', 'compact AC record size rule');
requireText('Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md', 'Default to 1-3 concise ACs', 'compact AC default');
requireText('Harness/specs/workflows/WF.md', 'task-scribe', 'compact heartbeat rule');
requireText('Harness/tasks/_template/PLAN.md', 'Compact task record', 'compact task PLAN template');
requireText('Harness/tasks/_template/PLAN.md', 'Default: keep 1-3 concise ACs', 'compact task PLAN AC guidance');
requireText('Harness/tasks/_template/PROGRESS.md', 'Compact heartbeat', 'compact task PROGRESS template');
requireText('Harness/specs/runtime/agent-workflow.md', 'TDD-GUIDE.md', 'agent workflow loads TDD guide');
requireText('Harness/specs/runtime/agent-workflow.md', 'real user-path test', 'agent workflow real user path requirement');
requireText('Harness/research/README.md', 'research-results.md');
requireText('Harness/specs/workflows/WF.md', 'Orchestration Loop', 'WF orchestration loop');
requireText('Harness/specs/workflows/WF.md', 'WF-KERNEL.md', 'WF references WF-KERNEL');
requireText('Harness/specs/workflows/WF.md', 'Cross-review and reflector NOT mandatory', 'WF-Light no mandatory cross-review');
requireText('Harness/specs/workflows/WF.md', '`.claude/agents/`', 'WF agent roster path');
requireText('Harness/specs/workflows/WF.md', 'Harness/tasks/', 'WF task directory reference');
const taskIdConvention = '`task-<verb>-<noun>[-detail]`';
requireText('Harness/specs/workflows/WF.md', taskIdConvention, 'WF task-id naming convention');
requireText('Harness/specs/workflows/WF-STATE.md', taskIdConvention, 'WF-STATE task-id naming convention');
requireText('Harness/specs/workflows/WF-MAX.md', taskIdConvention, 'WF-MAX task-id naming convention');
requireText('Harness/README.md', 'explicit WF token', 'WF explicit contract');
requireText('Harness/README.md', 'tier-gated acceptance', 'WF tiered acceptance router output');
requireText('.claude/skills/wf/SKILL.md', 'Harness/specs/workflows/WF.md', 'wf skill loads core WF doc');
requireText('.claude/skills/wf/SKILL.md', 'Tier-aware acceptance', 'wf skill tier-aware acceptance');
requireText('.claude/skills/wf/SKILL.md', taskIdConvention, 'wf skill task-id naming convention');
requireText('.agents/skills/wf/SKILL.md', 'Harness/specs/workflows/WF.md', 'Codex wf skill loads core WF doc');
requireText('.agents/skills/wf/SKILL.md', taskIdConvention, 'Codex wf skill task-id naming convention');
requireText('.claude/skills/subagent-orchestrator/SKILL.md', 'Harness/specs/runtime/subagents.md', 'subagent-orchestrator loads subagents doc');
requireText('.claude/skills/subagent-orchestrator/SKILL.md', '.claude/agents/', 'subagent-orchestrator built-in agent roster path');
requireText('.claude/skills/subagent-orchestrator/SKILL.md', 'WF/WF-MAX requires tier-specific', 'subagent-orchestrator WF tier-specific contract');
requireText('.claude/skills/wf-readme/SKILL.md', 'README.md', 'wf-readme loads README');
requireText('.claude/skills/wf-readme/SKILL.md', 'Harness/project/architecture.md', 'wf-readme links architecture docs');
requireText('Harness/specs/runtime/subagents.md', '## Source Attribution', 'subagent source attribution');
requireText('Harness/specs/runtime/subagents.md', 'npx skills find', 'find-skills discovery attribution');
requireText('Harness/specs/runtime/subagents.md', 'superpowers:dispatching-parallel-agents', 'parallel-agent source attribution');
requireText('Harness/specs/runtime/subagents.md', 'superpowers:subagent-driven-development', 'subagent-driven source attribution');
requireText('Harness/specs/runtime/subagents.md', '## Built-in Agent Roster', 'built-in agent roster');
requireText('Harness/specs/runtime/subagents.md', '## WF Default Fan-Out', 'WF default fan-out');
requireText('Harness/specs/runtime/subagents.md', 'concrete conditions', 'subagent decision tree');
requireText('Harness/specs/runtime/subagents.md', 'parallel planner/researcher/docs-researcher/architect subagents', 'WF roster orchestration shape');
requireText('Harness/specs/runtime/subagents.md', '`reflector`', 'reflector agent roster');
requireText('Harness/specs/runtime/subagents.md', 'reflector PASS', 'reflector review gate');
requireText('Harness/specs/runtime/subagents.md', '## Efficiency Ladder', 'subagent efficiency ladder');
requireText('Harness/specs/runtime/subagents.md', '## Review Gates', 'subagent review gates');
requireText('Harness/project/architecture.md', '## 2. Interface Decoupling', 'architecture interface decoupling');
requireText('Harness/project/architecture.md', '## 3. State Design', 'architecture state design');
requireText('Harness/project/architecture.md', 'Avoid speculative abstraction', 'anti-overengineering architecture rule');
requireText('CLAUDE.md', 'Use explicit interfaces or state models only when they protect a real boundary', 'CLAUDE interface/state simplicity rule');
requireText('Harness/README.md', '/wf-update', 'wf update startup instruction');
requireText('Harness/README.md', 'Need harness update', 'update routing row');
requireText('Harness/specs/workflows/WF-MAX.md', 'three-layer architecture', 'WF-MAX three-layer architecture');
requireText('Harness/specs/workflows/WF-MAX.md', 'dispatch permissions', 'WF-MAX role separation');
requireText('Harness/specs/workflows/WF-MAX.md', 'file_claim', 'WF-MAX coloring algorithm');
requireText('Harness/specs/workflows/WF-MAX.md', 'CEO → Manager → Worker', 'WF-MAX wave dispatch');
requireText('Harness/specs/workflows/WF-MAX.md', 'inherits the full', 'WF-MAX strict superset');
requireText('Harness/specs/workflows/WF-MAX.md', 'Cross-CLI', 'WF-MAX cross-CLI overflow');
requireText('Harness/specs/workflows/WF-MAX.md', 'claude -p', 'WF-MAX Claude CLI overflow');
requireText('Harness/specs/workflows/WF-MAX.md', 'codex exec', 'WF-MAX Codex CLI overflow');
requireText('Harness/specs/workflows/WF-MAX.md', 'agents.max_threads', 'WF-MAX Codex legacy max_threads alias');
requireText('Harness/specs/workflows/WF-MAX.md', 'max_concurrent_threads_per_session', 'WF-MAX Codex concurrent thread config');
requireText('Harness/specs/workflows/WF-MAX.md', 'Mandatory Fan-Out Contract', 'WF-MAX mandatory fan-out attempt contract');
requireText('Harness/specs/workflows/WF-MAX.md', 'fanoutAttempted: true', 'WF-MAX records fan-out attempt');
requireText('Harness/specs/workflows/WF-MAX.md', 'Runtime Capacity Map', 'WF-MAX runtime capacity map');
requireText('Harness/specs/workflows/WF-MAX.md', 'CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION', 'WF-MAX Claude Code subagent cap docs');
requireText('Harness/specs/workflows/WF-MAX.md', 'CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS', 'WF-MAX Claude Code concurrent subagent cap docs');
requireText('Harness/specs/workflows/WF-MAX.md', 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH', 'WF-MAX Claude Code spawn-depth cap docs');
requireText('Harness/specs/workflows/WF-MAX.md', 'Do not scaffold Codex scalar agent caps', 'WF-MAX Codex config compatibility guard');
requireText('Harness/specs/workflows/WF-MAX.md', 'subagent_depth = 2', 'WF-MAX OpenCode subagent depth default');
requireText('Harness/specs/workflows/WF-MAX.md', 'asks the user before any project/global Codex config change', 'WF-MAX asks before changing Codex config');
requireText('Harness/specs/workflows/WF-MAX.md', 'Close completed agents', 'WF-MAX close completed agents before overflow');
requireText('Harness/specs/workflows/WF-MAX.md', 'Codex++', 'WF-MAX forbids relying on Codex++ as stable capacity');
requireText('Harness/specs/workflows/WF-MAX.md', 'does not authorize CEO source edits', 'WF-MAX useful-degrade CEO source-edit boundary');
requireText('Harness/specs/workflows/WF-MAX.md', '## Cross-Task Decisions', 'WF-MAX PROGRESS heading preservation');
requireText('.claude/skills/wf-max/SKILL.md', 'agents.max_concurrent_threads_per_session', 'wf-max skill Codex thread config');
requireText('.claude/skills/wf-max/SKILL.md', 'agents.max_threads', 'wf-max skill Codex legacy alias');
requireText('.claude/skills/wf-max/SKILL.md', 'Do not scaffold scalar `[agents]` caps', 'wf-max skill Codex config compatibility guard');
requireText('.claude/skills/wf-max/SKILL.md', 'CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION', 'wf-max skill Claude Code subagent cap');
requireText('.claude/skills/wf-max/SKILL.md', 'CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS', 'wf-max skill Claude Code concurrent subagent cap');
requireText('.claude/skills/wf-max/SKILL.md', 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH', 'wf-max skill Claude Code spawn-depth cap');
requireText('.claude/skills/wf-max/SKILL.md', 'subagent_depth = 2', 'wf-max skill OpenCode subagent depth default');
requireText('.claude/skills/wf-max/SKILL.md', 'ask the user before raising', 'wf-max skill asks before raising Codex thread cap');
requireText('.claude/skills/wf-max/SKILL.md', 'Codex++', 'wf-max skill forbids Codex++ capacity assumption');
requireText('.claude/skills/wf-max/SKILL.md', taskIdConvention, 'wf-max skill task-id naming convention');
requireText('.agents/skills/wf-max/SKILL.md', taskIdConvention, 'Codex wf-max skill task-id naming convention');
requireText('.claude/skills/wf-max/SKILL.md', 'does not authorize CEO source edits', 'wf-max skill useful-degrade CEO source-edit boundary');
requireText('.claude/skills/wf-max/SKILL.md', '## Cross-Task Decisions', 'wf-max skill PROGRESS heading preservation');
requireText('.codex/config.toml', 'intentionally avoids WF-MAX capacity defaults', 'Codex config compatibility note');
forbidActiveToml('.codex/config.toml', /^\[agents\]$/m, 'Codex project config agents table');
forbidActiveToml('.codex/config.toml', /^\s*max_concurrent_threads_per_session\s*=/m, 'Codex project config concurrent thread scalar');
forbidActiveToml('.codex/config.toml', /^\s*max_depth\s*=/m, 'Codex project config max_depth scalar');
forbidActiveToml('.codex/config.toml', /^\s*max_threads\s*=/m, 'Codex project config legacy max_threads scalar');
requireText('opencode.json', '"$schema": "https://opencode.ai/config.json"', 'OpenCode config schema');
requireText('opencode.json', '.claude/rules/ecc/common.md', 'OpenCode instructions reference to ECC rules');
requireText('opencode.json', '"subagent_depth": 2', 'OpenCode WF-MAX subagent nesting depth');
requireText('.opencode/commands/wf-max.md', 'MUST attempt native runtime subagent fan-out', 'OpenCode wf-max command fan-out attempt');
requireText('.opencode/commands/wf-max.md', 'subagent_depth >= 2', 'OpenCode wf-max command subagent depth requirement');
requireText('.opencode/commands/wf-max.md', 'fanoutAttempted: true', 'OpenCode wf-max command records fan-out attempt');
requireText('.opencode/agents/explore-manager.md', 'task:', 'OpenCode explore-manager task permission');
requireText('.opencode/agents/explore-manager.md', '"codebase-explorer": allow', 'OpenCode explore-manager child allowlist');
requireText('.opencode/agents/explore-manager.md', '"git status*": allow', 'OpenCode explore-manager read-only git status');
requireText('.opencode/agents/explore-manager.md', '"git diff*": allow', 'OpenCode explore-manager read-only git diff');
forbidText('.opencode/agents/explore-manager.md', '"git *": allow', 'OpenCode explore-manager broad git permission');
requireText('.opencode/agents/architect-manager.md', '"architect": allow', 'OpenCode architect-manager child allowlist');
requireText('.opencode/agents/implement-manager.md', '"implementer": allow', 'OpenCode implement-manager child allowlist');
forbidText('.opencode/agents/implement-manager.md', '"node *": allow', 'OpenCode implement-manager broad node permission');
forbidText('.opencode/agents/implement-manager.md', '"npm *": allow', 'OpenCode implement-manager broad npm permission');
requireText('.opencode/agents/review-manager.md', '"reviewer": allow', 'OpenCode review-manager child allowlist');
forbidText('.opencode/agents/review-manager.md', '"node *": allow', 'OpenCode review-manager broad node permission');
requireText('Harness/README.md', '/wf-max', 'wf max router alias');
requireText('Harness/README.md', 'WF-MAX.md', 'WF-MAX router reference');
requireText('Harness/README.md', 'ACCEPTANCE_PROTOCOL.md', 'acceptance protocol router reference');
requireText('Harness/README.md', 'TDD-GUIDE.md', 'TDD guide router reference');
requireText('Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md', 'PRD-GATE', 'acceptance PRD gate');
requireText('Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md', 'AC-GATE', 'acceptance AC gate');
requireText('Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md', 'Acceptance Result', 'acceptance result matrix');
requireText('Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md', 'Syntax-only checks', 'syntax-only checks are not browser acceptance evidence');
requireText('Harness/specs/protocols/AGENT_ISOLATION.md', 'implementer', 'agent isolation implementer rule');
requireText('Harness/specs/protocols/HARNESS_BRIDGE.md', 'Agent-Operable Web Runtime', 'harness bridge agent-operable runtime');
requireText('Harness/specs/protocols/HARNESS_BRIDGE.md', 'Backend Broker Protocol', 'harness bridge backend broker protocol');
requireText('Harness/specs/protocols/HARNESS_BRIDGE.md', 'Multi-Agent Window Contract', 'harness bridge multi-agent window contract');
requireText('Harness/specs/protocols/HARNESS_BRIDGE.md', 'Artifact Workspace', 'harness bridge artifact workspace');
requireText('Harness/specs/protocols/HARNESS_BRIDGE.md', 'Network Trace Collector', 'harness bridge network trace collector');
requireText('Harness/wf-browser/README.md', 'Runtime Artifacts', 'wf-browser artifact workspace README');
requireText('Harness/wf-browser/README.md', 'A write/control lease is exclusive per window', 'wf-browser artifact README lease rule');
requireText('Harness/wf-browser/README.md', 'latest 20 runs or 7 days', 'wf-browser artifact README retention rule');
requireText('Harness/specs/workflows/WF-AUTO.md', 'Intent Checkpoint', 'wf-auto intent checkpoint');
requireText('Harness/specs/workflows/WF-AUTO.md', 'Adaptive Coverage Exhaustion Gate', 'wf-auto adaptive coverage exhaustion gate');
requireText('Harness/specs/workflows/WF-AUTO.md', 'dynamic high-risk obligations', 'wf-auto dynamic high-risk obligations');
requireText('Harness/specs/workflows/WF-AUTO.md', 'two different confirmation strategies', 'wf-auto two different confirmation strategies');
requireText('Harness/specs/workflows/WF-AUTO-ANGLES.md', 'Selection algorithm', 'wf-auto adaptive angle selection');
requireText('Harness/specs/workflows/WF-AUTO-ANGLES.md', 'Dynamic obligations', 'wf-auto dynamic obligations');
requireText('Harness/specs/workflows/WF-AUTO-ANGLES.md', 'Common probe recipes', 'wf-auto common probe recipes');
forbidText('Harness/specs/workflows/WF-AUTO.md', 'All 8 exhausted', 'stale eight-angle exhaustion rule');
forbidText('Harness/specs/workflows/WF-AUTO.md', '3 consecutive all-exhausted rounds', 'stale three-consecutive-all-exhausted stop rule');
forbidText('Harness/specs/workflows/WF-AUTO.md', '8-Angle Exhaustion Gate', 'stale eight-angle exhaustion gate name');
forbidText('Harness/specs/workflows/WF-AUTO-SPARK.md', '8 parallel external searches', 'stale eight-spark fixed-count search');
requireText('Harness/specs/workflows/WF-AUTO.md', 'Inherited WF/WF-MAX Constraints', 'wf-auto inherited WF/WF-MAX constraints');
requireText('Harness/specs/workflows/WF-AUTO.md', 'Mini PRD -> AC IDs -> test/validation plan -> implementer -> verifier', 'wf-auto per-cycle WF chain');
requireText('Harness/specs/workflows/WF-AUTO.md', 'reflector PASS', 'wf-auto reflector gate');
requireText('Harness/specs/workflows/WF-AUTO.md', 'Manual or benchmark-driven single-cycle', 'wf-auto bounded single-cycle tick contract');
requireText('Harness/specs/workflows/WF-AUTO.md', 'Harness/tasks/continuous/PLAN.md', 'wf-auto bounded tick PLAN record');
requireText('Harness/specs/workflows/WF-AUTO.md', 'Harness/tasks/continuous/PROGRESS.md', 'wf-auto bounded tick PROGRESS record');
requireText('Harness/specs/workflows/WF-AUTO-SPARK.md', 'Inherited Execution Chain', 'wf-auto-spark inherited execution chain');
requireText('Harness/specs/workflows/WF-AUTO-SPARK.md', 'External spark search replaces discovery only', 'wf-auto-spark discovery-only inheritance');
requireText('Harness/specs/workflows/WF-AUTO-SPARK.md', 'reflector PASS', 'wf-auto-spark reflector gate');
requireText('Harness/specs/workflows/WF-AUTO-SPARK.md', 'task-scribe formats task-state writes', 'wf-auto-spark task-scribe recorder delegation');
requireText('Harness/specs/workflows/WF-AUTO-SPARK.md', 'searchFallback: ceo-direct', 'wf-auto-spark search fallback');
requireText('Harness/specs/workflows/WF-AUTO-SPARK.md', 'pre-implementation triage', 'wf-auto-spark reflector escalation');
requireText('Harness/specs/workflows/WF-AUTO-SPARK.md', 'Literal anti-pattern matching', 'wf-auto-spark anti-pattern invariant guard');
requireText('Harness/specs/workflows/WF-AUTO-SPARK.md', 'node scripts/build-version.mjs --check', 'wf-auto-spark checksum drift guard');
requireText('Harness/specs/workflows/WF-MAX.md', 'process-file delegation is the default', 'WF-MAX task-scribe process-file delegation default');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Scenario Memory Hints', 'memory protocol scenario hints');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'WF closeout', 'memory protocol WF closeout injection row');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'memory-master owns writes', 'memory protocol memory write ownership');
requireText('Harness/specs/protocols/TDD-GUIDE.md', 'Browser/UI Acceptance TDD Gate', 'browser UI acceptance TDD gate');
requireText('Harness/specs/protocols/TDD-GUIDE.md', 'syntax-only', 'syntax-only acceptance prohibition');
requireText('Harness/specs/protocols/TDD-GUIDE.md', 'Playwright/CDP', 'Playwright/CDP acceptance requirement');
requireText('Harness/specs/protocols/TDD-GUIDE.md', 'AC-by-AC result matrix', 'AC-by-AC TDD evidence matrix');
requireText('Harness/tasks/_template/PLAN.md', 'Expanded evidence required when triggered', 'task template expanded evidence trigger');
requireText('Harness/templates/TEST_PLAN.template.md', 'syntax-only checks', 'test plan template syntax-only prohibition');
requireText('.claude/skills/tdd/SKILL.md', 'Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md', 'tdd skill loads acceptance protocol');
requireText('.claude/skills/tdd/SKILL.md', 'Harness/specs/protocols/HARNESS_BRIDGE.md', 'tdd skill loads harness bridge');
requireText('.claude/skills/tdd/SKILL.md', 'No syntax-only acceptance', 'tdd skill forbids syntax-only acceptance');
requireText('.claude/skills/wf-remove/SKILL.md', 'User-facing removal is the slash/skill command', 'wf-remove slash command is user-facing');
requireText('.claude/skills/wf-remove/SKILL.md', 'agent-internal execution steps', 'wf-remove script commands are agent-internal');
requireText('.claude/skills/wf-remove/SKILL.md', 'verify residual discovery folders', 'wf-remove residual discovery verification');
forbidText('Harness/scripts/wf-remove.mjs', '\uFFFD', 'replacement character in wf-remove output');
for (const marker of ['codebase-explorer', 'task-scribe', 'wf-agents-docs', 'wf-auto-spark']) {
  requireText('Harness/scripts/wf-remove.mjs', marker, `wf-remove built-in registry includes ${marker}`);
}
requireText('.claude/skills/wf-review/SKILL.md', 'opencode run --agent reviewer', 'wf-review OpenCode peer CLI path');
requireText('.claude/skills/wf-review/SKILL.md', 'Role: reviewer', 'wf-review installed reviewer role fallback');
requireText('.claude/skills/wf-review/SKILL.md', 'The main agent is the controller', 'wf-review controller final authority');
requireText('.claude/skills/wf-agents-docs/SKILL.md', 'claude -p --output-format json', 'wf-agents-docs Claude JSON CLI path');
requireText('.claude/skills/wf-agents-docs/SKILL.md', 'codex exec --json', 'wf-agents-docs Codex JSONL CLI path');
requireText('.claude/skills/wf-agents-docs/SKILL.md', 'opencode run --format json', 'wf-agents-docs OpenCode JSON CLI path');
requireText('.claude/skills/wf-agents-docs/SKILL.md', 'cache_read_input_tokens', 'wf-agents-docs Claude cache telemetry field');
requireText('.claude/skills/wf-agents-docs/SKILL.md', 'Do not trust exit code alone', 'wf-agents-docs PowerShell wrapper guard');
requireText('.claude/skills/wf-agents-docs/SKILL.md', 'Evidence-Packet Review Pattern', 'wf-agents-docs evidence-packet review method');
requireText('.claude/skills/wf-agents-docs/SKILL.md', 'No Scratch-File Rule', 'wf-agents-docs scratch-file guard');
requireText('.claude/skills/wf-agents-docs/SKILL.md', 'Subagent Output Contract', 'wf-agents-docs subagent output contract');
requireText('.claude/skills/wf-agents-docs/SKILL.md', 'Do not write CLI probe output under `%TEMP%`', 'wf-agents-docs temp pollution guard');
requireText('Harness/README.md', 'Need peer CLI automation docs', 'Harness router peer CLI automation docs row');
requireText('.opencode/commands/wf-review.md', 'peer-review contract', 'OpenCode wf-review wrapper peer-review contract');
requireText('Harness/specs/runtime/subagents.md', 'For `/wf-review`, use the installed `reviewer` role', 'subagents wf-review role fallback');
requireText('.claude/agents/tdd-guide.md', 'Browser Acceptance Rules', 'tdd-guide browser acceptance rules');
requireText('.claude/agents/tdd-guide.md', 'real user actions', 'tdd-guide real user action requirement');
requireText('.claude/agents/test-writer.md', 'Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md', 'test-writer loads acceptance protocol');
requireText('.claude/agents/test-writer.md', 'real user-path test', 'test-writer real user path requirement');
requireText('.claude/agents/test-writer.md', 'network URL, method, payload', 'test-writer network assertion requirement');
requireText('.claude/agents/reflector.md', 'PASS, RETURN_TO_DEBUG, or BLOCKED', 'reflector verdict contract');
requireText('Harness/specs/protocols/DEBUG_PROTOCOL.md', 'Layer Classification', 'debug layer classification');
requireText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'AC ID', 'memory AC traceability');
requireText('Harness/specs/runtime/subagents.md', 'Max parallelism', 'subagents max parallelism row');
requireText('Harness/specs/runtime/dispatch.md', 'Concurrency group', 'dispatch concurrency group field');
requireText('Harness/specs/runtime/dispatch.md', 'File claim', 'dispatch file claim field');
requireText('CLAUDE.md', '/wf-max', 'wf max startup instruction');
requireText('.claude/commands/wf-help.md', 'Do not invoke a skill', 'wf-help direct command boundary');
requireText('.claude/commands/wf-help.md', '| `/wf-help` |', 'wf-help command row');
requireText('.claude/commands/wf-help.md', '| `/wf-max <task>` |', 'wf-help wf-max row');
requireText('.claude/commands/wf-help.md', '| `/wf-auto` |', 'wf-help wf-auto row');
requireText('.claude/commands/wf-help.md', '| `/wf-readme <task>` |', 'wf-help wf-readme row');
forbidText('.claude/commands/wf-help.md', '.opencode/skills/', 'wf-help nonexistent OpenCode skills directory claim');
forbidText('.opencode/commands/wf-help.md', '.opencode/skills/', 'OpenCode wf-help nonexistent skills directory claim');
requireText('Harness/README.md', '## Direct Commands', 'direct commands section');
requireText('Harness/README.md', '.claude/commands/wf-help.md', 'wf-help router reference');
requireText('Harness/specs/workflows/WF-MAX.md', 'three-layer architecture', 'CLAUDE.md three-layer role architecture');
requireText('Harness/README.md', 'role enforcement has no runtime hook state', 'CLAUDE no-hook role enforcement statement');
requireText('Harness/specs/workflows/WF-AUTO.md', 'Runtime Hook Boundaries', 'runtime hook boundaries');
requireText('Harness/specs/workflows/WF-AUTO.md', 'only `/wf-auto` may use a runtime hook to drive auto-optimization', 'wf-auto-only hook boundary');
forbidText('CLAUDE.md', 'Enforced by hooks', 'WF-MAX hook enforcement claim');
forbidText('Harness/specs/workflows/WF.md', 'MUST use at least 3 distinct role passes', 'old WF role-pass minimum');
forbidText('Harness/specs/workflows/WF.md', 'at least three distinct role passes', 'old WF role-pass wording');
forbidText('Harness/specs/runtime/dispatch.md', 'requires ≥3 distinct subagents', 'old dispatch WF role minimum');
forbidText('CLAUDE.md', 'WF-MAX hooks', 'WF-MAX hook enforcement claim');
forbidText('Harness/README.md', 'PreToolUse hook', 'WF-MAX PreToolUse hook claim');
forbidText('Harness/README.md', 'SessionStart hook', 'WF-MAX SessionStart hook claim');
forbidText('Harness/README.md', 'hook-managed', 'hook-managed runtime claim');
forbidText('Harness/README.md', 'HOOK_PROTOCOL.md', 'removed hook protocol reference');
forbidText('Harness/specs/workflows/WF-AUTO.md', 'Hook-Assisted Long Loop', 'wf-auto hook loop section');
forbidText('Harness/specs/runtime/dispatch.md', 'removes the cap entirely', 'unbounded runtime-cap claim');
forbidText('Harness/specs/workflows/WF-MAX.md', 'no hard agent cap; recursion governed', 'unbounded agent-cap claim');
forbidText('Harness/specs/protocols/MEMORY_PROTOCOL.md', 'Hooks may', 'hook-triggered memory claim');
forbidText('.claude/settings.json', 'wf-mode-hook.mjs', 'Claude WF hook command registration');
forbidText('.codex/hooks.json', 'wf-mode-hook.mjs', 'Codex WF hook command registration');
const codexHookConfig = read('.codex/hooks.json');
const claudeSettings = read('.claude/settings.json');
requireText('.codex/hooks.json', '"SessionStart"', 'Codex startup-only update hook');
requireText('.claude/settings.json', '"SessionStart"', 'Claude startup-only update hook');
forbidText('.codex/hooks.json', 'UserPromptSubmit', 'Codex turn-by-turn status hook');
forbidText('.codex/hooks.json', '"Stop"', 'Codex stop status hook');
forbidText('.codex/hooks.json', 'wf-status.mjs', 'removed Codex WF status script');
forbidText('.claude/settings.json', 'UserPromptSubmit', 'Claude turn-by-turn update hook');
requireText('.opencode/plugins/harness-wf-status.mjs', 'opencode.startup', 'OpenCode startup-only update check');
forbidText('.opencode/plugins/harness-wf-status.mjs', "'chat.message'", 'OpenCode turn-by-turn update hook');
if (codexHookConfig && !codexHookConfig.includes('wf-auto-update-prompt.mjs')) {
  errors.push('.codex/hooks.json missing startup wf-auto update check');
}
if (claudeSettings.includes('"hooks"') && !claudeSettings.includes('wf-auto')) {
  errors.push('.claude/settings.json hooks may only be used for wf-auto');
}
if (read('.codex/config.toml').includes('hooks = true') && !codexHookConfig.includes('wf-auto-update-prompt.mjs')) {
  errors.push('.codex/config.toml may enable hooks only with a Harness hook configuration');
}

// AGENTS.md must be a thin shim — no Harness/WF-MAX/command table content
forbidText('AGENTS.md', 'WF-MAX Role Contract', 'AGENTS.md WF-MAX section');
forbidText('AGENTS.md', 'Key Commands', 'AGENTS.md command table');
forbidText('AGENTS.md', 'Harness/MEMORY.md', 'AGENTS.md Harness routing (must defer to CLAUDE.md)');
forbidText('AGENTS.md', 'Harness/README.md', 'AGENTS.md Harness routing (must defer to CLAUDE.md)');
requireText('AGENTS.md', 'CLAUDE.md', 'AGENTS.md CLAUDE.md reference');
requireText('AGENTS.md', 'compatibility entry', 'AGENTS.md Codex shim purpose');
requireText('AGENTS.md', 'single source', 'AGENTS.md CLAUDE.md as single source');

// Implicit WF trigger phrases forbidden in active runtime docs and SETUP
for (const rel of ['Harness/README.md', 'Harness/specs/workflows/WF.md', 'Harness/specs/runtime/context-loading.md', 'Harness/specs/runtime/subagents.md', 'Harness/specs/guides/SETUP.md']) {
  forbidText(rel, 'workflow mode', 'implicit WF trigger: workflow mode');
  forbidText(rel, 'wk mode', 'implicit WF trigger: wk mode');
}
// SETUP must not require old WF complete-role-chain contract
requireText('Harness/specs/guides/SETUP.md', 'explicit WF entry only', 'SETUP explicit WF entry contract');
requireText('Harness/specs/guides/SETUP.md', 'WF-Light', 'SETUP WF-Light tier reference');
requireText('Harness/specs/guides/SETUP.md', 'WF-Max-Useful', 'SETUP WF-Max-Useful tier reference');

// Memory Preflight markers required in workflow skill adapters
for (const skill of ['wf', 'wf-max', 'wf-auto', 'subagent-orchestrator']) {
  requireText(`.claude/skills/${skill}/SKILL.md`, 'Memory Preflight', `${skill} skill Memory Preflight section`);
}
for (const skill of cacheDisciplinedSkills) {
  requireText(`.claude/skills/${skill}/SKILL.md`, 'Cache Discipline', `${skill} skill cache discipline`);
}
requireText('.claude/skills/wf-auto/SKILL.md', 'bounded test tick', 'wf-auto skill bounded tick auto capsule rule');
requireText('.claude/skills/wf-auto/SKILL.md', 'missing auto capsule evidence', 'wf-auto skill missing auto capsule failure rule');
requireText('.claude/skills/wf-auto/SKILL.md', 'Harness/tasks/continuous/PLAN.md', 'wf-auto skill PLAN record');
requireText('.claude/skills/wf-auto/SKILL.md', 'Harness/tasks/continuous/PROGRESS.md', 'wf-auto skill PROGRESS record');
requireText('.claude/skills/wf-auto/SKILL.md', 'evidence ledger path/summary', 'wf-auto skill return evidence ledger path');
if (fs.existsSync(path.join(root, '.claude/skills/wf-browser/SKILL.md'))) {
  requireText('.claude/skills/wf-browser/SKILL.md', 'Cache Discipline', 'wf-browser skill cache discipline');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Two Jobs', 'wf-browser two-job design/control purpose');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Architecture design', 'wf-browser architecture design purpose');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Runtime control', 'wf-browser runtime control purpose');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Readiness Levels', 'wf-browser readiness levels');
  requireText('.claude/skills/wf-browser/SKILL.md', 'L4 | Multi-agent-ready', 'wf-browser multi-agent readiness level');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Mode Selection', 'wf-browser mode selection');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Architecture Design Track', 'wf-browser architecture design track');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Runtime Control Track', 'wf-browser runtime control track');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Recovery Track', 'wf-browser recovery track');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Design-To-Control Continuity', 'wf-browser design-to-control continuity');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Quality Gates', 'wf-browser quality gates');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Agent-Operable Web Runtime', 'wf-browser agent-operable runtime');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Browser Evidence Contract', 'wf-browser browser evidence contract');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Agent-Operable UI Contract', 'wf-browser agent-operable UI contract');
  requireText('.claude/skills/wf-browser/SKILL.md', 'WebSocket', 'wf-browser WebSocket bridge guidance');
  requireText('.claude/skills/wf-browser/SKILL.md', 'observe.*', 'wf-browser observation primitives');
  requireText('.claude/skills/wf-browser/SKILL.md', 'act.*', 'wf-browser action primitives');
  requireText('.claude/skills/wf-browser/SKILL.md', 'virtual cursor', 'wf-browser virtual cursor guidance');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Backend Broker', 'wf-browser backend broker guidance');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Multi-Agent Window Contract', 'wf-browser multi-agent window contract');
  requireText('.claude/skills/wf-browser/SKILL.md', 'window.create', 'wf-browser window pool operations');
  requireText('.claude/skills/wf-browser/SKILL.md', 'leaseId', 'wf-browser window lease identity');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Third-Party Pages', 'wf-browser third-party fallback guidance');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Harness/wf-browser/', 'wf-browser artifact workspace');
  requireText('.claude/skills/wf-browser/SKILL.md', 'Playwright', 'wf-browser Playwright fallback');
  requireText('.claude/skills/wf-browser/SKILL.md', 'CDP', 'wf-browser CDP fallback');
  requireText('.claude/skills/wf-browser/SKILL.md', 'data-testid', 'wf-browser data-testid guidance');
  requireText('.claude/skills/wf-browser/SKILL.md', 'accessible labels/roles', 'wf-browser accessible selector guidance');
  requireText('.claude/skills/wf-browser/SKILL.md', 'inputs, buttons, filters, rows, empty/error/loading states', 'wf-browser controllable UI coverage targets');
}

// Direct command checks
requireText('Harness/README.md', '/wf-update', 'wf-update direct command reference');
requireText('.claude/commands/wf-update.md', 'Do not invoke a skill', 'wf-update direct command boundary');
requireText('Harness/README.md', '| `/wf-ui`, `$wf-ui` |', 'wf-ui direct command row');
for (const rel of ['.claude/commands/wf-update.md', '.opencode/commands/wf-update.md']) {
  requireText(rel, '## Cache Discipline', `${rel} cache discipline`);
  requireText(rel, 'agent.safeApplyCommand', `${rel} safe apply step`);
  requireText(rel, 'wf-update-runner.mjs', `${rel} multi-scope update runner`);
  requireText(rel, '--apply-safe', `${rel} apply-safe command`);
  requireText(rel, 'agent.aiMergeRequired', `${rel} AI merge step`);
  requireText(rel, '--accept-local', `${rel} accept-local decision`);
  requireText(rel, '--accept-merged', `${rel} accept-merged decision`);
  requireText(rel, '--accept-template', `${rel} accept-template decision`);
  requireText(rel, '--finalize', `${rel} finalize command`);
  requireText(rel, 'strict `--apply` only when', `${rel} strict apply boundary`);
  requireText(rel, 'sync-host-global.mjs', `${rel} host-global sync step`);
  requireText(rel, '## Return', `${rel} return contract`);
  requireText(rel, 'agent.releaseHighlights', `${rel} release highlights summary`);
  requireText(rel, 'releaseNotes.highlights', `${rel} release notes fallback`);
}
for (const rel of ['.claude/commands/wf-ui.md', '.opencode/commands/wf-ui.md']) {
  requireText(rel, 'direct command', `${rel} wf-ui direct command classification`);
  requireText(rel, 'Do not invoke a skill', `${rel} wf-ui direct no-skill boundary`);
  requireText(rel, 'create-harness-vibe-coding wf-ui', `${rel} wf-ui direct CLI launch`);
  requireText(rel, '--host 127.0.0.1', `${rel} wf-ui loopback host`);
  requireText(rel, '--open', `${rel} wf-ui browser open flag`);
  requireText(rel, '--detach', `${rel} wf-ui detached launch flag`);
  forbidText(rel, 'workflow command', `${rel} wf-ui workflow routing`);
  forbidText(rel, 'Load `CLAUDE.md`', `${rel} wf-ui old router preload`);
  forbidText(rel, 'Harness/tasks/task-wf-ui-control-0729/STATE.json', `${rel} wf-ui old task-state preload`);
}
for (const rel of ['.claude/skills/wf-ui/SKILL.md', '.agents/skills/wf-ui/SKILL.md']) {
  requireText(rel, 'Codex compatibility shim', `${rel} wf-ui Codex compatibility shim`);
  requireText(rel, 'direct command', `${rel} wf-ui direct command statement`);
  requireText(rel, 'create-harness-vibe-coding wf-ui', `${rel} wf-ui direct CLI launch`);
  requireText(rel, '--detach', `${rel} wf-ui detached launch flag`);
  forbidText(rel, 'Harness/tasks/task-wf-ui-control-0729/STATE.json', `${rel} wf-ui old task-state preload`);
}
requireText('Harness/scripts/wf-update-check.mjs', 'releaseHighlights', 'wf-update-check release highlights metadata');
requireText('Harness/scripts/wf-update-check.mjs', 'updateReportRequired', 'wf-update-check user update report requirement');
requireText('.claude/commands/wf-help.md', 'direct command', 'wf-help wf-update direct command classification');
requireText('.claude/commands/wf-help.md', '$wf-help', 'wf-help Codex compatibility usage');
requireText('.claude/commands/wf-help.md', '/wf-browser', 'wf-help built-in browser workflow row');
requireText('.claude/commands/wf-help.md', '| `/wf-ui` | direct command |', 'wf-help wf-ui direct command row');
requireText('.opencode/commands/wf-help.md', '/wf-browser', 'OpenCode wf-help built-in browser workflow row');
requireText('.opencode/commands/wf-help.md', '| `/wf-ui` | direct command |', 'OpenCode wf-help wf-ui direct command row');

// wf-update skill must NOT claim Claude Code /wf-update as a skill invocation
// (allow mentions in the description/body that say "direct command" — those are correct)
forbidText('.claude/skills/wf-update/SKILL.md', 'Claude Code: use', 'wf-update skill Claude Code skill-claim');
forbidText('.claude/skills/wf-update/SKILL.md', 'Claude Code and Codex', 'wf-update skill old dual-platform claim');
requireText('.claude/skills/wf-update/SKILL.md', 'Codex compatibility', 'wf-update skill Codex compatibility statement');

// OpenCode command parity
requireText('.opencode/commands/wf-help.md', 'Do not invoke a skill', 'OpenCode wf-help direct command boundary');
requireText('.opencode/commands/wf-update.md', 'Do not invoke a skill', 'OpenCode wf-update direct command boundary');
for (const command of opencodeWorkflowCommands) {
  requireText(`.opencode/commands/${command}.md`, 'workflow command', `OpenCode ${command} workflow command classification`);
  requireText(`.opencode/commands/${command}.md`, `.claude/skills/${command}/SKILL.md`, `OpenCode ${command} wrapper skill routing`);
  requireText(`.opencode/commands/${command}.md`, 'Harness/MEMORY.md', `OpenCode ${command} wrapper router load`);
  requireText(`.opencode/commands/${command}.md`, 'Cache-First Context Contract', `OpenCode ${command} cache-first routing`);
}
if (fs.existsSync(path.join(root, '.opencode/commands/wf-browser.md'))) {
  requireText('.opencode/commands/wf-browser.md', 'Cache-First Context Contract', 'OpenCode wf-browser cache-first routing');
}

// wf-max adapter must stay tier-aware, not the old unconditional contract
forbidText('.claude/skills/wf-max/SKILL.md', 'every WF role, gate, and acceptance rule still', 'old wf-max unconditional role/gate inheritance');
forbidText('.claude/skills/wf-max/SKILL.md', 'Final acceptance requires verifier evidence, cross-review, and reflector PASS', 'old wf-max unconditional final acceptance');
requireText('.claude/skills/wf-max/SKILL.md', 'Final acceptance is tier-aware', 'wf-max tier-aware final acceptance');

// New small-fast agents
requireText('.claude/agents/task-scribe.md', 'model: haiku', 'task-scribe must use haiku model');
requireText('.claude/agents/codebase-explorer.md', 'model: haiku', 'codebase-explorer must use haiku model');
requireText('.claude/agents/codebase-explorer.md', 'read-only', 'codebase-explorer read-only contract');

// WF-KERNEL.md required invariants
requireText('Harness/specs/workflows/WF-KERNEL.md', 'Ready-Queue', 'WF-KERNEL ready-queue section');
requireText('Harness/specs/workflows/WF-KERNEL.md', 'Role / Model Matrix', 'WF-KERNEL role-model matrix');
requireText('Harness/specs/workflows/WF-KERNEL.md', 'Dispatch Packet', 'WF-KERNEL dispatch packet format');
requireText('Harness/specs/workflows/WF-KERNEL.md', 'Task Type', 'WF-KERNEL task type routing');
requireText('Harness/specs/workflows/WF-KERNEL.md', 'small-fast', 'WF-KERNEL small-fast tier mapping');

// WF variants reference WF-KERNEL
requireText('Harness/specs/workflows/WF.md', 'WF-KERNEL.md', 'WF.md references WF-KERNEL');
requireText('Harness/specs/workflows/WF-MAX.md', 'WF-KERNEL.md', 'WF-MAX.md references WF-KERNEL');
requireText('Harness/specs/workflows/WF-MAX.md', 'Use proven channels only', 'WF-MAX proven-channel degradation rule');
requireText('Harness/specs/workflows/WF-MAX.md', 'Evidence-Packet', 'WF-MAX evidence-packet channel record');
requireText('Harness/specs/workflows/WF-MAX.md', 'Do not create ad hoc probe scripts', 'WF-MAX no ad hoc probe scripts');

// Tier-aware acceptance: WF-Light must NOT require global cross-review/reflector
requireText('Harness/specs/workflows/WF.md', 'Cross-review and reflector NOT mandatory', 'WF.md WF-Light no mandatory cross-review');
requireText('Harness/specs/workflows/WF-KERNEL.md', 'Cross-review and reflector are NOT mandatory', 'WF-KERNEL WF-Light no mandatory cross-review');

// WF-MAX: maximum safe fan-out, not unconditional
requireText('Harness/specs/workflows/WF-MAX.md', 'maximum safe fan-out', 'WF-MAX maximum safe fan-out');
requireText('Harness/specs/workflows/WF-MAX.md', 'WF-Max-Useful', 'WF-MAX useful fan-out mode');
requireText('Harness/specs/workflows/WF-MAX.md', 'WF-Max-Strict', 'WF-MAX strict override mode');

// task-scribe is task-state write exception
requireText('Harness/specs/runtime/subagents.md', 'task-scribe', 'subagents.md task-scribe registration');
requireText('Harness/specs/runtime/dispatch.md', 'task-scribe', 'dispatch.md task-scribe roster');
requireText('Harness/specs/workflows/WF-KERNEL.md', 'task-scribe', 'WF-KERNEL task-scribe ownership');
forbidText('Harness/specs/workflows/WF-KERNEL.md', 'Only the main agent writes task', 'old single-writer rule');

// Old WF contract must not return to hot-path docs:
// /wf is WF-KERNEL tiered orchestration, not a default complete role chain;
// /wf-max defaults to WF-Max-Useful, unconditional fan-out is strict-only.
const hotPathDocs = [
  'CLAUDE.md',
  'Harness/MEMORY.md',
  'Harness/README.md',
  'Harness/specs/workflows/WF.md',
  'Harness/specs/workflows/WF-MAX.md',
  'Harness/specs/workflows/WF-AUTO.md',
  'Harness/specs/workflows/WF-AUTO-SPARK.md',
  'Harness/specs/workflows/WF-KERNEL.md',
  'Harness/specs/runtime/agent-workflow.md',
  'Harness/specs/runtime/dispatch.md',
  'Harness/specs/runtime/subagents.md',
  'Harness/specs/runtime/context-loading.md',
  'Harness/specs/protocols/ACCEPTANCE_PROTOCOL.md',
];
for (const rel of hotPathDocs) {
  forbidText(rel, 'complete role chain mandatory', 'old /wf default complete-role-chain contract');
  forbidText(rel, 'default complete role chain', 'old /wf default complete-role-chain contract');
  forbidText(rel, 'requires the complete role chain by default', 'old /wf default complete-role-chain contract');
  forbidText(rel, 'mandatory maximum fan-out', 'old /wf-max unconditional fan-out contract');
  forbidText(rel, 'strict superset: complete role chain plus maximum parallelism', 'old /wf-max strict-superset contract');
}

// WF-STATE.md and TASK_ARCHIVE.md must be reachable from the entry router
requireText('CLAUDE.md', 'Harness/specs/workflows/WF-STATE.md', 'CLAUDE.md WF-STATE routing');
requireText('CLAUDE.md', 'Harness/specs/protocols/TASK_ARCHIVE.md', 'CLAUDE.md TASK_ARCHIVE routing');
requireText('Harness/README.md', 'WF-STATE.md', 'README WF-STATE routing');
requireText('Harness/specs/protocols/TASK_ARCHIVE.md', 'archive-tasks.mjs', 'TASK_ARCHIVE script reference');
requireText('Harness/specs/workflows/WF-STATE.md', 'task-state.mjs', 'WF-STATE task-state script contract');
requireText('Harness/specs/protocols/TASK_ARCHIVE.md', 'task-state.mjs', 'TASK_ARCHIVE task-state script reference');

// Task-state consistency: prompt text is not authoritative for machine state.
const rootTaskProgress = parseRootTaskProgress(read('Harness/PROGRESS.md'));
const outerTaskSet = new Set(taskDirs.filter(name => !TASK_RESERVED.has(name) && !name.startsWith('_')));
const rootTaskRows = new Set(rootTaskProgress.rows.map(row => row.id));

if (rootTaskProgress.activeTask && !outerTaskSet.has(rootTaskProgress.activeTask)) {
  taskStateIssue(`Harness/PROGRESS.md Active Task "${rootTaskProgress.activeTask}" does not exist under Harness/tasks/`);
}

for (const row of rootTaskProgress.rows) {
  if (!outerTaskSet.has(row.id)) {
    taskStateIssue(`Harness/PROGRESS.md Task Index row has no outer task directory: ${row.id}`);
  }
  if (row.phase && !normalizeTaskPhase(row.phase)) {
    taskStateIssue(`Harness/PROGRESS.md Task Index row has unknown phase for ${row.id}: ${row.phase}`);
  }
}

const activeStateTasks = [];
for (const taskDir of outerTaskSet) {
  if (!rootTaskRows.has(taskDir)) {
    taskStateIssue(`Harness/tasks/${taskDir}/ is missing from Harness/PROGRESS.md Task Index`);
  }

  const statePath = path.join(root, 'Harness', 'tasks', taskDir, 'STATE.json');
  if (!fs.existsSync(statePath)) {
    taskStateIssue(`Harness/tasks/${taskDir}/STATE.json is missing; run node Harness/scripts/task-state.mjs reconcile --apply`);
    continue;
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (err) {
    taskStateIssue(`Harness/tasks/${taskDir}/STATE.json is invalid JSON: ${err.message}`);
    continue;
  }

  if (state.taskId && state.taskId !== taskDir) {
    taskStateIssue(`Harness/tasks/${taskDir}/STATE.json taskId "${state.taskId}" does not match directory`);
  }
  const status = normalizeTaskStatus(state.status);
  const phase = normalizeTaskPhase(state.phase);
  if (state.status && !status) {
    taskStateIssue(`Harness/tasks/${taskDir}/STATE.json has unknown status "${state.status}"`);
  }
  if (state.phase && !phase) {
    taskStateIssue(`Harness/tasks/${taskDir}/STATE.json has unknown phase "${state.phase}"`);
  }
  if (status === 'active') activeStateTasks.push(taskDir);
  if (status === 'active' && taskDir !== rootTaskProgress.activeTask) {
    taskStateIssue(`Harness/tasks/${taskDir}/STATE.json is active but Harness/PROGRESS.md Active Task is ${rootTaskProgress.activeTask || 'None'}; run node Harness/scripts/task-state.mjs reconcile --apply`);
  }
  if (taskDir === rootTaskProgress.activeTask && status && status !== 'active') {
    taskStateIssue(`Harness/PROGRESS.md Active Task points to ${taskDir}, but STATE.json status is "${status}"; run node Harness/scripts/task-state.mjs reconcile --apply`);
  }
}

if (activeStateTasks.length > 1) {
  taskStateIssue(`Multiple STATE.json files are active: ${activeStateTasks.join(', ')}; run node Harness/scripts/task-state.mjs reconcile --apply`);
}

// Outer task capsule cap: keep Harness/tasks/ lean (see Harness/specs/protocols/TASK_ARCHIVE.md)
const OUTER_TASK_CAP = 5;
const outerTasks = taskDirs.filter(name => !TASK_RESERVED.has(name) && !name.startsWith('_'));
if (outerTasks.length > OUTER_TASK_CAP) {
  const capMsg = `Harness/tasks/ has ${outerTasks.length} outer task capsules (cap ${OUTER_TASK_CAP}); remind the user to run $wf-task-archive when they want to archive completed tasks (apply mode maps to node Harness/scripts/task-state.mjs archive --apply)`;
  if (strict) errors.push(capMsg);
  else console.warn(`Warning: ${capMsg}`);
}

finishValidation();
