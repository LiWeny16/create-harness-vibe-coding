#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const strict = args.has('--strict') || args.has('--post-bootstrap');

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: node Harness/scripts/validate-harness.mjs [--strict]

Default mode checks scaffold structure, links, agents, and skills.
--strict also fails when project fact docs still contain unresolved {{TOKEN}} placeholders.
Literal explanatory {{...}} text is allowed.`);
  process.exit(0);
}

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
  'wf',
  'tdd',
  'wf-update',
  'wf-max',
  'wf-review',
  'wf-learn',
  'subagent-orchestrator',
  'wf-readme',
  'wf-agents-docs',
  'wf-remove',
  'wf-auto',
  'wf-auto-spark',
];

const opencodeWorkflowCommands = [
  'wf',
  'wf-max',
  'wf-auto',
  'wf-auto-spark',
  'wf-learn',
  'wf-review',
  'wf-readme',
  'wf-remove',
];

const cacheDisciplinedSkills = commonSkills.filter(skill => (
  skill === 'subagent-orchestrator' || skill.startsWith('wf')
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
  'Harness/WF.md',
  'Harness/WF-MAX.md',
  'Harness/ACCEPTANCE_PROTOCOL.md',
  'Harness/AGENT_ISOLATION.md',
  'Harness/HARNESS_BRIDGE.md',
  'Harness/DEBUG_PROTOCOL.md',
  'Harness/MEMORY_PROTOCOL.md',
  'Harness/templates/PRD.template.md',
  'Harness/templates/ACCEPTANCE.template.md',
  'Harness/templates/UI_CONTRACT.template.md',
  'Harness/templates/API_CONTRACT.template.md',
  'Harness/templates/TEST_PLAN.template.md',
  'Harness/templates/PLAYWRIGHT_SPEC.template.ts',
  'Harness/templates/VALIDATION_REPORT.template.md',
  ...memoryFiles,
  '.codex/config.toml',
  'opencode.json',
  '.claude/settings.json',
  '.claude/commands/wf-help.md',
  '.claude/commands/wf-update.md',
  '.opencode/commands/wf-help.md',
  '.opencode/commands/wf-update.md',
  ...opencodeWorkflowCommands.map(command => `.opencode/commands/${command}.md`),
  '.opencode/plugins/harness-wf-status.mjs',
  '.claude/rules/ecc/common.md',
  ...commonAgents.map(agent => `.claude/agents/${agent}.md`),
  ...commonAgents.map(agent => `.opencode/agents/${agent}.md`),
  ...commonSkills.map(skill => `.claude/skills/${skill}/SKILL.md`),
  ...commonSkills.map(skill => `.agents/skills/${skill}/SKILL.md`),
  'Harness/README.md',
  'Harness/SETUP.md',
  'Harness/PROGRESS.md',
  'Harness/lifecycle.md',
  'Harness/subagents.md',
  'Harness/dispatch.md',
  'Harness/extension.md',
  'Harness/context-loading.md',
  'Harness/ownership.manifest.json',
  'Harness/WF-KERNEL.md',
  'Harness/agent-workflow.md',
  'Harness/architecture.md',
  'Harness/research/README.md',
  'Harness/research/research-results.md',
  'Harness/research/PRD.md',
  'Harness/scripts/context-budget.mjs',
  'Harness/scripts/l2-cache-telemetry.mjs',
  'Harness/scripts/wf-update-check.mjs',
  'Harness/scripts/wf-remove.mjs',
  'Harness/scripts/scan-clean.mjs',
  'Harness/scripts/archive-tasks.mjs',
  'Harness/WF-STATE.md',
  'Harness/TASK_ARCHIVE.md',
  'Harness/.harness-version',
];

const projectFacts = [
  'Harness/PROGRESS.md',
  'Harness/research/PRD.md',
  'Harness/research/research-results.md',
  'Harness/architecture.md',
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
  'Harness/subagents.md',
  'Harness/dispatch.md',
  'Harness/context-loading.md',
];

const errors = [];

function read(rel) {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function requireText(rel, text, label = text) {
  const body = read(rel);
  if (body && !body.includes(text)) errors.push(`${rel} missing ${label}`);
}

function forbidText(rel, text, label = text) {
  const body = read(rel);
  if (body && body.includes(text)) errors.push(`${rel} contains forbidden ${label}`);
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
const TASK_RESERVED = new Set(['_template', 'auto', '_archive']);

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
  const pattern = /`\/(wf(?:-[a-z0-9]+)?)(?:\s+[^`]*)?`/g;

  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      const command = `/${match[1]}`;
      if (command === '/wf-help') continue;
      if (command === '/wf-browser') continue; // optional workflow, not a required skill
      commands.add(command);
    }
  }

  return [...commands].sort();
}

for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) {
    errors.push(`missing required file: ${rel}`);
  }
}

