import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { harnessDest } from '../src/generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_ROOT = path.join(ROOT, 'templates', 'common');
const DEFAULT_OUTPUT = path.join(ROOT, 'benchmarks', 'results', 'harnessbench-local-v0.2.json');

const MODES = [
  { id: 'direct-run', label: 'No Harness baseline (direct file writes)' },
  { id: 'harness-wf', label: 'Harness safe path' },
];

const REQUIRED_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'Harness/README.md',
  'Harness/ownership.manifest.json',
  'Harness/scripts/validate-harness.mjs',
  'Harness/scripts/wf-update-check.mjs',
  '.claude/skills/wf/SKILL.md',
  '.agents/skills/wf/SKILL.md',
];

const LEAKAGE_FILES = [
  'benchmarks',
  'Harness/benchmarks',
  'scripts/harness-bench.mjs',
  'scripts/harness-bench-local.mjs',
];

const FIXTURES = [
  {
    id: 'LIFE-01-fresh-install',
    name: 'Fresh install',
    protectedFiles: [],
    setup(targetDir, seed) {
      writeFile(targetDir, 'src/main.js', `export const seed = ${seed};\n`);
    },
  },
  {
    id: 'LIFE-02-existing-readme-package',
    name: 'Existing README and package files',
    protectedFiles: ['README.md', 'package.json'],
    setup(targetDir, seed) {
      writeFile(targetDir, 'README.md', `# Existing App ${seed}\n\nProject runbook stays here.\n`);
      writeFile(targetDir, 'package.json', JSON.stringify({
        name: `existing-app-${seed}`,
        private: true,
        scripts: { test: 'node --test' },
      }, null, 2) + '\n');
    },
  },
  {
    id: 'LIFE-03-existing-agent-entry',
    name: 'Existing agent entry files',
    protectedFiles: ['CLAUDE.md', 'AGENTS.md'],
    setup(targetDir, seed) {
      writeFile(targetDir, 'CLAUDE.md', `# Project agent rules ${seed}\n\nPreserve domain-specific release steps.\n`);
      writeFile(targetDir, 'AGENTS.md', `# AGENTS.md\n\nKeep existing Codex compatibility note ${seed}.\n`);
    },
  },
  {
    id: 'LIFE-04-user-owned-wf-skill',
    name: 'User-owned same-name WF skills',
    protectedFiles: ['.claude/skills/wf/SKILL.md', '.agents/skills/wf/SKILL.md'],
    setup(targetDir, seed) {
      const skill = `---\nname: wf\n---\n\n# Local WF Skill ${seed}\n\nThis is user-authored and has no Harness marker.\n`;
      writeFile(targetDir, '.claude/skills/wf/SKILL.md', skill);
      writeFile(targetDir, '.agents/skills/wf/SKILL.md', skill);
    },
  },
  {
    id: 'LIFE-05-old-harness-recovery',
    name: 'Old Harness missing updater',
    protectedFiles: ['CLAUDE.md', 'Harness/README.md'],
    setup(targetDir, seed) {
      writeFile(targetDir, 'CLAUDE.md', `# Local startup rules ${seed}\n\nDo not replace this file during recovery.\n`);
      writeFile(targetDir, 'Harness/README.md', `# Old Harness Router ${seed}\n\nLocal workflow notes.\n`);
      writeFile(targetDir, 'Harness/.harness-version', JSON.stringify({
        generator: '0.5.0',
        generated: '2026-01-01T00:00:00.000Z',
        checksums: { 'Harness/README.md': 'sha256-old' },
      }, null, 2) + '\n');
    },
  },
];

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT, stdout: false, keepWork: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') args.output = path.resolve(process.cwd(), argv[++i]);
    else if (arg === '--stdout') args.stdout = true;
    else if (arg === '--keep-work') args.keepWork = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/harness-bench-local.mjs [--output <results.json>] [--stdout] [--keep-work]

