import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sessionId = 'e2e-session-skills-hub';
const graphNodeId = 'e2e-node-skills-agent';
const alphaSkillId = 'skill:alpha';
const betaSkillId = 'skill:beta';
const draftLabel = 'Alpha Skill + Beta Skill';

/** Must match WorkflowSkillsHubOverlay.SKILL_GROUP_TRANSFER_TYPE. */
const SKILL_GROUP_TRANSFER_TYPE = 'application/x-harness-skill-group';

type JsonRecord = Record<string, any>;

type HarnessNetwork = {
  skillGroupCreateRequests: JsonRecord[];
  skillsHubRequests: string[];
  pageErrors: string[];
  failedResponses: string[];
};

const nodeConfig = {
  role: 'main',
  customRole: '',
  prompt: 'Run inside WF UI and use the workflow map as context.',
  model: 'gpt-5-codex',
  provider: 'openai',
  cwd: repoRoot,
  env: { HARNESS_WORKFLOW_MAP: 'Harness/a2a/workflow-map.json' },
  permissions: { filesystem: 'full-access', network: 'enabled' },
  launchPolicy: {
    autoStart: false,
    restartOnSave: false,
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
  },
  outputRouting: {
    markdownDefaultEnabled: false,
    markdownTargetNodeId: '',
    fallback: 'oldest-connected-markdown',
  },
  skills: ['wf-max', 'tdd', 'wf-browser'],
  skillPolicy: 'auto',
  recommendedSkills: ['wf-max', 'tdd', 'wf-browser'],
  contextSources: ['workflow-map', 'task-capsule', 'terminal-transcript'],
  capabilities: ['terminal', 'file-ops', 'browser', 'review'],
};

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function control() {
  return {
    canReadGraph: true,
    canModifyGraph: true,
    canStart: true,
    canStop: true,
    canDelete: true,
    canOpenTerminal: true,
    canOpenTranscript: true,
    canSendInput: true,
    canCreateAgent: true,
  };
}

function skillsHubPayload(): JsonRecord {
  return {
    ok: true,
    schemaVersion: 1,
    kind: 'skills-hub',
    generatedAt: '2026-08-14T00:00:00.000Z',
    query: { scope: 'project', q: '', limit: 50 },
    roots: [{ id: 'project-root', label: 'Project', scope: 'project', runtime: 'local', exists: true, path: '.' }],
    summary: { skillCount: 2, groupCount: 0, sourceCount: 1 },
    installTargets: [{ id: 'project-agents', label: 'Project agents', scope: 'project', runtime: 'local', default: true, path: '.' }],
    nodeSemantics: { role: 'agent-attached-capability-provider', defaultConnection: 'bidirectional capability port to Agent nodes', executor: 'agent' },
    skills: [
      { id: alphaSkillId, name: 'alpha', title: 'Alpha Skill', description: 'alpha fixture skill', kind: 'skill', nodeSemantics: 'agent-attached-capability-provider', attachable: true, state: 'indexed', sources: [{ rootId: 'project-root', label: 'Project', scope: 'project', runtime: 'local', relativePath: 'skills/alpha', path: 'skills/alpha' }] },
      { id: betaSkillId, name: 'beta', title: 'Beta Skill', description: 'beta fixture skill', kind: 'skill', nodeSemantics: 'agent-attached-capability-provider', attachable: true, state: 'indexed', sources: [{ rootId: 'project-root', label: 'Project', scope: 'project', runtime: 'local', relativePath: 'skills/beta', path: 'skills/beta' }] },
    ],
    groups: [],
  };
}

/** Capability-node state fixture for a skill-group created by the drop path. */
function capabilityStateFixture(
  nodeId: string,
  title: string,
  skills: JsonRecord[],
  sourceGroup: JsonRecord,
  position: { x: number; y: number },
): JsonRecord {
  return {
    nodeId,
    type: 'skill-group',
    title,
    revision: 1,
    description: `${skills.length} skills from Skills Hub`,
    sourceGroup,
    skills,
    skillNames: skills.map(skill => skill.name).filter(Boolean),
    skillCount: skills.length,
    servers: [],
    serverNames: [],
    serverCount: 0,
    transports: [],
    envKeyNames: [],
    envKeyCount: 0,
    redactedFieldCount: 0,
    nodeSemantics: {
      role: 'agent-attached-capability-provider',
      defaultConnection: 'bidirectional capability port to Agent nodes',
      executor: 'agent',
    },
    statePath: `Harness/a2a/capability-nodes/${nodeId}/state.json`,
    position,
  };
}

