// workflow-edge-update.test.mjs
//
// updateEdge wiring (P4): edges are editable after connect through the store
// and through the `node-map --action updateEdge` CLI mapping.
//
//   E1: updateEdge changes relation only; other fields unchanged (and the
//       update is idempotent-safe: re-applying the same patch must not fail).
//   E2: updateEdge changes direction + source/target handles; relation and
//       endpoints stay untouched.
//   E3: unknown edge -> EDGE_NOT_FOUND with a clear message.
//   E4: empty update (no fields) -> EMPTY_UPDATE, graph left untouched.
//   E5: CLI mapping — spawn `node Harness/scripts/wf-ui-control.mjs
//       node-map --action updateEdge` against a recording HTTP server and
//       assert the payload shape the CLI sends to the graph-actions endpoint
//       (POST /api/workflow/nodes/:actor/actions/agent.updateEdge).
//
// E1-E4 use the store-level pattern (temp roots via makeHarnessTempRoot);
// E5 spawns a genuine CLI subprocess exactly like control-plane-cli-smoke.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import { connectNodes, updateEdge } from '../workflow-graph-store.mjs';
import { loadWorkflowGraphMap, writeWorkflowGraphMap } from '../a2a-store.mjs';

// ── Store-level helpers ─────────────────────────────────────────────────────

function seedRoot(prefix) {
  const root = makeHarnessTempRoot(prefix);
  fs.mkdirSync(path.join(root, 'Harness', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Harness', 'a2a'), { recursive: true });
  return root;
}

// Seed plain agent graph nodes so connectNodes can resolve endpoints. No
// durable sessions are needed: resolveWorkflowNodeId resolves graph nodes.
function seedAgentGraph(root, nodeIds) {
  writeWorkflowGraphMap(root, {
    schemaVersion: 1,
    version: 1,
    nodes: nodeIds.map((nodeId, index) => ({
      nodeId,
      sessionId: `session-${nodeId}`,
      kind: 'terminal-session',
      runtime: 'claude',
      agentKind: index === 0 ? 'main' : 'subagent',
      role: index === 0 ? 'Main Agent' : `Agent ${nodeId}`,
      label: index === 0 ? 'Main Agent' : `Agent ${nodeId}`,
      status: 'running',
    })),
    edges: [],
  });
}

function edgeFromGraph(root, edgeId) {
  return loadWorkflowGraphMap(root).edges.find(edge => edge.id === edgeId);
}

// ── Store tests ─────────────────────────────────────────────────────────────

describe('updateEdge store', () => {
  it('E1: changes relation only; other fields unchanged; idempotent-safe re-apply', () => {
    const root = seedRoot('edge-update-e1-');
    seedAgentGraph(root, ['e1-main', 'e1-b']);
    const connected = connectNodes(root, {
      from: 'e1-main',
      to: 'e1-b',
      sourceHandle: 'bottom',
      targetHandle: 'top',
    });
    const edgeId = connected.edge.id;
    assert.ok(edgeId, 'connectNodes must return an edge id');
    const versionBefore = loadWorkflowGraphMap(root).version;

    const result = updateEdge(root, edgeId, { relation: 'reports' });
    assert.equal(result.ok, true);
    assert.equal(result.edge.id, edgeId);
    assert.equal(result.edge.relation, 'reports');
    // Fields not in the patch must stay untouched.
    assert.equal(result.edge.from, 'e1-main');
    assert.equal(result.edge.to, 'e1-b');
    assert.equal(result.edge.sourceHandle, 'bottom');
    assert.equal(result.edge.targetHandle, 'top');
    assert.equal(result.edge.direction, 'bidirectional');

    const persisted = edgeFromGraph(root, edgeId);
    assert.equal(persisted.relation, 'reports');
    assert.equal(persisted.sourceHandle, 'bottom');
    assert.equal(persisted.targetHandle, 'top');
    assert.equal(loadWorkflowGraphMap(root).version, versionBefore + 1, 'updateEdge must bump the graph version');

    // Re-applying the same patch must not fail (idempotent-safe).
    const again = updateEdge(root, edgeId, { relation: 'reports' });
    assert.equal(again.ok, true);
    assert.equal(again.edge.relation, 'reports');
  });

  it('E2: changes direction and handles; relation and endpoints untouched', () => {
    const root = seedRoot('edge-update-e2-');
    seedAgentGraph(root, ['e2-main', 'e2-b']);
    const connected = connectNodes(root, {
      from: 'e2-main',
      to: 'e2-b',
      relation: 'delegation',
    });
    const edgeId = connected.edge.id;
    assert.equal(connected.edge.direction, 'bidirectional');

    const result = updateEdge(root, edgeId, {
      direction: 'source-to-target',
      sourceHandle: 'bottom',
      targetHandle: 'top',
    });
    assert.equal(result.ok, true);
    assert.equal(result.edge.direction, 'source-to-target');
    assert.equal(result.edge.sourceHandle, 'bottom');
    assert.equal(result.edge.targetHandle, 'top');
    assert.equal(result.edge.relation, 'delegation', 'relation must stay untouched');
    assert.equal(result.edge.from, 'e2-main');
    assert.equal(result.edge.to, 'e2-b');

    const persisted = edgeFromGraph(root, edgeId);
    assert.equal(persisted.direction, 'source-to-target');
    assert.equal(persisted.sourceHandle, 'bottom');
    assert.equal(persisted.targetHandle, 'top');
    assert.equal(persisted.relation, 'delegation');
  });

  it('E3: unknown edge is rejected with a clear error', () => {
    const root = seedRoot('edge-update-e3-');
    seedAgentGraph(root, ['e3-main', 'e3-b']);
    const connected = connectNodes(root, { from: 'e3-main', to: 'e3-b' });

    assert.throws(
      () => updateEdge(root, 'edge-unknown', { relation: 'reports' }),
      (err) => {
        assert.equal(err.code, 'EDGE_NOT_FOUND');
        assert.match(err.message, /edge-unknown/);
        assert.equal(err.statusCode, 404);
        return true;
      },
    );
    // The known edge must be unaffected.
    assert.equal(edgeFromGraph(root, connected.edge.id).relation, 'delegation');
  });

  it('E4: empty update (no fields) is rejected and leaves the graph untouched', () => {
    const root = seedRoot('edge-update-e4-');
    seedAgentGraph(root, ['e4-main', 'e4-b']);
    const connected = connectNodes(root, {
      from: 'e4-main',
      to: 'e4-b',
      relation: 'delegation',
    });
    const edgeId = connected.edge.id;
    const versionBefore = loadWorkflowGraphMap(root).version;

    assert.throws(
      () => updateEdge(root, edgeId, {}),
      (err) => {
        assert.equal(err.code, 'EMPTY_UPDATE');
        assert.match(err.message, /at least one edge field/);
        assert.equal(err.statusCode, 400);
        return true;
      },
    );
    assert.throws(
      () => updateEdge(root, edgeId, null),
      (err) => {
        assert.equal(err.code, 'INVALID_PATCH');
        return true;
      },
    );
    // Failed updates must not bump the version or change the edge.
    const after = loadWorkflowGraphMap(root);
    assert.equal(after.version, versionBefore, 'failed update must not bump the version');
    assert.equal(edgeFromGraph(root, edgeId).relation, 'delegation');
  });
});

// ── CLI mapping test ────────────────────────────────────────────────────────

// Spawn a real `node Harness/scripts/wf-ui-control.mjs <command>` subprocess.
// Resolves with { status, stdout, stderr }; stdout is the parsed JSON when
// the CLI printed JSON, otherwise the raw string.
function runCli(cwd, args) {
  return new Promise((resolve, reject) => {
    const script = path.join(cwd, 'Harness', 'scripts', 'wf-ui-control.mjs');
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, HARNESS_AGENT_KIND: 'main' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`wf-ui-control timeout: ${args.join(' ')}`));
    }, 15000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      let parsed = stdout.trim();
      try {
        parsed = JSON.parse(parsed);
      } catch {
        // Non-JSON output (e.g. error text) is left as the raw string.
      }
      resolve({ status, stdout: parsed, stderr });
    });
  });
}

