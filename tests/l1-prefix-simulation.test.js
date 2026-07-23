import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// ============================================================================
// L1 prefix simulation: serializes context/dispatch packets and proves
// byte-identical stable prefixes across dynamic-suffix-only changes.
// This is a structural cache-friendliness proof, NOT a provider cache-hit claim.
// See Harness/specs/runtime/context-loading.md#Cache Validation Levels.
// ============================================================================

// Deterministic JSON serialization: stable key order, no trailing whitespace.
// Matches JSON.stringify's spec-mandated insertion-order behavior for own
// enumerable string keys. We keep it simple — define keys in canonical order
// in the source object (Object.keys respects definition order for string keys).
function serialize(obj) {
  return JSON.stringify(obj) + '\n';
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// ---------------------------------------------------------------------------
// Minimal dispatch packet — mirrors the three-layer structure from
// Harness/specs/runtime/context-loading.md § Cache-First Context Contract:
//   1. Stable prefix
//   2. Scoped references
//   3. Dynamic suffix
// ---------------------------------------------------------------------------

function makePacket(opts = {}) {
  const now = opts.timestamp ?? '2026-07-23T10:00:00.000Z';

  // Layer 1 — stable prefix. Must be deterministic and identical across calls
  // that share the same session/runtime configuration.
  const stablePrefix = {
    startup: {
      claudeMdDigest: 'sha256:abc123def456',
      harnessMemoryIndexDigest: 'sha256:7890abCDEF12',
      harnessReadmeDigest: 'sha256:3456cdef7890',
    },
    workflowDocs: [
      // canonical, deterministic order
      { name: 'Harness/specs/workflows/WF.md', digest: 'sha256:wf11111111' },
      { name: 'Harness/specs/workflows/WF-KERNEL.md', digest: 'sha256:wfK2222222' },
      { name: 'Harness/specs/runtime/subagents.md', digest: 'sha256:sub3333333' },
      { name: 'Harness/specs/runtime/dispatch.md', digest: 'sha256:dis44444444' },
    ],
    skillIndex: [
      { skill: 'subagent-orchestrator', version: '1.0' },
      { skill: 'tdd', version: '1.0' },
      { skill: 'wf', version: '1.0' },
      { skill: 'wf-auto', version: '1.0' },
      { skill: 'wf-auto-spark', version: '1.0' },
      { skill: 'wf-learn', version: '1.0' },
      { skill: 'wf-max', version: '1.0' },
      { skill: 'wf-readme', version: '1.0' },
      { skill: 'wf-remove', version: '1.0' },
      { skill: 'wf-review', version: '1.0' },
      { skill: 'wf-update', version: '1.0' },
    ],
    agentIndex: [
      { agent: 'architect', model: 'sonnet' },
      { agent: 'codebase-explorer', model: 'haiku' },
      { agent: 'context-master', model: 'haiku' },
      { agent: 'debugger', model: 'sonnet' },
      { agent: 'docs-researcher', model: 'sonnet' },
      { agent: 'implementer', model: 'sonnet' },
      { agent: 'memory-master', model: 'sonnet' },
      { agent: 'planner', model: 'sonnet' },
      { agent: 'reflector', model: 'sonnet' },
      { agent: 'researcher', model: 'sonnet' },
      { agent: 'reviewer', model: 'sonnet' },
      { agent: 'task-scribe', model: 'haiku' },
      { agent: 'test-writer', model: 'sonnet' },
      { agent: 'verifier', model: 'sonnet' },
    ],
    cacheContractVersion: '1.0',
  };

  // Layer 2 — scoped references. Task-specific but stable within a task.
  const scopedReferences = {
    taskState: opts.taskState ?? { phase: 'build', gate: 'write-gate', tier: 'WF-Standard' },
    planDigest: 'sha256:plan555',
    contracts: opts.contracts ?? ['Harness/tasks/task-example/PLAN.md'],
    selectedSourceFiles: opts.selectedSourceFiles ?? [
      'src/foo.js',
      'src/bar.js',
    ],
  };

  // Layer 3 — dynamic suffix. Volatile content that changes every turn.
  const dynamicSuffix = {
    latestUserMessage: opts.latestUserMessage ?? 'fix the login button',
    activeQuestion: opts.activeQuestion ?? null,
    currentHeartbeat: opts.currentHeartbeat ?? 'implementer wave 2 dispatched',
    timestamp: now,
    cwd: opts.cwd ?? '/home/user/project',
    runtime: opts.runtime ?? 'claude-code',
    model: opts.model ?? 'sonnet',
    channel: opts.channel ?? 'cli',
    freshSearchResults: opts.freshSearchResults ?? [],
    latestToolOutput: opts.latestToolOutput ?? '',
    commandLogs: opts.commandLogs ?? [],
    screenshots: opts.screenshots ?? [],
  };

  return { stablePrefix, scopedReferences, dynamicSuffix };
}

function stablePrefixBytes(packet) {
  const { dynamicSuffix: _dyn, scopedReferences: _scoped, ...rest } = packet;
  // rest = { stablePrefix: ... }
  // Include scopedReferences in serialization boundary? Per the contract,
  // scoped references sit between stable prefix and dynamic suffix.
  // For strict L1 testing we define the prefix as stablePrefix ONLY,
  // because scoped references are task-specific and may change between tasks
  // (but are stable within a task). We test the outer "routing prefix" that
  // must remain byte-identical across turns of the SAME task session.
  return serialize(rest);
}

function fullPacketBytes(packet) {
  return serialize(packet);
}

// ============================================================================
// Positive tests: same stable prefix, different dynamic suffix
// ============================================================================

test('L1 prefix hash is identical when only dynamic suffix changes (same turn, different user message)', () => {
  const p1 = makePacket({ latestUserMessage: 'fix the login button' });
  const p2 = makePacket({ latestUserMessage: 'add dark mode toggle' });

  assert.equal(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'stable prefix hash must be identical when only user message differs');
});

test('L1 prefix hash is identical when only timestamp changes', () => {
  const p1 = makePacket({ timestamp: '2026-07-23T10:00:00.000Z' });
  const p2 = makePacket({ timestamp: '2026-07-23T11:30:00.000Z' });

  assert.equal(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'stable prefix hash must be identical when only timestamp differs');
});

test('L1 prefix hash is identical when only tool output changes', () => {
  const p1 = makePacket({ latestToolOutput: 'npm test: 42 pass, 0 fail' });
  const p2 = makePacket({ latestToolOutput: 'npm test: 43 pass, 0 fail' });

  assert.equal(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'stable prefix hash must be identical when only tool output differs');
});

test('L1 prefix hash is identical when scoped references change (same task, different source files loaded)', () => {
  // scoped references are between stable prefix and dynamic suffix.
  // They are task-scoped but may change between turns within the same task
  // (e.g., loading a different source file). The STABLE prefix (routing docs)
  // must still be identical.
  const p1 = makePacket({ selectedSourceFiles: ['src/foo.js'] });
  const p2 = makePacket({ selectedSourceFiles: ['src/foo.js', 'src/baz.js'] });

  assert.equal(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'stable prefix hash must be identical when scoped source files differ');
});

test('L1 full packet hash differs when dynamic suffix changes', () => {
  const p1 = makePacket({ latestUserMessage: 'fix the login button' });
  const p2 = makePacket({ latestUserMessage: 'add dark mode toggle' });

  assert.notEqual(sha256(fullPacketBytes(p1)), sha256(fullPacketBytes(p2)),
    'full packet hash must differ when user message differs');
});

test('L1 full packet hash differs when timestamp changes', () => {
  const p1 = makePacket({ timestamp: '2026-07-23T10:00:00.000Z' });
  const p2 = makePacket({ timestamp: '2026-07-23T11:30:00.000Z' });

  assert.notEqual(sha256(fullPacketBytes(p1)), sha256(fullPacketBytes(p2)),
    'full packet hash must differ when timestamp differs');
});

// ============================================================================
// Negative controls: changing stable prefix content must change the hash
// ============================================================================

test('L1 prefix hash changes when a workflow doc digest changes', () => {
  const p1 = makePacket();
  const p2 = makePacket();
  // Mutate stable prefix: a workflow doc version changed
  p2.stablePrefix.workflowDocs[0].digest = 'sha256:CHANGED0000';

  assert.notEqual(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'stable prefix hash must change when a workflow doc digest changes');
});

test('L1 prefix hash changes when skill index ordering changes', () => {
  const p1 = makePacket();
  const p2 = makePacket();
  // Mutate: reorder skill list (different insertion order = different cache key)
  const [first, second] = [p2.stablePrefix.skillIndex[0], p2.stablePrefix.skillIndex[1]];
  p2.stablePrefix.skillIndex[0] = second;
  p2.stablePrefix.skillIndex[1] = first;

  assert.notEqual(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'stable prefix hash must change when skill index order changes');
});

test('L1 prefix hash changes when a skill is added to the stable index', () => {
  const p1 = makePacket();
  const p2 = makePacket();
  p2.stablePrefix.skillIndex.push({ skill: 'wf-browser', version: '1.0' });

  assert.notEqual(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'stable prefix hash must change when a skill is added to the stable index');
});

test('L1 prefix hash changes when CLAUDE.md digest changes', () => {
  const p1 = makePacket();
  const p2 = makePacket();
  p2.stablePrefix.startup.claudeMdDigest = 'sha256:UPDATED9999';

  assert.notEqual(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'stable prefix hash must change when CLAUDE.md digest updates');
});

test('L1 prefix hash changes when cache contract version changes', () => {
  const p1 = makePacket();
  const p2 = makePacket();
  p2.stablePrefix.cacheContractVersion = '2.0';

  assert.notEqual(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'stable prefix hash must change when cache contract version changes');
});

// ============================================================================
// Anti-pollution: dynamic-only fields in the stable prefix must be caught
// ============================================================================

test('L1 anti-pollution: injecting a timestamp into stable prefix changes the hash (detected)', () => {
  // If someone mistakenly puts a timestamp in the stable prefix,
  // the prefix hash will change between turns — the test DETECTS this.
  const p1 = makePacket();
  const p2 = makePacket();
  // Simulate: someone added a "generatedAt" field to the stable prefix
  p2.stablePrefix.generatedAt = '2026-07-23T12:00:00.000Z';

  assert.notEqual(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'stable prefix hash must change when a dynamic field (timestamp) leaks into it — this is the pollution alarm');
});

test('L1 anti-pollution: injecting latest tool output into stable prefix changes the hash (detected)', () => {
  const p1 = makePacket();
  const p2 = makePacket();
  // Simulate: someone put tool output inside stable prefix
  p2.stablePrefix.lastToolResult = 'test passed 99/99';

  assert.notEqual(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'stable prefix hash must change when tool output leaks into stable prefix');
});

// ============================================================================
// Edge cases
// ============================================================================

test('L1 deterministic serialization: same inputs produce identical full packet hashes', () => {
  const p1 = makePacket({ latestUserMessage: 'hello' });
  const p2 = makePacket({ latestUserMessage: 'hello' });

  assert.equal(sha256(fullPacketBytes(p1)), sha256(fullPacketBytes(p2)),
    'identical packets must produce identical full hashes');
});

test('L1 deterministic serialization: same inputs produce identical stable prefix hashes', () => {
  const p1 = makePacket();
  const p2 = makePacket();

  assert.equal(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'identical packets must produce identical stable prefix hashes');
});

test('L1 empty dynamic fields do not affect stable prefix hash', () => {
  const p1 = makePacket({ latestUserMessage: '', latestToolOutput: '', freshSearchResults: [] });
  const p2 = makePacket({ latestUserMessage: 'do something', latestToolOutput: 'output', freshSearchResults: [{ title: 'result', url: 'https://example.com' }] });

  assert.equal(sha256(stablePrefixBytes(p1)), sha256(stablePrefixBytes(p2)),
    'stable prefix hash must be identical regardless of dynamic field emptiness');
});
