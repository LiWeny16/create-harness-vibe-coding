#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function readFlagValue(flagName) {
  const idx = args.indexOf(flagName);
  if (idx === -1) return null;
  const value = args[idx + 1];
  return value && !value.startsWith('--') ? value : null;
}

const ROOT = path.resolve(process.env.WF_ROOT || readFlagValue('--root') || path.resolve(__dirname, '..', '..'));
const VERSION_FILE = path.join(ROOT, 'Harness', '.harness-version');
const APPLY = args.includes('--apply');
const JSON_OUT = args.includes('--json');
const DRY_RUN = args.includes('--dry-run') || (!APPLY && !args.includes('--apply'));

const HARNESS_MARKERS = [
  /\bcreate-harness-vibe-coding\b/i,
  /\bproject harness\b/i,
  /\bHarness\/(?:specs|WF|MEMORY|tasks|scripts|subagents|dispatch|context-loading|lifecycle|SETUP)\b/,
  /\bWF-(?:MAX|AUTO|KERNEL|STATE)\b/,
  /^harness:\s*(?:wf-agent|wf-framework|create-harness-vibe-coding)\b/im,
];

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function sha256(content) {
  return 'sha256-' + createHash('sha256').update(content).digest('hex');
}

function readNormalized(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return sha256(readNormalized(filePath));
}