function capabilityRuntimeNode(state: JsonRecord) {
  return {
    nodeId: state.nodeId,
    kind: state.type,
    version: state.revision,
    lifecycle: 'capability-provider',
    status: { state: 'ready', updatedAt: '2026-08-14T00:00:00.000Z' },
    graph: {
      position: state.position,
      handles: {
        inputs: [],
        outputs: [],
        bidirectional: ['capability'],
        ports: ['capability'],
        physical: ['capability:left', 'capability:right'],
        directions: { capability: 'bidirectional' },
      },
      connections: [],
    },
    stateRef: { path: state.statePath, revision: state.revision },
    contentRef: { kind: 'capability-node-state', statePath: state.statePath, revision: state.revision, capabilityKind: state.type },
    settings: { schemaId: 'skill-group-settings', values: {}, revision: 0 },
    capabilities: ['state:read', 'state:update', 'skill-group.read', 'skill-group.configure', 'capability:read'],
    ui: {
      previewKind: 'skill-group',
      settingsPanel: 'skill-group-settings',
      testId: 'workflow-capability-node',
      labels: { title: state.title },
    },
  };
}

/** Snapshot served by GET /api/a2a/snapshot; grows as drops create nodes. */
function workflowSnapshot(capabilities: JsonRecord[]): JsonRecord {
  const capabilityNodes = capabilities.map(state => ({
    id: state.nodeId,
    label: state.title,
    kind: 'capability-node',
    type: state.type,
    level: 0,
    status: 'ready',
    lifecycle: 'capability-provider',
    runtimeState: 'ready',
    managedByCurrentServer: true,
    control: control(),
    position: state.position,
    statePath: state.statePath,
    revision: state.revision,
    graphNodeId: state.nodeId,
  }));
  const capabilityStateRefs = Object.fromEntries(capabilities.map(state => [state.nodeId, {
    type: state.type,
    capabilityKind: state.type,
    title: state.title,
    statePath: state.statePath,
    revision: state.revision,
    sourceGroup: state.sourceGroup,
    skills: state.skills,
    skillNames: state.skillNames,
    skillCount: state.skillCount,
    nodeSemantics: state.nodeSemantics,
  }]));
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-14T00:00:00.000Z',
    workflowId: 'e2e-workflow-skills-hub',
    taskId: 'task-ac004-drag',
    mode: 'wf-max',
    phase: 'ac004',
    gate: 'TEST-GATE',
    rootAgentId: graphNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [{
      sessionId,
      runtime: 'codex',
      role: nodeConfig.role,
      objective: nodeConfig.prompt,
      status: 'running',
      attachMode: true,
      wsClientCount: 1,
      agentKind: nodeConfig.role,
      workflowMode: 'wf-max',
      cwd: nodeConfig.cwd,
      graphNodeId,
      config: nodeConfig,
      inputOwnerId: 'drawer',
    }],
    nodes: [{
      id: graphNodeId,
      label: 'Skills Agent',
      kind: 'terminal-session',
      level: 0,
      status: 'running',
      lifecycle: 'live',
      runtimeState: 'running',
      managedByCurrentServer: true,
      control: control(),
      role: nodeConfig.role,
      skills: nodeConfig.skills,
      permissions: nodeConfig.permissions,
      sessionId,
      taskId: 'task-ac004-drag',
      agentKind: nodeConfig.role,
      runtime: 'codex',
      peerId: 'codex',
      objective: nodeConfig.prompt,
      cwd: nodeConfig.cwd,
      graphNodeId,
      config: nodeConfig,
    }, ...capabilityNodes],
    edges: [],
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-skills-hub',
      version: 1,
      nodes: [{
        nodeId: graphNodeId,
        sessionId,
        agentKind: nodeConfig.role,
        runtime: 'codex',
        status: 'running',
        lifecycle: 'live',
        runtimeState: 'running',
        managedByCurrentServer: true,
        control: control(),
        taskId: 'task-ac004-drag',
        cwd: nodeConfig.cwd,
        position: { x: 520, y: 180 },
        config: nodeConfig,
      }, ...capabilityNodes.map(node => ({
        nodeId: node.id,
        kind: 'capability-node',
        type: node.type,
        status: 'ready',
        lifecycle: 'capability-provider',
        runtimeState: 'ready',
        managedByCurrentServer: true,
        control: control(),
        position: node.position,
        statePath: node.statePath,
        revision: node.revision,
        stateRef: { path: node.statePath, revision: node.revision },
      }))],
      edges: [],
      positions: {
        [graphNodeId]: { x: 520, y: 180 },
        ...Object.fromEntries(capabilityNodes.map(node => [node.id, node.position])),
      },
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
      componentStatePath: 'Harness/a2a/component-nodes',
      sourceOfTruth: 'backend',
      componentStateRefs: {},
      eventStateRefs: {},
      capabilityStateRefs,
      goalStateRefs: {},
    },
    componentNodes: {},
    eventNodes: {},
    capabilityNodes: Object.fromEntries(capabilities.map(state => [state.nodeId, state])),
    goalNodes: {},
    graphContextBySessionId: {
      [sessionId]: {
        workflowMapPath: 'Harness/a2a/workflow-map.json',
        componentStatePath: 'Harness/a2a/component-nodes',
        sourceOfTruth: 'backend',
        componentStateRefs: {},
        eventStateRefs: {},
        capabilityStateRefs,
        goalStateRefs: {},
      },
    },
  };
}

