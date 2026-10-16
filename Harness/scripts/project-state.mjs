#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import {
  ProjectError,
  archiveProject,
  initializeProject,
  listLocalProject,
  listWorkspaceProjects,
  loadProjectManifest,
  makeProjectManifest,
  readProjectSection,
  registerWorkspaceProject,
  resolveProject,
  restoreProject,
  searchProjectRecords,
  showProject,
  summarizeProject,
  unregisterWorkspaceProject,
  updateProject,
  updateProjectCharter,
  validateProjectTree,
  writeProjectRecord,
} from './lib/project-store.mjs';
import {
  applyProjectImport,
  previewProjectImport,
  rollbackProjectImport,
} from './lib/project-import.mjs';

const BOOLEAN_FLAGS = new Set(['apply', 'json', 'include-archived', 'dry-run']);

function usage() {
  return `Harness Project state CLI (schema v1)

Read:
  project-state.mjs list [--root <project-root>] [--workspace <root>] [--limit N] [--cursor ID] [--include-archived] [--budget-bytes N]
  project-state.mjs show <project-id> [--workspace <root>] [--include-archived]
  project-state.mjs summary <project-id> [--workspace <root>] [--budget-bytes N]
  project-state.mjs section <project-id> --section <charter|plan|risks|decisions|progress|evidence>
  project-state.mjs get <project-id> --section <name> --record <record-id>
  project-state.mjs search <project-id> --query <text> [--section <name>] [--cursor CURSOR] [--limit N] [--budget-bytes N]
  project-state.mjs validate [--root <project-root>] [--workspace <root>]

Write (mutations require --apply):
  project-state.mjs init --root <project-root> --id <id> --name <name> --apply
  project-state.mjs register --workspace <root> --project-root <root> --apply
  project-state.mjs unregister <project-id> --workspace <root> --apply
  project-state.mjs update <project-id> [--name N] [--status S] [--stage S] --apply
  project-state.mjs charter <project-id> [--goal TEXT] [--scope-json JSON] [--non-goals-json JSON] --apply
  project-state.mjs record <project-id> --section <name> --title TEXT --text TEXT --apply
  project-state.mjs archive|restore <project-id> --workspace <root> --apply
  project-state.mjs import <project-id> --source <relative-path> [--source <path> ...]
  project-state.mjs import <project-id> --source <path> --plan-hash HASH --apply
  project-state.mjs rollback --root <project-root> --transaction <id> [--apply]

Import and rollback default to dry-run. Sources must be explicitly selected and
remain inside the selected Project root. Project archive never moves a repo root.
Task state/physical archive remains managed by task-state.mjs.
`;
}