function containsPath(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  const rel = path.relative(resolvedParent, resolvedChild);
  return rel === '' || (rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveUnder(base, rel) {
  if (!rel || typeof rel !== 'string' || path.isAbsolute(rel)) return null;
  const parts = normalizePath(rel).split('/').filter(Boolean);
  if (parts.some(part => part === '..')) return null;
  const resolved = path.resolve(base, ...parts);
  return containsPath(base, resolved) ? resolved : null;
}

function sourceDestForHostFile(host, file) {
  const normalized = normalizePath(file);
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

function hasHarnessMarker(filePath) {
  try {
    const body = fs.readFileSync(filePath, 'utf8');
    return HARNESS_MARKERS.some(marker => marker.test(body));
  } catch {
    return false;
  }
}

function readVersion() {
  if (!fs.existsSync(VERSION_FILE)) {
    throw new Error(`Harness/.harness-version not found under ${ROOT}`);
  }
  return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
}

function hostTargets(version) {
  const hostGlobal = version?.hostGlobal;
  if (!hostGlobal || hostGlobal.copyMode !== 'copy' || !hostGlobal.targets || typeof hostGlobal.targets !== 'object') {
    return null;
  }
  return hostGlobal.targets;
}

function summarize(plan) {
  return {
    created: plan.created.length,
    updated: plan.updated.length,
    conflict: plan.conflict.length,
    skipped: plan.skipped.length,
    errors: plan.errors.length,
  };
}

function createPlan(version) {
  const targets = hostTargets(version);
  const plan = {
    root: normalizePath(ROOT),
    installScope: version?.installScope || 'project',
    created: [],
    updated: [],
    conflict: [],
    skipped: [],
    errors: [],
  };

  if (version?.installScope !== 'global') {
    plan.skipped.push({ reason: 'not a global install' });
    return plan;
  }
  if (!targets) {
    plan.errors.push({ reason: 'Harness/.harness-version missing hostGlobal copy targets' });
    return plan;
  }

  for (const [host, target] of Object.entries(targets)) {
    const hostRoot = target && typeof target.root === 'string'
      ? path.resolve(target.root)
      : null;
    const files = Array.isArray(target?.files) ? target.files : [];
    if (!hostRoot) {
      plan.errors.push({ host, reason: 'missing host root' });
      continue;
    }
    for (const file of files) {
      const sourceDest = sourceDestForHostFile(host, file);
      const sourcePath = sourceDest ? resolveUnder(ROOT, sourceDest) : null;
      const targetPath = resolveUnder(hostRoot, file);
      if (!sourceDest || !sourcePath) {
        plan.errors.push({ host, file, reason: 'unknown host-global source mapping' });
        continue;
      }
      if (!targetPath) {
        plan.errors.push({ host, file, source: sourceDest, reason: 'invalid host-global target path' });
        continue;
      }
      if (!fs.existsSync(sourcePath)) {
        plan.errors.push({ host, file, source: sourceDest, reason: 'missing runtime source file' });
        continue;
      }
      if (fs.existsSync(targetPath)) {
        const stat = fs.lstatSync(targetPath);
        if (stat.isSymbolicLink()) {
          plan.errors.push({ host, file, source: sourceDest, reason: 'target is symlink' });
          continue;
        }
        if (!stat.isFile()) {
          plan.errors.push({ host, file, source: sourceDest, reason: 'target is not a regular file' });
          continue;
        }
      }

      const sourceHash = sha256File(sourcePath);
      const targetHash = sha256File(targetPath);
      const entry = { host, file, source: sourceDest, targetRoot: normalizePath(hostRoot), sourceHash, targetHash };
      if (!targetHash) {
        plan.created.push({ ...entry, reason: 'missing host-global copy' });
      } else if (targetHash === sourceHash) {
        plan.skipped.push({ ...entry, reason: 'already current' });
      } else if (hasHarnessMarker(targetPath)) {
        plan.updated.push({ ...entry, reason: 'stale Harness-marked host-global copy' });
      } else {
        plan.conflict.push({ ...entry, reason: 'existing host-global file lacks Harness ownership marker' });
      }
    }
  }

  return plan;
}

function applyPlan(plan) {
  const written = [];
  for (const entry of [...plan.created, ...plan.updated]) {
    const sourcePath = resolveUnder(ROOT, entry.source);
    const targetPath = resolveUnder(entry.targetRoot, entry.file);
    if (!sourcePath || !targetPath) {
      plan.errors.push({ ...entry, reason: 'path resolution failed during apply' });
      continue;
    }
    if (fs.existsSync(targetPath) && fs.lstatSync(targetPath).isSymbolicLink()) {
      plan.errors.push({ ...entry, reason: 'target became symlink during apply' });
      continue;
    }
    const content = readNormalized(sourcePath);
    if (sha256(content) !== entry.sourceHash) {
      plan.errors.push({ ...entry, reason: 'runtime source changed during apply' });
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
    written.push({ host: entry.host, file: entry.file, source: entry.source });
  }
  return written;
}

function printResult(result) {
  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.status === 'not-global') {
    console.log('Host-global sync skipped: installScope is not global.');
    return;
  }
  console.log(`Host-global sync ${result.status}: ${result.summary.created} created, ${result.summary.updated} updated, ${result.summary.conflict} conflict, ${result.summary.errors} error.`);
  if (result.plan?.conflict?.length) {
    for (const entry of result.plan.conflict) {
      console.log(`  conflict ${entry.host}:${entry.file} (${entry.reason})`);
    }
  }
  if (result.plan?.errors?.length) {
    for (const entry of result.plan.errors) {
      console.log(`  error ${entry.host || 'host'}:${entry.file || ''} ${entry.reason}`);
    }
  }
}

function main() {
  let version;
  try {
    version = readVersion();
  } catch (err) {
    const result = { status: 'error', root: normalizePath(ROOT), message: err.message };
    printResult(result);
    process.exitCode = 1;
    return;
  }

  const plan = createPlan(version);
  const summary = summarize(plan);
  let written = [];
  if (APPLY && summary.conflict === 0 && summary.errors === 0) {
    written = applyPlan(plan);
  }
  const afterErrors = plan.errors.length;
  const status = version?.installScope !== 'global'
    ? 'not-global'
    : afterErrors > 0
      ? 'error'
      : summary.conflict > 0
        ? 'conflict'
        : summary.created + summary.updated > 0
          ? (APPLY ? 'synced' : 'needs-sync')
          : 'ok';
  const result = {
    status,
    dryRun: DRY_RUN,
    applied: APPLY && status === 'synced',
    root: normalizePath(ROOT),
    summary: summarize(plan),
    written,
    plan,
  };
  printResult(result);
  if (!['ok', 'synced', 'not-global'].includes(status)) process.exitCode = 1;
}

main();