describe('node-map --action updateEdge CLI mapping', () => {
  it('E5: sends {actorNodeId, edgeId, relation, direction, sourceHandle, targetHandle} to the graph-actions endpoint', async () => {
    const root = makeHarnessTempRoot('edge-update-e5-');
    const dest = path.join(root, 'Harness', 'scripts', 'wf-ui-control.mjs');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(process.cwd(), 'Harness', 'scripts', 'wf-ui-control.mjs'), dest);

    // Recording server: captures every request, answers 200 JSON.
    const requests = [];
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        requests.push({
          method: req.method,
          url: req.url,
          body: data ? JSON.parse(data) : null,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, captured: true }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}`;
    const baseArgs = ['node-map', '--actor', 'main-node', '--url', url, '--token', 'test-token', '--project', root];

    try {
      // ── explicit --edge ──
      const result = await runCli(root, [
        ...baseArgs,
        '--action', 'updateEdge',
        '--edge', 'main->worker',
        '--relation', 'delegation',
        '--direction', 'source-to-target',
        '--source-handle', 'bottom',
        '--target-handle', 'top',
      ]);
      assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
      assert.equal(requests.length, 1, 'exactly one graph-actions request expected');
      const captured = requests[0];
      assert.equal(captured.method, 'POST');
      assert.match(captured.url, /\/api\/workflow\/nodes\/main-node\/actions\/agent\.updateEdge$/);
      assert.equal(captured.body.actorNodeId, 'main-node');
      assert.equal(captured.body.edgeId, 'main->worker');
      assert.equal(captured.body.relation, 'delegation');
      assert.equal(captured.body.direction, 'source-to-target');
      assert.equal(captured.body.sourceHandle, 'bottom');
      assert.equal(captured.body.targetHandle, 'top');

      // ── --from/--to as the edge-id fallback ──
      const viaPair = await runCli(root, [
        ...baseArgs,
        '--action', 'updateEdge',
        '--from', 'main-node',
        '--to', 'worker-node',
        '--relation', 'reports',
      ]);
      assert.equal(viaPair.status, 0, `CLI failed: ${viaPair.stderr}`);
      assert.equal(requests.length, 2, 'second request expected');
      assert.equal(requests[1].body.edgeId, 'main-node->worker-node');
      assert.equal(requests[1].body.relation, 'reports');

      // ── empty update must fail client-side without any request ──
      const empty = await runCli(root, [
        ...baseArgs,
        '--action', 'updateEdge',
        '--edge', 'main->worker',
      ]);
      assert.notEqual(empty.status, 0, 'empty update must exit non-zero');
      assert.match(String(empty.stderr), /at least one of --relation/);
      assert.equal(requests.length, 2, 'failed mapping must not reach the server');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
