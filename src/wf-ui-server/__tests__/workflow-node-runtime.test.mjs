import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Helpers ──
function tempProjectRoot() {
  const id = crypto.randomBytes(4).toString('hex');
  const dir = path.join(process.cwd(), '.tmp-runtime-test-' + id);
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a', 'component-nodes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'component-nodes', 'index.json'), JSON.stringify({ schemaVersion: 1, nodes: [] }));
  fs.mkdirSync(path.join(dir, 'Harness', 'a2a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Harness', 'a2a', 'workflow-map.json'), JSON.stringify({ schemaVersion: 1, version: 1, nodes: [], edges: [], positions: {}, undoStack: [], redoStack: [], deletedNodes: [] }));
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function seedAgentGraphNode(root, nodeId = 'session-event-agent-01', overrides = {}) {
  const graph = runtime.loadWorkflowGraphMap(root);
  const sessionId = overrides.sessionId || `${nodeId}-pty`;
  runtime.writeWorkflowGraphMap(root, {
    ...graph,
    version: graph.version + 1,
    nodes: [
      ...(graph.nodes || []),
      {
        nodeId,
        sessionId,
        agentKind: overrides.agentKind || 'main',
        runtime: overrides.runtime || 'codex',
        status: overrides.status || 'stopped',
        label: overrides.label || 'Event Agent',
        cwd: root,
        taskId: null,
        role: overrides.role || overrides.agentKind || 'main',
        ...(overrides.config ? { config: overrides.config } : {}),
        ...(overrides.nodeConfig ? { nodeConfig: overrides.nodeConfig } : {}),
      },
    ],
    positions: {
      ...(graph.positions || {}),
      [nodeId]: { x: 100, y: 120 },
    },
  });
  return nodeId;
}

function seedActiveTask(root, taskId = 'task-runtime-goal') {
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
    nextAction: 'Implement Advanced Timer and Goal node.',
    acceptance: [
      { id: 'W14-TIMER', status: 'tracked', text: 'Advanced Timer supports base heartbeat and watchdog control.' },
      { id: 'W14-GOAL', status: 'tracked', text: 'Goal node exposes objective, acceptance, and two-phase completion.' },
    ],
    links: { dependsOn: [], blocks: [], related: [] },
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'PLAN.md'), '# Goal plan\n', 'utf8');
  fs.writeFileSync(path.join(root, 'Harness', 'tasks', taskId, 'PROGRESS.md'), '# Goal progress\n', 'utf8');
  return `goal-${taskId}`;
}

let runtime;
let graphStore;

before(async () => {
  runtime = await import('../workflow-node-runtime.mjs');
  graphStore = await import('../workflow-graph-store.mjs');
});