async function installWorkflowFixture(page: Page): Promise<{
  network: HarnessNetwork;
  capabilities: Map<string, JsonRecord>;
}> {
  const network: HarnessNetwork = {
    skillGroupCreateRequests: [],
    skillsHubRequests: [],
    pageErrors: [],
    failedResponses: [],
  };
  const capabilities = new Map<string, JsonRecord>();
  let graphVersion = 1;

  page.on('pageerror', error => network.pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('/favicon.ico')) {
      network.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  const currentSnapshot = () => workflowSnapshot([...capabilities.values()]);

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, {
    taskId: 'task-ac004-drag',
    phase: 'ac004',
    gate: 'TEST-GATE',
  }));
  await page.route('**/api/runtimes**', route => jsonResponse(route, [{
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    path: 'codex',
    version: 'test',
    status: 'available',
    launchable: true,
    adapterStatus: 'ok',
    capabilities: ['terminal'],
  }]));
  await page.route('**/api/tasks**', route => jsonResponse(route, [{
    taskId: 'task-ac004-drag',
    status: 'open',
    phase: 'ac004',
  }]));
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, currentSnapshot()));
  await page.route('**/api/a2a/graph-map**', async route => {
    if (route.request().method() === 'PUT' || route.request().method() === 'POST') {
      graphVersion += 1;
    }
    const snapshot = currentSnapshot();
    snapshot.graph.version = graphVersion;
    return jsonResponse(route, {
      ok: true,
      revision: graphVersion,
      graph: snapshot.graph,
      sourceOfTruth: 'backend',
    });
  });
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, currentSnapshot().sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, {
    entries: [{ seq: 1, stream: 'stdout', data: '\r\nSkills hub fixture ready\r\n' }],
  }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/workspace/tree**', route => {
    const url = new URL(route.request().url());
    const relPath = url.searchParams.get('path') || '';
    return jsonResponse(route, {
      root: repoRoot,
      path: relPath,
      entries: relPath
        ? []
        : [
            { name: 'src', path: 'src', type: 'directory', size: 0, hasChildren: true },
            { name: 'Harness', path: 'Harness', type: 'directory', size: 0, hasChildren: true },
            { name: 'package.json', path: 'package.json', type: 'file', size: 820, hasChildren: false },
          ],
    });
  });
  await page.route('**/api/workflow/skills-hub**', route => {
    network.skillsHubRequests.push(route.request().url());
    return jsonResponse(route, skillsHubPayload());
  });
  await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, async route => {
    if (route.request().method() === 'GET') {
      return jsonResponse(route, {
        ok: true,
        nodes: [...capabilities.values()].map(state => capabilityRuntimeNode(state)),
      });
    }
    const payload = route.request().postDataJSON() as JsonRecord;
    network.skillGroupCreateRequests.push(payload);
    const nodeId = `capability-skill-group-e2e-${network.skillGroupCreateRequests.length}`;
    const skills = Array.isArray(payload.skills) ? payload.skills.map((skill: JsonRecord) => ({
      id: String(skill.id || ''),
      name: String(skill.name || skill.id || ''),
      title: String(skill.title || skill.name || skill.id || ''),
      description: String(skill.description || ''),
      source: String(skill.source || 'skills-hub'),
      state: String(skill.state || 'indexed'),
    })) : [];
    const state = capabilityStateFixture(
      nodeId,
      String(payload.title || 'Skill Group'),
      skills,
      payload.sourceGroup || { id: `drop:${payload.title}`, label: payload.title, kind: 'local' },
      payload.position || { x: 300, y: 300 },
    );
    capabilities.set(nodeId, state);
    return jsonResponse(route, {
      ok: true,
      node: capabilityRuntimeNode(state),
      state,
      revision: state.revision,
    }, 201);
  });
  await page.route(/\/api\/workflow\/nodes\/.+/, async route => {
    const url = new URL(route.request().url());
    const nodeId = url.pathname.split('/').filter(Boolean)[3] || '';
    if (route.request().method() === 'GET') {
      const state = capabilities.get(nodeId);
      if (state) {
        return jsonResponse(route, {
          ok: true,
          node: capabilityRuntimeNode(state),
          state,
          revision: state.revision,
        });
      }
      return jsonResponse(route, { ok: true, node: null });
    }
    return jsonResponse(route, { ok: true });
  });

  return { network, capabilities };
}