const manifestText = read('Harness/ownership.manifest.json');
if (manifestText) {
  try {
    const manifest = JSON.parse(manifestText);
    for (const entry of manifest.frameworkOwned || []) {
      if (!entry || typeof entry.path !== 'string') continue;
      if (!fs.existsSync(path.join(root, ...entry.path.split('/')))) {
        errors.push(`ownership manifest frameworkOwned file missing: ${entry.path}`);
      }
    }
  } catch (err) {
    errors.push(`Harness/ownership.manifest.json is not valid JSON: ${err.message}`);
  }
}

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
// file is marked ANTI-PATTERN. See Harness/WF-MAX.md "Worker Channel Degradation & Independence".
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

requireText('Harness/MEMORY_PROTOCOL.md', 'L1/L2/L3 Memory Architecture', 'L2/L3 memory architecture section');
requireText('Harness/MEMORY_PROTOCOL.md', 'Memory Candidate Detection', 'memory candidate detection section');
requireText('Harness/MEMORY_PROTOCOL.md', 'explicit user preference', 'explicit user preference immediate write rule');
requireText('Harness/MEMORY_PROTOCOL.md', 'Memory Routing (L3)', 'memory routing section');
requireText('Harness/MEMORY_PROTOCOL.md', 'Scenario pack', 'route scoring scenario pack');
requireText('Harness/MEMORY_PROTOCOL.md', 'same tool or command pattern fails 3+ times', 'tool reflection trigger');
requireText('Harness/MEMORY_PROTOCOL.md', 'user corrects the same assumption or preference 2+ times', 'user correction reflection trigger');
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
requireText('CLAUDE.md', 'If `Harness/` exists, this repository is governed by the Harness contract', 'Harness binding contract');
requireText('CLAUDE.md', 'memory and resource router', 'memory/resource router');
requireText('CLAUDE.md', '## 5a. Low-Noise Progress', 'low-noise progress section');
requireText('CLAUDE.md', "Match the user's language for all user-facing prose", 'user-facing language match rule');
requireText('CLAUDE.md', 'Keep intermediate user updates to 1-2 short sentences', 'low-noise intermediate update rule');
requireText('.claude/rules/ecc/common.md', '## Low-Noise Progress', 'ECC low-noise progress section');
requireText('.claude/rules/ecc/common.md', "Match the user's language for user-facing prose", 'ECC user-facing language match rule');
requireText('.claude/rules/ecc/common.md', 'Do not recap plans, paste logs, or narrate obvious file reads', 'ECC low-noise no-recap rule');
requireText('.claude/rules/ecc/common.md', 'excluding `/wf-help` and `/wf-update`', 'ECC direct command exemption');
requireText('Harness/README.md', 'Load By Task', 'Harness task router');
requireText('Harness/README.md', 'Need context/cache/token efficiency', 'cache/token router row');
requireText('Harness/context-loading.md', 'Context Tiers', 'context tier load budget section');
requireText('Harness/context-loading.md', 'automatic route profiles, not user-selected modes', 'context tiers are automatic route profiles');
requireText('Harness/context-loading.md', 'Budgets are regression guards, not exclusion rules', 'context budgets do not block required files');
requireText('Harness/context-loading.md', 'Do not skip required rules', 'context budget correctness priority');
requireText('Harness/context-loading.md', 'Escalation rule', 'context-loading targeted escalation rule');
requireText('Harness/context-loading.md', 'Thin startup', 'thin startup context tier');
requireText('Harness/context-loading.md', 'Routed skill/doc', 'routed skill/doc lazy tier');
requireText('Harness/context-loading.md', 'Cache-First Context Contract', 'cache-first context contract');
requireText('Harness/context-loading.md', 'Cache Validation Levels', 'cache validation levels');
requireText('Harness/context-loading.md', 'Do not claim real cache hits', 'real cache telemetry boundary');
requireText('Harness/context-loading.md', 'cached_tokens', 'OpenAI cache telemetry field');
requireText('Harness/context-loading.md', 'cache_read_input_tokens', 'Anthropic cache telemetry field');
requireText('Harness/WF.md', 'Cache Discipline', 'WF cache discipline');
requireText('Harness/WF-KERNEL.md', 'Cache-First Context Contract', 'WF-KERNEL cache-first contract');
requireText('Harness/dispatch.md', 'Cache-first dispatch', 'dispatch cache-first discipline');
requireText('Harness/subagents.md', 'Cache-first discipline', 'subagents cache-first discipline');
forbidText('CLAUDE.md', 'Harness/SETUP.md', 'CLAUDE.md SETUP reference');
forbidText('CLAUDE.md', 'follow it before normal project work', 'installed-project SETUP hot-path routing');
requireText('Harness/SETUP.md', 'Harness/MEMORY_PROTOCOL.md', 'setup memory protocol reference');
requireText('Harness/SETUP.md', 'no startup dependency on this setup reference', 'SETUP startup boundary');
forbidText('Harness/SETUP.md', 'bootstrap contract line', 'stale SETUP-to-CLAUDE bootstrap contract');
forbidText('Harness/context-loading.md', 'Always keep:', 'ambiguous always-load context rule');
requireText('Harness/scripts/context-budget.mjs', 'thin-startup', 'context-budget thin startup route');
requireText('Harness/scripts/context-budget.mjs', 'cache-diagnostics-route', 'context-budget cache diagnostics route');
requireText('Harness/scripts/context-budget.mjs', 'not runtime exclusion rules', 'context-budget non-exclusion guard');
requireText('Harness/scripts/context-budget.mjs', 'approxTokens', 'context-budget approximate token output');
requireText('Harness/context-loading.md', 'Harness/scripts/l2-cache-telemetry.mjs', 'L2 telemetry script reference');
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
requireText('Harness/subagents.md', 'Subagents are readers and reporters', 'subagent state committer rule');
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

