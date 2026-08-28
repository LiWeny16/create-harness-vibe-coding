import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), '.tmp-p3-test-' + id);
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  // Seed graph-map with an agent/terminal-session node
  const graphMap = {
    schemaVersion: 1, version: 1,
    nodes: [
      { nodeId: 'session-test-agent-01', sessionId: 'test-agent-session-01', agentKind: 'main', runtime: 'claude', status: 'stopped', label: 'Test Agent', cwd: dir, taskId: null },
    ],
    edges: [],
    positions: { 'session-test-agent-01': { x: 100, y: 100 } },
    undoStack: [], redoStack: [], deletedNodes: [],
  };
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify(graphMap));
  // Create terminal session on disk if possible
  try {
    fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'sessions', 'test-agent-session-01'), { recursive: true });
    const sessionState = {
      sessionId: 'test-agent-session-01', status: 'stopped', runtime: 'claude',
      agentKind: 'main', role: 'test', cwd: dir, projectRoot: dir,
      graphNodeId: 'session-test-agent-01', nodeHomeRel: 'Harness/a2a/nodes/test-agent-session-01',
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'sessions', 'test-agent-session-01', 'STATE.json'), JSON.stringify(sessionState));
  } catch {}
  // Settings
  try { fs.mkdirSync(path.join(dir, 'Harness'), { recursive: true }); } catch {}
  try { fs.writeFileSync(path.join(dir, 'Harness', 'settings.json'), '{}'); } catch {}
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function seedActiveTask(root, taskId = 'task-api-goal') {
  fs.mkdirSync(path.join(root, 'Harness', 'tasks', taskId), { recursive: true });
  fs.writeFileSync(path.join(root, 'Harness', 'PROGRESS.md'), `# PROGRESS.md\n\n## Active Task\n\n- ${taskId}\n`, 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId,
    status: 'active',
    mode: 'direct',
    tier: 'WF-Standard',
    phase: 'implement',
    gate: 'TEST-GATE',
    updatedAt: '2026-08-05T00:00:00.000Z',
    activeQuestion: null,
    nextAction: 'Ship Advanced Timer and Goal node.',
    acceptance: [
      { id: 'W14-TIMER', status: 'tracked', text: 'Advanced Timer supports base heartbeat and watchdog control.' },
      { id: 'W14-GOAL', status: 'tracked', text: 'Goal node exposes objective, acceptance, and two-phase completion.' },
    ],
    links: { dependsOn: [], blocks: [], related: [] },
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'PLAN.md'), '# API goal plan\n', 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'PROGRESS.md'), '# API goal progress\n', 'utf8');
  return `goal-${taskId}`;
}

function jsonRequest(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { 'content-type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let root, server, baseUrl;

describe('Phase 3 — Unified Node Snapshot + Agent Adapter', () => {
  before(async () => {
    root = tempProjectRoot();
    const mod = await import('../server.mjs');
    const sessionMock = { getAll: () => [], get: () => null, create: () => {}, stop: () => null, update: () => {}, remove: () => {}, withLock: (_k, fn) => Promise.resolve().then(fn) };
    const raw = mod.createServer({ projectRoot: root, sessionRegistry: sessionMock, token: '' });
    await new Promise(r => raw.listen(0, () => r()));
    baseUrl = `http://127.0.0.1:${raw.address().port}`;
    server = raw;
  });
  after(() => { if (server) server.close(); cleanup(root); });

  // ── P3-001: listNodes includes agent graph nodes ──
  it('P3-001 GET /api/workflow/nodes includes agent graph-map nodes alongside component nodes', async () => {
    // Create a component node first
    await jsonRequest(`${baseUrl}/api/workflow/nodes`, { method: 'POST', body: { type: 'markdown', title: 'P3 Test MD' } });
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.nodes), 'nodes must be an array');
    // Should have at least 2 nodes: 1 component + 1 agent from seeded graph-map
    const agentNodes = res.body.nodes.filter(n => n.kind === 'agent' || n.sessionId);
    const componentNodes = res.body.nodes.filter(n => n.kind === 'markdown' || n.kind === 'excalidraw' || n.kind === 'file');
    assert.ok(agentNodes.length >= 1, `P3-001 RED: no agent nodes in list. Total: ${res.body.nodes.length}, kinds: ${res.body.nodes.map(n => n.kind).join(', ')}`);
    assert.ok(componentNodes.length >= 1, 'should have at least one component node');
    const markdownNode = componentNodes.find(n => n.kind === 'markdown');
    assert.deepEqual(markdownNode.graph.handles, {
      inputs: [],
      outputs: [],
      bidirectional: ['markdown'],
      ports: ['markdown'],
      physical: ['markdown:left', 'markdown:right', 'markdown:top', 'markdown:bottom'],
    });
  });

  // ── P3-002: agent.readContext returns 200 ──
  it('P3-002 POST /api/workflow/nodes/<agentId>/actions/agent.readContext returns context', async () => {
    const markdown = await jsonRequest(`${baseUrl}/api/workflow/nodes`, {
      method: 'POST',
      body: { type: 'markdown', title: 'P3 Agent Context MD' },
    });
    assert.equal(markdown.status, 201);
    const markdownNodeId = markdown.body.node.nodeId;
    const edge = await jsonRequest(`${baseUrl}/api/workflow/edges`, {
      method: 'POST',
      body: {
        from: 'session-test-agent-01',
        to: markdownNodeId,
        relation: 'context',
        sourceHandle: 'context',
        targetHandle: 'markdown',
      },
    });
    assert.equal(edge.status, 201);

    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/session-test-agent-01/actions/agent.readContext`, {
      method: 'POST', body: {},
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.ok);
    const context = res.body.context || res.body.result;
    assert.equal(context.nodeId, 'session-test-agent-01');
    assert.equal(context.identity.nodeId, 'session-test-agent-01');
    assert.equal(context.identity.sessionId, 'test-agent-session-01');
    assert.equal(context.identity.isMainAgent, true);
    assert.equal(context.workspace.kind, 'agent-node-home');
    assert.equal(context.workspace.cwd, root);
    assert.equal(context.workspace.nodeHomeRel, 'Harness/a2a/nodes/test-agent-session-01');
    assert.equal(context.workspace.nodeInitRel, 'Harness/a2a/nodes/test-agent-session-01/init.md');
    assert.equal(context.workspace.boundaries.workflowMap, 'backend-owned-read-only-diagnostic');
    assert.equal(context.ontology.ontologyId, 'harness.workflow.ontology');
    assert.ok(context.defaultSkills.includes('workflow-node-map'));
    assert.ok(context.effectiveSkills.includes('workflow-node-actions'));
    assert.ok(context.skillTriggers['workflow-node-actions'].includes('draw flowchart'));
    assert.ok(context.skillTriggers['workflow-node-map'].includes('connect nodes'));
    const actionSkillRef = context.defaultCapabilityRefs.find(ref => ref.name === 'workflow-node-actions');
    assert.ok(actionSkillRef.triggers.includes('draw flowchart'));
    assert.ok(context.connectedResourceRefs.some(ref => ref.nodeId === markdownNodeId && ref.type === 'markdown'));
    const markdownAffordance = context.affordances.find(ref => ref.nodeId === markdownNodeId);
    assert.equal(markdownAffordance.priority, 'preferred-output-target');
    assert.ok(markdownAffordance.allowedActions.includes('markdown.append'));
  });

  // ── P3-003: agent.readOutput returns terminal output ──
  it('P3-003 POST /api/workflow/nodes/<agentId>/actions/agent.readOutput returns output', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/session-test-agent-01/actions/agent.readOutput`, {
      method: 'POST', body: { tail: 20 },
    });
    assert.ok(res.status < 500, `P3-003 RED: got ${res.status}: ${JSON.stringify(res.body)}`);
    if (res.status === 200) {
      assert.ok(res.body.ok);
    }
  });

  // ── P3-004: agent.stop returns success ──
  it('P3-004 POST /api/workflow/nodes/<agentId>/actions/agent.stop returns ok', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/session-test-agent-01/actions/agent.stop`, {
      method: 'POST', body: {},
    });
    assert.ok(res.status < 500, `P3-004 RED: got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  // ── P3-005: agent.delete cleans graph-map ──
  it('P3-005 DELETE agent node removes from graph-map', async () => {
    const res = await jsonRequest(`${baseUrl}/api/workflow/nodes/session-test-agent-01/actions/agent.delete`, {
      method: 'POST', body: {},
    });
    assert.ok(res.status < 500, `P3-005 RED: got ${res.status}: ${JSON.stringify(res.body)}`);
    if (res.status === 200) {
      // Verify graph-map no longer has the node
      const graphRes = await jsonRequest(`${baseUrl}/api/a2a/graph-map`);
      const nodeIds = (graphRes.body.nodes || []).map(n => n.nodeId || n.id);
      assert.ok(!nodeIds.includes('session-test-agent-01'), 'agent node should be removed from graph-map');
    }
  });
});