async function openWorkflow(page: Page) {
  await page.goto('/workflow');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-node').first()).toBeVisible();
  // The drop handler converts client coordinates through the flow viewport, so
  // wait until ReactFlow is initialized and the canvas has settled.
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-wf-browser-ready', 'true');
}

async function openSkillsHub(page: Page) {
  await page.getByTestId('workflow-open-skills-overlay').click();
  const overlay = page.getByTestId('workflow-skills-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('data-mode', 'hub');
  return overlay;
}

/** Stage the given skills on the Installed tab and wait for the draft bar. */
async function composeDraft(page: Page, skillIds: string[]) {
  const overlay = page.getByTestId('workflow-skills-overlay');
  for (const skillId of skillIds) {
    const toggle = overlay.locator(`[data-testid="workflow-skills-overlay-skill-toggle"][data-skill-id="${skillId}"]`);
    await expect(toggle).toBeVisible();
    await toggle.click();
  }
  await expect(overlay.locator(`[data-testid="workflow-skills-overlay-draft-bar"][data-draft-count="${skillIds.length}"]`)).toBeVisible();
  await expect(overlay.locator(`[data-testid="workflow-skills-overlay-draft-chip"][data-draft-count="${skillIds.length}"]`)).toBeVisible();
}

/**
 * AC-004 drag simulation. Playwright's page.dragAndDrop cannot attach a custom
 * DataTransfer payload, so synthesize real drag events in the page:
 * 1. dragstart on the draft chip with a DataTransfer holding the
 *    'application/x-harness-skill-group' payload (the app re-writes it from its
 *    own draft state in its onDragStart handler);
 * 2. dragover + drop on the .react-flow__pane with the SAME DataTransfer
 *    (WorkflowRoute attaches onDrop to the ReactFlow root / wf-canvas-shell, so
 *    a bubbling drop from the pane reaches the handler);
 * 3. a window 'dragend' afterwards, mirroring the end of a real drag sequence.
 * Returns whether the drop was dispatched.
 */
async function simulateChipDrag(
  page: Page,
  payload: { skillIds: string[]; label: string },
  options: { drop?: boolean } = {},
): Promise<void> {
  const drop = options.drop !== false;
  await page.evaluate(({ payload, drop }) => {
    const chip = document.querySelector('[data-testid="workflow-skills-overlay-draft-chip"]');
    if (!(chip instanceof HTMLElement)) throw new Error('draft chip not found');
    const pane = document.querySelector('.react-flow__pane') || document.querySelector('[data-testid="workflow-canvas"]');
    if (!(pane instanceof HTMLElement)) throw new Error('canvas pane not found');
    const rect = pane.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const dt = new DataTransfer();
    dt.setData('application/x-harness-skill-group', JSON.stringify(payload));
    chip.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX,
      clientY,
    }));
    if (!drop) return;
    pane.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX,
      clientY,
    }));
    pane.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt,
      clientX,
      clientY,
    }));
  }, { payload, drop });
  if (drop) {
    await page.evaluate(() => {
      window.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }));
    });
  }
}