// ── Node CRUD ──
describe('Workflow Node Runtime', () => {
  let root;
  before(() => { root = tempProjectRoot(); });
  after(() => cleanup(root));

  it('creates a markdown node with settings', async () => {
    const result = await runtime.createNode(root, { type: 'markdown', title: 'Test MD' });
    assert.ok(result.ok);
    assert.equal(result.node.kind, 'markdown');
    assert.ok(result.state);
    assert.equal(result.state.type, 'markdown');
    assert.equal(result.node.ui.labels.title, 'Test MD');
    assert.deepEqual(result.node.graph.handles, {
      inputs: [],
      outputs: [],
      bidirectional: ['markdown'],
      ports: ['markdown'],
      physical: ['markdown:left', 'markdown:right', 'markdown:top', 'markdown:bottom'],
    });
  });

  it('creates an excalidraw node', async () => {
    const result = await runtime.createNode(root, { type: 'excalidraw', title: 'Test Draw' });
    assert.ok(result.ok);
    assert.equal(result.node.kind, 'excalidraw');
    assert.ok(result.state.scene);
    assert.ok(Array.isArray(result.state.scene.elements));
    assert.deepEqual(result.node.graph.handles, {
      inputs: [],
      outputs: [],
      bidirectional: ['scene'],
      ports: ['scene'],
      physical: ['scene:left', 'scene:right', 'scene:top', 'scene:bottom'],
    });
  });

  it('creates a file node', async () => {
    const result = await runtime.createNode(root, { type: 'file', title: 'Test File', file: { source: 'workspace', path: 'README.md', name: 'README.md', mime: 'text/markdown', size: 100 } });
    assert.ok(result.ok);
    assert.equal(result.node.kind, 'file');
    assert.equal(result.state.file.name, 'README.md');
  });

  it('lists and connects only live component nodes when stale state files remain in the index', async () => {
    const localRoot = tempProjectRoot();
    try {
      const live = await runtime.createNode(localRoot, { type: 'markdown', title: 'Live Markdown', markdown: 'here' });
      const stale = await runtime.createNode(localRoot, { type: 'markdown', title: 'Stale Markdown', markdown: 'gone' });
      fs.rmSync(path.join(localRoot, stale.node.stateRef.path), { force: true });

      const listed = await runtime.listNodes(localRoot);
      assert.equal(listed.nodes.some(node => node.nodeId === stale.node.nodeId), false);
      assert.equal(listed.nodes.some(node => node.nodeId === live.node.nodeId), true);
      assert.throws(
        () => graphStore.connectNodes(localRoot, { from: stale.node.nodeId, to: live.node.nodeId }),
        /Workflow node not found|ENDPOINT_NOT_FOUND/i,
      );

      const deleted = await runtime.deleteNode(localRoot, stale.node.nodeId);
      assert.equal(deleted.ok, true);
      assert.equal(deleted.nodeId, stale.node.nodeId);
      assert.equal(runtime.listComponentNodes(localRoot).some(node => node.nodeId === stale.node.nodeId), false);
    } finally {
      cleanup(localRoot);
    }
  });

  it('W11 creates a timer event node with directed event ports', async () => {
    const result = await runtime.createNode(root, {
      type: 'timer',
      title: 'Daily Standup Timer',
      schedule: { mode: 'manual', intervalSeconds: 900 },
      payloadTemplate: { prompt: 'Summarize current workflow status.' },
    });
    assert.ok(result.ok);
    assert.equal(result.node.kind, 'timer');
    assert.equal(result.state.type, 'timer');
    assert.equal(result.node.ui.testId, 'workflow-event-node');
    assert.deepEqual(result.node.graph.handles, {
      inputs: ['config'],
      outputs: ['event'],
      bidirectional: ['status'],
      ports: ['event', 'config', 'status'],
      physical: ['config:left', 'event:right', 'event:top', 'event:bottom'],
      directions: {
        event: 'source-to-target',
        config: 'target-only',
        status: 'bidirectional',
      },
    });
    assert.ok(result.node.capabilities.includes('timer.fire'));
    assert.equal(result.node.contentRef.kind, 'event-node-state');
  });

  it('W14-TIMER creates an Advanced Timer with base heartbeat, WDT, cadence, and control policy', async () => {
    const result = await runtime.createNode(root, {
      type: 'timer',
      title: 'Advanced Heartbeat Timer',
      enabled: true,
      schedule: {
        mode: 'loop',
        intervalSeconds: 30,
        cadence: { kind: 'sequence', sequenceSeconds: [15, 45, 90] },
      },
      heartbeat: {
        base: { enabled: true, intervalSeconds: 30 },
        watchdog: { enabled: true, intervalSeconds: 600, timeoutSeconds: 1800 },
      },
      whileGuard: { source: 'agentStatus', op: 'neq', value: 'stopped' },
      taskBinding: { taskId: 'task-runtime-goal', phases: ['implement'], stopWhenClosed: true },
      controlPolicy: { agentCanDisable: true, agentCanSetInterval: true, minIntervalSeconds: 5, maxIntervalSeconds: 7200 },
    });

    assert.equal(result.node.kind, 'timer');
    assert.equal(result.state.schedule.mode, 'loop');
    assert.deepEqual(result.state.schedule.cadence.sequenceSeconds, [15, 45, 90]);
    assert.equal(result.state.heartbeat.base.enabled, true);
    assert.equal(result.state.heartbeat.base.intervalSeconds, 30);
    assert.equal(result.state.heartbeat.watchdog.enabled, true);
    assert.equal(result.state.heartbeat.watchdog.intervalSeconds, 600);
    assert.equal(result.state.heartbeat.watchdog.state, 'ok');
    assert.equal(result.state.whileGuard.source, 'agentStatus');
    assert.equal(result.state.taskBinding.taskId, 'task-runtime-goal');
    for (const action of ['timer.enable', 'timer.disable', 'timer.setInterval', 'timer.setMode', 'timer.ackWatchdog', 'timer.resetWatchdog', 'timer.tick']) {
      assert.ok(result.node.capabilities.includes(action), `missing ${action}`);
    }
  });

  it('W16-TIMER persists Once, Adaptive, and Watchdog modes from the expanded editor contract', async () => {
    const localRoot = tempProjectRoot();
    try {
      const timer = await runtime.createNode(localRoot, {
        type: 'timer',
        title: 'Expanded Timer',
        enabled: true,
        schedule: { mode: 'loop', intervalSeconds: 60, cadence: { kind: 'fixed' } },
        heartbeat: {
          base: { enabled: true, intervalSeconds: 60 },
          watchdog: { enabled: false, intervalSeconds: 600, timeoutSeconds: 1800 },
        },
      });

      const once = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.configure', {
        title: 'One shot reminder',
        enabled: true,
        schedule: {
          mode: 'once',
          intervalSeconds: 90,
          triggerAt: '2026-08-05T15:30:00.000Z',
          cadence: { kind: 'fixed' },
        },
        heartbeat: {
          base: { enabled: false, intervalSeconds: 90 },
          watchdog: { enabled: false, intervalSeconds: 900, timeoutSeconds: 1800 },
        },
      });
      assert.equal(once.result.schedule.mode, 'once');
      assert.equal(once.result.schedule.triggerAt, '2026-08-05T15:30:00.000Z');
      assert.equal(once.node.ui.labels.title, 'One shot reminder');

      const adaptive = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.configure', {
        schedule: {
          mode: 'adaptive',
          intervalSeconds: 45,
          cadence: { kind: 'backoff', backoffFactor: 2.5, maxIntervalSeconds: 3600 },
        },
        heartbeat: {
          base: { enabled: true, intervalSeconds: 45 },
          watchdog: { enabled: true, intervalSeconds: 900, timeoutSeconds: 2700 },
        },
      });
      assert.equal(adaptive.result.schedule.mode, 'adaptive');
      assert.equal(adaptive.result.schedule.cadence.kind, 'backoff');
      assert.equal(adaptive.result.heartbeat.watchdog.enabled, true);

      const watchdog = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.setMode', {
        mode: 'watchdog',
      });
      assert.equal(watchdog.result.state.schedule.mode, 'watchdog');
    } finally {
      cleanup(localRoot);
    }
  });

  it('release-core/backend-gating rejects github-trigger creation without experimental opt-in', async () => {
    await assert.rejects(
      () => runtime.createNode(root, {
        type: 'github-trigger',
        title: 'Default GitHub Trigger',
      }),
      (error) => {
        assert.equal(error.code, 'PLANNED_NODE_REQUIRES_EXPERIMENTAL');
        assert.equal(error.statusCode, 409);
        return true;
      },
    );
  });

  it('release-core/backend-gating marks github-trigger as planned experimental-only ontology', () => {
    const ontology = runtime.workflowOntology();
    assert.equal(ontology.nodeTypes['github-trigger'].status, 'planned');
    assert.equal(ontology.nodeTypes['github-trigger'].experimentalOnly, true);
    assert.equal(ontology.nodeTypes['github-trigger'].createRequiresExperimental, true);
  });

  it('W14 creates a github-trigger event node with directed event ports and bounded metadata', async () => {
    const result = await runtime.createNode(root, {
      type: 'github-trigger',
      experimental: true,
      title: 'Repo Activity Trigger',
      repository: { owner: 'zingspark', name: 'create-harness-vibe-coding' },
      eventFilters: { events: ['pull_request', 'push'], actions: ['opened', 'synchronize'], branches: ['main'] },
      payloadTemplate: { prompt: 'Summarize the GitHub event for the connected Agent.' },
    });
    assert.ok(result.ok);
    assert.equal(result.node.kind, 'github-trigger');
    assert.equal(result.state.type, 'github-trigger');
    assert.equal(result.state.repository.fullName, 'zingspark/create-harness-vibe-coding');
    assert.deepEqual(result.state.eventFilters.events, ['pull_request', 'push']);
    assert.equal(result.node.ui.testId, 'workflow-event-node');
    assert.deepEqual(result.node.graph.handles, {
      inputs: ['config'],
      outputs: ['event'],
      bidirectional: ['status'],
      ports: ['event', 'config', 'status'],
      physical: ['config:left', 'event:right', 'event:top', 'event:bottom'],
      directions: {
        event: 'source-to-target',
        config: 'target-only',
        status: 'bidirectional',
      },
    });
    assert.ok(result.node.capabilities.includes('github-trigger.receive'));
    assert.equal(result.node.contentRef.kind, 'event-node-state');
    assert.equal(result.node.contentRef.eventKind, 'github-trigger');
    assert.equal(result.node.settings.schemaId, 'github-trigger-settings');

    const serialized = JSON.stringify(result);
    for (const forbidden of ['"token"', '"secret"', '"authorization"', '"headers"', '"rawBody"', '"body"']) {
      assert.equal(serialized.includes(forbidden), false, `github-trigger leaked forbidden field ${forbidden}`);
    }
  });

  it('W12 creates a skill-group capability node with bidirectional capability ports', async () => {
    const result = await runtime.createNode(root, {
      type: 'skill-group',
      title: 'Workflow Skill Pack',
      description: 'Curated local workflow skills',
      sourceGroup: { id: 'family:wf', label: 'WF Skills', kind: 'family' },
      skills: [
        { id: 'skill:wf-ui', name: 'wf-ui', title: 'WF-UI Adapter', description: 'Open the control panel', source: 'project' },
        { id: 'skill:wf', name: 'wf', title: 'WF Mode', description: 'Workflow mode', source: 'project' },
        { id: 'skill:wf-ui-duplicate', name: 'wf-ui', title: 'Duplicate ignored', source: 'project' },
      ],
    });
    assert.ok(result.ok);
    assert.equal(result.node.kind, 'skill-group');
    assert.equal(result.node.lifecycle, 'capability-provider');
    assert.equal(result.node.ui.testId, 'workflow-capability-node');
    assert.equal(result.state.type, 'skill-group');
    assert.deepEqual(result.state.skillNames, ['wf-ui', 'wf']);
    assert.deepEqual(result.node.graph.handles, {
      inputs: [],
      outputs: [],
      bidirectional: ['capability'],
      ports: ['capability'],
      physical: ['capability:left', 'capability:right', 'capability:top', 'capability:bottom'],
      directions: {
        capability: 'bidirectional',
      },
    });
    assert.ok(result.node.capabilities.includes('skill-group.read'));
    assert.equal(result.node.contentRef.kind, 'capability-node-state');
    assert.ok(result.node.stateRef.path.startsWith('Harness/a2a/capability-nodes/'));
    assert.ok(!JSON.stringify(result).includes('SKILL.md body'));
  });

  it('W13 creates an mcp-connector capability node from Hub metadata without spawning or leaking secrets', async () => {
    const sentinel = path.join(root, 'mcp-runtime-spawned.txt');
    fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({
      mcpServers: {
        github: {
          command: process.execPath,
          args: ['-e', `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'spawned')`, '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_TOKEN: 'ghp_secret_value',
          },
          url: 'https://api.github.test/mcp/token/path-secret?token=query-secret',
        },
      },
    }, null, 2));

    const result = await runtime.createNode(root, {
      type: 'mcp-connector',
      mcpServerId: 'mcp:project-mcp:github',
      title: 'GitHub MCP Connector',
    });

    assert.ok(result.ok);
    assert.equal(fs.existsSync(sentinel), false, 'mcp-connector creation must not spawn the MCP command');
    assert.equal(result.node.kind, 'mcp-connector');
    assert.equal(result.node.lifecycle, 'capability-provider');
    assert.equal(result.node.ui.testId, 'workflow-capability-node');
    assert.equal(result.state.type, 'mcp-connector');
    assert.equal(result.state.serverCount, 1);
    assert.deepEqual(result.state.serverNames, ['github']);
    assert.deepEqual(result.state.transports, ['http']);
    assert.deepEqual(result.state.envKeyNames, ['GITHUB_TOKEN']);
    assert.equal(result.state.servers[0].url, 'https://api.github.test/mcp/token/redacted');
    assert.deepEqual(result.node.graph.handles, {
      inputs: [],
      outputs: [],
      bidirectional: ['capability'],
      ports: ['capability'],
      physical: ['capability:left', 'capability:right', 'capability:top', 'capability:bottom'],
      directions: {
        capability: 'bidirectional',
      },
    });
    assert.ok(result.node.capabilities.includes('mcp-connector.read'));
    assert.equal(result.node.contentRef.capabilityKind, 'mcp-connector');
    assert.equal(result.node.settings.schemaId, 'mcp-connector-settings');

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('ghp_secret_value'), false);
    assert.equal(serialized.includes('path-secret'), false);
    assert.equal(serialized.includes('query-secret'), false);
    assert.equal(serialized.includes('@modelcontextprotocol/server-github'), false);
    assert.equal(serialized.includes('writeFileSync'), false);
    assert.equal(serialized.includes(String(sentinel)), false);
    for (const forbidden of ['"args"', '"env"', '"command"', '"raw"', '"rawConfig"', '"mcpConfig"', '"configBody"', '"body"', '"toolSchema"', '"resources"']) {
      assert.equal(serialized.includes(forbidden), false, `mcp-connector leaked forbidden field ${forbidden}`);
    }
  });

  it('lists created nodes', async () => {
    const result = await runtime.listNodes(root);
    assert.ok(Array.isArray(result.nodes));
    assert.ok(result.nodes.length >= 3, `expected >=3, got ${result.nodes.length}`);
  });

  it('reads a single node snapshot', async () => {
    const all = await runtime.listNodes(root);
    const nodeId = all.nodes[0].nodeId;
    const result = await runtime.getNode(root, nodeId);
    assert.ok(result.node);
    assert.equal(result.node.nodeId, nodeId);
    assert.ok(result.state);
  });

  it('updates node state with revision guard', async () => {
    const all = await runtime.listNodes(root);
    const md = all.nodes.find(n => n.kind === 'markdown');
    assert.ok(md, 'markdown node not found');
    const result = await runtime.updateNodeState(root, md.nodeId, { revision: md.version, markdown: '# Hello World' });
    assert.ok(result.ok);
    assert.ok(result.state.markdown.includes('Hello World'));
    assert.ok(result.revision > md.version);
  });

  it('rejects stale revision update', async () => {
    const all = await runtime.listNodes(root);
    const md = all.nodes.find(n => n.kind === 'markdown');
    await assert.rejects(
      () => runtime.updateNodeState(root, md.nodeId, { revision: 0, markdown: 'stale' }),
    );
  });

  it('updates node settings', async () => {
    const all = await runtime.listNodes(root);
    const md = all.nodes.find(n => n.kind === 'markdown');
    const result = await runtime.updateNodeSettings(root, md.nodeId, { editorMode: 'source', autoSave: true });
    assert.ok(result.settings);
    assert.ok(result.settings.values);
    assert.equal(result.settings.values.editorMode, 'source');
    assert.equal(result.settings.values.autoSave, true);
    assert.ok(result.settings.revision >= 1);
  });

  it('executes markdown.read action', async () => {
    const all = await runtime.listNodes(root);
    const md = all.nodes.find(n => n.kind === 'markdown');
    const result = await runtime.executeNodeAction(root, md.nodeId, 'markdown.read', {});
    assert.ok(result.ok);
    assert.equal(result.action, 'markdown.read');
    assert.ok(typeof result.result.markdown === 'string');
  });

  it('executes excalidraw.saveScene and revision increases', async () => {
    const all = await runtime.listNodes(root);
    const draw = all.nodes.find(n => n.kind === 'excalidraw');
    const scene = { elements: [{ id: 'e1', type: 'rectangle', x: 10, y: 20, width: 100, height: 80, strokeColor: '#6965DB', backgroundColor: '#e8e7ff' }], appState: { viewBackgroundColor: '#ffffff' }, files: {} };
    const result = await runtime.executeNodeAction(root, draw.nodeId, 'excalidraw.saveScene', { scene });
    assert.ok(result.ok);
    assert.ok(result.result.revision > draw.version);
    assert.ok(result.result.scene.elements.length > 0);
  });

  it('executes excalidraw.renderPreview returns non-empty', async () => {
    const all = await runtime.listNodes(root);
    const draw = all.nodes.find(n => n.kind === 'excalidraw');
    const result = await runtime.executeNodeAction(root, draw.nodeId, 'excalidraw.renderPreview', {});
    assert.ok(result.ok);
    assert.ok(Array.isArray(result.result.preview.elements));
    assert.ok(result.result.preview.hasContent);
  });

  it('executes file.readMeta', async () => {
    const all = await runtime.listNodes(root);
    const fileNode = all.nodes.find(n => n.kind === 'file');
    const result = await runtime.executeNodeAction(root, fileNode.nodeId, 'file.readMeta', {});
    assert.ok(result.ok);
    assert.equal(result.result.file.name, 'README.md');
  });

  it('W11 executes timer.fire and records the latest event', async () => {
    const all = await runtime.listNodes(root);
    const timer = all.nodes.find(n => n.kind === 'timer');
    assert.ok(timer, 'timer node must exist from W11 create test');
    const result = await runtime.executeNodeAction(root, timer.nodeId, 'timer.fire', { payload: { reason: 'test-fire' } });
    assert.ok(result.ok);
    assert.equal(result.action, 'timer.fire');
    assert.equal(result.node.kind, 'timer');
    assert.equal(result.result.event.kind, 'timer.fire');
    assert.equal(result.result.state.eventCount, 1);
    assert.deepEqual(result.result.event.payload.reason, 'test-fire');
  });

  it('W14 executes github-trigger.receive and records only a bounded delivery summary', async () => {
    const all = await runtime.listNodes(root);
    const trigger = all.nodes.find(n => n.kind === 'github-trigger');
    assert.ok(trigger, 'github-trigger node must exist from W14 create test');
    const result = await runtime.executeNodeAction(root, trigger.nodeId, 'github-trigger.receive', {
      event: 'pull_request',
      action: 'opened',
      deliveryId: 'delivery-123',
      repository: { owner: 'zingspark', name: 'create-harness-vibe-coding' },
      ref: 'refs/heads/main',
      sender: 'octocat',
      pullRequest: { number: 42, title: 'Add workflow trigger', url: 'https://github.example.test/pull/42' },
      body: { token: 'ghp_secret_value', large: 'must not persist' },
      headers: { authorization: 'Bearer secret' },
    });
    assert.ok(result.ok);
    assert.equal(result.action, 'github-trigger.receive');
    assert.equal(result.node.kind, 'github-trigger');
    assert.equal(result.result.event.kind, 'github.pull_request');
    assert.equal(result.result.event.action, 'opened');
    assert.equal(result.result.event.deliveryId, 'delivery-123');
    assert.equal(result.result.state.eventCount, 1);
    assert.equal(result.result.state.lastEvent.pullRequest.number, 42);

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('ghp_secret_value'), false);
    assert.equal(serialized.includes('Bearer secret'), false);
    assert.equal(serialized.includes('must not persist'), false);
    for (const forbidden of ['"headers"', '"authorization"', '"rawBody"', '"body"', '"secret"', '"token"']) {
      assert.equal(serialized.includes(forbidden), false, `github-trigger receive leaked forbidden field ${forbidden}`);
    }
  });

  it('rejects unknown action', async () => {
    const all = await runtime.listNodes(root);
    const md = all.nodes.find(n => n.kind === 'markdown');
    await assert.rejects(
      () => runtime.executeNodeAction(root, md.nodeId, 'markdown.flyToMoon', {}),
    );
  });

  it('deletes a node and cleans up', async () => {
    const all = await runtime.listNodes(root);
    const fileNode = all.nodes.find(n => n.kind === 'file');
    const result = await runtime.deleteNode(root, fileNode.nodeId);
    assert.ok(result.ok);
    const after = await runtime.listNodes(root);
    assert.ok(!after.nodes.some(n => n.nodeId === fileNode.nodeId));
  });

  it('restores a deleted component and its graph connections', async () => {
    const localRoot = tempProjectRoot();
    try {
      const source = await runtime.createNode(localRoot, { type: 'markdown', title: 'Recoverable Notes', markdown: 'restore me' });
      const target = await runtime.createNode(localRoot, { type: 'excalidraw', title: 'Recoverable Sketch' });
      graphStore.connectNodes(localRoot, {
        from: source.node.nodeId,
        to: target.node.nodeId,
        relation: 'context',
        sourceHandle: 'markdown',
        targetHandle: 'scene',
      });

      const deleted = await runtime.deleteNode(localRoot, target.node.nodeId);
      assert.ok(deleted.ok);
      assert.equal(runtime.listComponentNodes(localRoot).some(node => node.nodeId === target.node.nodeId), false);
      assert.equal(runtime.loadWorkflowGraphMap(localRoot).edges.length, 0);

      const restored = await runtime.restoreNode(localRoot, target.node.nodeId, { recovery: deleted.recovery });
      assert.ok(restored.ok);
      assert.equal(restored.node.nodeId, target.node.nodeId);
      assert.equal(runtime.listComponentNodes(localRoot).some(node => node.nodeId === target.node.nodeId), true);
      const graph = runtime.loadWorkflowGraphMap(localRoot);
      assert.equal(graph.nodes.some(node => node.nodeId === target.node.nodeId), true);
      assert.equal(graph.edges.some(edge => edge.source === source.node.nodeId && edge.target === target.node.nodeId), true);
    } finally {
      cleanup(localRoot);
    }
  });

  it('deletes and restores a Goal anchor without losing the active task', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot, 'task-runtime-goal-recovery');
      const deleted = await runtime.deleteNode(localRoot, goalNodeId);
      assert.ok(deleted.ok);
      assert.equal((await runtime.listNodes(localRoot)).nodes.some(node => node.nodeId === goalNodeId), false);
      await assert.rejects(() => runtime.getNodeContext(localRoot, goalNodeId), error => error?.code === 'NOT_FOUND');
      await assert.rejects(() => runtime.executeNodeAction(localRoot, goalNodeId, 'goal.update', { nextAction: 'must stay deleted' }), error => error?.code === 'NOT_FOUND');
      assert.throws(
        () => graphStore.connectNodes(localRoot, { from: goalNodeId, to: goalNodeId, relation: 'goal' }),
        error => error?.code === 'ENDPOINT_NOT_FOUND',
      );

      const restored = await runtime.restoreNode(localRoot, goalNodeId, { recovery: deleted.recovery });
      assert.ok(restored.ok);
      assert.equal(restored.node.nodeId, goalNodeId);
      assert.equal((await runtime.listNodes(localRoot)).nodes.some(node => node.nodeId === goalNodeId), true);
    } finally {
      cleanup(localRoot);
    }
  });

  it('returns node context with connected peers', async () => {
    const all = await runtime.listNodes(root);
    const md = all.nodes.find(n => n.kind === 'markdown');
    const ctx = await runtime.getNodeContext(root, md.nodeId);
    assert.ok(ctx.node);
    assert.ok(ctx.context);
    assert.ok(Array.isArray(ctx.node.graph.connections));
  });

  it('AC-007 exposes workflow links as bidirectional runtime connections with endpoint roles', async () => {
    const localRoot = tempProjectRoot();
    try {
      const source = await runtime.createNode(localRoot, { type: 'markdown', title: 'Source Notes' });
      const target = await runtime.createNode(localRoot, { type: 'excalidraw', title: 'Target Sketch' });
      graphStore.connectNodes(localRoot, {
        from: source.node.nodeId,
        to: target.node.nodeId,
        relation: 'context',
        sourceHandle: 'markdown',
        targetHandle: 'scene',
      });

      const sourceContext = await runtime.getNodeContext(localRoot, source.node.nodeId);
      const targetContext = await runtime.getNodeContext(localRoot, target.node.nodeId);
      const sourceConnection = sourceContext.node.graph.connections.find(item => item.peerNodeId === target.node.nodeId);
      const targetConnection = targetContext.node.graph.connections.find(item => item.peerNodeId === source.node.nodeId);

      assert.deepEqual(sourceConnection, {
        edgeId: `${source.node.nodeId}->${target.node.nodeId}`,
        peerNodeId: target.node.nodeId,
        endpointRole: 'source',
        localHandle: 'markdown:right',
        peerHandle: 'scene:left',
        sourceHandle: 'markdown:right',
        targetHandle: 'scene:left',
        relation: 'context',
        direction: 'bidirectional',
      });
      assert.deepEqual(targetConnection, {
        edgeId: `${source.node.nodeId}->${target.node.nodeId}`,
        peerNodeId: source.node.nodeId,
        endpointRole: 'target',
        localHandle: 'scene:left',
        peerHandle: 'markdown:right',
        sourceHandle: 'markdown:right',
        targetHandle: 'scene:left',
        relation: 'context',
        direction: 'bidirectional',
      });
    } finally {
      cleanup(localRoot);
    }
  });

  it('W18-AGENT-GRAPH Main Agent executes graph actions through executeNodeAction and non-main actors are rejected', async () => {
    const localRoot = tempProjectRoot();
    try {
      const mainAgentId = seedAgentGraphNode(localRoot, 'session-w18-main-agent', {
        agentKind: 'main',
        role: 'main',
        label: 'W18 Main Agent',
      });
      const workerAgentId = seedAgentGraphNode(localRoot, 'session-w18-worker-agent', {
        agentKind: 'subagent',
        role: 'worker',
        label: 'W18 Worker Agent',
        status: 'running',
      });
      const targetNodeId = 'component-w18-runtime-notes';

      const created = await runtime.executeNodeAction(localRoot, mainAgentId, 'agent.createNode', {
        actorNodeId: mainAgentId,
        nodeId: targetNodeId,
        type: 'markdown',
        title: 'W18 Runtime Notes',
        position: { x: 240, y: 180 },
      });
      assert.equal(created.ok, true);
      assert.ok(graphStore.getGraphSnapshot(localRoot).nodes.some(node => node.nodeId === targetNodeId));

      const connected = await runtime.executeNodeAction(localRoot, mainAgentId, 'agent.connectNodes', {
        actorNodeId: mainAgentId,
        from: mainAgentId,
        to: targetNodeId,
        relation: 'context',
        sourceHandle: 'context',
        targetHandle: 'markdown',
      });
      assert.equal(connected.ok, true);
      assert.ok(graphStore.getGraphSnapshot(localRoot).edges.some(edge => edge.from === mainAgentId && edge.to === targetNodeId));

      const moved = await runtime.executeNodeAction(localRoot, mainAgentId, 'agent.moveNode', {
        actorNodeId: mainAgentId,
        targetNodeId,
        position: { x: 410, y: 255 },
      });
      assert.equal(moved.ok, true);
      assert.deepEqual(graphStore.getGraphSnapshot(localRoot).positions[targetNodeId], { x: 410, y: 255 });

      const read = await runtime.executeNodeAction(localRoot, mainAgentId, 'agent.readGraph', {
        actorNodeId: mainAgentId,
      });
      assert.equal(read.ok, true);
      assert.ok(read.result?.graph?.nodes?.some(node => node.nodeId === targetNodeId));

      const disconnected = await runtime.executeNodeAction(localRoot, mainAgentId, 'agent.disconnectNodes', {
        actorNodeId: mainAgentId,
        edgeId: `${mainAgentId}->${targetNodeId}`,
      });
      assert.equal(disconnected.ok, true);
      assert.equal(graphStore.getGraphSnapshot(localRoot).edges.some(edge => edge.id === `${mainAgentId}->${targetNodeId}`), false);

      const deleted = await runtime.executeNodeAction(localRoot, mainAgentId, 'agent.deleteNode', {
        actorNodeId: mainAgentId,
        targetNodeId,
      });
      assert.equal(deleted.ok, true);
      assert.deepEqual(deleted.result.deletedNodeIds, [targetNodeId]);
      assert.equal(graphStore.getGraphSnapshot(localRoot).nodes.some(node => node.nodeId === targetNodeId), false);

      const batchA = await runtime.createNode(localRoot, {
        nodeId: 'component-w18-delete-batch-a',
        type: 'markdown',
        title: 'W18 Delete Batch A',
      });
      const batchGoalId = seedActiveTask(localRoot, 'task-w18-delete-batch');
      graphStore.connectNodes(localRoot, { from: mainAgentId, to: batchA.node.nodeId, relation: 'context' });
      graphStore.connectNodes(localRoot, { from: mainAgentId, to: batchGoalId, relation: 'goal' });

      const batch = await runtime.executeNodeAction(localRoot, mainAgentId, 'agent.deleteNodes', {
        actorNodeId: mainAgentId,
        all: true,
      });
      assert.equal(batch.ok, true);
      assert.ok(batch.result.deletedNodeIds.includes(batchA.node.nodeId), JSON.stringify(batch.result));
      assert.ok(batch.result.deletedNodeIds.includes(batchGoalId), JSON.stringify(batch.result));
      assert.ok(batch.result.skippedNodeIds.includes(mainAgentId), JSON.stringify(batch.result));
      const afterBatch = graphStore.getGraphSnapshot(localRoot);
      assert.ok(afterBatch.nodes.some(node => node.nodeId === mainAgentId), 'Main Agent must not delete itself');
      assert.equal(afterBatch.nodes.some(node => node.nodeId === batchA.node.nodeId), false);
      assert.equal(afterBatch.nodes.some(node => node.nodeId === batchGoalId), false);
      assert.equal((await runtime.listNodes(localRoot)).nodes.some(node => node.nodeId === batchGoalId), false, 'deleted virtual goal node must stay hidden from node runtime list');

      await assert.rejects(
        () => runtime.executeNodeAction(localRoot, mainAgentId, 'agent.deleteNode', {
          actorNodeId: mainAgentId,
          targetNodeId: mainAgentId,
        }),
        (error) => {
          assert.equal(error.statusCode, 400);
          assert.match(error.code || '', /CANNOT_DELETE_SELF/);
          return true;
        },
      );

      await assert.rejects(
        () => runtime.executeNodeAction(localRoot, workerAgentId, 'agent.readGraph', {
          actorNodeId: workerAgentId,
        }),
        (error) => {
          assert.equal(error.statusCode, 403);
          assert.match(error.code || '', /MAIN_AGENT_REQUIRED|AGENT_GRAPH_AUTH|UNAUTHORIZED|FORBIDDEN/);
          return true;
        },
      );
    } finally {
      cleanup(localRoot);
    }
  });

  it('W23 exposes connected Agent workers as delegateable context refs and ontology affordances', async () => {
    const localRoot = tempProjectRoot();
    try {
      const mainAgentId = seedAgentGraphNode(localRoot, 'session-w23-main-agent', {
        agentKind: 'main',
        role: 'main',
        label: 'W23 Main Agent',
        status: 'running',
        sessionId: 'w23-main-pty',
      });
      const workerAgentId = seedAgentGraphNode(localRoot, 'session-w23-worker-agent', {
        agentKind: 'subagent',
        role: 'worker',
        label: 'W23 Worker Agent',
        status: 'running',
        sessionId: 'w23-worker-pty',
      });

      const edge = graphStore.connectNodes(localRoot, {
        from: mainAgentId,
        to: workerAgentId,
        direction: 'bidirectional',
      });
      assert.equal(edge.edge.relation, 'delegation');

      const context = await runtime.getNodeContext(localRoot, mainAgentId);
      const workerRef = context.context.connectedAgentRefs.find(ref => ref.nodeId === workerAgentId);
      assert.ok(workerRef, JSON.stringify(context.context.connectedAgentRefs));
      assert.equal(workerRef.sessionId, 'w23-worker-pty');
      assert.equal(workerRef.agentKind, 'subagent');
      assert.equal(workerRef.delegation.canDelegate, true);
      assert.equal(workerRef.delegation.state, 'ready');
      assert.ok(workerRef.allowedActions.includes('agent.sendInput'));
      assert.ok(workerRef.allowedActions.includes('agent.readOutput'));
      assert.equal(workerRef.workspaceRef.path, 'Harness/a2a/nodes/w23-worker-pty');
      assert.equal(workerRef.workspaceRef.initPath, 'Harness/a2a/nodes/w23-worker-pty/init.md');

      const connectedPeer = context.context.connectedPeers.find(peer => peer.nodeId === workerAgentId);
      assert.equal(connectedPeer.type, 'agent');
      assert.equal(connectedPeer.sessionId, 'w23-worker-pty');

      const affordance = context.context.affordances.find(item => item.nodeId === workerAgentId);
      assert.equal(affordance.relationship, 'connected-agent-worker');
      assert.equal(affordance.canDelegate, true);
      assert.ok(affordance.allowedActions.includes('agent.sendInput'));
      assert.ok(affordance.allowedActions.includes('agent.readTranscript'));
    } finally {
      cleanup(localRoot);
    }
  });
});