describe('Phase 3 — Snapshot Completeness', () => {
  let root2, server2, baseUrl2;

  before(async () => {
    root2 = tempProjectRoot();
    const mod = await import('../server.mjs');
    const sessionMock = { getAll: () => [], get: () => null, create: () => {}, stop: () => null, update: () => {}, remove: () => {}, withLock: (_k, fn) => Promise.resolve().then(fn) };
    const raw = mod.createServer({ projectRoot: root2, sessionRegistry: sessionMock, token: '' });
    await new Promise(r => raw.listen(0, () => r()));
    baseUrl2 = `http://127.0.0.1:${raw.address().port}`;
    server2 = raw;
  });
  after(() => { if (server2) server2.close(); cleanup(root2); });

  // ── P3-006: executeNodeAction response has graph.connections ──
  it('P3-006 executeNodeAction response includes graph.connections on node snapshot', async () => {
    // Create two nodes and connect them
    const a = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'markdown', title: 'A' } });
    const b = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'excalidraw', title: 'B' } });
    await jsonRequest(`${baseUrl2}/api/workflow/edges`, { method: 'POST', body: { from: a.body.node.nodeId, to: b.body.node.nodeId } });

    // Execute action on one of them
    const res = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${a.body.node.nodeId}/actions/markdown.read`, {
      method: 'POST', body: {},
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.ok);
    // P3-006 check
    const node = res.body.node;
    assert.ok(node.graph, 'node must have graph');
    assert.ok(Array.isArray(node.graph.connections), 'graph.connections must be array');
    assert.ok(node.graph.connections.length > 0, `P3-006 RED: node.graph.connections is empty after edge creation. connections=${JSON.stringify(node.graph.connections)}`);
  });

  // ── P3-007: updateNodeSettings response has graph.connections ──
  it('P3-007 updateNodeSettings response includes graph.connections', async () => {
    const a = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'markdown', title: 'SettingsTest' } });
    const b = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'file', title: 'FileTest', file: { source: 'workspace', path: 'x.txt', name: 'x.txt', mime: 'text/plain', size: 0 } } });
    await jsonRequest(`${baseUrl2}/api/workflow/edges`, { method: 'POST', body: { from: a.body.node.nodeId, to: b.body.node.nodeId } });

    const res = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${a.body.node.nodeId}/settings`, {
      method: 'PATCH', body: { editorMode: 'source' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.node);
    assert.ok(res.body.node.graph);
    assert.ok(res.body.node.graph.connections.length > 0, `P3-007 RED: updateNodeSettings response lacks connections. got ${res.body.node.graph.connections.length}`);
  });

  it('AC-007 POST /api/workflow/edges rejects reverse duplicates for bidirectional links', async () => {
    const a = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'markdown', title: 'Reverse API A' } });
    const b = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'markdown', title: 'Reverse API B' } });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(b.status, 201, JSON.stringify(b.body));

    const first = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: { from: a.body.node.nodeId, to: b.body.node.nodeId, sourceHandle: 'markdown', targetHandle: 'markdown' },
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.edge.sourceHandle, 'markdown:right');
    assert.equal(first.body.edge.targetHandle, 'markdown:left');

    const reverse = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: { from: b.body.node.nodeId, to: a.body.node.nodeId, sourceHandle: 'markdown', targetHandle: 'markdown' },
    });
    assert.equal(reverse.status, 409, JSON.stringify(reverse.body));
    assert.equal(reverse.body.error.code, 'DUPLICATE_EDGE');
  });

  // ── P3-008: Excalidraw far-away elements produce non-empty preview ──
  it('AC-007 POST /api/workflow/edges preserves bare resource side handles', async () => {
    const a = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'markdown', title: 'Side API A' } });
    const b = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'excalidraw', title: 'Side API B' } });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(b.status, 201, JSON.stringify(b.body));

    const res = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: { from: a.body.node.nodeId, to: b.body.node.nodeId, sourceHandle: 'left', targetHandle: 'right' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.edge.sourceHandle, 'markdown:left');
    assert.equal(res.body.edge.targetHandle, 'scene:right');
    assert.equal(res.body.edge.direction, 'bidirectional');
  });

  it('W11 POST /api/workflow/nodes creates Timer nodes and directed event edges', async () => {
    const timer = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        type: 'timer',
        title: 'API Timer',
        schedule: { mode: 'manual', intervalSeconds: 300 },
        payloadTemplate: { prompt: 'Check inbox' },
      },
    });
    assert.equal(timer.status, 201, JSON.stringify(timer.body));
    assert.equal(timer.body.node.kind, 'timer');
    assert.equal(timer.body.node.graph.handles.outputs[0], 'event');
    assert.equal(timer.body.node.graph.handles.directions.event, 'source-to-target');

    const edge = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: {
        from: timer.body.node.nodeId,
        to: 'session-test-agent-01',
        relation: 'event',
        direction: 'source-to-target',
        sourceHandle: 'event',
        targetHandle: 'event.in',
      },
    });
    assert.equal(edge.status, 201, JSON.stringify(edge.body));
    assert.equal(edge.body.edge.direction, 'source-to-target');
    assert.equal(edge.body.edge.kind, 'event-link');
    assert.equal(edge.body.edge.sourceHandle, 'event');
    assert.equal(edge.body.edge.targetHandle, 'event.in');

    const context = await jsonRequest(`${baseUrl2}/api/workflow/context/session-test-agent-01`);
    assert.equal(context.status, 200, JSON.stringify(context.body));
    assert.ok(Array.isArray(context.body.context.connectedEventRefs));
    const eventRef = context.body.context.connectedEventRefs.find(ref => ref.nodeId === timer.body.node.nodeId);
    assert.ok(eventRef, JSON.stringify(context.body.context.connectedEventRefs));
    assert.equal(eventRef.direction, 'source-to-target');
    assert.equal(eventRef.eventKind, 'timer');
    assert.equal(eventRef.connection.localHandle, 'event.in');
  });

  it('W14-TIMER API supports Advanced Timer Agent control and WDT state', async () => {
    const timer = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        type: 'timer',
        title: 'API Advanced Timer',
        enabled: true,
        schedule: {
          mode: 'loop',
          intervalSeconds: 45,
          cadence: { kind: 'sequence', sequenceSeconds: [45, 90] },
        },
        heartbeat: {
          base: { enabled: true, intervalSeconds: 45 },
          watchdog: { enabled: true, intervalSeconds: 600, timeoutSeconds: 1800 },
        },
        controlPolicy: { agentCanDisable: true, agentCanSetInterval: true, minIntervalSeconds: 15, maxIntervalSeconds: 3600 },
      },
    });
    assert.equal(timer.status, 201, JSON.stringify(timer.body));
    assert.equal(timer.body.state.schedule.mode, 'loop');
    assert.deepEqual(timer.body.state.schedule.cadence.sequenceSeconds, [45, 90]);
    assert.equal(timer.body.state.heartbeat.watchdog.state, 'ok');

    const eventEdge = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: {
        from: timer.body.node.nodeId,
        to: 'session-test-agent-01',
        relation: 'event',
        direction: 'source-to-target',
        sourceHandle: 'event',
        targetHandle: 'event.in',
      },
    });
    assert.equal(eventEdge.status, 201, JSON.stringify(eventEdge.body));
    const controlEdge = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: {
        from: 'session-test-agent-01',
        to: timer.body.node.nodeId,
        relation: 'control',
        direction: 'source-to-target',
        sourceHandle: 'control',
        targetHandle: 'config',
      },
    });
    assert.equal(controlEdge.status, 201, JSON.stringify(controlEdge.body));

    const interval = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${timer.body.node.nodeId}/actions/timer.setInterval`, {
      method: 'POST',
      body: { actorNodeId: 'session-test-agent-01', intervalSeconds: 120, lane: 'base' },
    });
    assert.equal(interval.status, 200, JSON.stringify(interval.body));
    assert.equal(interval.body.result.state.schedule.intervalSeconds, 120);
    assert.equal(interval.body.result.state.heartbeat.base.intervalSeconds, 120);

    const ack = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${timer.body.node.nodeId}/actions/timer.ackWatchdog`, {
      method: 'POST',
      body: { actorNodeId: 'session-test-agent-01', now: '2026-08-05T01:00:00.000Z' },
    });
    assert.equal(ack.status, 200, JSON.stringify(ack.body));
    assert.equal(ack.body.result.state.heartbeat.watchdog.lastAckAt, '2026-08-05T01:00:00.000Z');

    const context = await jsonRequest(`${baseUrl2}/api/workflow/context/session-test-agent-01`);
    assert.equal(context.status, 200, JSON.stringify(context.body));
    const ref = context.body.context.connectedEventRefs.find(item => item.nodeId === timer.body.node.nodeId);
    assert.ok(ref, JSON.stringify(context.body.context.connectedEventRefs));
    assert.ok(ref.allowedActions.includes('timer.disable'));
    assert.equal(ref.heartbeat.base.intervalSeconds, 120);
    assert.equal(ref.heartbeat.watchdog.state, 'ok');
  });

  it('release-core/backend-gating POST /api/workflow/nodes rejects github-trigger without experimental opt-in', async () => {
    const rejected = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        type: 'github-trigger',
        title: 'Default API GitHub Trigger',
      },
    });
    assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
    assert.equal(rejected.body.error.code, 'PLANNED_NODE_REQUIRES_EXPERIMENTAL');
  });

  it('W14 POST /api/workflow/nodes creates GitHub Trigger nodes and Agent context refs', async () => {
    const trigger = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        type: 'github-trigger',
        experimental: true,
        title: 'API GitHub Trigger',
        repository: { owner: 'zingspark', name: 'create-harness-vibe-coding' },
        eventFilters: { events: ['pull_request'], actions: ['opened'], branches: ['main'] },
      },
    });
    assert.equal(trigger.status, 201, JSON.stringify(trigger.body));
    assert.equal(trigger.body.node.kind, 'github-trigger');
    assert.equal(trigger.body.node.graph.handles.outputs[0], 'event');
    assert.equal(trigger.body.node.graph.handles.directions.event, 'source-to-target');
    assert.equal(trigger.body.node.contentRef.eventKind, 'github-trigger');
    assert.equal(trigger.body.state.repository.fullName, 'zingspark/create-harness-vibe-coding');

    const receive = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${trigger.body.node.nodeId}/actions/github-trigger.receive`, {
      method: 'POST',
      body: {
        event: 'pull_request',
        action: 'opened',
        deliveryId: 'delivery-api-1',
        repository: { owner: 'zingspark', name: 'create-harness-vibe-coding' },
        sender: 'octocat',
        pullRequest: { number: 99, title: 'API trigger event' },
        rawBody: '{"token":"ghp_secret_value"}',
        headers: { authorization: 'Bearer secret' },
      },
    });
    assert.equal(receive.status, 200, JSON.stringify(receive.body));
    assert.equal(receive.body.result.event.kind, 'github.pull_request');
    assert.equal(receive.body.result.state.eventCount, 1);

    const edge = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: {
        from: trigger.body.node.nodeId,
        to: 'session-test-agent-01',
        relation: 'event',
        direction: 'source-to-target',
        sourceHandle: 'event',
        targetHandle: 'event.in',
      },
    });
    assert.equal(edge.status, 201, JSON.stringify(edge.body));
    assert.equal(edge.body.edge.direction, 'source-to-target');
    assert.equal(edge.body.edge.kind, 'event-link');

    const context = await jsonRequest(`${baseUrl2}/api/workflow/context/session-test-agent-01`);
    assert.equal(context.status, 200, JSON.stringify(context.body));
    const eventRef = context.body.context.connectedEventRefs.find(ref => ref.nodeId === trigger.body.node.nodeId);
    assert.ok(eventRef, JSON.stringify(context.body.context.connectedEventRefs));
    assert.equal(eventRef.eventKind, 'github-trigger');
    assert.equal(eventRef.connection.localHandle, 'event.in');
    assert.equal(eventRef.repository.fullName, 'zingspark/create-harness-vibe-coding');
    assert.equal(eventRef.lastEvent.pullRequest.number, 99);

    const serialized = JSON.stringify({ trigger: trigger.body, receive: receive.body, context: context.body.context });
    assert.equal(serialized.includes('ghp_secret_value'), false);
    assert.equal(serialized.includes('Bearer secret'), false);
    assert.equal(serialized.includes('rawBody'), false);
    assert.equal(serialized.includes('headers'), false);
    assert.equal(serialized.includes('"token"'), false);
  });

  it('W14-GOAL API exposes active Goal node and two-phase Agent completion proposal', async () => {
    const goalNodeId = seedActiveTask(root2);
    const nodes = await jsonRequest(`${baseUrl2}/api/workflow/nodes`);
    assert.equal(nodes.status, 200, JSON.stringify(nodes.body));
    const goal = nodes.body.nodes.find(node => node.nodeId === goalNodeId);
    assert.ok(goal, JSON.stringify(nodes.body.nodes.map(node => node.kind)));
    assert.equal(goal.kind, 'goal');
    assert.equal(goal.ui.testId, 'workflow-goal-node');

    const denied = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${goalNodeId}/actions/goal.requestCompletion`, {
      method: 'POST',
      body: {
        actorNodeId: 'session-test-agent-01',
        evidenceRefs: ['must-not-write'],
        note: 'Unconnected Agent should not update Goal state.',
      },
    });
    assert.equal(denied.status, 403, JSON.stringify(denied.body));
    assert.equal(denied.body.error.code, 'GOAL_EDGE_REQUIRED');

    const deniedUpdate = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${goalNodeId}/actions/goal.update`, {
      method: 'POST',
      body: {
        actorNodeId: 'session-test-agent-01',
        title: 'Unlinked API write should fail',
      },
    });
    assert.equal(deniedUpdate.status, 403, JSON.stringify(deniedUpdate.body));
    assert.equal(deniedUpdate.body.error.code, 'GOAL_EDGE_REQUIRED');

    const edge = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: {
        from: goalNodeId,
        to: 'session-test-agent-01',
        relation: 'wf-bridge/goal',
        direction: 'bidirectional',
        sourceHandle: 'goal:right',
        targetHandle: 'context',
      },
    });
    assert.equal(edge.status, 201, JSON.stringify(edge.body));
    assert.equal(edge.body.edge.relation, 'goal');

    const linkedUpdate = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${goalNodeId}/actions/goal.update`, {
      method: 'POST',
      body: {
        actorNodeId: 'session-test-agent-01',
        title: 'API editable Goal title',
        status: 'completed',
        phase: 'forged-api-phase',
        gate: 'forged-api-gate',
        nextAction: 'Verify API-linked Goal edit',
      },
    });
    assert.equal(linkedUpdate.status, 200, JSON.stringify(linkedUpdate.body));
    assert.equal(linkedUpdate.body.result.state.title, 'API editable Goal title');
    assert.equal(linkedUpdate.body.result.state.status, 'active');
    assert.notEqual(linkedUpdate.body.result.state.phase, 'forged-api-phase');
    assert.notEqual(linkedUpdate.body.result.state.gate, 'forged-api-gate');

    const context = await jsonRequest(`${baseUrl2}/api/workflow/context/session-test-agent-01`);
    assert.equal(context.status, 200, JSON.stringify(context.body));
    assert.ok(Array.isArray(context.body.context.connectedGoalRefs));
    const ref = context.body.context.connectedGoalRefs.find(item => item.nodeId === goalNodeId);
    assert.ok(ref, JSON.stringify(context.body.context.connectedGoalRefs));
    assert.equal(ref.title, 'API editable Goal title');
    assert.equal(ref.status, 'active');
    assert.equal(ref.acceptance.length, 2);
    assert.equal(ref.progress.total, 2);
    assert.equal(ref.contentRef.kind, 'task-capsule');
    assert.equal(ref.contentRef.statePath, 'Harness/tasks/task-api-goal/STATE.json');
    assert.ok(context.body.context.connectedPeers.some(peer => peer.nodeId === goalNodeId && peer.type === 'goal'));

    const proposed = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${goalNodeId}/actions/goal.requestCompletion`, {
      method: 'POST',
      body: {
        actorNodeId: 'session-test-agent-01',
        evidenceRefs: ['api-tests'],
        note: 'W14 API checks pass.',
      },
    });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
    assert.equal(proposed.body.result.state.status, 'proposed-complete');
    assert.equal(proposed.body.result.state.confirmation.proposedBy, 'session-test-agent-01');
    const refreshedContext = await jsonRequest(`${baseUrl2}/api/workflow/context/session-test-agent-01`);
    const updatedGoalRef = refreshedContext.body.context.connectedGoalRefs.find(item => item.nodeId === goalNodeId);
    assert.equal(updatedGoalRef.status, 'proposed-complete');
    assert.equal(updatedGoalRef.confirmation.state, 'proposed');
    const taskState = JSON.parse(fs.readFileSync(path.join(root2, 'Harness', 'tasks', 'task-api-goal', 'STATE.json'), 'utf8'));
    assert.equal(taskState.status, 'active', 'Agent completion proposal must not mark task complete');
  });

  it('AC-004 AC-005 GET workflow context exposes canonical connected resource refs and Markdown output routing', async () => {
    fs.mkdirSync(path.join(root2, 'src'), { recursive: true });
    const fileBody = '# Canonical Context\n\nReadable file.\n';
    fs.writeFileSync(path.join(root2, 'src', 'canonical-context.md'), fileBody);

    const fileNode = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        nodeId: 'component-canonical-context-file',
        type: 'file',
        title: 'canonical-context.md',
        file: {
          source: 'workspace',
          path: 'src/canonical-context.md',
          name: 'canonical-context.md',
          mime: 'text/markdown',
          size: Buffer.byteLength(fileBody),
        },
      },
    });
    const missingFileNode = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        nodeId: 'component-canonical-missing-file',
        type: 'file',
        title: 'missing-context.md',
        file: {
          source: 'workspace',
          path: 'src/missing-context.md',
          name: 'missing-context.md',
          mime: 'text/markdown',
          size: 99,
        },
      },
    });
    const olderMarkdown = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        nodeId: 'component-canonical-alpha-notes',
        type: 'markdown',
        title: 'Alpha Notes',
        markdown: '# Alpha\n',
      },
    });
    const newerMarkdown = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        nodeId: 'component-canonical-zeta-notes',
        type: 'markdown',
        title: 'Zeta Notes',
        markdown: '# Zeta\n',
      },
    });
    const diagramNode = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        nodeId: 'component-canonical-diagram',
        type: 'excalidraw',
        title: 'Sketch',
        scene: { elements: [], appState: {}, files: {} },
      },
    });
    for (const result of [fileNode, missingFileNode, olderMarkdown, newerMarkdown, diagramNode]) {
      assert.equal(result.status, 201, JSON.stringify(result.body));
    }

    const settings = await jsonRequest(`${baseUrl2}/api/workflow/nodes/session-test-agent-01/settings`, {
      method: 'PATCH',
      body: {
        outputRouting: {
          markdownDefaultEnabled: true,
          markdownTargetNodeId: '',
          fallback: 'oldest-connected-markdown',
        },
      },
    });
    assert.equal(settings.status, 200, JSON.stringify(settings.body));
    assert.equal(settings.body.node.kind, 'agent');
    assert.equal(settings.body.settings.values.outputRouting.markdownDefaultEnabled, true);

    const edges = [
      { from: fileNode.body.node.nodeId, to: 'session-test-agent-01', relation: 'context', sourceHandle: 'file', targetHandle: 'context' },
      { from: missingFileNode.body.node.nodeId, to: 'session-test-agent-01', relation: 'context', sourceHandle: 'file', targetHandle: 'context' },
      { from: 'session-test-agent-01', to: newerMarkdown.body.node.nodeId, relation: 'default-output', sourceHandle: 'output', targetHandle: 'markdown' },
      { from: 'session-test-agent-01', to: olderMarkdown.body.node.nodeId, relation: 'default-output', sourceHandle: 'output', targetHandle: 'markdown' },
      { from: diagramNode.body.node.nodeId, to: 'session-test-agent-01', relation: 'context', sourceHandle: 'scene', targetHandle: 'context' },
    ];
    for (const edge of edges) {
      const res = await jsonRequest(`${baseUrl2}/api/workflow/edges`, { method: 'POST', body: edge });
      assert.equal(res.status, 201, JSON.stringify(res.body));
    }

    const contextRes = await jsonRequest(`${baseUrl2}/api/workflow/context/session-test-agent-01`);
    assert.equal(contextRes.status, 200);
    const context = contextRes.body.context;
    assert.ok(Array.isArray(context.connectedResourceRefs), 'canonical context must expose connectedResourceRefs');
    const refsByNodeId = new Map(context.connectedResourceRefs.map(ref => [ref.nodeId, ref]));

    const fileRef = refsByNodeId.get(fileNode.body.node.nodeId);
    assert.equal(fileRef.direction, 'bidirectional');
    assert.equal(fileRef.endpointRole, 'target');
    assert.deepEqual(fileRef.stateRef, {
      path: fileNode.body.node.stateRef.path,
      revision: fileNode.body.node.stateRef.revision,
    });
    assert.equal(fileRef.contentRef.kind, 'workspace-file');
    assert.equal(fileRef.contentRef.path, 'src/canonical-context.md');
    assert.equal(fileRef.contentRef.mime, 'text/markdown');
    assert.equal(fileRef.contentRef.size, Buffer.byteLength(fileBody));
    assert.equal(fileRef.contentRef.endpoints.text, '/api/workspace/text');
    assert.deepEqual(fileRef.handles, {
      inputs: [],
      outputs: [],
      bidirectional: ['file'],
      ports: ['file'],
      physical: ['file:left', 'file:right', 'file:top', 'file:bottom'],
    });
    assert.ok(fileRef.capabilities.includes('text:read'));
    assert.deepEqual(fileRef.connection, {
      edgeId: `${fileNode.body.node.nodeId}->session-test-agent-01`,
      localHandle: 'context',
      peerHandle: 'file:right',
      sourceHandle: 'file:right',
      targetHandle: 'context',
      relation: 'context',
      direction: 'bidirectional',
      endpointRole: 'target',
    });
    assert.equal(fileRef.metadata.exists, true);
    assert.equal(fileRef.metadata.stale, false);
    assert.equal(typeof fileRef.metadata.etag, 'string');

    const missingRef = refsByNodeId.get(missingFileNode.body.node.nodeId);
    assert.equal(missingRef.metadata.exists, false);
    assert.equal(missingRef.metadata.stale, true);
    assert.equal(missingRef.metadata.needsRefresh, true);
    assert.equal(missingRef.metadata.etag, null);

    const markdownRef = refsByNodeId.get(olderMarkdown.body.node.nodeId);
    assert.equal(markdownRef.direction, 'bidirectional');
    assert.equal(markdownRef.endpointRole, 'source');
    assert.deepEqual(markdownRef.contentRef, {
      kind: 'component-state',
      statePath: olderMarkdown.body.node.stateRef.path,
      revision: olderMarkdown.body.node.stateRef.revision,
      field: 'markdown',
      mime: 'text/markdown',
    });
    assert.deepEqual(markdownRef.handles, {
      inputs: [],
      outputs: [],
      bidirectional: ['markdown'],
      ports: ['markdown'],
      physical: ['markdown:left', 'markdown:right', 'markdown:top', 'markdown:bottom'],
    });

    const diagramRef = refsByNodeId.get(diagramNode.body.node.nodeId);
    assert.equal(diagramRef.type, 'excalidraw');
    assert.ok(diagramRef.capabilities.includes('excalidraw:read'));
    assert.deepEqual(diagramRef.handles, {
      inputs: [],
      outputs: [],
      bidirectional: ['scene'],
      ports: ['scene'],
      physical: ['scene:left', 'scene:right', 'scene:top', 'scene:bottom'],
    });

    assert.deepEqual(context.outputRouting.markdownDefault, {
      enabled: true,
      explicitTargetNodeId: '',
      resolvedTargetNodeId: olderMarkdown.body.node.nodeId,
      resolution: 'oldest-connected-markdown',
    });
  });

  it('AC-005 PATCH workflow agent settings supports explicit Markdown output target', async () => {
    const markdown = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        nodeId: 'component-canonical-explicit-notes',
        type: 'markdown',
        title: 'Explicit Notes',
        markdown: '# Explicit\n',
      },
    });
    assert.equal(markdown.status, 201, JSON.stringify(markdown.body));

    const edge = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: {
        from: 'session-test-agent-01',
        to: markdown.body.node.nodeId,
        relation: 'default-output',
        sourceHandle: 'output',
        targetHandle: 'markdown',
      },
    });
    assert.equal(edge.status, 201, JSON.stringify(edge.body));

    const settings = await jsonRequest(`${baseUrl2}/api/workflow/nodes/session-test-agent-01/settings`, {
      method: 'PATCH',
      body: {
        outputRouting: {
          markdownDefaultEnabled: true,
          markdownTargetNodeId: markdown.body.node.nodeId,
          fallback: 'oldest-connected-markdown',
        },
      },
    });
    assert.equal(settings.status, 200, JSON.stringify(settings.body));
    assert.equal(settings.body.settings.schemaId, 'agent-settings');
    assert.deepEqual(settings.body.settings.values.outputRouting, {
      markdownDefaultEnabled: true,
      markdownTargetNodeId: markdown.body.node.nodeId,
      fallback: 'oldest-connected-markdown',
    });

    const contextRes = await jsonRequest(`${baseUrl2}/api/workflow/context/session-test-agent-01`);
    assert.equal(contextRes.status, 200);
    assert.deepEqual(contextRes.body.context.outputRouting.markdownDefault, {
      enabled: true,
      explicitTargetNodeId: markdown.body.node.nodeId,
      resolvedTargetNodeId: markdown.body.node.nodeId,
      resolution: 'explicit-target',
    });
  });

  it('AC-004 AC-005 Agent config skills are exposed as effective capability refs in workflow context', async () => {
    const patch = await jsonRequest(`${baseUrl2}/api/a2a/nodes/session-test-agent-01/config`, {
      method: 'PATCH',
      body: {
        skills: ['wf-ui', 'browser-lab', 'wf-ui'],
        skillPolicy: 'manual',
      },
    });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));
    assert.deepEqual(patch.body.node.config.skills, ['wf-ui', 'browser-lab']);
    assert.equal(patch.body.node.config.skillPolicy, 'manual');

    const contextRes = await jsonRequest(`${baseUrl2}/api/workflow/context/session-test-agent-01`);
    assert.equal(contextRes.status, 200, JSON.stringify(contextRes.body));
    const context = contextRes.body.context;
    assert.ok(context.effectiveSkills.includes('workflow-ontology'));
    assert.ok(context.effectiveSkills.includes('workflow-context'));
    assert.ok(context.effectiveSkills.includes('wf-ui'));
    assert.ok(context.effectiveSkills.includes('browser-lab'));
    assert.equal(context.skillPolicy, 'manual');
    assert.ok(Array.isArray(context.connectedCapabilityRefs), 'context must expose connectedCapabilityRefs');
    assert.deepEqual(context.connectedCapabilityRefs.map(ref => ref.name), ['wf-ui', 'browser-lab']);
    assert.deepEqual(context.connectedCapabilityRefs.map(ref => ref.relation), ['capability', 'capability']);
    assert.ok(context.connectedCapabilityRefs.every(ref => ref.executor === 'agent'));
  });

  it('W12 Agent context includes graph-connected skill-group capability pack refs without leaking bodies or secrets', async () => {
    const pack = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        type: 'skill-group',
        title: 'API Skill Pack',
        description: 'Capabilities selected from Skills Hub',
        sourceGroup: { id: 'family:api', label: 'API Skills', kind: 'family' },
        skills: [
          { id: 'skill:api-review', name: 'api-review', title: 'API Review', description: 'Review APIs', source: 'project' },
          { id: 'skill:no-leak', name: 'no-leak', title: 'No Leak', description: 'SECRET_TOKEN must not appear in bodies', source: 'project' },
        ],
      },
    });
    assert.equal(pack.status, 201, JSON.stringify(pack.body));
    assert.equal(pack.body.node.kind, 'skill-group');
    assert.equal(pack.body.node.ui.testId, 'workflow-capability-node');
    assert.equal(pack.body.node.contentRef.kind, 'capability-node-state');

    const edge = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: {
        from: 'session-test-agent-01',
        to: pack.body.node.nodeId,
        relation: 'capability',
        direction: 'bidirectional',
        sourceHandle: 'right',
        targetHandle: 'capability:left',
      },
    });
    assert.equal(edge.status, 201, JSON.stringify(edge.body));
    assert.equal(edge.body.edge.direction, 'bidirectional');
    assert.equal(edge.body.edge.relation, 'capability');
    assert.equal(edge.body.edge.targetHandle, 'capability:left');

    const contextRes = await jsonRequest(`${baseUrl2}/api/workflow/context/session-test-agent-01`);
    assert.equal(contextRes.status, 200, JSON.stringify(contextRes.body));
    const context = contextRes.body.context;
    assert.ok(context.effectiveSkills.includes('api-review'));
    assert.ok(context.effectiveSkills.includes('no-leak'));
    assert.ok(Array.isArray(context.connectedCapabilityNodeRefs), 'context must expose capability pack provenance');
    const ref = context.connectedCapabilityNodeRefs.find(item => item.nodeId === pack.body.node.nodeId);
    assert.ok(ref, `missing skill-group ref in ${JSON.stringify(context.connectedCapabilityNodeRefs)}`);
    assert.equal(ref.capabilityKind, 'skill-group');
    assert.equal(ref.executor, 'agent');
    assert.equal(ref.connection.relation, 'capability');
    assert.deepEqual(ref.skillNames, ['api-review', 'no-leak']);
    assert.ok(Array.isArray(context.effectiveSkillGroups), 'context must expose Skill Group summary units');
    const group = context.effectiveSkillGroups.find(item => item.nodeId === pack.body.node.nodeId);
    assert.ok(group, `missing effectiveSkillGroups entry in ${JSON.stringify(context.effectiveSkillGroups)}`);
    assert.equal(group.label, 'API Skills');
    assert.deepEqual(group.skillNames, ['api-review', 'no-leak']);

    const serialized = JSON.stringify(context);
    assert.ok(!serialized.includes('SKILL.md'), 'context must not expose skill body file names as execution content');
    assert.ok(!serialized.includes('C:\\\\'), 'context must not expose absolute Windows paths');
    assert.ok(!serialized.includes('/Users/'), 'context must not expose absolute POSIX user paths');
    assert.ok(!serialized.includes('Review APIs'), 'context must not include per-skill descriptions');
    assert.ok(!serialized.includes('SECRET_TOKEN must not appear in bodies'), 'context must not include per-skill descriptions');
  });

  it('W13 Agent context includes graph-connected mcp-connector refs without spawning or leaking secrets', async () => {
    const sentinel = path.join(root2, 'api-mcp-spawned.txt');
    fs.writeFileSync(path.join(root2, '.mcp.json'), JSON.stringify({
      mcpServers: {
        github: {
          command: process.execPath,
          args: ['-e', `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'spawned')`, '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'ghp_secret_value' },
          url: 'https://github.example.test/mcp/token/ghp_secret_value?token=query-secret',
        },
      },
    }, null, 2));

    const connector = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, {
      method: 'POST',
      body: {
        type: 'mcp-connector',
        mcpServerId: 'mcp:project-mcp:github',
        title: 'GitHub MCP',
      },
    });
    assert.equal(connector.status, 201, JSON.stringify(connector.body));
    assert.equal(fs.existsSync(sentinel), false, 'MCP connector API create must not spawn commands');
    assert.equal(connector.body.node.kind, 'mcp-connector');
    assert.equal(connector.body.node.ui.testId, 'workflow-capability-node');
    assert.equal(connector.body.node.contentRef.capabilityKind, 'mcp-connector');
    assert.equal(connector.body.state.serverCount, 1);
    assert.deepEqual(connector.body.state.serverNames, ['github']);

    const edge = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: {
        from: 'session-test-agent-01',
        to: connector.body.node.nodeId,
        relation: 'capability',
        direction: 'bidirectional',
        sourceHandle: 'right',
        targetHandle: 'capability:left',
      },
    });
    assert.equal(edge.status, 201, JSON.stringify(edge.body));
    assert.equal(edge.body.edge.direction, 'bidirectional');
    assert.equal(edge.body.edge.relation, 'capability');

    const contextRes = await jsonRequest(`${baseUrl2}/api/workflow/context/session-test-agent-01`);
    assert.equal(contextRes.status, 200, JSON.stringify(contextRes.body));
    const context = contextRes.body.context;
    const ref = context.connectedCapabilityNodeRefs.find(item => item.nodeId === connector.body.node.nodeId);
    assert.ok(ref, `missing mcp-connector ref in ${JSON.stringify(context.connectedCapabilityNodeRefs)}`);
    assert.equal(ref.capabilityKind, 'mcp-connector');
    assert.equal(ref.executor, 'agent');
    assert.equal(ref.serverCount, 1);
    assert.deepEqual(ref.serverNames, ['github']);
    assert.ok(!context.effectiveSkills.includes('github'), 'MCP connector must not mutate effectiveSkills');

    const serialized = JSON.stringify({ connector: connector.body, context });
    assert.equal(serialized.includes('ghp_secret_value'), false);
    assert.equal(serialized.includes('query-secret'), false);
    assert.equal(serialized.includes('@modelcontextprotocol/server-github'), false);
    assert.equal(serialized.includes('writeFileSync'), false);
    assert.equal(serialized.includes(String(sentinel)), false);
    for (const forbidden of ['"args"', '"env"', '"command"', '"raw"', '"rawConfig"', '"mcpConfig"', '"configBody"', '"body"', '"toolSchema"', '"resources"']) {
      assert.equal(serialized.includes(forbidden), false, `MCP connector API leaked forbidden field ${forbidden}`);
    }
  });

  it('AC-005 PATCH workflow agent settings rejects traversal ids', async () => {
    const res = await jsonRequest(`${baseUrl2}/api/workflow/nodes/..%2Fescape/settings`, {
      method: 'PATCH',
      body: {
        outputRouting: {
          markdownDefaultEnabled: true,
          markdownTargetNodeId: '',
          fallback: 'oldest-connected-markdown',
        },
      },
    });
    assert.ok(res.status >= 400, `expected traversal id rejection, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(fs.existsSync(path.join(root2, 'Harness', 'a2a', 'escape', 'settings.json')), false);
  });

  it('W18-AGENT-GRAPH W18-OPS-AUDIT Agent graph API actions expose bounded redacted operation audit records', async () => {
    const mainAgentId = 'session-test-agent-01';
    const workerAgentId = 'session-w18-api-worker';
    const targetNodeId = 'component-w18-api-notes';
    const graphPath = path.join(root2, 'Harness', 'a2a', 'workflow-map.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    fs.writeFileSync(graphPath, JSON.stringify({
      ...graph,
      nodes: [
        ...(graph.nodes || []),
        {
          nodeId: workerAgentId,
          sessionId: 'w18-api-worker-session',
          agentKind: 'subagent',
          role: 'worker',
          runtime: 'codex',
          status: 'running',
          label: 'W18 API Worker',
          cwd: root2,
        },
      ],
      positions: {
        ...(graph.positions || {}),
        [workerAgentId]: { x: 20, y: 20 },
      },
    }, null, 2));

    const secret = 'sk-w18-api-secret';
    const largePayload = 'audit-payload-'.repeat(512);
    const create = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${mainAgentId}/actions/agent.createNode`, {
      method: 'POST',
      body: {
        actorNodeId: mainAgentId,
        nodeId: targetNodeId,
        type: 'markdown',
        title: 'W18 API Notes',
        position: { x: 320, y: 180 },
        secret,
        largePayload,
      },
    });
    assert.equal(create.status, 200, JSON.stringify(create.body));

    const connect = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${mainAgentId}/actions/agent.connectNodes`, {
      method: 'POST',
      body: {
        actorNodeId: mainAgentId,
        from: mainAgentId,
        to: targetNodeId,
        relation: 'context',
        sourceHandle: 'context',
        targetHandle: 'markdown',
      },
    });
    assert.equal(connect.status, 200, JSON.stringify(connect.body));

    const read = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${mainAgentId}/actions/agent.readGraph`, {
      method: 'POST',
      body: { actorNodeId: mainAgentId },
    });
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.ok(read.body.result?.graph?.nodes?.some(node => node.nodeId === targetNodeId), JSON.stringify(read.body));

    const move = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${mainAgentId}/actions/agent.moveNode`, {
      method: 'POST',
      body: {
        actorNodeId: mainAgentId,
        targetNodeId,
        position: { x: 480, y: 260 },
        secret,
        largePayload,
      },
    });
    assert.equal(move.status, 200, JSON.stringify(move.body));

    const disconnect = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${mainAgentId}/actions/agent.disconnectNodes`, {
      method: 'POST',
      body: {
        actorNodeId: mainAgentId,
        edgeId: `${mainAgentId}->${targetNodeId}`,
      },
    });
    assert.equal(disconnect.status, 200, JSON.stringify(disconnect.body));

    const deleteNode = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${mainAgentId}/actions/agent.deleteNode`, {
      method: 'POST',
      body: {
        actorNodeId: mainAgentId,
        targetNodeId,
        secret,
        largePayload,
      },
    });
    assert.equal(deleteNode.status, 200, JSON.stringify(deleteNode.body));
    assert.deepEqual(deleteNode.body.result?.deletedNodeIds, [targetNodeId], JSON.stringify(deleteNode.body));

    const deleteSelf = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${mainAgentId}/actions/agent.deleteNode`, {
      method: 'POST',
      body: {
        actorNodeId: mainAgentId,
        targetNodeId: mainAgentId,
      },
    });
    assert.equal(deleteSelf.status, 400, JSON.stringify(deleteSelf.body));
    assert.match(deleteSelf.body.error?.code || '', /CANNOT_DELETE_SELF/);

    const rejected = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${workerAgentId}/actions/agent.readGraph`, {
      method: 'POST',
      body: { actorNodeId: workerAgentId },
    });
    assert.equal(rejected.status, 403, JSON.stringify(rejected.body));
    assert.match(rejected.body.error?.code || '', /MAIN_AGENT_REQUIRED|AGENT_GRAPH_AUTH|UNAUTHORIZED|FORBIDDEN/);

    const snapshot = await jsonRequest(`${baseUrl2}/api/workflow`);
    assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
    const recent = snapshot.body.workflow?.operations?.recent;
    assert.ok(Array.isArray(recent), 'W18-OPS-AUDIT requires workflow.operations.recent[] in workflow snapshot');
    assert.ok(recent.length >= 6, `expected audit records for graph actions, got ${JSON.stringify(recent)}`);
    for (const kind of ['agent.createNode', 'agent.connectNodes', 'agent.readGraph', 'agent.moveNode', 'agent.disconnectNodes', 'agent.deleteNode']) {
      assert.ok(recent.some(record => record.kind === kind), `missing operation record ${kind}`);
    }
    for (const record of recent) {
      assert.ok(record.id, JSON.stringify(record));
      assert.equal(record.actor?.nodeId, mainAgentId);
      assert.ok(Array.isArray(record.targetNodeIds), JSON.stringify(record));
      assert.ok(Array.isArray(record.edgeIds), JSON.stringify(record));
      assert.ok(typeof record.status === 'string' && record.status.length > 0, JSON.stringify(record));
      assert.ok(Date.parse(record.startedAt) > 0, JSON.stringify(record));
      assert.ok(Date.parse(record.completedAt) >= Date.parse(record.startedAt), JSON.stringify(record));
      assert.ok(Date.parse(record.expiresAt) > Date.parse(record.startedAt), JSON.stringify(record));
      assert.ok(JSON.stringify(record).length < 2048, `operation record is too large: ${JSON.stringify(record)}`);
    }
    const serializedRecent = JSON.stringify(recent);
    assert.equal(serializedRecent.includes(secret), false);
    assert.equal(serializedRecent.includes(largePayload.slice(0, 1024)), false);

    for (let i = 0; i < 25; i += 1) {
      const extra = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${mainAgentId}/actions/agent.readGraph`, {
        method: 'POST',
        body: { actorNodeId: mainAgentId, nonce: `audit-bound-${i}` },
      });
      assert.equal(extra.status, 200, JSON.stringify(extra.body));
    }
    const boundedSnapshot = await jsonRequest(`${baseUrl2}/api/workflow`);
    assert.equal(boundedSnapshot.status, 200, JSON.stringify(boundedSnapshot.body));
    const boundedRecent = boundedSnapshot.body.workflow?.operations?.recent;
    assert.ok(Array.isArray(boundedRecent), 'W18-OPS-AUDIT requires workflow.operations.recent[] after many actions');
    assert.ok(boundedRecent.length <= 20, `recent operations must be bounded to 20 records, got ${boundedRecent.length}`);
  });

  it('W23 API exposes connected Agent workers through context and delegation affordances', async () => {
    const mainAgentId = 'session-test-agent-01';
    const workerAgentId = 'session-w23-api-worker';
    const workerSessionId = 'w23-api-worker-session';
    const graphPath = path.join(root2, 'Harness', 'a2a', 'workflow-map.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    fs.writeFileSync(graphPath, JSON.stringify({
      ...graph,
      version: Number(graph.version || 1) + 1,
      nodes: [
        ...(graph.nodes || []).filter(node => (node.nodeId || node.id) !== workerAgentId),
        {
          nodeId: workerAgentId,
          sessionId: workerSessionId,
          agentKind: 'subagent',
          role: 'worker',
          runtime: 'claude',
          status: 'running',
          label: 'W23 API Worker',
          cwd: root2,
        },
      ],
      positions: {
        ...(graph.positions || {}),
        [workerAgentId]: { x: 360, y: 120 },
      },
    }, null, 2));

    const edge = await jsonRequest(`${baseUrl2}/api/workflow/edges`, {
      method: 'POST',
      body: {
        from: mainAgentId,
        to: workerAgentId,
        direction: 'bidirectional',
      },
    });
    assert.equal(edge.status, 201, JSON.stringify(edge.body));
    assert.equal(edge.body.edge.relation, 'delegation');

    const contextRes = await jsonRequest(`${baseUrl2}/api/workflow/context/${mainAgentId}`);
    assert.equal(contextRes.status, 200, JSON.stringify(contextRes.body));
    const context = contextRes.body.context;
    const workerRef = context.connectedAgentRefs.find(ref => ref.nodeId === workerAgentId);
    assert.ok(workerRef, JSON.stringify(context.connectedAgentRefs));
    assert.equal(workerRef.sessionId, workerSessionId);
    assert.equal(workerRef.delegation.canDelegate, true);
    assert.ok(workerRef.allowedActions.includes('agent.sendInput'));
    assert.ok(workerRef.allowedActions.includes('agent.readTranscript'));
    assert.equal(workerRef.workspaceRef.path, `Harness/a2a/nodes/${workerSessionId}`);

    const affordance = context.affordances.find(item => item.nodeId === workerAgentId);
    assert.equal(affordance.relationship, 'connected-agent-worker');
    assert.equal(affordance.canDelegate, true);
    assert.ok(affordance.allowedActions.includes('agent.sendInput'));
    assert.ok(context.connectedPeers.some(peer => peer.nodeId === workerAgentId && peer.type === 'agent'));
  });

  it('P3-008 Excalidraw renderPreview with far-away elements returns normalized non-empty preview', async () => {
    const draw = await jsonRequest(`${baseUrl2}/api/workflow/nodes`, { method: 'POST', body: { type: 'excalidraw', title: 'FarDraw' } });
    // Save scene with elements at extreme coordinates
    await jsonRequest(`${baseUrl2}/api/workflow/nodes/${draw.body.node.nodeId}/actions/excalidraw.saveScene`, {
      method: 'POST',
      body: {
        scene: {
          elements: [
            { id: 'e1', type: 'rectangle', x: 5000, y: 3000, width: 200, height: 100, strokeColor: '#6965DB', backgroundColor: '#e8e7ff' },
            { id: 'e2', type: 'ellipse', x: -100, y: -50, width: 80, height: 80, strokeColor: '#ff0000', backgroundColor: '#ffe0e0' },
          ],
          appState: { viewBackgroundColor: '#ffffff' },
          files: {},
        },
      },
    });
    const res = await jsonRequest(`${baseUrl2}/api/workflow/nodes/${draw.body.node.nodeId}/actions/excalidraw.renderPreview`, {
      method: 'POST', body: {},
    });
    assert.equal(res.status, 200);
    const preview = res.body.result?.preview || res.body.result;
    assert.ok(preview.hasContent, `P3-008 RED: preview hasContent is false for far-away elements`);
    assert.ok(preview.elements.length === 2, `P3-008 RED: expected 2 elements, got ${preview.elements.length}`);
    // All elements must be within the viewport bounds (0-300 x 0-240 with 16px padding)
    for (const el of preview.elements) {
      assert.ok(el.x >= 0 && el.x <= 300, `P3-008 RED: element x=${el.x} outside viewport`);
      assert.ok(el.y >= 0 && el.y <= 240, `P3-008 RED: element y=${el.y} outside viewport`);
    }
  });
});

console.log('OK: workflow-api-phase3.test.mjs');