test.describe('WF UI AC-004 skills-hub to canvas drag', () => {
  test('AC-004 composes two skills and drops the draft chip onto the canvas, creating a skill-group node', async ({ page }) => {
    const { network } = await installWorkflowFixture(page);
    await openWorkflow(page);
    await openSkillsHub(page);
    await composeDraft(page, [alphaSkillId, betaSkillId]);

    await simulateChipDrag(page, { skillIds: [alphaSkillId, betaSkillId], label: draftLabel });

    // The drop path POSTs /api/workflow/nodes with a skill-group payload built
    // from the chip transfer: skill ids + the composed label.
    await expect.poll(() => network.skillGroupCreateRequests.length).toBe(1);
    expect(network.skillGroupCreateRequests[0]).toEqual(expect.objectContaining({
      type: 'skill-group',
      title: draftLabel,
      description: '2 skills from Skills Hub',
      skills: expect.arrayContaining([
        expect.objectContaining({ id: alphaSkillId, name: 'alpha', title: 'Alpha Skill' }),
        expect.objectContaining({ id: betaSkillId, name: 'beta', title: 'Beta Skill' }),
      ]),
    }));

    // The created node renders as a skill-group capability node showing the
    // composed label and the skill count; the loading placeholder is gone.
    const node = page.locator('[data-testid="workflow-capability-node"][data-capability-type="skill-group"][data-skill-count="2"]');
    await expect(node).toBeVisible();
    await expect(node).toContainText(draftLabel);
    await expect(page.getByTestId('workflow-node-loading-placeholder')).toHaveCount(0);

    // The overlay stays closed: the drop cleared the draft-drag flag before the
    // trailing window dragend, so the dragend must NOT reopen the hub.
    await expect(page.locator('.wf-canvas-shell')).toHaveAttribute('data-skills-overlay-open', 'false');
    await expect(page.getByTestId('workflow-skills-overlay')).toHaveCount(0);

    expect(network.pageErrors, 'page errors').toEqual([]);
  });

  test('AC-004 a canceled chip drag (dragstart without drop) reopens the hub with the draft intact', async ({ page }) => {
    const { network } = await installWorkflowFixture(page);
    await openWorkflow(page);
    await openSkillsHub(page);
    await composeDraft(page, [alphaSkillId, betaSkillId]);

    // Drag starts but no drop lands. The overlay stays MOUNTED but hidden
    // (hidden prop -> visibility:hidden + pointer-events:none backdrop) so the
    // composed draft survives; skillsOverlay.open is still true, hence
    // data-skills-overlay-open stays 'true'. The window dragend then restores
    // the overlay visibly with the draft intact.
    await simulateChipDrag(page, { skillIds: [alphaSkillId, betaSkillId], label: draftLabel }, { drop: false });
    const overlay = page.getByTestId('workflow-skills-overlay');
    await expect(page.locator('.wf-canvas-shell')).toHaveAttribute('data-skills-overlay-open', 'true');
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toHaveCSS('visibility', 'hidden');

    await page.evaluate(() => {
      window.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }));
    });

    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('data-mode', 'hub');
    await expect(overlay.locator('[data-testid="workflow-skills-overlay-draft-bar"][data-draft-count="2"]')).toBeVisible();
    await expect(overlay.locator('[data-testid="workflow-skills-overlay-draft-chip"][data-draft-count="2"]')).toBeVisible();

    // No node was created by the canceled gesture.
    expect(network.skillGroupCreateRequests).toEqual([]);
    expect(network.pageErrors, 'page errors').toEqual([]);
  });

  test('AC-004 a failed skill-group create reopens the hub with the draft intact', async ({ page }) => {
    const { network } = await installWorkflowFixture(page);
    // Override the create endpoint AFTER the fixture so this route wins: any
    // skill-group create fails; the list GET stays harmless. Record the POST
    // payload into the network log here (the fixture's recording route is
    // shadowed by this override).
    await page.route(/\/api\/workflow\/nodes(?:\?.*)?$/, async route => {
      if (route.request().method() === 'GET') {
        return jsonResponse(route, { ok: true, nodes: [] });
      }
      const payload = route.request().postDataJSON() as JsonRecord;
      if (payload?.type === 'skill-group') {
        network.skillGroupCreateRequests.push(payload);
        return jsonResponse(route, {
          ok: false,
          code: 'CREATE_FAILED',
          message: 'Skill group create failed',
        }, 500);
      }
      return jsonResponse(route, { ok: true, node: { nodeId: `unused-${Date.now()}` } }, 201);
    });
    await openWorkflow(page);
    await openSkillsHub(page);
    await composeDraft(page, [alphaSkillId, betaSkillId]);

    await simulateChipDrag(page, { skillIds: [alphaSkillId, betaSkillId], label: draftLabel });

    // The failed create must NOT eat the draft: the hub reopens with both
    // skills still staged so the user can retry the drag.
    const overlay = page.getByTestId('workflow-skills-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('data-mode', 'hub');
    await expect(overlay.locator('[data-testid="workflow-skills-overlay-draft-bar"][data-draft-count="2"]')).toBeVisible();
    await expect(overlay.locator('[data-testid="workflow-skills-overlay-draft-chip"][data-draft-count="2"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-capability-node"]')).toHaveCount(0);

    expect(network.skillGroupCreateRequests, 'create attempt recorded').toHaveLength(1);
    expect(network.pageErrors, 'page errors').toEqual([]);
  });
});
