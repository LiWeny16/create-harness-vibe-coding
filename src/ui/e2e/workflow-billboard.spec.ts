import { expect, test, type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionRegistry } from '../../wf-ui-server/session-registry.mjs';
import { startServer, stopServer } from '../../wf-ui-server/server.mjs';

type JsonRecord = Record<string, any>;
type TestBackend = {
  baseUrl: string;
  token: string;
  server: any;
};

let backend: TestBackend | null = null;
let projectRoot = '';
let markdownNodeId = '';

async function apiJson(method: string, route: string, payload?: unknown) {
  if (!backend) throw new Error('Billboard test backend is not running');
  const response = await fetch(backend.baseUrl + route, {
    method,
    headers: {
      Authorization: 'Bearer ' + backend.token,
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return { status: response.status, body: await response.json() as JsonRecord };
}

async function forwardToTestBackend(route: Route) {
  if (!backend) throw new Error('Billboard test backend is not running');
  const request = route.request();
  const url = new URL(request.url());
  const headers = {
    ...request.headers(),
    authorization: 'Bearer ' + backend.token,
  };
  const response = await route.fetch({
    url: backend.baseUrl + url.pathname + url.search,
    headers,
  });
  await route.fulfill({ response });
}

test.beforeAll(async () => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-agent-billboard-ui-'));
  const taskDir = path.join(projectRoot, 'Harness', 'tasks', 'task-agent-billboard-context');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'Harness', 'PROGRESS.md'),
    '# Progress\n\n## Active Task\n\n- task-agent-billboard-context\n',
  );
  fs.writeFileSync(path.join(taskDir, 'STATE.json'), JSON.stringify({
    schemaVersion: 1,
    taskId: 'task-agent-billboard-context',
    status: 'active',
    mode: 'wf',
    phase: 'red',
    acceptance: [],
    links: { dependsOn: [], blocks: [] },
  }, null, 2) + '\n');

  const started = await startServer({
    projectRoot,
    host: '127.0.0.1',
    port: 0,
    sessionRegistry: new SessionRegistry(),
  });
  backend = {
    baseUrl: 'http://127.0.0.1:' + started.port,
    token: started.token,
    server: started.server,
  };
  const normal = await apiJson('POST', '/api/workflow/nodes', {
    type: 'markdown',
    title: 'Normal Markdown',
    markdown: '# Existing editor\n',
    position: { x: 260, y: 420 },
  });
  if (normal.status !== 201) throw new Error('Failed to seed normal Markdown node: ' + JSON.stringify(normal.body));
  markdownNodeId = normal.body.node.nodeId;
});