// ── Graph Store ──
describe('Workflow Graph Store', () => {
  let root;
  let nodeA;
  let nodeB;
  before(async () => {
    root = tempProjectRoot();
    // Create real component nodes so endpoint validation passes
    const a = await runtime.createNode(root, { type: 'markdown', title: 'Graph Test A' });
    const b = await runtime.createNode(root, { type: 'excalidraw', title: 'Graph Test B' });
    nodeA = a.node.nodeId;
    nodeB = b.node.nodeId;
  });
  after(() => cleanup(root));

  it('connects two nodes semantically', () => {
    const result = graphStore.connectNodes(root, { from: nodeA, to: nodeB, relation: 'wf-bridge' });
    assert.ok(result.ok);
    assert.ok(result.edge);
    assert.equal(result.edge.from, nodeA);
    assert.equal(result.edge.to, nodeB);
    assert.equal(result.edge.sourceHandle, 'markdown:right');
    assert.equal(result.edge.targetHandle, 'scene:left');
  });

  it('prevents duplicate edge', () => {
    assert.throws(() => {
      graphStore.connectNodes(root, { from: nodeA, to: nodeB });
    }, /duplicate|exists|already/i);
  });

  it('AC-007 prevents reverse duplicate edges for bidirectional links', async () => {
    const localRoot = tempProjectRoot();
    try {
      const a = await runtime.createNode(localRoot, { type: 'markdown', title: 'Reverse A' });
      const b = await runtime.createNode(localRoot, { type: 'markdown', title: 'Reverse B' });
      graphStore.connectNodes(localRoot, { from: a.node.nodeId, to: b.node.nodeId, sourceHandle: 'markdown', targetHandle: 'markdown' });
      assert.throws(() => {
        graphStore.connectNodes(localRoot, { from: b.node.nodeId, to: a.node.nodeId, sourceHandle: 'markdown', targetHandle: 'markdown' });
      }, /duplicate|exists|already/i);
    } finally {
      cleanup(localRoot);
    }
  });

  it('AC-007 preserves bare resource left/right physical side aliases', async () => {
    const localRoot = tempProjectRoot();
    try {
      const a = await runtime.createNode(localRoot, { type: 'markdown', title: 'Physical A' });
      const b = await runtime.createNode(localRoot, { type: 'excalidraw', title: 'Physical B' });
      const edge = graphStore.connectNodes(localRoot, {
        from: a.node.nodeId,
        to: b.node.nodeId,
        sourceHandle: 'left',
        targetHandle: 'right',
      });
      assert.equal(edge.edge.sourceHandle, 'markdown:left');
      assert.equal(edge.edge.targetHandle, 'scene:right');
      const context = await runtime.getNodeContext(localRoot, a.node.nodeId);
      assert.equal(context.node.graph.connections[0].sourceHandle, 'markdown:left');
      assert.equal(context.node.graph.connections[0].targetHandle, 'scene:right');
      assert.equal(context.node.graph.connections[0].direction, 'bidirectional');
    } finally {
      cleanup(localRoot);
    }
  });

  it('AC-007 strips display labels and physical sides from semantic relations', async () => {
    const localRoot = tempProjectRoot();
    try {
      const a = await runtime.createNode(localRoot, { type: 'markdown', title: 'Relation A' });
      const b = await runtime.createNode(localRoot, { type: 'excalidraw', title: 'Relation B' });
      const c = await runtime.createNode(localRoot, { type: 'file', title: 'Relation File', file: { source: 'workspace', path: 'rel.txt', name: 'rel.txt', mime: 'text/plain', size: 0 } });

      const displayLabel = graphStore.connectNodes(localRoot, {
        from: a.node.nodeId,
        to: b.node.nodeId,
        relation: 'markdown <-> scene',
        sourceHandle: 'markdown',
        targetHandle: 'scene',
      });
      assert.equal(displayLabel.edge.relation, 'wf-bridge');

      const physicalRelation = graphStore.connectNodes(localRoot, {
        from: a.node.nodeId,
        to: c.node.nodeId,
        relation: 'wf-bridge/markdown:right',
        sourceHandle: 'markdown:right',
        targetHandle: 'file',
      });
      assert.equal(physicalRelation.edge.relation, 'wf-bridge/markdown');

      const context = await runtime.getNodeContext(localRoot, a.node.nodeId);
      const relations = context.node.graph.connections.map(connection => connection.relation).sort();
      assert.deepEqual(relations, ['wf-bridge', 'wf-bridge/markdown'].sort());
      assert.ok(!JSON.stringify(context.node.graph.connections).includes('<->'));
      assert.ok(!JSON.stringify(context.node.graph.connections.map(connection => connection.relation)).includes(':right'));
    } finally {
      cleanup(localRoot);
    }
  });

  it('reads connections for a node', () => {
    const result = graphStore.readConnections(root, nodeA);
    assert.equal(result.nodeId, nodeA);
    assert.ok(result.connections.length >= 1);
    assert.equal(result.connections[0].direction, 'bidirectional');
    assert.ok(['source', 'target'].includes(result.connections[0].endpointRole));
  });

  it('W11 allows directed event edges and keeps reverse event edges distinct', async () => {
      const localRoot = tempProjectRoot();
      try {
      const timer = await runtime.createNode(localRoot, { type: 'timer', title: 'Manual Timer' });
      const agentNodeId = seedAgentGraphNode(localRoot);
      const graph = graphStore.getGraphSnapshot(localRoot);
      graphStore.connectNodes(localRoot, {
        from: timer.node.nodeId,
        to: agentNodeId,
        relation: 'event',
        direction: 'source-to-target',
        sourceHandle: 'event',
        targetHandle: 'event.in',
      });
      const reverse = graphStore.connectNodes(localRoot, {
        from: agentNodeId,
        to: timer.node.nodeId,
        relation: 'control',
        direction: 'source-to-target',
        sourceHandle: 'control',
        targetHandle: 'config',
      });
      assert.equal(reverse.edge.direction, 'source-to-target');
      assert.equal(graphStore.getGraphSnapshot(localRoot).edges.length, (graph.edges || []).length + 2);
      const timerConnections = graphStore.readConnections(localRoot, timer.node.nodeId).connections;
      assert.ok(timerConnections.some(connection => connection.direction === 'source-to-target' && connection.endpointRole === 'source'));
      assert.ok(timerConnections.some(connection => connection.direction === 'source-to-target' && connection.endpointRole === 'target'));
    } finally {
      cleanup(localRoot);
    }
  });

  it('W11 exposes connected event refs to an agent context', async () => {
      const localRoot = tempProjectRoot();
      try {
      const timer = await runtime.createNode(localRoot, { type: 'timer', title: 'Agent Timer' });
      seedAgentGraphNode(localRoot);
      graphStore.connectNodes(localRoot, {
        from: timer.node.nodeId,
        to: 'session-event-agent-01',
        relation: 'event',
        direction: 'source-to-target',
        sourceHandle: 'event',
        targetHandle: 'event.in',
      });
      const context = await runtime.getNodeContext(localRoot, 'session-event-agent-01');
      assert.ok(Array.isArray(context.context.connectedEventRefs), 'agent context must expose connectedEventRefs');
      assert.equal(context.context.connectedEventRefs.length, 1);
      assert.equal(context.context.connectedEventRefs[0].nodeId, timer.node.nodeId);
      assert.equal(context.context.connectedEventRefs[0].direction, 'source-to-target');
      assert.equal(context.context.connectedEventRefs[0].eventKind, 'timer');
      assert.equal(context.context.connectedEventRefs[0].connection.localHandle, 'event.in');
    } finally {
      cleanup(localRoot);
    }
  });

  it('W34 exposes capsule dock links to Agent context without storing normal graph edges', async () => {
    const localRoot = tempProjectRoot();
    try {
      const timer = await runtime.createNode(localRoot, {
        type: 'timer',
        title: 'Docked Agent Timer',
        enabled: true,
        controlPolicy: { agentCanDisable: true, agentCanSetInterval: true },
      });
      const agentNodeId = seedAgentGraphNode(localRoot, 'session-docked-agent-01');
      const graph = runtime.loadWorkflowGraphMap(localRoot);
      runtime.writeWorkflowGraphMap(localRoot, {
        ...graph,
        version: graph.version + 1,
        edges: [],
        capsuleDockLinks: [{
          id: `dock:${agentNodeId}::${timer.node.nodeId}`,
          nodeIds: [agentNodeId, timer.node.nodeId].sort(),
          anchorId: timer.node.nodeId,
          draggedId: agentNodeId,
          side: 'top',
          edges: [],
          connections: [
            {
              source: timer.node.nodeId,
              target: agentNodeId,
              relation: 'event',
              direction: 'source-to-target',
              sourceHandle: 'event',
              targetHandle: 'event.in',
            },
            {
              source: agentNodeId,
              target: timer.node.nodeId,
              relation: 'control',
              direction: 'source-to-target',
              sourceHandle: 'context',
              targetHandle: 'config',
            },
          ],
        }],
      });

      const stored = runtime.loadWorkflowGraphMap(localRoot);
      assert.equal(stored.edges.length, 0);
      assert.equal(stored.capsuleDockLinks.length, 1);
      assert.equal(stored.capsuleDockLinks[0].connections.length, 2);

      const context = await runtime.getNodeContext(localRoot, agentNodeId);
      const ref = context.context.connectedEventRefs.find(item => item.nodeId === timer.node.nodeId);
      assert.ok(ref, JSON.stringify(context.context.connectedEventRefs));
      assert.equal(ref.connection.relation, 'event');
      assert.equal(ref.connection.localHandle, 'event.in');
      assert.ok(ref.allowedActions.includes('timer.setInterval'), JSON.stringify(ref.allowedActions));

      const interval = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.setInterval', {
        actorNodeId: agentNodeId,
        intervalSeconds: 120,
      });
      assert.equal(interval.result.state.schedule.intervalSeconds, 120);
    } finally {
      cleanup(localRoot);
    }
  });

  it('W34 migrates legacy dock-created edges and dedupes ordinary edge plus dock semantics', async () => {
    const localRoot = tempProjectRoot();
    try {
      const timer = await runtime.createNode(localRoot, {
        type: 'timer',
        title: 'Legacy Dock Timer',
        enabled: true,
        controlPolicy: { agentCanDisable: true, agentCanSetInterval: true },
      });
      const agentNodeId = seedAgentGraphNode(localRoot, 'session-legacy-dock-agent-01');
      const graph = runtime.loadWorkflowGraphMap(localRoot);
      const legacyEdges = [
        {
          id: 'legacy-dock-event',
          source: timer.node.nodeId,
          target: agentNodeId,
          relation: 'event',
          direction: 'source-to-target',
          sourceHandle: 'event',
          targetHandle: 'event.in',
        },
        {
          id: 'legacy-dock-control',
          source: agentNodeId,
          target: timer.node.nodeId,
          relation: 'control',
          direction: 'source-to-target',
          sourceHandle: 'context',
          targetHandle: 'config',
        },
      ];
      runtime.writeWorkflowGraphMap(localRoot, {
        ...graph,
        version: graph.version + 1,
        edges: legacyEdges,
        capsuleDockLinks: [{
          id: `dock:${agentNodeId}::${timer.node.nodeId}`,
          nodeIds: [agentNodeId, timer.node.nodeId].sort(),
          anchorId: timer.node.nodeId,
          draggedId: agentNodeId,
          side: 'left',
          edges: legacyEdges.map(edge => ({ edgeId: edge.id, retention: 'delete-on-detach' })),
        }],
      });

      const migrated = runtime.loadWorkflowGraphMap(localRoot);
      assert.equal(migrated.edges.length, 0);
      assert.equal(migrated.capsuleDockLinks.length, 1);
      assert.equal(migrated.capsuleDockLinks[0].edges.length, 0);
      assert.equal(migrated.capsuleDockLinks[0].connections.length, 2);

      const context = await runtime.getNodeContext(localRoot, agentNodeId);
      assert.equal(context.context.connectedEventRefs.filter(item => item.nodeId === timer.node.nodeId).length, 1);

      const interval = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.setInterval', {
        actorNodeId: agentNodeId,
        intervalSeconds: 180,
      });
      assert.equal(interval.result.state.schedule.intervalSeconds, 180);

      const duplicateGraph = runtime.loadWorkflowGraphMap(localRoot);
      runtime.writeWorkflowGraphMap(localRoot, {
        ...duplicateGraph,
        version: duplicateGraph.version + 1,
        edges: legacyEdges.map(edge => ({ ...edge, id: edge.id.replace('legacy-dock', 'manual') })),
        capsuleDockLinks: [{
          id: `dock:${agentNodeId}::${timer.node.nodeId}`,
          nodeIds: [agentNodeId, timer.node.nodeId].sort(),
          anchorId: timer.node.nodeId,
          draggedId: agentNodeId,
          side: 'right',
          edges: [],
          connections: legacyEdges.map(edge => ({
            source: edge.source,
            target: edge.target,
            relation: edge.relation,
            direction: edge.direction,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
          })),
        }],
      });
      const duplicateContext = await runtime.getNodeContext(localRoot, agentNodeId);
      assert.equal(duplicateContext.context.connectedEventRefs.filter(item => item.nodeId === timer.node.nodeId).length, 1);
    } finally {
      cleanup(localRoot);
    }
  });

  it('W14-TIMER lets a connected Agent control interval, watchdog ack, and disable through a control edge', async () => {
    const localRoot = tempProjectRoot();
    try {
      const agentNodeId = seedAgentGraphNode(localRoot, 'session-timer-agent-01');
      const timer = await runtime.createNode(localRoot, {
        type: 'timer',
        title: 'Agent-Controlled Timer',
        enabled: true,
        schedule: { mode: 'interval', intervalSeconds: 60 },
        heartbeat: {
          base: { enabled: true, intervalSeconds: 60 },
          watchdog: { enabled: true, intervalSeconds: 900, timeoutSeconds: 1800 },
        },
        controlPolicy: { agentCanDisable: true, agentCanSetInterval: true, minIntervalSeconds: 10, maxIntervalSeconds: 3600 },
      });
      graphStore.connectNodes(localRoot, {
        from: timer.node.nodeId,
        to: agentNodeId,
        relation: 'event',
        direction: 'source-to-target',
        sourceHandle: 'event',
        targetHandle: 'event.in',
      });
      graphStore.connectNodes(localRoot, {
        from: agentNodeId,
        to: timer.node.nodeId,
        relation: 'control',
        direction: 'source-to-target',
        sourceHandle: 'control',
        targetHandle: 'config',
      });

      const context = await runtime.getNodeContext(localRoot, agentNodeId);
      const ref = context.context.connectedEventRefs.find(item => item.nodeId === timer.node.nodeId);
      assert.ok(ref, JSON.stringify(context.context.connectedEventRefs));
      assert.deepEqual(ref.allowedActions.sort(), ['timer.ackWatchdog', 'timer.configure', 'timer.disable', 'timer.enable', 'timer.resetWatchdog', 'timer.setInterval', 'timer.setMode'].sort());
      assert.equal(ref.heartbeat.watchdog.state, 'ok');

      const interval = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.setInterval', {
        actorNodeId: agentNodeId,
        intervalSeconds: 120,
        lane: 'base',
      });
      assert.equal(interval.result.state.schedule.intervalSeconds, 120);
      assert.equal(interval.result.state.heartbeat.base.intervalSeconds, 120);
      assert.ok(Date.parse(interval.result.state.heartbeat.base.nextDueAt), 'timer.setInterval should schedule the next base heartbeat');

      const ack = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.ackWatchdog', {
        actorNodeId: agentNodeId,
        now: '2026-08-05T00:01:00.000Z',
      });
      assert.equal(ack.result.state.heartbeat.watchdog.lastAckAt, '2026-08-05T00:01:00.000Z');
      assert.equal(ack.result.state.heartbeat.watchdog.state, 'ok');

      const disabled = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.disable', {
        actorNodeId: agentNodeId,
      });
      assert.equal(disabled.result.state.enabled, false);
      assert.equal(disabled.result.state.heartbeat.base.enabled, false);
      assert.equal(disabled.result.state.heartbeat.base.nextDueAt, '');
    } finally {
      cleanup(localRoot);
    }
  });

  it('W25-TIMER context distinguishes Timer event delivery from Agent control', async () => {
    const localRoot = tempProjectRoot();
    try {
      const agentNodeId = seedAgentGraphNode(localRoot, 'session-timer-agent-context-01');
      const timer = await runtime.createNode(localRoot, {
        type: 'timer',
        title: 'Event-only Timer',
        enabled: true,
        schedule: { mode: 'loop', intervalSeconds: 60 },
        heartbeat: {
          base: { enabled: true, intervalSeconds: 60 },
          watchdog: { enabled: true, intervalSeconds: 600, timeoutSeconds: 1800 },
        },
        controlPolicy: { agentCanDisable: true, agentCanSetInterval: true, minIntervalSeconds: 10, maxIntervalSeconds: 3600 },
      });
      assert.ok(Date.parse(timer.state.heartbeat.base.nextDueAt), 'enabled Timer creation should schedule nextDueAt');

      graphStore.connectNodes(localRoot, {
        from: timer.node.nodeId,
        to: agentNodeId,
        relation: 'event',
        direction: 'source-to-target',
        sourceHandle: 'event',
        targetHandle: 'event.in',
      });

      const eventOnlyContext = await runtime.getNodeContext(localRoot, agentNodeId);
      const eventOnlyRef = eventOnlyContext.context.connectedEventRefs.find(item => item.nodeId === timer.node.nodeId);
      assert.ok(eventOnlyRef, JSON.stringify(eventOnlyContext.context.connectedEventRefs));
      assert.equal(eventOnlyRef.canControl, false);
      assert.equal(eventOnlyRef.controlEdgeRequired, true);
      assert.ok(eventOnlyRef.deniedActions.includes('timer.setInterval'), JSON.stringify(eventOnlyRef.deniedActions));
      assert.match(eventOnlyRef.controlReason, /event delivery is not Timer control/);
      assert.ok(eventOnlyContext.context.availableOnDemandSkills.includes('workflow-timer-node'));

      await assert.rejects(
        () => runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.setInterval', {
          actorNodeId: agentNodeId,
          intervalSeconds: 120,
        }),
        /Timer control action requires a source-to-target control edge/,
      );

      graphStore.connectNodes(localRoot, {
        from: agentNodeId,
        to: timer.node.nodeId,
        relation: 'control',
        direction: 'source-to-target',
        sourceHandle: 'context',
        targetHandle: 'config',
      });

      const controlContext = await runtime.getNodeContext(localRoot, agentNodeId);
      const controlRef = controlContext.context.connectedEventRefs.find(item => item.nodeId === timer.node.nodeId);
      assert.equal(controlRef.canControl, true);
      assert.equal(controlRef.controlEdgeRequired, false);
      assert.deepEqual(controlRef.deniedActions, []);
      assert.ok(controlRef.allowedActions.includes('timer.setInterval'), JSON.stringify(controlRef.allowedActions));

      const updated = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.setInterval', {
        actorNodeId: agentNodeId,
        intervalSeconds: 120,
      });
      assert.equal(updated.result.state.schedule.intervalSeconds, 120);
      assert.ok(Date.parse(updated.result.state.heartbeat.base.nextDueAt), 'Timer API control should keep nextDueAt scheduled');
    } finally {
      cleanup(localRoot);
    }
  });

  it('W16-TIMER requires a control edge for Agent-authored configure actions', async () => {
    const localRoot = tempProjectRoot();
    try {
      const agentNodeId = seedAgentGraphNode(localRoot, 'session-timer-agent-03');
      const unconnectedAgentNodeId = seedAgentGraphNode(localRoot, 'session-timer-agent-04');
      const timer = await runtime.createNode(localRoot, {
        type: 'timer',
        title: 'Configure Gate Timer',
        enabled: true,
        schedule: { mode: 'interval', intervalSeconds: 60 },
        controlPolicy: { agentCanDisable: true, agentCanSetInterval: true, agentCanSetMode: true, minIntervalSeconds: 10, maxIntervalSeconds: 3600 },
      });

      await assert.rejects(
        () => runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.configure', {
          actorType: 'agent',
          schedule: { mode: 'watchdog', intervalSeconds: 120 },
        }),
        /Agent-authored node action requires actorNodeId or actorSessionId/,
      );

      await assert.rejects(
        () => runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.configure', {
          actorNodeId: unconnectedAgentNodeId,
          schedule: { mode: 'watchdog', intervalSeconds: 120 },
        }),
        /Timer control action requires a source-to-target control edge from actor to timer/,
      );

      graphStore.connectNodes(localRoot, {
        from: agentNodeId,
        to: timer.node.nodeId,
        relation: 'control',
        direction: 'source-to-target',
        sourceHandle: 'control',
        targetHandle: 'config',
      });

      await assert.rejects(
        () => runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.configure', {
          actorNodeId: agentNodeId,
          actorSessionId: `${unconnectedAgentNodeId}-pty`,
          schedule: { mode: 'watchdog', intervalSeconds: 120 },
        }),
        /Agent action actor does not match actorSessionId/,
      );

      const configured = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.configure', {
        actorNodeId: agentNodeId,
        schedule: { mode: 'watchdog', intervalSeconds: 120 },
      });
      assert.equal(configured.result.schedule.mode, 'watchdog');
      const sessionActorConfigured = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.configure', {
        actorSessionId: `${agentNodeId}-pty`,
        schedule: { mode: 'watchdog', intervalSeconds: 180 },
      });
      assert.equal(sessionActorConfigured.result.schedule.intervalSeconds, 180);
    } finally {
      cleanup(localRoot);
    }
  });

  it('W14-TIMER computes due base heartbeat and watchdog timeout events without arbitrary code execution', async () => {
    const localRoot = tempProjectRoot();
    try {
      const timer = await runtime.createNode(localRoot, {
        type: 'timer',
        title: 'Due Timer',
        enabled: true,
        schedule: {
          mode: 'while',
          intervalSeconds: 60,
          cadence: { kind: 'fixed' },
        },
        heartbeat: {
          base: {
            enabled: true,
            intervalSeconds: 60,
            nextDueAt: '2026-08-05T00:00:00.000Z',
          },
          watchdog: {
            enabled: true,
            intervalSeconds: 600,
            timeoutSeconds: 300,
            lastPingAt: '2026-08-04T23:50:00.000Z',
            lastAckAt: '2026-08-04T23:40:00.000Z',
            state: 'waiting',
          },
        },
        whileGuard: { source: 'watchdogAck', op: 'exists', value: 'ignored' },
      });

      const tick = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.tick', {
        now: '2026-08-05T00:01:00.000Z',
      });
      assert.equal(tick.result.events.length, 2);
      assert.deepEqual(tick.result.events.map(event => event.kind).sort(), ['timer.heartbeat.base', 'timer.watchdog.timeout']);
      assert.equal(tick.result.state.heartbeat.base.count, 1);
      assert.equal(tick.result.state.heartbeat.watchdog.state, 'missed');
      assert.equal(tick.result.state.heartbeat.watchdog.missedCount, 1);
      assert.equal(JSON.stringify(tick.result.state.whileGuard).includes('function'), false);
    } finally {
      cleanup(localRoot);
    }
  });

  it('W14-GOAL exposes a synthetic Goal node and connectedGoalRefs without allowing direct Agent completion', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'session-goal-agent-01');
      const unconnectedAgentNodeId = seedAgentGraphNode(localRoot, 'session-goal-agent-02');
      const listed = await runtime.listNodes(localRoot);
      const goal = listed.nodes.find(node => node.kind === 'goal');
      assert.ok(goal, JSON.stringify(listed.nodes.map(node => node.kind)));
      assert.equal(goal.nodeId, goalNodeId);
      assert.equal(goal.ui.testId, 'workflow-goal-node');
      assert.ok(goal.capabilities.includes('goal.requestCompletion'));

      await assert.rejects(
        () => runtime.executeNodeAction(localRoot, goalNodeId, 'goal.requestCompletion', {
          actorNodeId: unconnectedAgentNodeId,
          evidenceRefs: ['should-not-write'],
          note: 'Unconnected Agent should not update this Goal.',
        }),
        /Goal action requires a bidirectional goal edge from actor to goal/,
      );

      graphStore.connectNodes(localRoot, {
        from: goalNodeId,
        to: agentNodeId,
        relation: 'goal',
        direction: 'bidirectional',
        sourceHandle: 'goal:right',
        targetHandle: 'context',
      });

      const context = await runtime.getNodeContext(localRoot, agentNodeId);
      assert.ok(Array.isArray(context.context.connectedGoalRefs), 'agent context must expose connectedGoalRefs');
      const ref = context.context.connectedGoalRefs.find(item => item.nodeId === goalNodeId);
      assert.ok(ref, JSON.stringify(context.context.connectedGoalRefs));
      assert.equal(ref.status, 'active');
      assert.equal(ref.acceptance.length, 2);
      assert.equal(ref.progress.total, 2);
      assert.equal(ref.contentRef.kind, 'task-capsule');
      assert.equal(ref.contentRef.statePath, 'Harness/tasks/task-runtime-goal/STATE.json');
      assert.equal(ref.connection.relation, 'goal');
      assert.ok(context.context.connectedPeers.some(peer => peer.nodeId === goalNodeId && peer.type === 'goal'));

      const proposal = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.requestCompletion', {
        actorNodeId: agentNodeId,
        evidenceRefs: ['backend-tests'],
        note: 'All W14 acceptance checks pass.',
      });
      assert.equal(proposal.result.state.status, 'proposed-complete');
      assert.equal(proposal.result.state.confirmation.proposedBy, agentNodeId);
      const updatedContext = await runtime.getNodeContext(localRoot, agentNodeId);
      const updatedRef = updatedContext.context.connectedGoalRefs.find(item => item.nodeId === goalNodeId);
      assert.equal(updatedRef.status, 'proposed-complete');
      assert.equal(updatedRef.confirmation.state, 'proposed');
      const taskState = JSON.parse(fs.readFileSync(path.join(localRoot, 'Harness', 'tasks', 'task-runtime-goal', 'STATE.json'), 'utf8'));
      assert.equal(taskState.status, 'active', 'Agent proposal must not directly complete task state');
    } finally {
      cleanup(localRoot);
    }
  });

  it('W35-GOAL creates or restores the active task Goal node through runtime createNode', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot, 'task-runtime-create-goal');
      const created = await runtime.createNode(localRoot, {
        type: 'goal',
        position: { x: 720, y: 180 },
      });
      assert.equal(created.node.kind, 'goal');
      assert.equal(created.node.nodeId, goalNodeId);
      assert.deepEqual(created.node.graph.position, { x: 720, y: 180 });

      await runtime.deleteNode(localRoot, goalNodeId);
      const hidden = await runtime.listNodes(localRoot);
      assert.equal(hidden.nodes.some(node => node.nodeId === goalNodeId), false);

      const restored = await runtime.createNode(localRoot, {
        type: 'goal',
        position: { x: 840, y: 220 },
      });
      assert.equal(restored.node.nodeId, goalNodeId);
      assert.deepEqual(restored.node.graph.position, { x: 840, y: 220 });
      const visible = await runtime.listNodes(localRoot);
      assert.equal(visible.nodes.some(node => node.nodeId === goalNodeId), true);
    } finally {
      cleanup(localRoot);
    }
  });

  it('W34 exposes capsule Goal docks to Agent context without normal graph edges', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot, 'task-runtime-docked-goal');
      const agentNodeId = seedAgentGraphNode(localRoot, 'session-docked-goal-agent-01');
      const graph = runtime.loadWorkflowGraphMap(localRoot);
      runtime.writeWorkflowGraphMap(localRoot, {
        ...graph,
        version: graph.version + 1,
        nodes: [
          ...(graph.nodes || []),
          {
            nodeId: goalNodeId,
            id: goalNodeId,
            type: 'goal',
            kind: 'goal-node',
            label: 'Docked Goal',
            status: 'active',
          },
        ],
        edges: [],
        capsuleDockLinks: [{
          id: `dock:${agentNodeId}::${goalNodeId}`,
          nodeIds: [agentNodeId, goalNodeId].sort(),
          anchorId: goalNodeId,
          draggedId: agentNodeId,
          side: 'bottom',
          edges: [],
          connections: [{
            source: goalNodeId,
            target: agentNodeId,
            relation: 'goal',
            direction: 'bidirectional',
            sourceHandle: 'goal:right',
            targetHandle: 'context',
          }],
        }],
      });

      const stored = runtime.loadWorkflowGraphMap(localRoot);
      assert.equal(stored.edges.length, 0);
      assert.equal(stored.capsuleDockLinks.length, 1);

      const context = await runtime.getNodeContext(localRoot, agentNodeId);
      const ref = context.context.connectedGoalRefs.find(item => item.nodeId === goalNodeId);
      assert.ok(ref, JSON.stringify(context.context.connectedGoalRefs));
      assert.equal(ref.connection.relation, 'goal');
      assert.equal(ref.connection.endpointRole, 'target');

      const proposal = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.requestCompletion', {
        actorNodeId: agentNodeId,
        evidenceRefs: ['dock-link-context'],
        note: 'Goal dock grants Agent context without a normal graph edge.',
      });
      assert.equal(proposal.result.state.status, 'proposed-complete');
      assert.equal(proposal.result.state.confirmation.proposedBy, agentNodeId);
    } finally {
      cleanup(localRoot);
    }
  });

  it('W16-GOAL lets users edit Goal metadata and requires linked Agents for Goal updates', async () => {
    const localRoot = tempProjectRoot();
    try {
      const goalNodeId = seedActiveTask(localRoot);
      const agentNodeId = seedAgentGraphNode(localRoot, 'session-goal-agent-03');
      const unconnectedAgentNodeId = seedAgentGraphNode(localRoot, 'session-goal-agent-04');

      const userEdit = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.update', {
        title: 'Ship expanded Goal editing',
        objective: 'Editable objective text belongs in the Goal sidecar.',
        nextAction: 'Verify Goal editor save flow',
        status: 'completed',
        phase: 'forged-phase',
        gate: 'forged-gate',
        acceptance: [
          { id: 'W16-001', text: 'Double-click opens the Goal workbench', status: 'verified' },
          { id: 'W16-002', text: 'Linked Agent may update Goal metadata', status: 'tracked' },
        ],
        planItems: [
          { id: 'P-001', text: 'Inspect current Goal editor state', status: 'done' },
          { id: 'P-002', text: 'Wire Agent-filled plan list', status: 'todo' },
        ],
        wdt: { enabled: true, state: 'ok', timerNodeId: 'event-timer-w16' },
      });
      assert.equal(userEdit.result.state.title, 'Ship expanded Goal editing');
      assert.equal(userEdit.result.state.objective, 'Editable objective text belongs in the Goal sidecar.');
      assert.equal(userEdit.result.state.nextAction, 'Verify Goal editor save flow');
      assert.equal(userEdit.result.state.status, 'active');
      assert.notEqual(userEdit.result.state.phase, 'forged-phase');
      assert.notEqual(userEdit.result.state.gate, 'forged-gate');
      assert.equal(userEdit.result.state.acceptance.length, 2);
      assert.equal(userEdit.result.state.planItems.length, 2);
      assert.equal(userEdit.result.state.planItems[0].status, 'done');
      assert.equal(userEdit.result.state.progress.verified, 1);

      await assert.rejects(
        () => runtime.executeNodeAction(localRoot, goalNodeId, 'goal.update', {
          actorType: 'agent',
          title: 'Agent write without actor should fail',
        }),
        /Agent-authored node action requires actorNodeId or actorSessionId/,
      );

      await assert.rejects(
        () => runtime.executeNodeAction(localRoot, goalNodeId, 'goal.update', {
          actorNodeId: unconnectedAgentNodeId,
          title: 'Unlinked write should fail',
        }),
        /Goal action requires a bidirectional goal edge from actor to goal/,
      );

      graphStore.connectNodes(localRoot, {
        from: agentNodeId,
        to: goalNodeId,
        relation: 'goal',
        direction: 'bidirectional',
        sourceHandle: 'right',
        targetHandle: 'goal:left',
      });

      await assert.rejects(
        () => runtime.executeNodeAction(localRoot, goalNodeId, 'goal.update', {
          actorNodeId: agentNodeId,
          actorSessionId: `${unconnectedAgentNodeId}-pty`,
          title: 'Spoofed session write should fail',
        }),
        /Agent action actor does not match actorSessionId/,
      );

      const agentEdit = await runtime.executeNodeAction(localRoot, goalNodeId, 'goal.update', {
        actorNodeId: agentNodeId,
        title: 'Linked Agent edited Goal',
        status: 'completed',
        phase: 'linked-forged-phase',
        gate: 'linked-forged-gate',
        acceptance: [
          { id: 'W16-001', text: 'Double-click opens the Goal workbench', status: 'verified' },
        ],
        planItems: [
          { id: 'P-001', text: 'Agent updates the visible plan list', status: 'done' },
        ],
      });
      assert.equal(agentEdit.result.state.title, 'Linked Agent edited Goal');
      assert.equal(agentEdit.result.state.status, 'active');
      assert.notEqual(agentEdit.result.state.phase, 'linked-forged-phase');
      assert.notEqual(agentEdit.result.state.gate, 'linked-forged-gate');
      assert.equal(agentEdit.result.state.acceptance.length, 1);
      assert.equal(agentEdit.result.state.planItems.length, 1);
      const context = await runtime.getNodeContext(localRoot, agentNodeId);
      const ref = context.context.connectedGoalRefs.find(item => item.nodeId === goalNodeId);
      assert.equal(ref.title, 'Linked Agent edited Goal');
      assert.equal(ref.acceptance[0].id, 'W16-001');
      assert.equal(ref.planItems[0].text, 'Agent updates the visible plan list');
    } finally {
      cleanup(localRoot);
    }
  });

  it('W21-ONTOLOGY explains connected Agent affordances and timer control edge requirements', async () => {
    const localRoot = tempProjectRoot();
    try {
      const agentNodeId = seedAgentGraphNode(localRoot, 'session-ontology-main-agent', {
        agentKind: 'main',
        role: 'main',
        label: 'Ontology Main Agent',
        config: { skills: ['wf-browser'] },
      });
      const markdown = await runtime.createNode(localRoot, {
        type: 'markdown',
        title: 'Ontology Notes',
        markdown: 'Agent-readable notes',
      });
      const drawing = await runtime.createNode(localRoot, {
        type: 'excalidraw',
        title: 'Ontology Drawing',
      });
      const timer = await runtime.createNode(localRoot, {
        type: 'timer',
        title: 'Ontology Timer',
        enabled: true,
        schedule: { mode: 'loop', intervalSeconds: 60 },
        controlPolicy: { agentCanDisable: true, agentCanSetInterval: true },
      });
      const skills = await runtime.createNode(localRoot, {
        type: 'skill-group',
        title: 'Ontology Skills',
        skills: [
          { id: 'skill:wf-ui', name: 'wf-ui', title: 'WF UI' },
        ],
      });
      const goalNodeId = seedActiveTask(localRoot, 'task-ontology-goal');

      graphStore.connectNodes(localRoot, {
        from: agentNodeId,
        to: markdown.node.nodeId,
        relation: 'context',
        sourceHandle: 'context',
        targetHandle: 'markdown',
      });
      graphStore.connectNodes(localRoot, {
        from: drawing.node.nodeId,
        to: agentNodeId,
        relation: 'context',
        sourceHandle: 'scene',
        targetHandle: 'context',
      });
      graphStore.connectNodes(localRoot, {
        from: timer.node.nodeId,
        to: agentNodeId,
        relation: 'event',
        direction: 'source-to-target',
        sourceHandle: 'event',
        targetHandle: 'event.in',
      });
      graphStore.connectNodes(localRoot, {
        from: skills.node.nodeId,
        to: agentNodeId,
        relation: 'capability',
        sourceHandle: 'capability',
        targetHandle: 'capability',
      });
      graphStore.connectNodes(localRoot, {
        from: goalNodeId,
        to: agentNodeId,
        relation: 'goal',
        direction: 'bidirectional',
        sourceHandle: 'goal',
        targetHandle: 'goal',
      });

      const contextBeforeControl = await runtime.getNodeContext(localRoot, agentNodeId);
      assert.equal(contextBeforeControl.context.ontology.ontologyId, 'harness.workflow.ontology');
      assert.ok(Array.isArray(contextBeforeControl.context.affordances));
      assert.ok(contextBeforeControl.context.defaultSkills.includes('workflow-ontology'));
      assert.ok(contextBeforeControl.context.effectiveSkills.includes('workflow-ontology'));
      assert.ok(contextBeforeControl.context.effectiveSkills.includes('wf-browser'));
      const graphAffordance = contextBeforeControl.context.affordances.find(item => item.type === 'workflow-graph');
      assert.equal(graphAffordance.canControl, true);
      assert.ok(graphAffordance.allowedActions.includes('agent.createNode'));

      const markdownAffordance = contextBeforeControl.context.affordances.find(item => item.nodeId === markdown.node.nodeId);
      assert.equal(markdownAffordance.canRead, true);
      assert.equal(markdownAffordance.canWrite, true);
      assert.equal(markdownAffordance.priority, 'preferred-output-target');
      assert.equal(markdownAffordance.outputModality, 'text');
      assert.ok(markdownAffordance.allowedActions.includes('markdown.replace'));
      assert.ok(markdownAffordance.preferredActions.includes('markdown.replace'));
      assert.match(markdownAffordance.useWhen, /long-form text/);

      const drawingAffordance = contextBeforeControl.context.affordances.find(item => item.nodeId === drawing.node.nodeId);
      assert.equal(drawingAffordance.canRead, true);
      assert.equal(drawingAffordance.canWrite, true);
      assert.equal(drawingAffordance.priority, 'preferred-output-target');
      assert.equal(drawingAffordance.outputModality, 'diagram');
      assert.ok(drawingAffordance.allowedActions.includes('excalidraw.saveScene'));
      assert.ok(drawingAffordance.preferredActions.includes('excalidraw.saveScene'));
      assert.match(drawingAffordance.useWhen, /diagrams/);

      const goalAffordance = contextBeforeControl.context.affordances.find(item => item.nodeId === goalNodeId);
      assert.equal(goalAffordance.canWrite, true);
      assert.ok(goalAffordance.allowedActions.includes('goal.update'));

      const skillAffordance = contextBeforeControl.context.affordances.find(item => item.nodeId === skills.node.nodeId);
      assert.equal(skillAffordance.canRead, true);
      assert.equal(skillAffordance.canWrite, false);
      assert.ok(skillAffordance.allowedActions.includes('skill-group.read'));
      assert.ok(skillAffordance.deniedActions.includes('skill-group.configure'));
      const configuredSkillAffordance = contextBeforeControl.context.affordances.find(item => item.nodeId === 'skill:wf-browser');
      assert.equal(configuredSkillAffordance.canRead, true);
      assert.deepEqual(configuredSkillAffordance.allowedActions, ['capability:read']);

      const timerBefore = contextBeforeControl.context.affordances.find(item => item.nodeId === timer.node.nodeId);
      assert.equal(timerBefore.canRead, true);
      assert.equal(timerBefore.canControl, false);
      assert.ok(timerBefore.deniedActions.includes('timer.configure'));

      graphStore.connectNodes(localRoot, {
        from: agentNodeId,
        to: timer.node.nodeId,
        relation: 'control',
        direction: 'source-to-target',
        sourceHandle: 'control',
        targetHandle: 'config',
      });
      const contextAfterControl = await runtime.getNodeContext(localRoot, agentNodeId);
      const timerAfter = contextAfterControl.context.affordances.find(item => item.nodeId === timer.node.nodeId);
      assert.equal(timerAfter.canControl, true);
      assert.ok(timerAfter.allowedActions.includes('timer.configure'));
      assert.ok(timerAfter.allowedActions.includes('timer.setInterval'));
      assert.ok(!timerAfter.deniedActions.includes('timer.configure'));
      const sessionActorControl = await runtime.executeNodeAction(localRoot, timer.node.nodeId, 'timer.setInterval', {
        actorNodeId: 'session-ontology-main-agent-pty',
        intervalSeconds: 120,
      });
      assert.equal(sessionActorControl.result.state.schedule.intervalSeconds, 120);
    } finally {
      cleanup(localRoot);
    }
  });

  it('W14 exposes connected github-trigger refs to an agent context without raw delivery leakage', async () => {
      const localRoot = tempProjectRoot();
      try {
      const trigger = await runtime.createNode(localRoot, {
        type: 'github-trigger',
        experimental: true,
        title: 'Agent GitHub Trigger',
        repository: { owner: 'zingspark', name: 'create-harness-vibe-coding' },
        eventFilters: { events: ['pull_request'], actions: ['opened'], branches: ['main'] },
      });
      await runtime.executeNodeAction(localRoot, trigger.node.nodeId, 'github-trigger.receive', {
        event: 'pull_request',
        action: 'opened',
        deliveryId: 'delivery-agent-1',
        repository: { owner: 'zingspark', name: 'create-harness-vibe-coding' },
        sender: 'octocat',
        pullRequest: { number: 7, title: 'Context check' },
        headers: { 'x-hub-signature-256': 'sha256=secret' },
        rawBody: '{"token":"secret"}',
      });
      seedAgentGraphNode(localRoot);
      graphStore.connectNodes(localRoot, {
        from: trigger.node.nodeId,
        to: 'session-event-agent-01',
        relation: 'event',
        direction: 'source-to-target',
        sourceHandle: 'event',
        targetHandle: 'event.in',
      });
      const context = await runtime.getNodeContext(localRoot, 'session-event-agent-01');
      assert.ok(Array.isArray(context.context.connectedEventRefs), 'agent context must expose connectedEventRefs');
      const ref = context.context.connectedEventRefs.find(item => item.nodeId === trigger.node.nodeId);
      assert.ok(ref, JSON.stringify(context.context.connectedEventRefs));
      assert.equal(ref.direction, 'source-to-target');
      assert.equal(ref.eventKind, 'github-trigger');
      assert.equal(ref.connection.localHandle, 'event.in');
      assert.equal(ref.repository.fullName, 'zingspark/create-harness-vibe-coding');
      assert.deepEqual(ref.eventFilters.events, ['pull_request']);
      assert.equal(ref.lastEvent.kind, 'github.pull_request');
      assert.equal(ref.lastEvent.pullRequest.number, 7);

      const serialized = JSON.stringify(context.context.connectedEventRefs);
      assert.equal(serialized.includes('sha256=secret'), false);
      assert.equal(serialized.includes('"token"'), false);
      assert.equal(serialized.includes('rawBody'), false);
      assert.equal(serialized.includes('headers'), false);
    } finally {
      cleanup(localRoot);
    }
  });

  it('W12 exposes connected skill-group capability refs to an agent context', async () => {
      const localRoot = tempProjectRoot();
      try {
      const pack = await runtime.createNode(localRoot, {
        type: 'skill-group',
        title: 'Agent Skill Pack',
        sourceGroup: { id: 'source:workflow', label: 'Workflow', kind: 'source' },
        skills: [
          { id: 'skill:wf-ui', name: 'wf-ui', title: 'WF-UI Adapter', description: 'Open wf-ui', source: 'project' },
          { id: 'skill:browser-lab', name: 'browser-lab', title: 'Browser Lab', description: 'Browser testing', source: 'project' },
        ],
      });
      seedAgentGraphNode(localRoot);
      const edge = graphStore.connectNodes(localRoot, {
        from: 'session-event-agent-01',
        to: pack.node.nodeId,
        relation: 'capability',
        sourceHandle: 'right',
        targetHandle: 'capability:left',
      });
      assert.equal(edge.edge.direction, 'bidirectional');
      assert.equal(edge.edge.relation, 'capability');
      assert.equal(edge.edge.targetHandle, 'capability:left');

      const context = await runtime.getNodeContext(localRoot, 'session-event-agent-01');
      assert.ok(Array.isArray(context.context.connectedCapabilityRefs), 'agent context must expose connectedCapabilityRefs');
      assert.ok(Array.isArray(context.context.connectedCapabilityNodeRefs), 'agent context must expose capability-node provenance refs');
      assert.ok(context.context.effectiveSkills.includes('workflow-ontology'));
      assert.ok(context.context.effectiveSkills.includes('workflow-context'));
      assert.ok(context.context.effectiveSkills.includes('wf-ui'));
      assert.ok(context.context.effectiveSkills.includes('browser-lab'));
      assert.equal(context.context.connectedCapabilityNodeRefs.length, 1);
      assert.equal(context.context.connectedCapabilityNodeRefs[0].nodeId, pack.node.nodeId);
      assert.equal(context.context.connectedCapabilityNodeRefs[0].capabilityKind, 'skill-group');
      assert.equal(context.context.connectedCapabilityNodeRefs[0].executor, 'agent');
      assert.equal(context.context.connectedCapabilityNodeRefs[0].connection.relation, 'capability');
      assert.deepEqual(context.context.connectedCapabilityNodeRefs[0].skillNames, ['wf-ui', 'browser-lab']);
      assert.ok(Array.isArray(context.context.effectiveSkillGroups), 'agent context must expose effectiveSkillGroups');
      assert.equal(context.context.effectiveSkillGroups.length, 1);
      assert.equal(context.context.effectiveSkillGroups[0].nodeId, pack.node.nodeId);
      assert.equal(context.context.effectiveSkillGroups[0].label, 'Workflow');
      assert.deepEqual(context.context.effectiveSkillGroups[0].skillNames, ['wf-ui', 'browser-lab']);
      const serialized = JSON.stringify(context);
      assert.ok(!serialized.includes('C:\\\\'), 'context must not leak absolute Windows paths');
      assert.ok(!serialized.includes('/Users/'), 'context must not leak absolute POSIX user paths');
      assert.ok(!serialized.includes('SECRET_TOKEN'), 'context must not leak secret-like values');
      assert.ok(!serialized.includes('Open wf-ui'), 'context must not include per-skill descriptions');
      assert.ok(!serialized.includes('Browser testing'), 'context must not include per-skill descriptions');
    } finally {
      cleanup(localRoot);
    }
  });

  it('W13 exposes connected mcp-connector refs to an agent context without adding effective skills', async () => {
    const localRoot = tempProjectRoot();
    try {
      const agentId = seedAgentGraphNode(localRoot, 'session-mcp-agent-01');
      const sentinel = path.join(localRoot, 'mcp-context-spawned.txt');
      fs.writeFileSync(path.join(localRoot, '.mcp.json'), JSON.stringify({
        mcpServers: {
          docs: {
            command: process.execPath,
            args: ['-e', `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'spawned')`, '@secret/mcp-server'],
            env: { MCP_DOCS_TOKEN: 'docs-secret-value' },
            url: 'https://docs.example.test/mcp/token/docs-secret-value',
          },
        },
      }, null, 2));
      const connector = await runtime.createNode(localRoot, {
        type: 'mcp-connector',
        mcpServerId: 'mcp:project-mcp:docs',
        title: 'Docs MCP',
      });
      await graphStore.connectNodes(localRoot, {
        from: agentId,
        to: connector.node.nodeId,
        relation: 'capability',
        direction: 'bidirectional',
        sourceHandle: 'right',
        targetHandle: 'capability:left',
      });

      const context = await runtime.getNodeContext(localRoot, agentId);
      assert.equal(fs.existsSync(sentinel), false, 'agent context read must not spawn MCP command');
      assert.ok(Array.isArray(context.context.connectedCapabilityNodeRefs));
      const ref = context.context.connectedCapabilityNodeRefs.find(item => item.nodeId === connector.node.nodeId);
      assert.ok(ref, `missing mcp-connector ref in ${JSON.stringify(context.context.connectedCapabilityNodeRefs)}`);
      assert.equal(ref.capabilityKind, 'mcp-connector');
      assert.equal(ref.executor, 'agent');
      assert.equal(ref.connection.relation, 'capability');
      assert.deepEqual(ref.serverNames, ['docs']);
      assert.equal(ref.serverCount, 1);
      assert.ok(!context.context.effectiveSkills.includes('docs'), 'MCP servers must not be promoted into effectiveSkills');

      const serialized = JSON.stringify(context);
      assert.equal(serialized.includes('docs-secret-value'), false);
      assert.equal(serialized.includes('@secret/mcp-server'), false);
      assert.equal(serialized.includes('writeFileSync'), false);
      assert.equal(serialized.includes(String(sentinel)), false);
    } finally {
      cleanup(localRoot);
    }
  });

  it('AC-007 rejects updateEdge changes that create reverse duplicate bidirectional links', async () => {
    const localRoot = tempProjectRoot();
    try {
      const a = await runtime.createNode(localRoot, { type: 'markdown', title: 'Update A' });
      const b = await runtime.createNode(localRoot, { type: 'markdown', title: 'Update B' });
      const c = await runtime.createNode(localRoot, { type: 'markdown', title: 'Update C' });
      graphStore.connectNodes(localRoot, { from: a.node.nodeId, to: b.node.nodeId });
      const second = graphStore.connectNodes(localRoot, { from: a.node.nodeId, to: c.node.nodeId });

      assert.throws(() => {
        graphStore.updateEdge(localRoot, second.edge.id, { from: b.node.nodeId, to: a.node.nodeId });
      }, /duplicate|DUPLICATE_EDGE|already/i);
    } finally {
      cleanup(localRoot);
    }
  });

  it('disconnects by edge id', () => {
    const before = graphStore.getGraphSnapshot(root);
    const edge = before.edges[0];
    const result = graphStore.disconnectNodes(root, edge.id);
    assert.ok(result.ok);
    const after = graphStore.getGraphSnapshot(root);
    assert.equal(after.edges.length, before.edges.length - 1);
  });

  it('rejects disconnect of nonexistent edge', () => {
    assert.throws(() => {
      graphStore.disconnectNodes(root, 'nonexistent-edge');
    }, /not found|NOT_FOUND|EDGE_NOT_FOUND/i);
  });

  it('rejects connect with nonexistent endpoint', () => {
    assert.throws(() => {
      graphStore.connectNodes(root, { from: nodeA, to: 'component-nonexistent-ffffffff' });
    }, /not found|ENDPOINT_NOT_FOUND/i);
  });

  it('getGraphSnapshot returns complete state', () => {
    const snapshot = graphStore.getGraphSnapshot(root);
    assert.ok(snapshot.nodes);
    assert.ok(snapshot.edges);
    assert.ok(snapshot.version >= 1);
  });
});
