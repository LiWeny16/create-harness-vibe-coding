const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const targetUrl = process.env.HARNESS_CDP_URL;
const evidenceDir = process.env.HARNESS_CDP_EVIDENCE;
const externalFile = process.env.HARNESS_CDP_EXTERNAL_FILE;

if (!targetUrl || !evidenceDir || !externalFile) {
  throw new Error('Set HARNESS_CDP_URL, HARNESS_CDP_EVIDENCE, and HARNESS_CDP_EXTERNAL_FILE');
}

const parsedUrl = new URL(targetUrl);
const origin = parsedUrl.origin;
const token = parsedUrl.searchParams.get('token') || '';
const workflowUrl = `${origin}/workflow?token=${encodeURIComponent(token)}`;
const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chromePath = chromeCandidates.find(candidate => fs.existsSync(candidate));

if (!chromePath) throw new Error('Chrome/Edge executable not found');

fs.mkdirSync(evidenceDir, { recursive: true });

let currentPhase = 'boot';
let sendPage = null;

const result = {
  url: workflowUrl.replace(token, '<redacted>'),
  browser: chromePath,
  viewport: { width: 1440, height: 1000 },
  evidenceDir,
  startedAt: new Date().toISOString(),
  checks: {},
  ac: {},
  selectors: {},
  timings: {},
  networkErrors: [],
  runtimeExceptions: [],
  consoleMessages: [],
  graphPuts: [],
  longTasks: [],
  createdNodeIds: [],
  cleanup: [],
  notes: [],
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assert(condition, message, extra) {
  if (condition) return;
  const error = new Error(message);
  error.extra = extra;
  throw error;
}

async function waitForJson(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      last = `${response.status} ${response.statusText}`;
    } catch (error) {
      last = String(error.message || error);
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}: ${last || 'no response'}`);
}

async function httpJson(route, options = {}) {
  const response = await fetch(origin + route, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${route}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function httpDelete(route) {
  try {
    await httpJson(route, { method: 'DELETE' });
    result.cleanup.push({ route, ok: true });
  } catch (error) {
    result.cleanup.push({ route, ok: false, error: String(error.message || error) });
  }
}

function makeCdpSocket(wsUrl) {
  const pending = new Map();
  let nextId = 0;
  const ws = new WebSocket(wsUrl);

  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP websocket open timeout: ${wsUrl}`)), 10000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = reject;
  });

  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    const wait = pending.get(message.id);
    if (!wait) {
      if (ws.__onEvent) ws.__onEvent(message);
      return;
    }
    clearTimeout(wait.timer);
    pending.delete(message.id);
    if (message.error) wait.reject(new Error(`${wait.method}: ${message.error.message}`));
    else wait.resolve(message.result || {});
  };

  return {
    opened,
    ws,
    send(method, params = {}) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout ${method}`));
        }, 15000);
        pending.set(id, { resolve, reject, timer, method });
      });
    },
    onEvent(handler) {
      ws.__onEvent = handler;
    },
  };
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
      last = value;
    } catch (error) {
      last = error.message;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}${last ? ` (${last})` : ''}`);
}

async function evalRaw(expression, awaitPromise = false) {
  const response = await sendPage('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || response.exceptionDetails.exception?.description || expression);
  }
  return response.result?.value;
}

async function evalJson(fnSource, ...args) {
  return await evalRaw(`(${fnSource})(...${JSON.stringify(args)})`, true);
}

async function exists(selector) {
  return !!(await evalJson('sel => !!document.querySelector(sel)', selector));
}

async function text(selector) {
  return await evalJson('sel => document.querySelector(sel)?.textContent || ""', selector);
}

async function bbox(selector) {
  return await evalJson(`sel => {
    const element = document.querySelector(sel);
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const r = element.getBoundingClientRect();
    return {
      x: r.x, y: r.y, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2
    };
  }`, selector);
}

async function pointTop(x, y) {
  return await evalJson(`(x, y) => {
    const element = document.elementFromPoint(x, y);
    if (!element) return null;
    const test = element.closest('[data-testid]');
    return {
      tag: element.tagName,
      testId: test?.getAttribute('data-testid') || '',
      path: test?.getAttribute('data-path') || '',
      text: (element.textContent || '').slice(0, 120),
      className: String(element.className || '')
    };
  }`, x, y);
}