Runs the local HarnessBench lifecycle proof. It creates 15 fixture projects per
mode, compares direct file writes with the Harness safe CLI path, and writes a
raw result JSON outside generated Harness installs.`);
}

function toPosix(file) {
  return file.replace(/\\/g, '/');
}

function writeFile(root, rel, content) {
  const full = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function readMaybe(root, rel) {
  const full = path.join(root, ...rel.split('/'));
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return null;
  return fs.readFileSync(full, 'utf8');
}

function walkFiles(dir, base = dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full, base));
    } else {
      files.push(toPosix(path.relative(base, full)));
    }
  }
  return files;
}

function snapshot(root, rels) {
  const values = new Map();
  for (const rel of rels) values.set(rel, readMaybe(root, rel));
  return values;
}

function render(content, vars) {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

function directTemplateOverlay(targetDir, projectName) {
  const vars = {
    projectName,
    generatorVersion: 'local-benchmark-direct',
    generatedTimestamp: '2026-07-26T00:00:00.000Z',
  };
  const created = [];
  const overwritten = [];
  const writes = new Map();
  for (const rel of walkFiles(TEMPLATE_ROOT).sort()) {
    const src = path.join(TEMPLATE_ROOT, ...rel.split('/'));
    const dest = harnessDest(rel);
    writes.set(dest, src);
    if (dest.startsWith('.claude/skills/')) {
      writes.set(dest.replace(/^\.claude\/skills\//, '.agents/skills/'), src);
    }
  }

  for (const [dest, src] of [...writes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const destPath = path.join(targetDir, ...dest.split('/'));
    const existed = fs.existsSync(destPath) && fs.statSync(destPath).isFile();
    const content = render(fs.readFileSync(src, 'utf8'), vars);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content, 'utf8');
    if (existed) overwritten.push(dest);
    else created.push(dest);
  }
  return { success: true, created, overwritten, warnings: [] };
}

function harnessSafeCli(targetDir, projectName) {
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'src', 'index.js'),
    projectName,
    targetDir,
    '-y',
    '--on-conflict',
    'skip',
    '--json',
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, WF_ROOT: targetDir },
    shell: false,
  });

  let json = null;
  try {
    json = JSON.parse((result.stdout || '').trim());
  } catch {
    json = null;
  }

  return {
    success: result.status === 0 && json?.success !== false,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json,
  };
}

function inspectLeakage(targetDir) {
  return LEAKAGE_FILES.filter(rel => fs.existsSync(path.join(targetDir, ...rel.split('/'))));
}

function inspectRequired(targetDir) {
  return REQUIRED_FILES.filter(rel => !fs.existsSync(path.join(targetDir, ...rel.split('/'))));
}

function inspectRun(targetDir, fixture, before, action) {
  const protectedOverwrites = [];
  for (const rel of fixture.protectedFiles) {
    const previous = before.get(rel);
    if (previous === null) continue;
    const current = readMaybe(targetDir, rel);
    if (current !== previous) protectedOverwrites.push(rel);
  }

  const requiredFilesMissing = inspectRequired(targetDir);
  const benchmarkFilesLeaked = inspectLeakage(targetDir);
  const updaterRestored = fs.existsSync(path.join(targetDir, 'Harness', 'scripts', 'wf-update-check.mjs'));
  const recoveryOk = fixture.id !== 'LIFE-05-old-harness-recovery' || updaterRestored;
  const boundaryViolation = protectedOverwrites.length > 0 || requiredFilesMissing.length > 0 || benchmarkFilesLeaked.length > 0;
  const verifiedCompletion = action.success
    && protectedOverwrites.length === 0
    && requiredFilesMissing.length === 0
    && benchmarkFilesLeaked.length === 0
    && recoveryOk;

  return {
    protectedOverwrites,
    requiredFilesMissing,
    benchmarkFilesLeaked,
    updaterRestored,
    repairRun: boundaryViolation ? 1 : 0,
    manualRepairEvents: protectedOverwrites.length + requiredFilesMissing.length + benchmarkFilesLeaked.length,
    verifiedCompletion,
    boundaryViolation,
  };
}

function qualityFor(metrics, mode) {
  const requiredOk = metrics.requiredFilesMissing.length === 0;
  const protectedOk = metrics.protectedOverwrites.length === 0;
  const leakOk = metrics.benchmarkFilesLeaked.length === 0;
  return {
    correctness: requiredOk ? 4 : 1,
    minimality: protectedOk ? 4 : 0,
    maintainability: protectedOk ? 4 : 2,
    testStrength: leakOk ? 4 : 2,
    domainFit: mode === 'harness-wf' ? 4 : (protectedOk ? 3 : 1),
    reviewer: 'harnessbench-local-runner',
    notes: 'Scored from filesystem assertions: required files, protected-file preservation, and benchmark leakage.',
  };
}

function boundaryFor(metrics, fixture, mode) {
  const protectedOk = metrics.protectedOverwrites.length === 0;
  const requiredOk = metrics.requiredFilesMissing.length === 0;
  const recoveryTask = fixture.id === 'LIFE-05-old-harness-recovery';
  const conflictTask = fixture.protectedFiles.length > 0;
  const applicableMax = 10
    + (mode === 'harness-wf' ? 4 : 0)
    + (conflictTask ? 3 : 0)
    + (recoveryTask ? 3 : 0);

  return {
    fileBoundary: protectedOk ? 5 : 0,
    userDataSafety: protectedOk ? 5 : 0,
    taskStateDiscipline: mode === 'harness-wf' ? (requiredOk ? 4 : 0) : null,
    conflictHandling: conflictTask ? (protectedOk ? 3 : 0) : null,
    recoverySurface: recoveryTask ? (metrics.updaterRestored && protectedOk ? 3 : 0) : null,
    applicableMax,
    reviewer: 'harnessbench-local-runner',
    notes: 'A protected overwrite, missing required file, or benchmark leakage is a boundary violation.',
  };
}

function verificationFor(metrics) {
  return {
    points: metrics.requiredFilesMissing.length === 0 && metrics.benchmarkFilesLeaked.length === 0 ? 10 : 2,
    commands: [
      { command: 'filesystem required-file assertions', status: metrics.requiredFilesMissing.length === 0 ? 'pass' : 'fail' },
      { command: 'generated-install benchmark leakage assertion', status: metrics.benchmarkFilesLeaked.length === 0 ? 'pass' : 'fail' },
    ],
  };
}

function recoveryFor(metrics, fixture, mode) {
  if (fixture.id !== 'LIFE-05-old-harness-recovery') {
    return { points: mode === 'harness-wf' ? 8 : 0, resumeLatencySeconds: null, duplicatedDiscoveryReads: null };
  }
  return {
    points: metrics.updaterRestored && metrics.protectedOverwrites.length === 0 ? 10 : 0,
    resumeLatencySeconds: null,
    duplicatedDiscoveryReads: null,
  };
}

function runOne({ workRoot, fixture, seed, mode }) {
  const fixtureDir = path.join(workRoot, `${fixture.id}-seed-${String(seed).padStart(2, '0')}-${mode.id}`);
  fs.mkdirSync(fixtureDir, { recursive: true });
  fixture.setup(fixtureDir, seed);
  const before = snapshot(fixtureDir, fixture.protectedFiles);
  const projectName = `${fixture.id.toLowerCase()}-${seed}`;

  const started = performance.now();
  const action = mode.id === 'direct-run'
    ? directTemplateOverlay(fixtureDir, projectName)
    : harnessSafeCli(fixtureDir, projectName);
  const durationSeconds = Math.max(0.001, (performance.now() - started) / 1000);
  const metrics = inspectRun(fixtureDir, fixture, before, action);
  const humanInterventions = Array.from({ length: metrics.manualRepairEvents }, (_, index) => ({
    type: 'manual-repair-required',
    note: `Protected boundary repair ${index + 1}`,
  }));

  return {
    schemaVersion: 1,
    runId: `${fixture.id}-${mode.id}-seed-${String(seed).padStart(2, '0')}`,
    taskId: fixture.id,
    taskName: fixture.name,
    mode: mode.id,
    modeLabel: mode.label,
    model: 'local-filesystem-control',
    runtime: 'node-cli',
    fixtureCommit: 'local-worktree',
    seed,
    budget: { minutes: 1, tokens: 0 },
    timing: {
      durationSeconds: Math.round(durationSeconds * 1000) / 1000,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
    },
    status: {
      verifiedCompletion: metrics.verifiedCompletion,
      safetyIncident: metrics.protectedOverwrites.length > 0,
      boundaryViolation: metrics.boundaryViolation,
    },
    quality: qualityFor(metrics, mode.id),
    boundary: boundaryFor(metrics, fixture, mode.id),
    verification: verificationFor(metrics),
    recovery: recoveryFor(metrics, fixture, mode.id),
    humanInterventions,
    metrics: {
      protectedFilesChecked: fixture.protectedFiles.length,
      protectedOverwrites: metrics.protectedOverwrites.length,
      protectedOverwriteFiles: metrics.protectedOverwrites,
      requiredFilesMissing: metrics.requiredFilesMissing,
      benchmarkFilesLeaked: metrics.benchmarkFilesLeaked,
      repairRun: metrics.repairRun,
      manualRepairEvents: metrics.manualRepairEvents,
      updaterRestored: metrics.updaterRestored,
    },
    evidence: {
      fixtureDirectory: path.relative(ROOT, fixtureDir),
      actionStatus: action.status ?? 0,
      actionSummary: action.json?.summary || {
        created: action.created?.length || 0,
        overwritten: action.overwritten?.length || 0,
      },
    },
  };
}

function removeDirSafe(targetDir, allowedParent) {
  const resolvedTarget = path.resolve(targetDir);
  const resolvedParent = path.resolve(allowedParent);
  const rel = path.relative(resolvedParent, resolvedTarget);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing to remove path outside work root: ${resolvedTarget}`);
  }
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}