test.afterAll(async () => {
  if (backend) await stopServer(backend.server);
  if (!projectRoot) return;
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (
    path.dirname(resolvedRoot) === resolvedTemp
    && path.basename(resolvedRoot).startsWith('wf-agent-billboard-ui-')
  ) {
    fs.rmSync(resolvedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  backend = null;
  projectRoot = '';
});

async function openWorkflow(page: Page) {
  await page.route('**/api/**', forwardToTestBackend);
  await page.goto('/workflow');
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('workflow-component-node').first()).toBeVisible();
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-wf-browser-ready', 'true');
}

test('AC-003 create Billboard in the resource picker, append with markdown.append, and keep Markdown editor presentation', async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  const apiRequests: Array<{ method: string; pathname: string; body: JsonRecord }> = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/workflow/nodes' || url.pathname.includes('/actions/markdown.append')) {
      apiRequests.push({
        method: request.method(),
        pathname: url.pathname,
        body: (request.postDataJSON() || {}) as JsonRecord,
      });
    }
  });

  await openWorkflow(page);
  const normalMarkdownNode = page.locator('[data-testid="workflow-component-node"][data-node-id="' + markdownNodeId + '"]');
  await expect(normalMarkdownNode).toBeVisible();
  await expect(normalMarkdownNode).toHaveAttribute('data-component-type', 'markdown');
  await expect(page.getByTestId('workflow-markdown-node-editor')).toBeVisible();

  await page.getByTestId('workflow-create-node').click();
  const picker = page.getByTestId('workflow-create-node-panel');
  await expect(picker).toBeVisible();
  const billboardOption = picker.getByTestId('workflow-create-billboard-node');
  await expect(billboardOption).toBeVisible();
  const createResponsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/workflow/nodes' && response.request().method() === 'POST';
  });
  await billboardOption.click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json();

  await expect.poll(() => apiRequests.filter(request => request.method === 'POST' && request.pathname === '/api/workflow/nodes').length).toBe(1);
  const createRequest = apiRequests.find(request => request.method === 'POST' && request.pathname === '/api/workflow/nodes');
  expect(createRequest?.body).toEqual(expect.objectContaining({
    type: 'markdown',
    presentation: 'billboard',
    title: 'Team Billboard',
    position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
  }));

  const createdNodeId = String(created.node?.nodeId || '');
  expect(createdNodeId).toBeTruthy();
  const initialBillboard = page.locator('[data-testid="workflow-billboard-node"][data-node-id="' + createdNodeId + '"]');
  await expect(initialBillboard).toBeVisible();
  await expect(initialBillboard).toContainText('No updates yet');

  const appendText = '- agent-a/Agent A tried the API append; result: shared note visible. avoid: replacing the whole shared board. recommend: use markdown.append.\n- agent-b/Agent B tried a fresh context read; result: the same note is visible. recommend: reuse this finding.\n';
  const append = await page.evaluate(async ({ nodeId, markdown }) => {
    const response = await fetch('/api/workflow/nodes/' + encodeURIComponent(nodeId) + '/actions/markdown.append', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown, expectedRevision: 1 }),
    });
    return { status: response.status, body: await response.json() };
  }, { nodeId: createdNodeId, markdown: appendText });
  expect(append.status).toBe(200);
  expect(append.body.action).toBe('markdown.append');
  expect(apiRequests).toEqual(expect.arrayContaining([
    expect.objectContaining({
      method: 'POST',
      pathname: '/api/workflow/nodes/' + encodeURIComponent(createdNodeId) + '/actions/markdown.append',
    }),
  ]));

  await page.reload();
  await expect(page.getByTestId('workflow-canvas')).toHaveAttribute('data-wf-browser-ready', 'true');
  const billboardNode = page.locator('[data-testid="workflow-billboard-node"][data-node-id="' + createdNodeId + '"]');
  await expect(billboardNode).toBeVisible();
  await expect(billboardNode).toContainText('agent-a/Agent A tried the API append; result: shared note visible.');
  await expect(billboardNode).toContainText('agent-b/Agent B tried a fresh context read; result: the same note is visible.');
  await expect(billboardNode).toHaveAttribute('data-revision', '2');
  await expect(page.getByTestId('workflow-billboard-entry')).toHaveCount(2);
  const fullFirstEntry = appendText.split('\n')[0];
  await expect(page.getByTestId('workflow-billboard-entry').first()).toHaveAttribute('title', fullFirstEntry);
  await expect(page.getByTestId('workflow-billboard-entry').first()).toHaveAttribute('aria-label', fullFirstEntry);
  const billboardBounds = await page.locator('[data-testid="workflow-component-node"][data-node-id="' + createdNodeId + '"]').boundingBox();
  expect(billboardBounds?.height).toBeLessThan(150);
  await expect(normalMarkdownNode).toBeVisible();
  await expect(normalMarkdownNode).toHaveAttribute('data-component-type', 'markdown');
  await expect(page.getByTestId('workflow-markdown-node-editor')).toBeVisible();
  expect(pageErrors, 'page errors').toEqual([]);

  await page.locator('[data-testid="workflow-component-node"][data-node-id="' + createdNodeId + '"]')
    .screenshot({
      path: test.info().outputPath('workflow-billboard-ac-003.png'),
      style: '[data-testid="workflow-explorer-shell"] { display: none !important; }',
    });
});
