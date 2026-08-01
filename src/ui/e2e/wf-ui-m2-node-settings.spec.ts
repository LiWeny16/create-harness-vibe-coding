import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const token = process.env.WF_UI_E2E_TOKEN || 'playwright-m1-red';
const repoRoot = process.env.WF_UI_E2E_PROJECT_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sessionId = 'e2e-session-m2';
const graphNodeId = 'e2e-node-m2';

type JsonRecord = Record<string, any>;

type HarnessNetwork = {
  configPatchRequests: JsonRecord[];
  restartRequests: JsonRecord[];
  workspaceTreeRequests: string[];
  pageErrors: string[];
  failedResponses: string[];
};

const baseNodeConfig = {
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

function workflowSnapshot(config: JsonRecord = baseNodeConfig) {
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: '2026-08-01T00:00:00.000Z',
    workflowId: 'e2e-workflow-m2',
    taskId: 'task-define-workflow-context-surface',
    mode: 'wf-max',
    phase: 'planning-dgate',
    gate: 'TEST-GATE',
    rootAgentId: graphNodeId,
    availableWorkflows: [{ id: 'wf-max', command: '/wf-max', label: 'WF-MAX' }],
    subagentModes: [{ id: 'none', label: 'None' }],
    roles: { nodes: [], edges: [] },
    queues: { acceptance: [], dependsOn: [], blocks: [] },
    sessions: [{
      sessionId,
      runtime: 'codex',
      role: config.role,
      objective: config.prompt,
      status: 'running',
      attachMode: true,
      wsClientCount: 1,
      agentKind: config.role,
      workflowMode: 'wf-max',
      cwd: config.cwd,
      graphNodeId,
      config,
      inputOwnerId: 'drawer',
    }],
    nodes: [{
      id: graphNodeId,
      label: 'M2 Agent',
      kind: 'terminal-session',
      level: 0,
      status: 'running',
      lifecycle: 'live',
      runtimeState: 'running',
      managedByCurrentServer: true,
      control: control(),
      role: config.role,
      skills: config.skills,
      permissions: config.permissions,
      sessionId,
      taskId: 'task-define-workflow-context-surface',
      agentKind: config.role,
      runtime: 'codex',
      peerId: 'codex',
      objective: config.prompt,
      cwd: config.cwd,
      graphNodeId,
      config,
    }],
    edges: [],
    graph: {
      schemaVersion: 1,
      workflowId: 'e2e-workflow-m2',
      version: 1,
      nodes: [{
        nodeId: graphNodeId,
        sessionId,
        agentKind: config.role,
        runtime: 'codex',
        status: 'running',
        lifecycle: 'live',
        runtimeState: 'running',
        managedByCurrentServer: true,
        control: control(),
        taskId: 'task-define-workflow-context-surface',
        cwd: config.cwd,
        position: { x: 520, y: 180 },
        config,
      }],
      edges: [],
      positions: { [graphNodeId]: { x: 520, y: 180 } },
      undoStack: [],
      redoStack: [],
      graphContextPath: 'Harness/a2a/workflow-map.json',
    },
    graphContextBySessionId: {},
  };
}

function workspaceEntries(relPath: string) {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const table: Record<string, unknown[]> = {
    '': [
      { name: 'src', path: 'src', type: 'directory', size: 0, hasChildren: true },
      { name: 'Harness', path: 'Harness', type: 'directory', size: 0, hasChildren: true },
      { name: 'package.json', path: 'package.json', type: 'file', size: 820, hasChildren: false },
    ],
  };
  return table[normalized] || [];
}

function isLaunchAffecting(payload: JsonRecord) {
  return ['model', 'provider', 'cwd', 'env', 'permissions', 'launchPolicy'].some(key => key in payload);
}