async function mouseClick(x, y, button = 'left', clicks = 1) {
  const buttonName = button === 'right' ? 'right' : 'left';
  const buttons = button === 'right' ? 2 : 1;
  await sendPage('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  for (let i = 1; i <= clicks; i += 1) {
    await sendPage('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: buttonName, buttons, clickCount: i });
    await sendPage('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: buttonName, buttons: 0, clickCount: i });
    if (i < clicks) await sleep(70);
  }
}

async function clickSelector(selector, button = 'left', clicks = 1) {
  const box = await bbox(selector);
  assert(box && box.width > 0 && box.height > 0, `No bbox for ${selector}`, box);
  await mouseClick(box.cx, box.cy, button, clicks);
  return box;
}

async function keyPress(key) {
  const keyCodes = { Escape: 27, Enter: 13, Tab: 9 };
  const windowsVirtualKeyCode = keyCodes[key] || key.toUpperCase().charCodeAt(0);
  await sendPage('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode });
  await sendPage('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode });
}

async function blankCanvasPoint(prefer = { x: 1040, y: 760 }) {
  return await evalJson(`prefer => {
    const pane = document.querySelector('.react-flow__pane') || document.querySelector('[data-testid="workflow-canvas"]');
    const bounds = pane?.getBoundingClientRect();
    const candidates = [
      prefer,
      { x: 1120, y: 820 },
      { x: 930, y: 820 },
      { x: 1200, y: 520 },
      { x: 760, y: 820 },
      { x: 1040, y: 620 }
    ];
    const blocked = [
      '[data-testid="workflow-node"]',
      '[data-testid="workflow-node-terminal"]',
      '[data-testid="workflow-component-node"]',
      '[data-testid="workflow-markdown-node-editor"]',
      '[data-testid="workflow-markdown-source-editor"]',
      '[data-testid="workflow-markdown-rich-editor"]',
      '[data-testid="workflow-excalidraw-node"]',
      '[data-testid="workflow-excalidraw-element"]',
      '[data-testid="workflow-file-node"]',
      '[data-testid="workflow-file-preview"]',
      '[data-testid="workflow-create-node-panel"]',
      '[data-testid="workflow-context-menu"]',
      '[data-testid="workflow-node-context-menu"]',
      '[data-testid="workspace-preview-panel"]',
      '[data-testid="workflow-explorer-shell"]',
      '[data-testid="workflow-bridge-label"]',
      '[data-testid="workflow-node-settings"]',
      '[data-testid="workflow-node-config"]',
      '.react-flow__node',
      '.react-flow__edge',
      '.react-flow__edgelabel-renderer'
    ].join(', ');
    const toPoint = candidate => {
      const x = Math.max((bounds?.left || 0) + 20, Math.min(candidate.x, (bounds?.right || window.innerWidth) - 20));
      const y = Math.max((bounds?.top || 0) + 20, Math.min(candidate.y, (bounds?.bottom || window.innerHeight) - 20));
      return { x, y };
    };
    const isBlank = point => {
      const element = document.elementFromPoint(point.x, point.y);
      if (!element) return false;
      if (element.closest(blocked)) return false;
      return Boolean(element.classList?.contains('react-flow__pane') || element.closest('.react-flow__pane') || element.closest('[data-testid="workflow-canvas"]'));
    };
    for (const candidate of candidates.map(toPoint)) {
      if (isBlank(candidate)) {
        const element = document.elementFromPoint(candidate.x, candidate.y);
        return { x: candidate.x, y: candidate.y, topTestId: element?.closest('[data-testid]')?.getAttribute('data-testid') || '', tag: element?.tagName || '' };
      }
    }
    if (bounds) {
      for (let row = 8; row >= 2; row -= 1) {
        for (let col = 9; col >= 2; col -= 1) {
          const point = {
            x: bounds.left + (bounds.width * col / 10),
            y: bounds.top + (bounds.height * row / 10)
          };
          if (isBlank(point)) {
            const element = document.elementFromPoint(point.x, point.y);
            return { x: point.x, y: point.y, topTestId: element?.closest('[data-testid]')?.getAttribute('data-testid') || '', tag: element?.tagName || '' };
          }
        }
      }
    }
    for (const candidate of candidates.map(toPoint)) {
      const element = document.elementFromPoint(candidate.x, candidate.y);
      if (!element?.closest(blocked)) {
        return { x: candidate.x, y: candidate.y, topTestId: element?.closest('[data-testid]')?.getAttribute('data-testid') || '', tag: element?.tagName || '' };
      }
    }
    const x = (bounds?.left || 0) + (bounds?.width || window.innerWidth) * 0.72;
    const y = (bounds?.top || 0) + (bounds?.height || window.innerHeight) * 0.78;
    const element = document.elementFromPoint(x, y);
    return { x, y, topTestId: element?.closest('[data-testid]')?.getAttribute('data-testid') || '', tag: element?.tagName || '' };
  }`, prefer);
}

function nodeIdsFromSnapshot(snapshot) {
  return new Set((snapshot.nodes || []).map(node => node.nodeId || node.id).filter(Boolean));
}

async function snapshot() {
  return await httpJson('/api/a2a/graph-map');
}

async function newNodeIds(beforeSet) {
  const after = await snapshot();
  return (after.nodes || [])
    .map(node => node.nodeId || node.id)
    .filter(nodeId => nodeId && !beforeSet.has(nodeId));
}

async function closeFloatingPanels() {
  await evalRaw(`
    (() => {
      const clickClose = (rootSelector) => {
        const root = document.querySelector(rootSelector);
        if (!root) return;
        const buttons = Array.from(root.querySelectorAll('button'));
        const close = buttons.find(button => /^(Close|关闭)$/i.test((button.textContent || '').trim()) || /^(Close|关闭)$/i.test(button.getAttribute('title') || ''));
        (close || buttons[0])?.click();
      };
      clickClose('[data-testid="workflow-create-node-panel"]');
      clickClose('[data-testid="workflow-node-settings"]');
      clickClose('[data-testid="workflow-node-config"]');
    })();
    true;
  `, true).catch(() => {});
  await keyPress('Escape').catch(() => {});
  await sleep(150);
}

async function run() {
  const cdpTempRoot = path.resolve('Harness', '.temp', 'cdp-profiles');
  fs.mkdirSync(cdpTempRoot, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(cdpTempRoot, 'harness-cdp-profile-'));
  const remotePort = 9222 + Math.floor(Math.random() * 1000);
  const chrome = childProcess.spawn(chromePath, [
    `--remote-debugging-port=${remotePort}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-dev-shm-usage',
    '--window-size=1440,1000',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    const version = await waitForJson(`http://127.0.0.1:${remotePort}/json/version`, 12000);
    const root = makeCdpSocket(version.webSocketDebuggerUrl);
    await root.opened;
    const target = await root.send('Target.createTarget', { url: 'about:blank', newWindow: false });
    const targets = await waitForJson(`http://127.0.0.1:${remotePort}/json/list`, 10000);
    const pageTarget = targets.find(item => item.id === target.targetId);
    assert(pageTarget?.webSocketDebuggerUrl, 'Could not locate page target websocket');

    const page = makeCdpSocket(pageTarget.webSocketDebuggerUrl);
    await page.opened;
    sendPage = page.send.bind(page);
    page.onEvent(message => {
      if (message.method === 'Runtime.exceptionThrown') {
        result.runtimeExceptions.push(message.params?.exceptionDetails || message.params || {});
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const type = message.params?.type;
        const args = (message.params?.args || [])
          .map(arg => arg.value ?? arg.description ?? arg.unserializableValue ?? '')
          .join(' ');
        if (['error', 'warning', 'assert'].includes(type) || /React error #185|Maximum update depth/.test(args)) {
          result.consoleMessages.push({ type, text: args, timestamp: message.params?.timestamp });
        }
      }
      if (message.method === 'Network.responseReceived') {
        const response = message.params?.response;
        if (response && response.status >= 400) {
          result.networkErrors.push({
            kind: 'response',
            status: response.status,
            url: response.url.replace(token, '<redacted>'),
            mime: response.mimeType,
          });
        }
      }
      if (message.method === 'Network.loadingFailed' && !message.params?.canceled) {
        result.networkErrors.push({
          kind: 'loadingFailed',
          errorText: message.params?.errorText,
          requestId: message.params?.requestId,
        });
      }
      if (message.method === 'Network.requestWillBeSent') {
        const request = message.params?.request;
        if (request?.method === 'PUT' && request.url.includes('/api/a2a/graph-map')) {
          let parsed = null;
          try {
            parsed = JSON.parse(request.postData || '{}');
          } catch {
            parsed = null;
          }
          result.graphPuts.push({
            phase: currentPhase,
            url: request.url.replace(token, '<redacted>'),
            bytes: (request.postData || '').length,
            expectedVersion: parsed?.expectedVersion,
            baseVersion: parsed?.baseVersion,
            undo: Array.isArray(parsed?.undoStack) ? parsed.undoStack.length : null,
            redo: Array.isArray(parsed?.redoStack) ? parsed.redoStack.length : null,
            edges: Array.isArray(parsed?.edges) ? parsed.edges.length : null,
            positions: parsed?.positions ? Object.keys(parsed.positions).length : null,
          });
        }
      }
    });

    await sendPage('Page.enable');
    await sendPage('Runtime.enable');
    await sendPage('Network.enable');
    await sendPage('DOM.enable');
    await sendPage('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sendPage('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.__harnessLongTasks = [];
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              window.__harnessLongTasks.push({
                name: entry.name,
                duration: entry.duration,
                startTime: entry.startTime
              });
            }
          }).observe({ type: 'longtask', buffered: true });
        } catch (error) {
          window.__harnessLongTaskObserverError = String(error && error.message || error);
        }
      `,
    });

    currentPhase = 'navigation';
    const navStarted = Date.now();
    await sendPage('Page.navigate', { url: workflowUrl });
    await waitFor(async () => await exists('[data-testid="workflow-canvas"]'), 20000, 'workflow canvas');
    await waitFor(async () => await exists('[data-testid="workflow-explorer-tree"]'), 20000, 'explorer tree');
    await waitFor(async () => await exists('[data-testid="workspace-tree-item"][data-path="package.json"]'), 20000, 'package.json row');
    result.timings.readyMs = Date.now() - navStarted;

    currentPhase = 'plus-menu';
    const plusBox = await bbox('[data-testid="workflow-create-node"]');
    const plusTop = plusBox ? await pointTop(plusBox.cx, plusBox.cy) : null;
    result.checks.plusButton = { box: plusBox, topElement: plusTop };
    assert(plusTop?.testId === 'workflow-create-node', 'Create node button is not topmost at its center', result.checks.plusButton);
    await clickSelector('[data-testid="workflow-create-node"]');
    await waitFor(async () => await exists('[data-testid="workflow-create-node-panel"]'), 5000, 'create panel');
    const nodeKinds = await evalJson(`() => Array.from(document.querySelectorAll('[data-testid="workflow-create-node-option"]'))
      .map(element => element.getAttribute('data-node-kind')).filter(Boolean).sort()`);
    result.checks.plusMenuKinds = nodeKinds;
    assert(['agent', 'diagram', 'file', 'markdown'].every(kind => nodeKinds.includes(kind)), 'Plus create menu missing node types', nodeKinds);
    await evalRaw(`
      (() => {
        const panel = document.querySelector('[data-testid="workflow-create-node-panel"]');
        const buttons = Array.from(panel?.querySelectorAll('button') || []);
        const close = buttons.find(button => /^(Close|关闭)$/i.test((button.textContent || '').trim()) || /^(Close|关闭)$/i.test(button.getAttribute('title') || ''));
        (close || buttons[0])?.click();
      })();
      true;
    `, true);
    await waitFor(async () => !(await exists('[data-testid="workflow-create-node-panel"]')), 5000, 'create panel closed');

    currentPhase = 'canvas-context-menu';
    await sleep(500);
    const blank1 = await blankCanvasPoint({ x: 1180, y: 760 });
    result.checks.canvasContextPoint = {
      point: blank1,
      topElement: await pointTop(blank1.x, blank1.y),
    };
    await mouseClick(blank1.x, blank1.y, 'right');
    try {
      await waitFor(async () => await exists('[data-testid="workflow-context-menu"]'), 2500, 'canvas context menu native right-click');
      result.checks.canvasContextMode = 'native-cdp-right-click';
    } catch (nativeRightClickError) {
      result.notes.push(`Native CDP right-click did not open canvas menu: ${nativeRightClickError.message}`);
      await evalJson(`(x, y) => {
        const target = document.elementFromPoint(x, y);
        const event = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: x,
          clientY: y,
          button: 2,
          buttons: 2
        });
        target?.dispatchEvent(event);
        return {
          targetTag: target?.tagName || '',
          targetTestId: target?.closest('[data-testid]')?.getAttribute('data-testid') || '',
          defaultPrevented: event.defaultPrevented
        };
      }`, blank1.x, blank1.y).then(info => {
        result.checks.canvasContextSyntheticDispatch = info;
      });
      await waitFor(async () => await exists('[data-testid="workflow-context-menu"]'), 5000, 'canvas context menu synthetic fallback');
      result.checks.canvasContextMode = 'synthetic-dom-contextmenu-fallback';
    }
    const canvasActions = await evalJson(`() => Array.from(document.querySelectorAll('[data-testid="workflow-context-action"]'))
      .map(element => element.getAttribute('data-action')).filter(Boolean)`);
    result.checks.canvasContextActions = canvasActions;
    assert(canvasActions.includes('create-node'), 'Canvas context menu missing create-node', canvasActions);
    await mouseClick(blank1.x + 8, blank1.y + 8, 'left');
    await waitFor(async () => !(await exists('[data-testid="workflow-context-menu"]')), 3000, 'canvas context menu closed');

    currentPhase = 'explorer-preview';
    const packageSelector = '[data-testid="workspace-tree-item"][data-path="package.json"]';
    const packageBefore = await bbox(packageSelector);
    await sendPage('Input.dispatchMouseEvent', { type: 'mouseMoved', x: packageBefore.cx + 16, y: packageBefore.cy, button: 'none', buttons: 0 });
    await sleep(120);
    const packageAfter = await bbox(packageSelector);
    const packageTop = await pointTop(packageAfter.cx, packageAfter.cy);
    result.checks.explorerRowDrift = {
      topDelta: Math.abs(packageAfter.top - packageBefore.top),
      before: packageBefore,
      after: packageAfter,
      topElement: packageTop,
    };
    assert(result.checks.explorerRowDrift.topDelta <= 1, 'Explorer row moved on hover/mouse move', result.checks.explorerRowDrift);
    assert(packageTop?.testId === 'workspace-tree-item' && packageTop?.path === 'package.json', 'Explorer row not topmost after hover', packageTop);
    await mouseClick(packageAfter.cx, packageAfter.cy, 'left');
    await waitFor(async () => (await text('[data-testid="workspace-preview-panel"]')).includes('package.json'), 7000, 'package.json preview');
    result.checks.packagePreview = (await text('[data-testid="workspace-preview-panel"]')).slice(0, 200);
    const beforeInsert = nodeIdsFromSnapshot(await snapshot());
    await clickSelector('[data-testid="workspace-preview-insert"]');
    const insertedIds = await waitFor(async () => {
      const ids = await newNodeIds(beforeInsert);
      return ids.length ? ids : null;
    }, 10000, 'preview insert node');
    result.createdNodeIds.push(...insertedIds);
    result.checks.previewInsertIds = insertedIds;
    result.checks.previewInsertText = (await text('[data-testid="workflow-file-node"], [data-testid="workflow-component-node"][data-component-type="file"]')).slice(0, 200);

    const srcSelector = '[data-testid="workspace-tree-item"][data-path="src"]';
    if (await exists(srcSelector)) {
      const beforeExpanded = await evalJson('sel => document.querySelector(sel)?.getAttribute("aria-expanded")', srcSelector);
      await clickSelector(srcSelector);
      await sleep(250);
      const afterExpanded = await evalJson('sel => document.querySelector(sel)?.getAttribute("aria-expanded")', srcSelector);
      result.checks.folderSingleClick = { beforeExpanded, afterExpanded };
      assert(beforeExpanded !== afterExpanded, 'Folder single-click did not toggle expanded state', result.checks.folderSingleClick);
    } else {
      result.notes.push('src folder absent; skipped folder toggle');
    }

    currentPhase = 'workspace-drag-drop';
    const beforeWorkspaceDrag = nodeIdsFromSnapshot(await snapshot());
    const packageLockSelector = '[data-testid="workspace-tree-item"][data-path="package-lock.json"]';
    const dragSourceSelector = (await exists(packageLockSelector)) ? packageLockSelector : packageSelector;
    const sourceBox = await bbox(dragSourceSelector);
    const dropPoint = await blankCanvasPoint({ x: 1110, y: 700 });
    await sendPage('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sourceBox.cx, y: sourceBox.cy, button: 'none', buttons: 0 });
    await sendPage('Input.dispatchMouseEvent', { type: 'mousePressed', x: sourceBox.cx, y: sourceBox.cy, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(100);
    await sendPage('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dropPoint.x, y: dropPoint.y, button: 'left', buttons: 1 });
    await sleep(150);
    await sendPage('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dropPoint.x, y: dropPoint.y, button: 'left', buttons: 0, clickCount: 1 });
    let workspaceDragIds = [];
    try {
      workspaceDragIds = await waitFor(async () => {
        const ids = await newNodeIds(beforeWorkspaceDrag);
        return ids.length ? ids : null;
      }, 3000, 'workspace mouse drag node');
      result.checks.workspaceDragMode = 'mouse';
    } catch {
      result.notes.push('Headless CDP mouse drag did not start HTML5 drag; using Input.dispatchDragEvent fallback');
      const pathValue = dragSourceSelector.includes('package-lock') ? 'package-lock.json' : 'package.json';
      const itemData = JSON.stringify({
        kind: 'workspace-file',
        path: pathValue,
        source: 'workspace',
        name: path.basename(pathValue),
        mime: 'text/plain',
        size: 0,
      });
      const dragData = {
        items: [
          { mimeType: 'application/x-harness-workspace-item', data: itemData, title: pathValue, baseURL: origin },
          { mimeType: 'text/plain', data: pathValue, title: pathValue, baseURL: origin },
        ],
        dragOperationsMask: 1,
      };
      await sendPage('Input.dispatchDragEvent', { type: 'dragEnter', x: dropPoint.x, y: dropPoint.y, data: dragData });
      await sendPage('Input.dispatchDragEvent', { type: 'dragOver', x: dropPoint.x, y: dropPoint.y, data: dragData });
      await sendPage('Input.dispatchDragEvent', { type: 'drop', x: dropPoint.x, y: dropPoint.y, data: dragData });
      workspaceDragIds = await waitFor(async () => {
        const ids = await newNodeIds(beforeWorkspaceDrag);
        return ids.length ? ids : null;
      }, 10000, 'workspace dispatchDragEvent node');
      result.checks.workspaceDragMode = 'cdp-dispatchDragEvent';
    }
    result.createdNodeIds.push(...workspaceDragIds);
    result.checks.workspaceDragIds = workspaceDragIds;

    currentPhase = 'external-file-drop';
    const beforeExternalDrop = nodeIdsFromSnapshot(await snapshot());
    const extPoint = await blankCanvasPoint({ x: 1010, y: 610 });
    let externalDropMode = 'synthetic-fileevent';
    await evalJson(`async (x, y, name, content) => {
      const target = document.elementFromPoint(x, y)?.closest('[data-testid="workflow-canvas"]') || document.querySelector('[data-testid="workflow-canvas"]');
      const file = new File([content], name, { type: 'text/plain' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      for (const type of ['dragover', 'drop']) {
        const event = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
        Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
        target.dispatchEvent(event);
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }`, extPoint.x, extPoint.y, path.basename(externalFile), fs.readFileSync(externalFile, 'utf8'));
    let externalIds = [];
    try {
      externalIds = await waitFor(async () => {
        const ids = await newNodeIds(beforeExternalDrop);
        return ids.length ? ids : null;
      }, 10000, 'external file drop node');
    } catch (dropError) {
      externalDropMode = 'file-input-fallback';
      result.notes.push(`Synthetic file drop did not create node: ${dropError.message}; using file input fallback`);
      const beforeFileInput = nodeIdsFromSnapshot(await snapshot());
      await clickSelector('[data-testid="workflow-create-node"]');
      await waitFor(async () => await exists('[data-testid="workflow-create-node-panel"]'), 5000, 'file create panel');
      await evalRaw('Array.from(document.querySelectorAll(\'[data-testid="workflow-create-node-option"]\')).find(element => element.getAttribute("data-node-kind") === "file")?.click(); true', true);
      await waitFor(async () => await exists('[data-testid="workflow-create-file-upload"]'), 5000, 'file upload input');
      const documentNode = await sendPage('DOM.getDocument', { depth: -1, pierce: true });
      const query = await sendPage('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '[data-testid="workflow-create-file-upload"]' });
      assert(query.nodeId, 'File upload input nodeId not found');
      await sendPage('DOM.setFileInputFiles', { nodeId: query.nodeId, files: [externalFile] });
      externalIds = await waitFor(async () => {
        const ids = await newNodeIds(beforeFileInput);
        return ids.length ? ids : null;
      }, 12000, 'external file input node');
    }
    result.createdNodeIds.push(...externalIds);
    result.checks.externalFileIds = externalIds;
    result.checks.externalFileMode = externalDropMode;
    const externalNode = (await snapshot()).nodes.find(node => externalIds.includes(node.nodeId || node.id));
    result.checks.externalFileNode = externalNode;
    assert(JSON.stringify(externalNode).includes('user-file') || JSON.stringify(externalNode).includes('Harness/user-files'), 'External upload did not create user-file reference', externalNode);
    await closeFloatingPanels();

    currentPhase = 'large-text-paste';
    const beforePaste = nodeIdsFromSnapshot(await snapshot());
    const pasteText = `CDP large pasted markdown ${Date.now()}\n\n${'This text should become a markdown node. '.repeat(8)}`;
    const pastePoint = await blankCanvasPoint({ x: 920, y: 550 });
    await mouseClick(pastePoint.x, pastePoint.y, 'left');
    await evalJson(`async (x, y, pastedText) => {
      const target = document.elementFromPoint(x, y)?.closest('[data-testid="workflow-canvas"]') || document.querySelector('[data-testid="workflow-canvas"]');
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', pastedText);
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dataTransfer });
      target.dispatchEvent(event);
      await new Promise(resolve => setTimeout(resolve, 50));
    }`, pastePoint.x, pastePoint.y, pasteText);
    const pasteIds = await waitFor(async () => {
      const ids = await newNodeIds(beforePaste);
      return ids.length ? ids : null;
    }, 10000, 'large text markdown node');
    result.createdNodeIds.push(...pasteIds);
    result.checks.pasteMarkdownIds = pasteIds;
    const pastedNode = (await snapshot()).nodes.find(node => pasteIds.includes(node.nodeId || node.id));
    assert(JSON.stringify(pastedNode).includes('markdown') || pastedNode?.type === 'markdown', 'Large text paste did not create markdown node', pastedNode);

    currentPhase = 'node-context-settings';
    const agentSelector = '[data-testid="workflow-node"], [data-testid="workflow-node-terminal"]';
    await waitFor(async () => await exists(agentSelector), 8000, 'agent node');
    const agentBox = await bbox(agentSelector);
    await mouseClick(agentBox.cx, agentBox.cy, 'right');
    await waitFor(async () => await exists('[data-testid="workflow-node-context-menu"]'), 5000, 'node context menu');
    const nodeActions = await evalJson(`() => Array.from(document.querySelectorAll('[data-testid="workflow-node-context-action"]'))
      .map(element => element.getAttribute('data-action')).filter(Boolean).sort()`);
    result.checks.nodeContextActions = nodeActions;
    assert(['settings', 'open-config', 'copy', 'cut', 'duplicate', 'delete'].every(action => nodeActions.includes(action)), 'Node context menu missing actions', nodeActions);
    await closeFloatingPanels();
    await mouseClick(agentBox.cx + 2, agentBox.cy + 2, 'left', 2);
    await waitFor(async () => await exists('[data-testid="workflow-node-settings"], [data-testid="workflow-node-config"]'), 8000, 'node config/settings after double click');
    result.checks.nodeConfigVisible = (await exists('[data-testid="workflow-node-settings"]')) ? 'settings' : 'config';
    if (await exists('[data-testid="workflow-node-settings"]')) {
      await clickSelector('[data-testid="workflow-node-cwd-picker"]');
      await waitFor(async () => await exists('[data-testid="workflow-node-cwd-picker-panel"]'), 8000, 'cwd picker panel');
      const cwdPicker = await evalJson(`() => ({
        root: !!document.querySelector('[data-testid="workflow-node-cwd-picker-root"]'),
        back: !!document.querySelector('[data-testid="workflow-node-cwd-picker-back"]'),
        useCurrent: !!document.querySelector('[data-testid="workflow-node-cwd-picker-use-current"]'),
        list: !!document.querySelector('[data-testid="workflow-node-cwd-picker-list"]'),
        items: document.querySelectorAll('[data-testid="workflow-node-cwd-picker-item"]').length,
        loading: !!document.querySelector('[data-testid="workflow-node-cwd-picker-loading"]'),
        error: document.querySelector('[data-testid="workflow-node-cwd-picker-error"]')?.textContent || ''
      })`);
      result.checks.cwdPicker = cwdPicker;
      assert(cwdPicker.root && cwdPicker.back && cwdPicker.useCurrent && cwdPicker.list, 'CWD picker missing Explorer-backed controls', cwdPicker);
    } else {
      result.notes.push('workflow-node-settings not visible after double-click; legacy config visible');
    }
    await closeFloatingPanels();

    currentPhase = 'bridge-single-click';
    await waitFor(async () => await exists('[data-testid="workflow-bridge-label"]'), 8000, 'bridge label');
    const bridgeBox = await bbox('[data-testid="workflow-bridge-label"]');
    const bridgeTop = await pointTop(bridgeBox.cx, bridgeBox.cy);
    result.checks.bridgeTopElement = bridgeTop;
    assert(bridgeTop?.testId === 'workflow-bridge-label', 'Bridge label is not topmost at its center', bridgeTop);
    await mouseClick(bridgeBox.cx, bridgeBox.cy, 'left');
    await sleep(300);
    const panelAfterSingle = await exists('[data-testid="workflow-bridge-panel"]');
    result.checks.bridgeSingleClickPanel = panelAfterSingle;
    assert(!panelAfterSingle, 'Bridge panel opened on single click');
    const putsBeforeDrag = result.graphPuts.length;
    currentPhase = 'bridge-dragging';
    await sendPage('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bridgeBox.cx, y: bridgeBox.cy, button: 'none', buttons: 0 });
    await sendPage('Input.dispatchMouseEvent', { type: 'mousePressed', x: bridgeBox.cx, y: bridgeBox.cy, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(80);
    await sendPage('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bridgeBox.cx + 8, y: bridgeBox.cy + 40, button: 'left', buttons: 1 });
    await sleep(250);
    const putsDuringDrag = result.graphPuts.slice(putsBeforeDrag);
    assert(putsDuringDrag.length === 0, 'Graph-map PUT occurred before bridge pointerup', putsDuringDrag);
    currentPhase = 'bridge-pointerup';
    await sendPage('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bridgeBox.cx + 8, y: bridgeBox.cy + 40, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(900);
    const putsAfterDrag = result.graphPuts.slice(putsBeforeDrag);
    result.checks.bridgeDragGraphPuts = putsAfterDrag;
    if (putsAfterDrag.length > 0) {
      assert(putsAfterDrag.every(put => Number.isInteger(put.expectedVersion) || Number.isInteger(put.baseVersion)), 'Graph-map PUT missing version guard', putsAfterDrag);
      assert(putsAfterDrag.every(put => (put.undo ?? 0) === 0 && (put.redo ?? 0) === 0 && put.bytes < 50000), 'Graph-map PUT payload not bounded', putsAfterDrag);
    }
    currentPhase = 'bridge-double-click';
    const bridgeBox2 = await bbox('[data-testid="workflow-bridge-label"]');
    await mouseClick(bridgeBox2.cx, bridgeBox2.cy, 'left', 2);
    await waitFor(async () => await exists('[data-testid="workflow-bridge-panel"]'), 5000, 'bridge panel on double click');
    result.checks.bridgePanelText = (await text('[data-testid="workflow-bridge-panel"]')).slice(0, 200);

    currentPhase = 'toast-zindex';
    const toastPoint = await blankCanvasPoint({ x: 900, y: 720 });
    const invalidDrag = {
      items: [{ mimeType: 'application/x-harness-workspace-item', data: '', title: '', baseURL: origin }],
      dragOperationsMask: 1,
    };
    await sendPage('Input.dispatchDragEvent', { type: 'dragEnter', x: toastPoint.x, y: toastPoint.y, data: invalidDrag });
    await sendPage('Input.dispatchDragEvent', { type: 'dragOver', x: toastPoint.x, y: toastPoint.y, data: invalidDrag });
    await sendPage('Input.dispatchDragEvent', { type: 'drop', x: toastPoint.x, y: toastPoint.y, data: invalidDrag });
    await waitFor(async () => await exists('[data-testid="workflow-toast"]'), 5000, 'workflow toast');
    const toast = await evalJson(`() => {
      const toast = document.querySelector('[data-testid="workflow-toast"]');
      const panel = document.querySelector('[data-testid="workflow-create-node-panel"], [data-testid="workflow-context-menu"], [data-testid="workflow-node-context-menu"], [data-testid="workflow-bridge-panel"]');
      const r = toast?.getBoundingClientRect();
      const top = r ? document.elementFromPoint(r.left + Math.min(30, r.width / 2), r.top + Math.min(20, r.height / 2)) : null;
      return {
        toastZ: toast ? getComputedStyle(toast).zIndex : '',
        panelZ: panel ? getComputedStyle(panel).zIndex : '',
        topTestId: top?.closest('[data-testid]')?.getAttribute('data-testid') || '',
        text: toast?.textContent || '',
        rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
      };
    }`);
    result.checks.toast = toast;
    assert(toast.topTestId === 'workflow-toast', 'Toast not topmost at its own point', toast);

    currentPhase = 'final';
    result.longTasks = await evalJson(`() => (window.__harnessLongTasks || []).map(task => ({
      name: task.name,
      duration: Math.round(task.duration),
      startTime: Math.round(task.startTime)
    }))`);
    result.timings.maxLongTaskMs = Math.max(0, ...result.longTasks.map(task => task.duration || 0));

    const screenshot = await sendPage('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const screenshotPath = path.join(evidenceDir, 'workflow-cdp-final.png');
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    result.screenshot = screenshotPath;

    const blockingConsole = result.consoleMessages.filter(message => {
      const body = message.text || '';
      if (/Download the React DevTools/.test(body)) return false;
      return message.type === 'error' || /React error #185|Maximum update depth/.test(body);
    });
    result.checks.blockingConsole = blockingConsole;
    result.ac = {
      'AC-001': result.checks.plusMenuKinds?.length >= 4 && result.checks.canvasContextActions?.includes('create-node'),
      'AC-002': insertedIds.length > 0 && workspaceDragIds.length > 0 && externalIds.length > 0 && pasteIds.length > 0,
      'AC-006': result.checks.explorerRowDrift?.topDelta <= 1 && (!result.checks.folderSingleClick || result.checks.folderSingleClick.beforeExpanded !== result.checks.folderSingleClick.afterExpanded),
      'AC-007': ['settings', 'open-config', 'copy', 'cut', 'duplicate', 'delete'].every(action => nodeActions.includes(action)) && !!result.checks.nodeConfigVisible,
      'AC-008': !panelAfterSingle && putsDuringDrag.length === 0 && (putsAfterDrag.length === 0 || putsAfterDrag.every(put => Number.isInteger(put.expectedVersion) || Number.isInteger(put.baseVersion))),
      'AC-010': !result.checks.cwdPicker || (result.checks.cwdPicker.root && result.checks.cwdPicker.list),
      'AC-011': toast.topTestId === 'workflow-toast' && bridgeTop?.testId === 'workflow-bridge-label',
      'AC-012': result.runtimeExceptions.length === 0 && blockingConsole.length === 0 && result.networkErrors.length === 0 && result.timings.maxLongTaskMs <= 250 && result.timings.readyMs < 3000 && putsDuringDrag.length === 0,
    };

    assert(result.runtimeExceptions.length === 0, 'Runtime exceptions captured', result.runtimeExceptions);
    assert(blockingConsole.length === 0, 'Blocking console errors captured', blockingConsole);
    assert(result.networkErrors.length === 0, 'Network errors captured', result.networkErrors);
    assert(result.timings.maxLongTaskMs <= 250, 'Long task budget exceeded', result.longTasks);
    assert(result.timings.readyMs < 3000, 'Ready time budget exceeded', result.timings.readyMs);

    for (const nodeId of Array.from(new Set(result.createdNodeIds))) {
      if (nodeId && /^component-/.test(nodeId)) {
        await httpDelete(`/api/a2a/component-nodes/${encodeURIComponent(nodeId)}`);
      }
    }

    result.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
      ok: true,
      evidenceDir,
      resultPath: path.join(evidenceDir, 'result.json'),
      screenshotPath,
      ac: result.ac,
      timings: result.timings,
      graphPuts: result.graphPuts,
      notes: result.notes,
    }, null, 2));
  } finally {
    try {
      chrome.kill();
    } catch {
      // no-op
    }
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // no-op
    }
  }
}

run().catch(async error => {
  result.failedAt = new Date().toISOString();
  result.error = { message: error.message, stack: error.stack, extra: error.extra };
  if (sendPage) {
    try {
      const screenshot = await sendPage('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const screenshotPath = path.join(evidenceDir, 'workflow-cdp-failure.png');
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
      result.failureScreenshot = screenshotPath;
    } catch {
      // no-op
    }
  }
  fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
  console.error(JSON.stringify({
    ok: false,
    evidenceDir,
    resultPath: path.join(evidenceDir, 'result.json'),
    error: result.error,
    checks: result.checks,
    ac: result.ac,
    networkErrors: result.networkErrors,
    runtimeExceptions: result.runtimeExceptions,
    consoleMessages: result.consoleMessages,
    graphPuts: result.graphPuts,
    notes: result.notes,
  }, null, 2));
  process.exitCode = 1;
});
