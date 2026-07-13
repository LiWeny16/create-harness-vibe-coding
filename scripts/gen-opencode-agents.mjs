#!/usr/bin/env node
/**
 * gen-opencode-agents.mjs — Dev utility (NOT shipped).
 *
 * Reads CC agent files from templates/common/.claude/agents/*.md and emits
 * OpenCode-format agent files into templates/common/.opencode/agents/*.md.
 *
 * Transform:
 *   - drops `name` (OpenCode uses the filename)
 *   - keeps `description` (required by OpenCode)
 *   - adds `mode: subagent` (all Harness role agents are subagents)
 *   - drops `model` (inherit from primary agent; minimal config)
 *   - converts CC `tools:` whitelist -> OpenCode `permission:` with explicit
 *     deny for the security-critical keys the agent does NOT have
 *   - restricted bash `Bash(git *)` -> permission.bash glob allow/deny map
 *
 * Run: node scripts/gen-opencode-agents.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..', 'templates', 'common', '.claude', 'agents');
const DEST_DIR = resolve(__dirname, '..', 'templates', 'common', '.opencode', 'agents');

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const TASK_TOOLS = new Set(['Agent', 'Task']);

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const map = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (mm) map[mm[1]] = mm[2];
  }
  return { fm: map, body: m[2] };
}

function parseTools(raw) {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(tok => {
    const m = tok.match(/^([A-Za-z]+)(?:\(([^)]*)\))?$/);
    if (!m) return { name: tok, pattern: null };
    return { name: m[1], pattern: m[2] ? m[2].trim() : null };
  });
}

function buildPermission(tools) {
  const hasEdit = tools.some(t => EDIT_TOOLS.has(t.name));
  const bashEntries = tools.filter(t => t.name === 'Bash');
  const hasBash = bashEntries.length > 0;
  const plainBash = bashEntries.filter(t => !t.pattern);
  const restrictedBash = bashEntries.filter(t => t.pattern);
  const hasTask = tools.some(t => TASK_TOOLS.has(t.name));
  const hasWebSearch = tools.some(t => t.name === 'WebSearch');
  const hasWebFetch = tools.some(t => t.name === 'WebFetch');

  const permission = {};
  if (!hasEdit) permission.edit = 'deny';
  if (!hasBash) {
    permission.bash = 'deny';
  } else if (restrictedBash.length > 0 && plainBash.length === 0) {
    permission.bash = { '*': 'deny' };
    for (const t of restrictedBash) {
      permission.bash[t.pattern] = 'allow';
    }
  }
  if (!hasTask) permission.task = 'deny';
  if (!hasWebSearch) permission.websearch = 'deny';
  if (!hasWebFetch) permission.webfetch = 'deny';
  return permission;
}

function yamlScalar(v) {
  return v;
}

function yamlKey(k) {
  // Quote keys that contain YAML-special characters (* & ! [ ] { } , # : > | ? - @ ` or whitespace).
  if (/[*&!{}\[\],#:>|?@`]/.test(k) || /\s/.test(k) || k === '') {
    return JSON.stringify(k);
  }
  return k;
}

function emitValue(prefix, key, value, lines) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number') {
    lines.push(`${prefix}${yamlKey(key)}: ${value}`);
  } else if (typeof value === 'object') {
    lines.push(`${prefix}${yamlKey(key)}:`);
    for (const [subKey, subVal] of Object.entries(value)) {
      emitValue(prefix + '  ', subKey, subVal, lines);
    }
  }
}

function emitFrontmatter(obj) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(obj)) {
    emitValue('', key, value, lines);
  }
  lines.push('---');
  return lines.join('\n');
}

function transform(raw, name) {
  const parsed = parseFrontmatter(raw);
  if (!parsed) {
    throw new Error(`Could not parse frontmatter for ${name}`);
  }
  const { fm, body } = parsed;
  const tools = parseTools(fm.tools);
  const permission = buildPermission(tools);

  const newFm = {
    description: fm.description || `Harness ${name} agent.`,
    mode: 'subagent',
  };
  if (Object.keys(permission).length > 0) {
    newFm.permission = permission;
  }
  return `${emitFrontmatter(newFm)}\n${body.replace(/^\r?\n/, '\n')}`;
}

function main() {
  if (!existsSync(SRC_DIR)) {
    console.error(`Source not found: ${SRC_DIR}`);
    process.exit(1);
  }
  mkdirSync(DEST_DIR, { recursive: true });

  const files = readdirSync(SRC_DIR).filter(f => f.endsWith('.md')).sort();
  let count = 0;
  for (const file of files) {
    const name = file.replace(/\.md$/, '');
    const raw = readFileSync(join(SRC_DIR, file), 'utf-8');
    const out = transform(raw, name);
    writeFileSync(join(DEST_DIR, file), out, 'utf-8');
    count++;
    const tools = parseTools(parseFrontmatter(raw).fm.tools);
    const perm = buildPermission(tools);
    console.log(`  ${file.padEnd(26)} <- tools: ${parseTools(parseFrontmatter(raw).fm.tools).map(t => t.pattern ? `${t.name}(${t.pattern})` : t.name).join(',') || '(none)'} => permission: ${JSON.stringify(perm)}`);
  }
  console.log(`\nGenerated ${count} OpenCode agent files in ${DEST_DIR}`);
}

main();