async function installWorkflowFixture(page: Page): Promise<HarnessNetwork> {
  const network: HarnessNetwork = {
    configPatchRequests: [],
    restartRequests: [],
    workspaceTreeRequests: [],
    pageErrors: [],
    failedResponses: [],
  };

  page.on('pageerror', error => network.pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && !response.url().includes('/favicon.ico')) {
      network.failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.route('**/api/debug/report', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/settings', route => jsonResponse(route, { ui: { theme: 'light' } }));
  await page.route('**/api/workflow', route => jsonResponse(route, {
    taskId: 'task-define-workflow-context-surface',
    phase: 'planning-dgate',
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
    taskId: 'task-define-workflow-context-surface',
    status: 'open',
    phase: 'planning-dgate',
  }]));
  await page.route('**/api/a2a/snapshot**', route => jsonResponse(route, workflowSnapshot()));
  await page.route('**/api/a2a/graph-map**', route => jsonResponse(route, { ok: true, revision: 2 }));
  await page.route('**/api/sessions?all=1**', route => jsonResponse(route, workflowSnapshot().sessions));
  await page.route('**/api/terminals/**/range**', route => jsonResponse(route, {
    entries: [{ seq: 1, stream: 'stdout', data: '\r\nM2 terminal fixture ready\r\n' }],
  }));
  await page.route('**/api/sessions/**/attach-mode', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/sessions/**/input', route => jsonResponse(route, { ok: true }));
  await page.route('**/api/workspace/tree**', route => {
    const url = new URL(route.request().url());
    const relPath = url.searchParams.get('path') || '';
    network.workspaceTreeRequests.push(relPath);
    return jsonResponse(route, {
      root: repoRoot,
      path: relPath,
      entries: workspaceEntries(relPath),
    });
  });
  await page.route(`**/api/a2a/nodes/${graphNodeId}/config`, async route => {
    const payload = route.request().postDataJSON() as JsonRecord;
    network.configPatchRequests.push({
      method: route.request().method(),
      url: route.request().url(),
      payload,
    });
    return jsonResponse(route, {
      ok: true,
      node: {
        id: graphNodeId,
        config: { ...baseNodeConfig, ...payload },
      },
      restartRequired: isLaunchAffecting(payload),
      revision: network.configPatchRequests.length + 1,
    });
  });
  await page.route(`**/api/a2a/nodes/${graphNodeId}/restart`, async route => {
    const payload = route.request().postDataJSON() as JsonRecord || {};
    network.restartRequests.push({
      method: route.request().method(),
      url: route.request().url(),
      payload,
    });
    return jsonResponse(route, {
      ok: true,
      nodeId: graphNodeId,
      sessionId: `${sessionId}-restarted`,
      restartRequired: false,
      revision: 10,
    });
  });

  return network;
}

async function openWorkflow(page: Page) {
  await page.goto(`/workflow?token=${encodeURIComponent(token)}`);
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-node').first()).toBeVisible();
}

async function openNodeSettings(page: Page) {
  const node = page.getByTestId('workflow-node').first();
  await expect(node).toBeVisible();
  await node.click();
  await node.dblclick();
  await expect(page.getByTestId('workflow-node-settings')).toBeVisible();
}

async function expectLabeledControl(page: Page, testId: string, label: RegExp) {
  const control = page.getByTestId(testId);
  await expect(control).toBeVisible();
  await expect(page.getByLabel(label)).toBeVisible();
}

async function expectTooltip(page: Page, testId: string) {
  const tip = page.getByTestId(`${testId}-tip`);
  await expect(tip).toBeVisible();
  await tip.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
}

async function setControlValue(control: Locator, value: string) {
  const tagName = await control.evaluate(element => element.tagName.toLowerCase());
  if (tagName === 'select') {
    await control.selectOption(value);
    return;
  }
  const role = await control.getAttribute('role');
  if (role === 'combobox') {
    await control.click();
    await control.fill(value);
    await control.press('Enter');
    return;
  }
  await control.fill(value);
}

async function expectPanelInViewport(page: Page, panel: Locator) {
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

async function expectControlsDoNotOverflow(page: Page, panel: Locator, testIds: string[]) {
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  for (const testId of testIds) {
    const control = page.getByTestId(testId);
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box, `${testId} should have layout bounds`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(panelBox!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
    expect(box!.height, `${testId} should not collapse`).toBeGreaterThan(16);
  }
}

test.describe('WF UI M2 RED node settings acceptance', () => {
  test('AC-005 opens the new settings surface with labeled controls, tooltips, canvas isolation, and M1 controls still visible', async ({ page }) => {
    await installWorkflowFixture(page);
    await openWorkflow(page);

    await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
    await openNodeSettings(page);

    const panel = page.getByTestId('workflow-node-settings');
    await expect(panel).toHaveAttribute('data-canvas-control', 'true');
    await expect(panel).toHaveClass(/nodrag/);
    await expect(panel).toHaveClass(/nopan/);
    await expect(panel).toHaveClass(/nowheel/);
    await expect(page.getByTestId('workflow-node-config')).toHaveCount(0);

    const controls: Array<[string, RegExp]> = [
      ['workflow-node-setting-role', /^role$/i],
      ['workflow-node-setting-custom-role', /custom role/i],
      ['workflow-node-setting-prompt', /prompt|objective/i],
      ['workflow-node-setting-model', /model/i],
      ['workflow-node-setting-provider', /provider/i],
      ['workflow-node-setting-cwd', /cwd|working directory/i],
      ['workflow-node-setting-env', /env|environment/i],
      ['workflow-node-setting-permissions', /permissions/i],
      ['workflow-node-setting-launch-policy', /launch policy/i],
      ['workflow-node-setting-skills', /skills/i],
      ['workflow-node-setting-skill-policy', /skill policy/i],
      ['workflow-node-setting-context-sources', /context sources/i],
      ['workflow-node-setting-capabilities', /capabilities/i],
    ];
    for (const [testId, label] of controls) {
      await expectLabeledControl(page, testId, label);
      await expectTooltip(page, testId);
    }

    await expect(page.getByTestId('workflow-node-settings-save')).toBeVisible();
    await expect(page.getByTestId('workflow-node-restart')).toBeVisible();
    await expect(page.getByTestId('workflow-node-settings-search')).toBeVisible();
    await expect(page.getByTestId('workflow-node-settings-nav')).toBeVisible();
    await expect(page.getByTestId('workflow-node-cwd-picker')).toBeVisible();
    await expect(page.getByTestId('workflow-node-permission-mode')).toBeVisible();
    await expect(page.getByTestId('workflow-node-launch-policy')).toBeVisible();
    await expect(page.getByTestId('workflow-node-markdown-output-toggle')).toBeVisible();
    await expect(page.getByTestId('workflow-node-markdown-output-target')).toBeVisible();
    await expect(page.getByTestId('workflow-node-setting-permissions').locator('textarea')).toHaveCount(0);
    await expect(page.getByTestId('workflow-node-setting-launch-policy').locator('textarea')).toHaveCount(0);
    await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
    await expect(page.getByTestId('terminal-input-owner')).toBeVisible();
  });

  test('AC-005 saves non-launch edits through PATCH without marking restart-required', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);
    await openNodeSettings(page);

    await setControlValue(page.getByTestId('workflow-node-setting-role'), 'reviewer');
    await setControlValue(page.getByTestId('workflow-node-setting-custom-role'), 'Security Review Lead');
    await setControlValue(page.getByTestId('workflow-node-setting-prompt'), 'Review the workflow map and report only risks.');
    await page.getByTestId('workflow-node-skill-policy-manual').click();
    await page.getByTestId('workflow-node-skill-add-input').fill('wf-review');
    await page.getByTestId('workflow-node-skill-add').click();
    await page.getByTestId('workflow-node-context-source-task-capsule').click();
    await page.getByTestId('workflow-node-capability-review-only').click();
    await page.getByTestId('workflow-node-settings-save').click();

    await expect.poll(() => network.configPatchRequests.length).toBe(1);
    expect(network.configPatchRequests[0]).toEqual(expect.objectContaining({
      method: 'PATCH',
      payload: expect.objectContaining({
        role: 'reviewer',
        customRole: 'Security Review Lead',
        prompt: 'Review the workflow map and report only risks.',
        skills: expect.arrayContaining(['wf-review']),
        skillPolicy: 'manual',
        contextSources: expect.arrayContaining(['task-capsule']),
        capabilities: expect.arrayContaining(['review-only']),
      }),
    }));
    await expect(page.getByTestId('workflow-node-saved-state')).toContainText(/saved/i);
    await expect(page.getByTestId('workflow-node-restart-required')).toBeHidden();
  });

  test('AC-005 launch-affecting edits show restart-required, post restart, and clear after success', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);
    await openNodeSettings(page);

    await setControlValue(page.getByTestId('workflow-node-setting-model'), 'gpt-5.1-codex');
    await setControlValue(page.getByTestId('workflow-node-setting-provider'), 'openai-compatible');
    await setControlValue(page.getByTestId('workflow-node-setting-cwd'), path.join(repoRoot, 'src'));
    await setControlValue(page.getByTestId('workflow-node-setting-env'), JSON.stringify({ NODE_ENV: 'test' }, null, 2));
    await page.getByTestId('workflow-node-permission-mode').selectOption('full-access');
    await page.getByTestId('workflow-node-launch-auto-start').check();
    await page.getByTestId('workflow-node-launch-restart-on-save').uncheck();

    await expect(page.getByTestId('workflow-node-restart-required')).toBeVisible();
    await expect(page.getByTestId('workflow-node-restart')).toBeEnabled();
    await page.getByTestId('workflow-node-settings-save').click();

    await expect.poll(() => network.configPatchRequests.length).toBe(1);
    expect(network.configPatchRequests[0]).toEqual(expect.objectContaining({
      method: 'PATCH',
      payload: expect.objectContaining({
        model: 'gpt-5.1-codex',
        provider: 'openai-compatible',
        cwd: path.join(repoRoot, 'src'),
        env: { NODE_ENV: 'test' },
        permissions: expect.objectContaining({ filesystem: 'full-access' }),
        launchPolicy: expect.objectContaining({
          autoStart: true,
          restartOnSave: false,
          sandboxMode: 'danger-full-access',
          approvalPolicy: 'never',
        }),
      }),
    }));

    await page.getByTestId('workflow-node-restart').click();
    await expect.poll(() => network.restartRequests.length).toBe(1);
    expect(network.restartRequests[0]).toEqual(expect.objectContaining({
      method: 'POST',
    }));
    expect(network.restartRequests[0].url).toContain(`/api/a2a/nodes/${graphNodeId}/restart`);
    await expect(page.getByTestId('workflow-node-restart-required')).toBeHidden();
  });

  test('AC-005 skill selector supports auto recommendations, manual add/remove, and locked immutable mode', async ({ page }) => {
    await installWorkflowFixture(page);
    await openWorkflow(page);
    await openNodeSettings(page);

    await expect(page.getByTestId('workflow-node-skill-policy-auto')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="workflow-node-recommended-skill-chip"][data-skill-id="wf-browser"]')).toBeVisible();
    await expect(page.locator('[data-testid="workflow-node-skill-chip"][data-skill-id="tdd"]')).toBeVisible();
    await expect(page.getByTestId('workflow-node-skill-add-input')).toBeEnabled();

    await page.getByTestId('workflow-node-skill-policy-manual').click();
    await expect(page.getByTestId('workflow-node-skill-add-input')).toBeEnabled();
    await page.getByTestId('workflow-node-skill-add-input').fill('wf-review');
    await page.getByTestId('workflow-node-skill-add').click();
    await expect(page.locator('[data-testid="workflow-node-skill-chip"][data-skill-id="wf-review"]')).toBeVisible();
    await page.locator('[data-testid="workflow-node-skill-chip"][data-skill-id="wf-review"] [data-testid="workflow-node-skill-remove"]').click();
    await expect(page.locator('[data-testid="workflow-node-skill-chip"][data-skill-id="wf-review"]')).toHaveCount(0);

    await page.getByTestId('workflow-node-skill-policy-locked').click();
    await expect(page.getByTestId('workflow-node-skills-locked')).toBeVisible();
    await expect(page.getByTestId('workflow-node-skill-add-input')).toBeDisabled();
    await expect(page.locator('[data-testid="workflow-node-skill-chip"] [data-testid="workflow-node-skill-remove"]')).toHaveCount(0);
  });

  test('AC-004 Markdown default output routing is configurable without raw JSON or restart', async ({ page }) => {
    const network = await installWorkflowFixture(page);
    await openWorkflow(page);
    await openNodeSettings(page);

    await page.getByTestId('workflow-node-markdown-output-toggle').check();
    await page.getByTestId('workflow-node-markdown-output-target').selectOption('');
    await page.getByTestId('workflow-node-settings-save').click();

    await expect.poll(() => network.configPatchRequests.length).toBe(1);
    expect(network.configPatchRequests[0]).toEqual(expect.objectContaining({
      method: 'PATCH',
      payload: expect.objectContaining({
        outputRouting: expect.objectContaining({
          markdownDefaultEnabled: true,
          markdownTargetNodeId: '',
          fallback: 'oldest-connected-markdown',
        }),
      }),
    }));
    await expect(page.getByTestId('workflow-node-restart-required')).toBeHidden();
  });

  test('AC-005 settings panel remains tidy at desktop and narrow viewport without hiding M1 Explorer or terminal owner state', async ({ page }) => {
    await installWorkflowFixture(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await openWorkflow(page);
    await openNodeSettings(page);

    const panel = page.getByTestId('workflow-node-settings');
    const controlIds = [
      'workflow-node-setting-role',
      'workflow-node-setting-custom-role',
      'workflow-node-setting-prompt',
      'workflow-node-setting-model',
      'workflow-node-setting-provider',
      'workflow-node-setting-cwd',
      'workflow-node-setting-env',
      'workflow-node-setting-permissions',
      'workflow-node-setting-launch-policy',
      'workflow-node-settings-search',
      'workflow-node-settings-nav',
      'workflow-node-cwd-picker',
      'workflow-node-permission-mode',
      'workflow-node-launch-policy',
      'workflow-node-markdown-output-toggle',
      'workflow-node-markdown-output-target',
      'workflow-node-setting-skills',
      'workflow-node-setting-skill-policy',
      'workflow-node-setting-context-sources',
      'workflow-node-setting-capabilities',
    ];

    await expectPanelInViewport(page, panel);
    await expectControlsDoNotOverflow(page, panel, controlIds);
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);

    await page.setViewportSize({ width: 390, height: 820 });
    await expect(panel).toBeVisible();
    await expectPanelInViewport(page, panel);
    await expectControlsDoNotOverflow(page, panel, controlIds);
    await expect(page.getByTestId('workflow-explorer-shell')).toBeVisible();
    await expect(page.getByTestId('terminal-input-owner')).toBeVisible();
    await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
  });
});