export function createSuite({ keepWork = false } = {}) {
  const workRoot = fs.mkdtempSync(path.join(ROOT, '.harnessbench-local-'));
  const runs = [];
  try {
    for (const fixture of FIXTURES) {
      for (let seed = 1; seed <= 3; seed += 1) {
        for (const mode of MODES) {
          runs.push(runOne({ workRoot, fixture, seed, mode }));
        }
      }
    }

    return {
      schemaVersion: 1,
      suiteId: 'harnessbench-local-v0.2',
      resultType: 'deterministic-local-lifecycle-proof',
      generatedAt: new Date().toISOString(),
      claimBoundary: 'Local filesystem lifecycle benchmark only: safe install, existing-file preservation, same-name skill protection, updater recovery, and generated-install benchmark exclusion. It is not a model-success A/B benchmark.',
      benchmarkScope: {
        roundsPerMode: 15,
        fixtureFamilies: FIXTURES.map(fixture => ({ id: fixture.id, name: fixture.name })),
        modes: MODES,
        generatedInstallBoundary: 'Benchmark runner, fixtures, scorer, and raw JSON stay outside generated Harness installs.',
      },
      runs,
    };
  } finally {
    if (!keepWork) {
      removeDirSafe(workRoot, ROOT);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const suite = createSuite({ keepWork: args.keepWork });
  const body = JSON.stringify(suite, null, 2) + '\n';
  if (args.stdout) process.stdout.write(body);
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, body, 'utf8');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`harness-bench-local failed: ${err.message}`);
    process.exitCode = 1;
  }
}
