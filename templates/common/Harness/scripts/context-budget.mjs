#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const rootArgIndex = process.argv.indexOf('--root');
const root = rootArgIndex !== -1 && process.argv[rootArgIndex + 1]
  ? path.resolve(process.argv[rootArgIndex + 1])
  : process.cwd();
const json = args.has('--json');

const routes = [
  {
    id: 'thin-startup',
    maxBytes: 12500,
    paths: [
      'CLAUDE.md',
      'Harness/memory/startup-hints.md',
    ],
  },
  {
    id: 'wf-router-prefix',
    maxBytes: 42000,
    paths: [
      'CLAUDE.md',
      'Harness/MEMORY.md',
      'Harness/README.md',
    ],
  },
  {
    id: 'wf-light-prefix',
    maxBytes: 58000,
    paths: [
      'CLAUDE.md',
      'Harness/MEMORY.md',
      'Harness/README.md',
      'Harness/WF.md',
      'Harness/WF-KERNEL.md',
    ],
  },
  {
    id: 'cache-diagnostics-route',
    maxBytes: 36000,
    paths: [
      'Harness/context-loading.md',
      'Harness/WF-KERNEL.md',
      'Harness/dispatch.md',
      '.claude/skills/wf-agents-docs/SKILL.md',
    ],
  },
];

function readBytes(rel) {
  const abs = path.join(root, ...rel.split('/'));
  if (!fs.existsSync(abs)) return { missing: true, bytes: 0 };
  return { missing: false, bytes: Buffer.byteLength(fs.readFileSync(abs)) };
}

function routeResult(route) {
  const files = route.paths.map(rel => ({ path: rel, ...readBytes(rel) }));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const missing = files.filter(file => file.missing).map(file => file.path);
  return {
    id: route.id,
    maxBytes: route.maxBytes,
    totalBytes,
    approxTokens: Math.ceil(totalBytes / 4),
    status: missing.length > 0 || totalBytes > route.maxBytes ? 'FAIL' : 'PASS',
    missing,
    files,
  };
}

const results = routes.map(routeResult);
const ok = results.every(result => result.status === 'PASS');

if (json) {
  console.log(JSON.stringify({
    ok,
    root,
    note: 'Budgets are route-profile regression guards, not runtime exclusion rules. approxTokens is bytes/4, not provider token accounting.',
    results,
  }, null, 2));
} else {
  console.log('Context budgets are route-profile regression guards, not runtime exclusion rules.');
  for (const result of results) {
    console.log(`${result.status} ${result.id}: ${result.totalBytes}/${result.maxBytes} bytes (~${result.approxTokens} tokens)`);
    for (const file of result.files) {
      const state = file.missing ? 'MISSING' : `${file.bytes} bytes`;
      console.log(`  - ${file.path}: ${state}`);
    }
  }
}

process.exit(ok ? 0 : 1);