const dispatch = read('Harness/dispatch.md');
if (dispatch) {
  for (const agent of commonAgents) {
    if (!dispatch.includes(`\`${agent}\``)) errors.push(`Harness/dispatch.md missing common agent: ${agent}`);
  }
  if (!dispatch.includes('## Handoff Format')) errors.push('Harness/dispatch.md missing heading: ## Handoff Format');
}

const contextLoading = read('Harness/context-loading.md');
if (contextLoading) {
  if (!contextLoading.includes('Harness/README.md` is the primary Harness documentation router')) {
    errors.push('Harness/context-loading.md must declare Harness/README.md as the primary Harness documentation router');
  }
  for (const pack of contextPacks) {
    if (!contextLoading.includes(pack)) errors.push(`Harness/context-loading.md missing subagent pack: ${pack}`);
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
    // Optional workflows (browser-e2e, ts-react-frontend, etc.) may not be installed
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

requireUiSelectorContract('Harness/workflows/browser-e2e.md');
requireUiSelectorContract('Harness/workflows/ts-react-frontend.md');

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

requireText('Harness/extension.md', 'Skills should extend the harness');
requireText('Harness/agent-workflow.md', 'Harness/tasks/<task-id>/PROGRESS.md');
requireText('Harness/README.md', 'Task records are compact by default', 'compact task record router rule');
requireText('Harness/agent-workflow.md', 'AC record size', 'compact AC record size rule');
requireText('Harness/ACCEPTANCE_PROTOCOL.md', 'Default to 1-3 concise ACs', 'compact AC default');
requireText('Harness/WF.md', 'task-scribe', 'compact heartbeat rule');
requireText('Harness/tasks/_template/PLAN.md', 'Compact task record', 'compact task PLAN template');
requireText('Harness/tasks/_template/PLAN.md', 'Default: keep 1-3 concise ACs', 'compact task PLAN AC guidance');
requireText('Harness/tasks/_template/PROGRESS.md', 'Compact heartbeat', 'compact task PROGRESS template');
requireText('Harness/agent-workflow.md', 'TDD-GUIDE.md', 'agent workflow loads TDD guide');
requireText('Harness/agent-workflow.md', 'real user-path test', 'agent workflow real user path requirement');
requireText('Harness/research/README.md', 'research-results.md');
requireText('Harness/WF.md', 'Orchestration Loop', 'WF orchestration loop');
requireText('Harness/WF.md', 'WF-KERNEL.md', 'WF references WF-KERNEL');
requireText('Harness/WF.md', 'Cross-review and reflector NOT mandatory', 'WF-Light no mandatory cross-review');
requireText('Harness/WF.md', '`.claude/agents/`', 'WF agent roster path');
requireText('Harness/WF.md', 'Harness/tasks/', 'WF task directory reference');
requireText('Harness/README.md', 'explicit WF token', 'WF explicit contract');
requireText('Harness/README.md', 'tier-gated acceptance', 'WF tiered acceptance router output');
requireText('.claude/skills/wf/SKILL.md', 'Harness/WF.md', 'wf skill loads core WF doc');
requireText('.claude/skills/wf/SKILL.md', 'Tier-aware acceptance', 'wf skill tier-aware acceptance');
requireText('.agents/skills/wf/SKILL.md', 'Harness/WF.md', 'Codex wf skill loads core WF doc');
requireText('.claude/skills/subagent-orchestrator/SKILL.md', 'Harness/subagents.md', 'subagent-orchestrator loads subagents doc');
requireText('.claude/skills/subagent-orchestrator/SKILL.md', '.claude/agents/', 'subagent-orchestrator built-in agent roster path');
requireText('.claude/skills/subagent-orchestrator/SKILL.md', 'WF/WF-MAX requires tier-specific', 'subagent-orchestrator WF tier-specific contract');
requireText('.claude/skills/wf-readme/SKILL.md', 'README.md', 'wf-readme loads README');
requireText('.claude/skills/wf-readme/SKILL.md', 'Harness/architecture.md', 'wf-readme links architecture docs');
requireText('Harness/subagents.md', '## Source Attribution', 'subagent source attribution');
requireText('Harness/subagents.md', 'npx skills find', 'find-skills discovery attribution');
requireText('Harness/subagents.md', 'superpowers:dispatching-parallel-agents', 'parallel-agent source attribution');
requireText('Harness/subagents.md', 'superpowers:subagent-driven-development', 'subagent-driven source attribution');
requireText('Harness/subagents.md', '## Built-in Agent Roster', 'built-in agent roster');
requireText('Harness/subagents.md', '## WF Default Fan-Out', 'WF default fan-out');
requireText('Harness/subagents.md', 'concrete conditions', 'subagent decision tree');
requireText('Harness/subagents.md', 'parallel planner/researcher/docs-researcher/architect subagents', 'WF roster orchestration shape');
requireText('Harness/subagents.md', '`reflector`', 'reflector agent roster');
requireText('Harness/subagents.md', 'reflector PASS', 'reflector review gate');
requireText('Harness/subagents.md', '## Efficiency Ladder', 'subagent efficiency ladder');
requireText('Harness/subagents.md', '## Review Gates', 'subagent review gates');
requireText('Harness/architecture.md', '## 2. Interface Decoupling', 'architecture interface decoupling');
requireText('Harness/architecture.md', '## 3. State Design', 'architecture state design');
requireText('Harness/architecture.md', 'Avoid speculative abstraction', 'anti-overengineering architecture rule');
requireText('CLAUDE.md', 'Use explicit interfaces or state models only when they protect a real boundary', 'CLAUDE interface/state simplicity rule');
requireText('Harness/README.md', '/wf-update', 'wf update startup instruction');
requireText('Harness/README.md', 'Need harness update', 'update routing row');
requireText('Harness/WF-MAX.md', 'three-layer architecture', 'WF-MAX three-layer architecture');
requireText('Harness/WF-MAX.md', 'dispatch permissions', 'WF-MAX role separation');
requireText('Harness/WF-MAX.md', 'file_claim', 'WF-MAX coloring algorithm');
requireText('Harness/WF-MAX.md', 'CEO → Manager → Worker', 'WF-MAX wave dispatch');
requireText('Harness/WF-MAX.md', 'inherits the full', 'WF-MAX strict superset');
requireText('Harness/WF-MAX.md', 'Cross-CLI', 'WF-MAX cross-CLI overflow');
requireText('Harness/WF-MAX.md', 'claude -p', 'WF-MAX Claude CLI overflow');
requireText('Harness/WF-MAX.md', 'codex exec', 'WF-MAX Codex CLI overflow');
requireText('Harness/WF-MAX.md', 'agents.max_threads', 'WF-MAX Codex max_threads config');
requireText('Harness/WF-MAX.md', 'agents.max_depth', 'WF-MAX Codex max_depth config');
requireText('Harness/WF-MAX.md', 'max_threads = 12', 'WF-MAX Codex scaffold max_threads default');
requireText('Harness/WF-MAX.md', 'max_depth = 1', 'WF-MAX Codex scaffold max_depth default');
requireText('Harness/WF-MAX.md', 'Ask the user before raising', 'WF-MAX asks before raising Codex thread cap');
requireText('Harness/WF-MAX.md', 'Close completed agents', 'WF-MAX close completed agents before overflow');
requireText('Harness/WF-MAX.md', 'Codex++', 'WF-MAX forbids relying on Codex++ as stable capacity');
requireText('.claude/skills/wf-max/SKILL.md', 'agents.max_threads', 'wf-max skill Codex thread config');
requireText('.claude/skills/wf-max/SKILL.md', 'max_threads = 12', 'wf-max skill Codex scaffold max_threads default');
requireText('.claude/skills/wf-max/SKILL.md', 'ask the user before raising', 'wf-max skill asks before raising Codex thread cap');
requireText('.claude/skills/wf-max/SKILL.md', 'Codex++', 'wf-max skill forbids Codex++ capacity assumption');
requireText('.codex/config.toml', '[agents]', 'Codex agents config table');
requireText('.codex/config.toml', 'max_threads = 12', 'Codex scaffold max_threads default');
requireText('.codex/config.toml', 'max_depth = 1', 'Codex scaffold max_depth default');
requireText('opencode.json', '"$schema": "https://opencode.ai/config.json"', 'OpenCode config schema');
requireText('opencode.json', '.claude/rules/ecc/common.md', 'OpenCode instructions reference to ECC rules');
requireText('Harness/README.md', '/wf-max', 'wf max router alias');
requireText('Harness/README.md', 'WF-MAX.md', 'WF-MAX router reference');
requireText('Harness/README.md', 'ACCEPTANCE_PROTOCOL.md', 'acceptance protocol router reference');
requireText('Harness/README.md', 'TDD-GUIDE.md', 'TDD guide router reference');
requireText('Harness/ACCEPTANCE_PROTOCOL.md', 'PRD-GATE', 'acceptance PRD gate');
requireText('Harness/ACCEPTANCE_PROTOCOL.md', 'AC-GATE', 'acceptance AC gate');
requireText('Harness/ACCEPTANCE_PROTOCOL.md', 'Acceptance Result', 'acceptance result matrix');
requireText('Harness/ACCEPTANCE_PROTOCOL.md', 'Syntax-only checks', 'syntax-only checks are not browser acceptance evidence');
requireText('Harness/AGENT_ISOLATION.md', 'implementer', 'agent isolation implementer rule');
requireText('Harness/HARNESS_BRIDGE.md', 'Network Trace Collector', 'harness bridge network trace collector');
requireText('Harness/WF-AUTO.md', 'Intent Checkpoint', 'wf-auto intent checkpoint');
requireText('Harness/WF-AUTO.md', 'Adaptive Coverage Exhaustion Gate', 'wf-auto adaptive coverage exhaustion gate');
requireText('Harness/WF-AUTO.md', 'dynamic high-risk obligations', 'wf-auto dynamic high-risk obligations');
requireText('Harness/WF-AUTO.md', 'two different confirmation strategies', 'wf-auto two different confirmation strategies');
requireText('Harness/WF-AUTO-ANGLES.md', 'Selection algorithm', 'wf-auto adaptive angle selection');
requireText('Harness/WF-AUTO-ANGLES.md', 'Dynamic obligations', 'wf-auto dynamic obligations');
requireText('Harness/WF-AUTO-ANGLES.md', 'Common probe recipes', 'wf-auto common probe recipes');
forbidText('Harness/WF-AUTO.md', 'All 8 exhausted', 'stale eight-angle exhaustion rule');
forbidText('Harness/WF-AUTO.md', '3 consecutive all-exhausted rounds', 'stale three-consecutive-all-exhausted stop rule');
forbidText('Harness/WF-AUTO.md', '8-Angle Exhaustion Gate', 'stale eight-angle exhaustion gate name');
forbidText('Harness/WF-AUTO-SPARK.md', '8 parallel external searches', 'stale eight-spark fixed-count search');
requireText('Harness/WF-AUTO.md', 'Inherited WF/WF-MAX Constraints', 'wf-auto inherited WF/WF-MAX constraints');
requireText('Harness/WF-AUTO.md', 'Mini PRD -> AC IDs -> test/validation plan -> implementer -> verifier', 'wf-auto per-cycle WF chain');
requireText('Harness/WF-AUTO.md', 'reflector PASS', 'wf-auto reflector gate');
requireText('Harness/WF-AUTO-SPARK.md', 'Inherited Execution Chain', 'wf-auto-spark inherited execution chain');
requireText('Harness/WF-AUTO-SPARK.md', 'External spark search replaces discovery only', 'wf-auto-spark discovery-only inheritance');
requireText('Harness/WF-AUTO-SPARK.md', 'reflector PASS', 'wf-auto-spark reflector gate');
requireText('Harness/WF-AUTO-SPARK.md', 'task-scribe formats task-state writes', 'wf-auto-spark task-scribe recorder delegation');
requireText('Harness/WF-AUTO-SPARK.md', 'searchFallback: ceo-direct', 'wf-auto-spark search fallback');
requireText('Harness/WF-AUTO-SPARK.md', 'pre-implementation triage', 'wf-auto-spark reflector escalation');
requireText('Harness/WF-AUTO-SPARK.md', 'Literal anti-pattern matching', 'wf-auto-spark anti-pattern invariant guard');
requireText('Harness/WF-AUTO-SPARK.md', 'node scripts/build-version.mjs --check', 'wf-auto-spark checksum drift guard');
requireText('Harness/WF-MAX.md', 'process-file delegation is the default', 'WF-MAX task-scribe process-file delegation default');
requireText('Harness/MEMORY_PROTOCOL.md', 'Scenario Memory Hints', 'memory protocol scenario hints');
requireText('Harness/MEMORY_PROTOCOL.md', 'WF closeout', 'memory protocol WF closeout injection row');
requireText('Harness/MEMORY_PROTOCOL.md', 'memory-master owns writes', 'memory protocol memory write ownership');
requireText('Harness/TDD-GUIDE.md', 'Browser/UI Acceptance TDD Gate', 'browser UI acceptance TDD gate');
requireText('Harness/TDD-GUIDE.md', 'syntax-only', 'syntax-only acceptance prohibition');
requireText('Harness/TDD-GUIDE.md', 'Playwright/CDP', 'Playwright/CDP acceptance requirement');
requireText('Harness/TDD-GUIDE.md', 'AC-by-AC result matrix', 'AC-by-AC TDD evidence matrix');
requireText('Harness/tasks/_template/PLAN.md', 'Expanded evidence required when triggered', 'task template expanded evidence trigger');
requireText('Harness/templates/TEST_PLAN.template.md', 'syntax-only checks', 'test plan template syntax-only prohibition');
requireText('.claude/skills/tdd/SKILL.md', 'Harness/ACCEPTANCE_PROTOCOL.md', 'tdd skill loads acceptance protocol');
requireText('.claude/skills/tdd/SKILL.md', 'Harness/HARNESS_BRIDGE.md', 'tdd skill loads harness bridge');
requireText('.claude/skills/tdd/SKILL.md', 'No syntax-only acceptance', 'tdd skill forbids syntax-only acceptance');
requireText('.claude/skills/wf-remove/SKILL.md', 'User-facing removal is the slash/skill command', 'wf-remove slash command is user-facing');
requireText('.claude/skills/wf-remove/SKILL.md', 'agent-internal execution steps', 'wf-remove script commands are agent-internal');
requireText('.claude/skills/wf-remove/SKILL.md', 'verify residual discovery folders', 'wf-remove residual discovery verification');
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
requireText('Harness/README.md', 'Need peer CLI automation docs', 'Harness router peer CLI automation docs row');
requireText('.opencode/commands/wf-review.md', 'peer-review contract', 'OpenCode wf-review wrapper peer-review contract');
requireText('Harness/subagents.md', 'For `/wf-review`, use the installed `reviewer` role', 'subagents wf-review role fallback');
requireText('.claude/agents/tdd-guide.md', 'Browser Acceptance Rules', 'tdd-guide browser acceptance rules');
requireText('.claude/agents/tdd-guide.md', 'real user actions', 'tdd-guide real user action requirement');
requireText('.claude/agents/test-writer.md', 'Harness/ACCEPTANCE_PROTOCOL.md', 'test-writer loads acceptance protocol');
requireText('.claude/agents/test-writer.md', 'real user-path test', 'test-writer real user path requirement');
requireText('.claude/agents/test-writer.md', 'network URL, method, payload', 'test-writer network assertion requirement');
requireText('.claude/agents/reflector.md', 'PASS, RETURN_TO_DEBUG, or BLOCKED', 'reflector verdict contract');
requireText('Harness/DEBUG_PROTOCOL.md', 'Layer Classification', 'debug layer classification');
requireText('Harness/MEMORY_PROTOCOL.md', 'AC ID', 'memory AC traceability');
requireText('Harness/subagents.md', 'Max parallelism', 'subagents max parallelism row');
requireText('Harness/dispatch.md', 'Concurrency group', 'dispatch concurrency group field');
requireText('Harness/dispatch.md', 'File claim', 'dispatch file claim field');
requireText('CLAUDE.md', '/wf-max', 'wf max startup instruction');
requireText('.claude/commands/wf-help.md', 'Do not invoke a skill', 'wf-help direct command boundary');
requireText('.claude/commands/wf-help.md', '| `/wf-help` |', 'wf-help command row');
requireText('.claude/commands/wf-help.md', '| `/wf-max <task>` |', 'wf-help wf-max row');
requireText('.claude/commands/wf-help.md', '| `/wf-auto` |', 'wf-help wf-auto row');
requireText('.claude/commands/wf-help.md', '| `/wf-readme <task>` |', 'wf-help wf-readme row');
requireText('Harness/README.md', '## Direct Commands', 'direct commands section');
requireText('Harness/README.md', '.claude/commands/wf-help.md', 'wf-help router reference');
requireText('Harness/WF-MAX.md', 'three-layer architecture', 'CLAUDE.md three-layer role architecture');
requireText('Harness/README.md', 'no runtime hook state', 'CLAUDE no-hook role enforcement statement');
requireText('Harness/README.md', 'no runtime hook state', 'README no-hook runtime statement');
requireText('Harness/WF-AUTO.md', 'WF-AUTO Hook Exception', 'wf-auto-only hook exception');
requireText('Harness/WF-AUTO.md', 'only `/wf-auto` may use a runtime hook', 'wf-auto-only hook boundary');
forbidText('CLAUDE.md', 'Enforced by hooks', 'WF-MAX hook enforcement claim');
forbidText('Harness/WF.md', 'MUST use at least 3 distinct role passes', 'old WF role-pass minimum');
forbidText('Harness/WF.md', 'at least three distinct role passes', 'old WF role-pass wording');
forbidText('Harness/dispatch.md', 'requires ≥3 distinct subagents', 'old dispatch WF role minimum');
forbidText('CLAUDE.md', 'WF-MAX hooks', 'WF-MAX hook enforcement claim');
forbidText('Harness/README.md', 'PreToolUse hook', 'WF-MAX PreToolUse hook claim');
forbidText('Harness/README.md', 'SessionStart hook', 'WF-MAX SessionStart hook claim');
forbidText('Harness/README.md', 'hook-managed', 'hook-managed runtime claim');
forbidText('Harness/README.md', 'HOOK_PROTOCOL.md', 'removed hook protocol reference');
forbidText('Harness/WF-AUTO.md', 'Hook-Assisted Long Loop', 'wf-auto hook loop section');
forbidText('Harness/dispatch.md', 'removes the cap entirely', 'unbounded runtime-cap claim');
forbidText('Harness/WF-MAX.md', 'no hard agent cap; recursion governed', 'unbounded agent-cap claim');
forbidText('Harness/MEMORY_PROTOCOL.md', 'Hooks may', 'hook-triggered memory claim');
forbidText('.claude/settings.json', 'wf-mode-hook.mjs', 'Claude WF hook command registration');
forbidText('.codex/hooks.json', 'wf-mode-hook.mjs', 'Codex WF hook command registration');
const codexHookConfig = read('.codex/hooks.json');
const claudeSettings = read('.claude/settings.json');
requireText('.codex/hooks.json', '"SessionStart"', 'Codex startup-only update hook');
requireText('.claude/settings.json', '"SessionStart"', 'Claude startup-only update hook');
forbidText('.codex/hooks.json', 'UserPromptSubmit', 'Codex turn-by-turn update hook');
forbidText('.claude/settings.json', 'UserPromptSubmit', 'Claude turn-by-turn update hook');
requireText('.opencode/plugins/harness-wf-status.mjs', 'opencode.startup', 'OpenCode startup-only update check');
forbidText('.opencode/plugins/harness-wf-status.mjs', "'chat.message'", 'OpenCode turn-by-turn update hook');
if (codexHookConfig && !codexHookConfig.includes('wf-auto')) {
  errors.push('.codex/hooks.json may only exist for a wf-auto hook configuration');
}
if (claudeSettings.includes('"hooks"') && !claudeSettings.includes('wf-auto')) {
  errors.push('.claude/settings.json hooks may only be used for wf-auto');
}
if (read('.codex/config.toml').includes('hooks = true') && !codexHookConfig.includes('wf-auto')) {
  errors.push('.codex/config.toml may enable hooks only with a wf-auto hook configuration');
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
for (const rel of ['Harness/README.md', 'Harness/WF.md', 'Harness/context-loading.md', 'Harness/subagents.md', 'Harness/SETUP.md']) {
  forbidText(rel, 'workflow mode', 'implicit WF trigger: workflow mode');
  forbidText(rel, 'wk mode', 'implicit WF trigger: wk mode');
}
// SETUP must not require old WF complete-role-chain contract
requireText('Harness/SETUP.md', 'explicit WF entry only', 'SETUP explicit WF entry contract');
requireText('Harness/SETUP.md', 'WF-Light', 'SETUP WF-Light tier reference');
requireText('Harness/SETUP.md', 'WF-Max-Useful', 'SETUP WF-Max-Useful tier reference');

// Memory Preflight markers required in workflow skill adapters
for (const skill of ['wf', 'wf-max', 'subagent-orchestrator']) {
  requireText(`.claude/skills/${skill}/SKILL.md`, 'Memory Preflight', `${skill} skill Memory Preflight section`);
}
for (const skill of cacheDisciplinedSkills) {
  requireText(`.claude/skills/${skill}/SKILL.md`, 'Cache Discipline', `${skill} skill cache discipline`);
}
if (fs.existsSync(path.join(root, '.claude/skills/wf-browser/SKILL.md'))) {
  requireText('.claude/skills/wf-browser/SKILL.md', 'Cache Discipline', 'wf-browser skill cache discipline');
}

// Direct command checks
requireText('Harness/README.md', '/wf-update', 'wf-update direct command reference');
requireText('.claude/commands/wf-update.md', 'Do not invoke a skill', 'wf-update direct command boundary');
for (const rel of ['.claude/commands/wf-update.md', '.opencode/commands/wf-update.md']) {
  requireText(rel, '## Cache Discipline', `${rel} cache discipline`);
  requireText(rel, 'agent.safeApplyCommand', `${rel} safe apply step`);
  requireText(rel, '--apply-safe', `${rel} apply-safe command`);
  requireText(rel, 'agent.aiMergeRequired', `${rel} AI merge step`);
  requireText(rel, '--accept-local', `${rel} accept-local decision`);
  requireText(rel, '--accept-merged', `${rel} accept-merged decision`);
  requireText(rel, '--accept-template', `${rel} accept-template decision`);
  requireText(rel, '--finalize', `${rel} finalize command`);
  requireText(rel, 'strict `--apply` only when', `${rel} strict apply boundary`);
  requireText(rel, '## Return', `${rel} return contract`);
}
requireText('.claude/commands/wf-help.md', 'direct command', 'wf-help wf-update direct command classification');
requireText('.claude/commands/wf-help.md', '/wf-browser', 'wf-help optional browser workflow row');
requireText('.opencode/commands/wf-help.md', '/wf-browser', 'OpenCode wf-help optional browser workflow row');

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
requireText('Harness/WF-KERNEL.md', 'Ready-Queue', 'WF-KERNEL ready-queue section');
requireText('Harness/WF-KERNEL.md', 'Role / Model Matrix', 'WF-KERNEL role-model matrix');
requireText('Harness/WF-KERNEL.md', 'Dispatch Packet', 'WF-KERNEL dispatch packet format');
requireText('Harness/WF-KERNEL.md', 'Task Type', 'WF-KERNEL task type routing');
requireText('Harness/WF-KERNEL.md', 'small-fast', 'WF-KERNEL small-fast tier mapping');

// WF variants reference WF-KERNEL
requireText('Harness/WF.md', 'WF-KERNEL.md', 'WF.md references WF-KERNEL');
requireText('Harness/WF-MAX.md', 'WF-KERNEL.md', 'WF-MAX.md references WF-KERNEL');
requireText('Harness/WF-MAX.md', 'probe-worker-channels.mjs', 'WF-MAX references worker-channel probe (M3 anti-regression)');

// Tier-aware acceptance: WF-Light must NOT require global cross-review/reflector
requireText('Harness/WF.md', 'Cross-review and reflector NOT mandatory', 'WF.md WF-Light no mandatory cross-review');
requireText('Harness/WF-KERNEL.md', 'Cross-review and reflector are NOT mandatory', 'WF-KERNEL WF-Light no mandatory cross-review');

// WF-MAX: maximum safe fan-out, not unconditional
requireText('Harness/WF-MAX.md', 'maximum safe fan-out', 'WF-MAX maximum safe fan-out');
requireText('Harness/WF-MAX.md', 'WF-Max-Useful', 'WF-MAX useful fan-out mode');
requireText('Harness/WF-MAX.md', 'WF-Max-Strict', 'WF-MAX strict override mode');

// task-scribe is task-state write exception
requireText('Harness/subagents.md', 'task-scribe', 'subagents.md task-scribe registration');
requireText('Harness/dispatch.md', 'task-scribe', 'dispatch.md task-scribe roster');
requireText('Harness/WF-KERNEL.md', 'task-scribe', 'WF-KERNEL task-scribe ownership');
forbidText('Harness/WF-KERNEL.md', 'Only the main agent writes task', 'old single-writer rule');

// Old WF contract must not return to hot-path docs:
// /wf is WF-KERNEL tiered orchestration, not a default complete role chain;
// /wf-max defaults to WF-Max-Useful, unconditional fan-out is strict-only.
const hotPathDocs = [
  'CLAUDE.md',
  'Harness/MEMORY.md',
  'Harness/README.md',
  'Harness/WF.md',
  'Harness/WF-MAX.md',
  'Harness/WF-AUTO.md',
  'Harness/WF-AUTO-SPARK.md',
  'Harness/WF-KERNEL.md',
  'Harness/agent-workflow.md',
  'Harness/dispatch.md',
  'Harness/subagents.md',
  'Harness/context-loading.md',
  'Harness/ACCEPTANCE_PROTOCOL.md',
];
for (const rel of hotPathDocs) {
  forbidText(rel, 'complete role chain mandatory', 'old /wf default complete-role-chain contract');
  forbidText(rel, 'default complete role chain', 'old /wf default complete-role-chain contract');
  forbidText(rel, 'requires the complete role chain by default', 'old /wf default complete-role-chain contract');
  forbidText(rel, 'mandatory maximum fan-out', 'old /wf-max unconditional fan-out contract');
  forbidText(rel, 'strict superset: complete role chain plus maximum parallelism', 'old /wf-max strict-superset contract');
}

// WF-STATE.md and TASK_ARCHIVE.md must be reachable from the entry router
requireText('CLAUDE.md', 'Harness/WF-STATE.md', 'CLAUDE.md WF-STATE routing');
requireText('CLAUDE.md', 'Harness/TASK_ARCHIVE.md', 'CLAUDE.md TASK_ARCHIVE routing');
requireText('Harness/README.md', 'WF-STATE.md', 'README WF-STATE routing');
requireText('Harness/TASK_ARCHIVE.md', 'archive-tasks.mjs', 'TASK_ARCHIVE script reference');

// Outer task capsule cap: keep Harness/tasks/ lean (see Harness/TASK_ARCHIVE.md)
const OUTER_TASK_CAP = 5;
const outerTasks = taskDirs.filter(name => !TASK_RESERVED.has(name) && !name.startsWith('_'));
if (outerTasks.length > OUTER_TASK_CAP) {
  const capMsg = `Harness/tasks/ has ${outerTasks.length} outer task capsules (cap ${OUTER_TASK_CAP}); archive completed tasks with node Harness/scripts/archive-tasks.mjs --apply (see Harness/TASK_ARCHIVE.md)`;
  if (strict) errors.push(capMsg);
  else console.warn(`Warning: ${capMsg}`);
}

if (errors.length) {
  console.error(`Harness validation failed${strict ? ' (strict)' : ''}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Harness validation passed${strict ? ' (strict)' : ''}.`);
if (!strict) {
  console.log('Tip: run `node Harness/scripts/validate-harness.mjs --strict` after bootstrap to check unresolved project placeholders.');
}