function parseArgs(argv) {
  const [command = 'help', ...tail] = argv;
  const positionals = [];
  const options = {};
  for (let i = 0; i < tail.length; i += 1) {
    const token = tail[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const rawKey = token.slice(2);
    if (BOOLEAN_FLAGS.has(rawKey)) {
      options[rawKey] = true;
      continue;
    }
    const value = tail[i + 1];
    if (value === undefined || value.startsWith('--')) throw new ProjectError('BAD_ARGUMENT', `Missing value for ${token}`);
    i += 1;
    if (rawKey === 'source') {
      options.sources ||= [];
      options.sources.push(value);
    } else {
      options[rawKey] = value;
    }
  }
  return { command, positionals, options };
}

function jsonOption(options) {
  return options.json ? true : false;
}

function rootOption(options) {
  return path.resolve(options.root || process.cwd());
}

function resolveArgs(positionals, options) {
  return {
    projectId: positionals[0] || options.id || null,
    projectRoot: rootOption(options),
    workspaceRoot: options.workspace ? path.resolve(options.workspace) : null,
    includeArchived: options['include-archived'] === true,
    budgetBytes: options['budget-bytes'],
    cursor: options.cursor || null,
    limit: options.limit,
  };
}

function parseJsonOption(options, key, fallback = []) {
  if (options[key] === undefined) return fallback;
  try {
    const parsed = JSON.parse(options[key]);
    if (!Array.isArray(parsed)) throw new Error('must be a JSON array');
    return parsed;
  } catch (error) {
    throw new ProjectError('BAD_ARGUMENT', `--${key} must be a JSON array: ${error.message}`);
  }
}

// A workspace index normally lives at an ancestor of the Project root. When the
// caller omits --workspace, reconcile routing through that ancestor instead of
// silently writing a lifecycle change that leaves a stale active/archived route.
function withDiscoveredWorkspace(resolved) {
  if (resolved.workspaceRoot) return resolved;
  const projectRoot = path.resolve(resolved.projectRoot || process.cwd());
  let projectId = resolved.projectId;
  if (!projectId) {
    try { projectId = loadProjectManifest(projectRoot).id; } catch { return resolved; }
  }
  let dir = projectRoot;
  for (;;) {
    const parent = path.dirname(dir);
    if (parent === dir) return resolved;
    dir = parent;
    if (!fs.existsSync(path.join(dir, ...'.harness-workspace/INDEX.json'.split('/')))) continue;
    try {
      const probe = resolveProject({ projectId, projectRoot, workspaceRoot: dir, includeArchived: true });
      if (path.resolve(probe.projectRoot) === projectRoot) return { ...resolved, workspaceRoot: dir };
    } catch { /* this workspace does not own the Project root */ }
  }
}

function execute(command, positionals, options) {
  const resolved = resolveArgs(positionals, options);
  if (command === 'help' || command === '--help' || command === '-h') return { ok: true, usage: usage() };
  if (command === 'init') {
    const projectRoot = rootOption(options);
    if (!options.apply) return { ok: true, dryRun: true, project: makeProjectManifest({ id: options.id, name: options.name || path.basename(projectRoot) }), projectRoot };
    return { ok: true, dryRun: false, project: initializeProject(projectRoot, { id: options.id, name: options.name || path.basename(projectRoot) }), projectRoot };
  }
  if (command === 'register') {
    if (!options.workspace || !options['project-root']) throw new ProjectError('BAD_ARGUMENT', 'register requires --workspace and --project-root');
    if (!options.apply) return { ok: true, dryRun: true, project: loadProjectManifest(options['project-root']), workspaceRoot: path.resolve(options.workspace) };
    return registerWorkspaceProject(options.workspace, options['project-root']);
  }
  if (command === 'unregister') {
    if (!options.workspace) throw new ProjectError('BAD_ARGUMENT', 'unregister requires --workspace');
    if (!options.apply) return { ok: true, dryRun: true, projectId: resolved.projectId };
    return unregisterWorkspaceProject(options.workspace, resolved.projectId);
  }
  if (command === 'list') {
    if (!options.workspace) {
      return listLocalProject(rootOption(options), {
        includeArchived: options['include-archived'] === true,
        limit: options.limit,
        cursor: options.cursor,
        budgetBytes: options['budget-bytes'],
      });
    }
    return listWorkspaceProjects(options.workspace, {
      includeArchived: options['include-archived'] === true,
      limit: options.limit,
      cursor: options.cursor,
      budgetBytes: options['budget-bytes'],
    });
  }
  if (command === 'show') return showProject(resolved);
  if (command === 'summary') return summarizeProject(resolved);
  if (command === 'section') return readProjectSection({ ...resolved, section: options.section });
  if (command === 'get') return (async () => {
    const { getProjectRecord } = await import('./lib/project-store.mjs');
    return getProjectRecord({ ...resolved, section: options.section, recordId: options.record });
  })();
  if (command === 'search') return searchProjectRecords({ ...resolved, query: options.query, section: options.section });
  if (command === 'validate') {
    const result = validateProjectTree(rootOption(options), { includeWorkspace: options.workspace ? path.resolve(options.workspace) : false });
    if (!result.ok) throw new ProjectError('VALIDATION_FAILED', result.errors.join('; '), { result });
    return result;
  }
  if (command === 'update') {
    const patch = {};
    for (const key of ['name', 'status', 'stage']) if (options[key] !== undefined) patch[key] = options[key];
    if (!Object.keys(patch).length) throw new ProjectError('BAD_ARGUMENT', 'update requires --name, --status, or --stage');
    if (!options.apply) return { ok: true, dryRun: true, project: { ...resolveProject(resolved).project, ...patch } };
    return updateProject({ ...withDiscoveredWorkspace(resolved), expectedRevision: options['expected-revision'] ?? null, patch });
  }
  if (command === 'archive' || command === 'restore') {
    if (!options.apply) return { ok: true, dryRun: true, projectId: resolved.projectId, action: command };
    const routed = withDiscoveredWorkspace(resolved);
    return command === 'archive' ? archiveProject(routed) : restoreProject(routed);
  }
  if (command === 'charter') {
    const patch = {};
    if (options.goal !== undefined) patch.goal = options.goal;
    if (options['scope-json'] !== undefined) patch.scope = parseJsonOption(options, 'scope-json');
    if (options['non-goals-json'] !== undefined) patch.nonGoals = parseJsonOption(options, 'non-goals-json');
    if (!Object.keys(patch).length) throw new ProjectError('BAD_ARGUMENT', 'charter requires --goal, --scope-json, or --non-goals-json');
    if (!options.apply) return { ok: true, dryRun: true, projectId: resolved.projectId, patch };
    return updateProjectCharter({ ...resolved, expectedRevision: options['expected-revision'] ?? null, patch });
  }
  if (command === 'record' || command === 'add') {
    if (!options.apply) return { ok: true, dryRun: true, projectId: resolved.projectId, section: options.section, title: options.title };
    return writeProjectRecord({
      ...resolved,
      section: options.section,
      record: {
        id: options['record-id'],
        kind: options.kind,
        title: options.title,
        content: options.text ?? options.content ?? '',
        status: options.status,
        source: options.sourceRef,
        taskIds: options['task-ids'],
        milestoneIds: options['milestone-ids'] ? parseJsonOption(options, 'milestone-ids') : undefined,
      },
    });
  }
  if (command === 'import') {
    const args = { ...resolved, sources: options.sources || [] };
    if (!options.apply) return previewProjectImport(args);
    if (!options['plan-hash']) throw new ProjectError('BAD_ARGUMENT', 'Applying an import requires the reviewed --plan-hash');
    return applyProjectImport({ ...args, planHash: options['plan-hash'] });
  }
  if (command === 'rollback') {
    if (!options.transaction) throw new ProjectError('BAD_ARGUMENT', 'rollback requires --transaction');
    return rollbackProjectImport({ projectRoot: rootOption(options), transactionId: options.transaction, apply: options.apply === true });
  }
  throw new ProjectError('UNKNOWN_COMMAND', `Unknown Project command: ${command}`);
}

function emit(value, asJson) {
  if (!asJson && value?.usage) {
    process.stdout.write(value.usage);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
    const result = await execute(parsed.command, parsed.positionals, parsed.options);
    emit(result, jsonOption(parsed.options));
  } catch (error) {
    const body = {
      ok: false,
      error: {
        code: error.code || 'PROJECT_ERROR',
        message: String(error.message || error),
        ...(error.details ? { details: error.details } : {}),
      },
    };
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    process.exitCode = 1;
  }
}

await main();
