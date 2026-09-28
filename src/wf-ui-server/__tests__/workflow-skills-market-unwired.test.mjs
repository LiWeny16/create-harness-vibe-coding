import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const hubSurfaceFiles = [
  'src/ui/src/components/WorkflowSkillsHubOverlay.tsx',
  'src/ui/src/components/WorkflowRoute.tsx',
  'src/wf-ui-server/server.mjs',
  'src/ui/src/components/workflow/nodeRuntimeClient.ts',
];

test('AC-006 Market implementation is not wired into the Skills Hub surface', () => {
  for (const relativePath of hubSurfaceFiles) {
    const contents = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.doesNotMatch(contents, /skills[-_]market|skillsMarket/i, `${relativePath} must not reference the Market module or client`);
  }
});
