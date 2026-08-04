import { useEffect, useMemo, useRef, useState } from 'react';
import { wsUrl } from './api';

type PrimitiveStatus = 'ok' | 'failed' | 'blocked' | 'unsupported';
type CapabilityKind = 'route' | 'component' | 'element' | 'canvas' | 'graph' | 'form';

export interface WfBrowserActionSpec {
  label?: string;
  input?: string;
}

export interface WfBrowserCapability {
  id: string;
  kind: CapabilityKind;
  label: string;
  selectors?: { testId?: string; selector?: string; role?: string; name?: string };
  keys?: Record<string, string>;
  state?: () => unknown;
  actions?: Record<string, WfBrowserActionSpec>;
  captures?: Array<'screenshot' | 'ui-tree' | 'state' | 'logs' | 'network' | 'ast' | 'replay' | 'analysis'>;
}

interface RuntimeConfig {
  enabled: boolean;
  overlay: boolean;
  runId: string;
  windowId: string;
  agentId: string;
  leaseId: string;
}

interface CursorState {
  visible: boolean;
  x: number;
  y: number;
  operation: string;
  label: string;
  pulse: boolean;
}

interface PrimitiveResult {
  status: PrimitiveStatus;
  result?: unknown;
  events?: unknown[];
  error?: { code: string; message: string };
}

interface PrimitiveContext {
  commandId?: string;
  agentId?: string;
  leaseId?: string;
}

type WfBrowserIntentDetail = {
  intent: string;
  payload: Record<string, unknown>;
  context: PrimitiveContext;
  handled: boolean;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

type TargetPayload = {
  selector?: string;
  testId?: string;
  capabilityId?: string;
  role?: string;
  name?: string;
  text?: string;
  point?: { x: number; y: number };
};

type NetworkEntry = {
  id: string;
  type: 'fetch' | 'xhr' | 'resource';
  method: string;
  url: string;
  status: number | null;
  ok: boolean | null;
  durationMs: number;
  at: string;
  initiatorType?: string;
  contentType?: string;
  transferSize?: number;
  error?: string;
};

type ReplayEntry = {
  id: string;
  at: string;
  primitive: string;
  status: PrimitiveStatus;
  durationMs: number;
  commandId: string;
  agentId: string;
  leaseId: string;
  payload: unknown;
  target?: unknown;
  result?: unknown;
  error?: unknown;
  before: { routeId: string; pathname: string; logSeq: number; networkSeq: number };
  after: { routeId: string; pathname: string; logSeq: number; networkSeq: number };
};

type DiffSnapshot = {
  id: string;
  at: string;
  route: ReturnType<typeof observeRoute>;
  ui: { nodeCount: number; capabilityIds: string[]; testIds: string[] };
  state: { capabilityCount: number; storage: Record<string, string> };
  counts: { logs: number; errors: number; network: number; replay: number };
};

const capabilityRegistry = new Map<string, WfBrowserCapability>();
let cursorSink: ((next: CursorState) => void) | null = null;
let logsInstalled = false;
let networkInstalled = false;
let logSeq = 0;
let networkSeq = 0;
let replaySeq = 0;
let diffBaseline: DiffSnapshot | null = null;
const logBuffer: Array<{ level: string; message: string; at: string; args?: string[] }> = [];
const networkBuffer: NetworkEntry[] = [];
const replayBuffer: ReplayEntry[] = [];

function pushLog(level: string, args: unknown[]) {
  logSeq += 1;
  logBuffer.push({
    level,
    message: args.map(formatLogArg).join(' '),
    args: args.map(formatLogArg),
    at: new Date().toISOString(),
  });
  while (logBuffer.length > 300) logBuffer.shift();
}

function pushNetwork(entry: Omit<NetworkEntry, 'id'>) {
  networkSeq += 1;
  networkBuffer.push({
    id: `net-${networkSeq}`,
    ...entry,
  });
  while (networkBuffer.length > 500) networkBuffer.shift();
}

function pushReplay(entry: Omit<ReplayEntry, 'id'>) {
  replaySeq += 1;
  replayBuffer.push({
    id: `replay-${replaySeq}`,
    ...entry,
  });
  while (replayBuffer.length > 500) replayBuffer.shift();
}

function formatLogArg(value: unknown) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function installLogCapture() {
  if (logsInstalled) return;
  logsInstalled = true;
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      pushLog(level, args);
      original(...args);
    };
  }
  window.addEventListener('error', (event) => {
    pushLog('error', [event.message, event.filename, event.lineno]);
  });
  window.addEventListener('unhandledrejection', (event) => {
    pushLog('error', ['unhandledrejection', event.reason]);
  });
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url || '';
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return String(init.method).toUpperCase();
  if (typeof input === 'object' && 'method' in input && input.method) return String(input.method).toUpperCase();
  return 'GET';
}

function responseContentType(headers: Headers | null) {
  try { return headers?.get('content-type') || ''; } catch { return ''; }
}

function installNetworkCapture() {
  if (networkInstalled) return;
  networkInstalled = true;

  const originalFetch = window.fetch?.bind(window);
  if (originalFetch) {
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const started = performance.now();
      const method = requestMethod(input, init);
      const url = requestUrl(input);
      try {
        const response = await originalFetch(input, init);
        pushNetwork({
          type: 'fetch',
          method,
          url: response.url || url,
          status: response.status,
          ok: response.ok,
          durationMs: Math.round(performance.now() - started),
          at: new Date().toISOString(),
          contentType: responseContentType(response.headers),
        });
        return response;
      } catch (err) {
        pushNetwork({
          type: 'fetch',
          method,
          url,
          status: null,
          ok: false,
          durationMs: Math.round(performance.now() - started),
          at: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    };
  }

  const Xhr = window.XMLHttpRequest;
  if (Xhr?.prototype) {
    const originalOpen = Xhr.prototype.open;
    const originalSend = Xhr.prototype.send;
    Xhr.prototype.open = function open(...args: unknown[]) {
      const [method, url] = args;
      (this as XMLHttpRequest & { __wfBrowserNetwork?: Record<string, unknown> }).__wfBrowserNetwork = {
        method: String(method || 'GET').toUpperCase(),
        url: String(url || ''),
      };
      return originalOpen.apply(this, args as unknown as [string, string | URL, boolean, string?, string?]);
    };
    Xhr.prototype.send = function send(...args: unknown[]) {
      const xhr = this as XMLHttpRequest & { __wfBrowserNetwork?: Record<string, unknown> };
      const meta = xhr.__wfBrowserNetwork || {};
      const started = performance.now();
      const onDone = () => {
        xhr.removeEventListener('loadend', onDone);
        pushNetwork({
          type: 'xhr',
          method: String(meta.method || 'GET'),
          url: xhr.responseURL || String(meta.url || ''),
          status: Number(xhr.status || 0) || null,
          ok: xhr.status >= 200 && xhr.status < 400,
          durationMs: Math.round(performance.now() - started),
          at: new Date().toISOString(),
          contentType: xhr.getResponseHeader('content-type') || '',
        });
      };
      xhr.addEventListener('loadend', onDone);
      return originalSend.apply(this, args as [Document | XMLHttpRequestBodyInit | null | undefined]);
    };
  }
}

function emitRegistryChanged() {
  window.dispatchEvent(new CustomEvent('wf-browser:capabilities-changed'));
}

export function registerWfBrowserCapability(capability: WfBrowserCapability) {
  if (!capability?.id) throw new Error('wf-browser capability requires an id');
  capabilityRegistry.set(capability.id, capability);
  emitRegistryChanged();
  return () => {
    capabilityRegistry.delete(capability.id);
    emitRegistryChanged();
  };
}

export function useWfBrowserCapabilities(capabilities: WfBrowserCapability[]) {
  useEffect(() => {
    const cleanups = capabilities.map(capability => registerWfBrowserCapability(capability));
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [capabilities]);
}

function routeId() {
  const path = window.location.pathname || '/';
  if (path === '/') return 'tasks';
  return path.replace(/^\/+/, '').replace(/[^A-Za-z0-9_-]+/g, '-') || 'root';
}

function readConfig(): RuntimeConfig {
  const params = new URL(window.location.href).searchParams;
  const read = (keys: string[], storageKey: string) => {
    for (const key of keys) {
      const value = params.get(key);
      if (value) {
        window.sessionStorage.setItem(storageKey, value);
        return value;
      }
    }
    return window.sessionStorage.getItem(storageKey) || '';
  };
  const runId = read(['wfRun', 'wfBrowserRunId', 'wf-browser-run'], 'wf-browser-run-id');
  const windowId = read(['wfWindow', 'wfBrowserWindowId', 'wf-browser-window'], 'wf-browser-window-id');
  const agentId = read(['wfAgent', 'wfBrowserAgentId', 'wf-browser-agent'], 'wf-browser-agent-id');
  const leaseId = read(['wfLease', 'wfBrowserLeaseId', 'wf-browser-lease'], 'wf-browser-lease-id');
  const debugFlag = params.get('wfDebug') || window.sessionStorage.getItem('wf-browser-debug') || '';
  if (debugFlag) window.sessionStorage.setItem('wf-browser-debug', debugFlag);
  return {
    enabled: Boolean(runId && windowId),
    overlay: Boolean(runId && windowId) || debugFlag === '1' || debugFlag === 'true',
    runId,
    windowId,
    agentId,
    leaseId,
  };
}

function selectorAttr(name: string, value: string) {
  return `[${name}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

function textOf(element: Element) {
  return (element.textContent || '').replace(/\s+/g, ' ').trim();
}

function roleFor(element: Element) {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'input') {
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'textbox';
  }
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (tag === 'form') return 'form';
  if (tag === 'main') return 'main';
  return '';
}

function accessibleName(element: Element) {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map(id => document.getElementById(id)?.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text;
  }
  const aria = element.getAttribute('aria-label');
  if (aria) return aria.trim();
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const id = element.id;
    if (id) {
      const label = document.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
      if (label) return textOf(label);
    }
    if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.placeholder) {
      return element.placeholder;
    }
  }
  const title = element.getAttribute('title');
  if (title) return title.trim();
  return textOf(element).slice(0, 120);
}

function isVisible(element: Element) {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function boundsFor(element: Element) {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function dataAttrsFor(element: Element) {
  const attrs: Record<string, string> = {};
  for (const attr of [...element.attributes]) {
    if (!attr.name.startsWith('data-')) continue;
    attrs[attr.name] = attr.value.length > 240 ? `${attr.value.slice(0, 240)}...` : attr.value;
  }
  return attrs;
}

function capabilitySelector(capability: WfBrowserCapability) {
  return capability.selectors?.selector
    || (capability.selectors?.testId ? selectorAttr('data-testid', capability.selectors.testId) : '');
}

function serialiseCapability(capability: WfBrowserCapability) {
  let bounds;
  const selector = capabilitySelector(capability);
  const element = selector ? document.querySelector(selector) : null;
  if (element && isVisible(element)) bounds = boundsFor(element);
  let state;
  try { state = capability.state ? capability.state() : undefined; } catch (err) { state = { error: String(err) }; }
  return {
    id: capability.id,
    kind: capability.kind,
    label: capability.label,
    selectors: capability.selectors || {},
    keys: capability.keys || {},
    bounds,
    state,
    actions: capability.actions || {},
    captures: capability.captures || [],
  };
}

function matchingElementsForCapability(capability: WfBrowserCapability) {
  const selector = capabilitySelector(capability);
  if (!selector) return [];
  try {
    return [...document.querySelectorAll(selector)].slice(0, 80);
  } catch {
    return [];
  }
}

function buildRegisteredCapabilityIndex(elements: Element[]) {
  const index = new Map<Element, string[]>();
  const matches = [...capabilityRegistry.values()]
    .flatMap(capability => matchingElementsForCapability(capability).map(element => ({ capability, element })));
  for (const element of elements) {
    const ids: string[] = [];
    for (const match of matches) {
      if ((match.element === document.body || match.element === document.documentElement) && match.element !== element) continue;
      if (match.element === element || match.element.contains(element)) ids.push(match.capability.id);
    }
    if (ids.length) index.set(element, [...new Set(ids)]);
  }
  return index;
}

function routeCapability() {
  return {
    id: `route.${routeId()}`,
    kind: 'route',
    label: document.title || routeId(),
    selectors: { selector: 'body' },
    keys: { pathname: window.location.pathname },
    bounds: boundsFor(document.body),
    state: {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    },
    actions: {},
    captures: ['ui-tree', 'state', 'logs'],
  };
}

function observeCapabilities() {
  return {
    route: routeCapability(),
    capabilities: [
      routeCapability(),
      ...[...capabilityRegistry.values()].map(serialiseCapability),
    ],
  };
}

function candidateElements() {
  const selector = [
    '[data-testid]',
    '[data-wf-capability]',
    '[role]',
    '[aria-label]',
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    'form',
    'main',
    '[contenteditable="true"]',
  ].join(',');
  return [...document.querySelectorAll(selector)].filter(isVisible);
}

function observeUiTree(payload: Record<string, unknown> = {}) {
  const maxNodes = Math.min(Math.max(Number(payload.maxNodes || 200), 1), 1000);
  const elements = candidateElements().slice(0, maxNodes);
  const ids = new Map<Element, string>();
  const registeredCapabilities = buildRegisteredCapabilityIndex(elements);
  const nodes = elements.map((element, index) => {
    const id = `ui-${index + 1}`;
    ids.set(element, id);
    const parent = element.parentElement?.closest('[data-testid],[data-wf-capability],[role],button,a,input,select,textarea,form,main,[contenteditable="true"]');
    const attributeCapabilityId = element.getAttribute('data-wf-capability') || '';
    const registeredCapabilityIds = registeredCapabilities.get(element) || [];
    return {
      id,
      parentId: parent ? ids.get(parent) || null : null,
      tag: element.tagName.toLowerCase(),
      role: roleFor(element),
      name: accessibleName(element),
      testId: element.getAttribute('data-testid') || '',
      capabilityId: attributeCapabilityId || registeredCapabilityIds[0] || '',
      registeredCapabilityIds,
      dataAttrs: dataAttrsFor(element),
      disabled: Boolean((element as HTMLButtonElement | HTMLInputElement).disabled),
      selected: element.getAttribute('aria-selected') === 'true',
      expanded: element.getAttribute('aria-expanded') || '',
      bounds: boundsFor(element),
    };
  });
  return {
    route: window.location.pathname,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    truncated: elements.length >= maxNodes,
    nodes,
  };
}

function observeRoute() {
  return {
    routeId: routeId(),
    href: window.location.href,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    readyState: document.readyState,
    theme: document.documentElement.dataset.theme || '',
  };
}

function observeState() {
  return {
    route: observeRoute(),
    storage: {
      wfBrowserRunId: window.sessionStorage.getItem('wf-browser-run-id') || '',
      wfBrowserWindowId: window.sessionStorage.getItem('wf-browser-window-id') || '',
    },
    capabilities: [...capabilityRegistry.values()].map(capability => ({
      id: capability.id,
      state: serialiseCapability(capability).state,
    })),
  };
}

function resourceEntries(limit = 40): NetworkEntry[] {
  try {
    return performance.getEntriesByType('resource')
      .slice(-limit)
      .map((entry) => {
        const resource = entry as PerformanceResourceTiming;
        return {
          id: `resource-${Math.round(entry.startTime)}-${String(entry.name).slice(-12)}`,
          type: 'resource' as const,
          method: '',
          url: entry.name,
          status: null,
          ok: null,
          durationMs: Math.round(entry.duration),
          at: new Date(performance.timeOrigin + entry.startTime).toISOString(),
          initiatorType: resource.initiatorType || '',
          transferSize: Number(resource.transferSize || 0),
        };
      });
  } catch {
    return [];
  }
}

function observeNetwork(payload: Record<string, unknown> = {}) {
  const limit = Math.min(Math.max(Number(payload.limit || 120), 1), 500);
  const includeResources = payload.resources !== false;
  return {
    seq: networkSeq,
    route: window.location.pathname,
    entries: networkBuffer.slice(-limit),
    resources: includeResources ? resourceEntries(Math.min(limit, 80)) : [],
  };
}

function observeReplay(payload: Record<string, unknown> = {}) {
  const limit = Math.min(Math.max(Number(payload.limit || 120), 1), 500);
  const prefix = String(payload.prefix || '').trim();
  const entries = prefix
    ? replayBuffer.filter(entry => entry.primitive.startsWith(prefix)).slice(-limit)
    : replayBuffer.slice(-limit);
  return {
    seq: replaySeq,
    route: window.location.pathname,
    entries,
  };
}

function makeDiffSnapshot(maxNodes = 160): DiffSnapshot {
  const ui = observeUiTree({ maxNodes });
  const state = observeState();
  return {
    id: `diff-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
    at: new Date().toISOString(),
    route: observeRoute(),
    ui: {
      nodeCount: ui.nodes.length,
      capabilityIds: [...new Set(ui.nodes.flatMap(node => node.registeredCapabilityIds || (node.capabilityId ? [node.capabilityId] : [])))].sort(),
      testIds: [...new Set(ui.nodes.map(node => node.testId).filter(Boolean))].sort(),
    },
    state: {
      capabilityCount: state.capabilities.length,
      storage: state.storage,
    },
    counts: {
      logs: logBuffer.length,
      errors: logBuffer.filter(entry => entry.level === 'error').length,
      network: networkBuffer.length,
      replay: replayBuffer.length,
    },
  };
}

function arrayDelta(before: string[], after: string[]) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter(item => !beforeSet.has(item)),
    removed: before.filter(item => !afterSet.has(item)),
  };
}

function observeDiff(payload: Record<string, unknown> = {}) {
  const current = makeDiffSnapshot(Math.min(Math.max(Number(payload.maxNodes || 160), 20), 500));
  const previous = diffBaseline;
  if (!previous || payload.reset === true) {
    diffBaseline = current;
    return {
      baselineCreated: true,
      before: null,
      after: current,
      changes: null,
    };
  }
  const changes = {
    routeChanged: previous.route.pathname !== current.route.pathname || previous.route.search !== current.route.search,
    route: { before: previous.route.pathname, after: current.route.pathname },
    nodeCountDelta: current.ui.nodeCount - previous.ui.nodeCount,
    capabilityIds: arrayDelta(previous.ui.capabilityIds, current.ui.capabilityIds),
    testIds: arrayDelta(previous.ui.testIds, current.ui.testIds),
    capabilityCountDelta: current.state.capabilityCount - previous.state.capabilityCount,
    logDelta: current.counts.logs - previous.counts.logs,
    errorDelta: current.counts.errors - previous.counts.errors,
    networkDelta: current.counts.network - previous.counts.network,
    replayDelta: current.counts.replay - previous.counts.replay,
  };
  if (payload.remember !== false) diffBaseline = current;
  return {
    baselineCreated: false,
    before: previous,
    after: current,
    changes,
  };
}

function resolveTarget(target: TargetPayload = {}) {
  if (target.capabilityId && capabilityRegistry.has(target.capabilityId)) {
    const cap = capabilityRegistry.get(target.capabilityId)!;
    const selector = capabilitySelector(cap);
    if (selector) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement) return element;
    }
  }
  if (target.selector) {
    const element = document.querySelector(target.selector);
    if (element instanceof HTMLElement) return element;
  }
  if (target.testId) {
    const element = document.querySelector(selectorAttr('data-testid', target.testId));
    if (element instanceof HTMLElement) return element;
  }
  if (target.point) {
    const element = document.elementFromPoint(target.point.x, target.point.y);
    if (element instanceof HTMLElement) return element;
  }
  const elements = candidateElements();
  if (target.role || target.name) {
    const element = elements.find(item => {
      const role = roleFor(item);
      const name = accessibleName(item);
      return (!target.role || role === target.role) && (!target.name || name.includes(target.name));
    });
    if (element instanceof HTMLElement) return element;
  }
  if (target.text) {
    const element = elements.find(item => textOf(item).includes(target.text || ''));
    if (element instanceof HTMLElement) return element;
  }
  return null;
}

function centerOf(element: Element) {
  const rect = element.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
}

async function moveCursor(point: { x: number; y: number }, operation: string, context: PrimitiveContext = {}, pulse = false) {
  cursorSink?.({
    visible: true,
    x: point.x,
    y: point.y,
    operation,
    label: context.agentId || 'agent',
    pulse,
  });
  const delayMs = operation === 'act.drag'
    ? (pulse ? 40 : 20)
    : (pulse ? 140 : 80);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

function dispatchMouse(target: EventTarget, type: string, point: { x: number; y: number }, buttons = 0, button = 0) {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    button,
    buttons,
    view: window,
  }));
}

function dispatchPointer(target: EventTarget, type: string, point: { x: number; y: number }, buttons = 0, pointerId = 1, button = 0) {
  if (typeof PointerEvent === 'function') {
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      pointerId,
      pointerType: 'mouse',
      isPrimary: true,
      button,
      buttons,
      view: window,
    }));
    return;
  }
  dispatchMouse(target, type.replace(/^pointer/, 'mouse'), point, buttons, button);
}

function inputText(element: HTMLElement, text: string, replace = false) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const next = replace ? text : `${element.value || ''}${text}`;
    setter?.call(element, next);
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: text,
      inputType: replace && text === '' ? 'deleteContentBackward' : 'insertText',
    }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (element.isContentEditable) {
    if (replace) element.textContent = text;
    else element.textContent = `${element.textContent || ''}${text}`;
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: text,
      inputType: replace && text === '' ? 'deleteContentBackward' : 'insertText',
    }));
  }
}

function pointFromUnknown(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const candidate = record.point && typeof record.point === 'object' ? record.point as Record<string, unknown> : record;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function elementAt(point: { x: number; y: number }) {
  const element = document.elementFromPoint(point.x, point.y);
  return element instanceof HTMLElement ? element : document.body;
}

async function selectValue(element: HTMLElement, payload: Record<string, unknown>) {
  const value = String(payload.value ?? payload.text ?? payload.label ?? '');
  if (!value) return { selected: false, reason: 'missing value' };
  if (element instanceof HTMLSelectElement) {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { selected: element.value, native: true };
  }

  const opener = element.matches('button,[aria-haspopup="listbox"]')
    ? element
    : element.querySelector<HTMLElement>('button,[aria-haspopup="listbox"]');
  opener?.click();
  await new Promise(resolve => setTimeout(resolve, 80));
  const options = candidateElements().filter(item => roleFor(item) === 'option');
  const option = options.find(item => {
    const name = accessibleName(item).toLowerCase();
    return name === value.toLowerCase() || name.includes(value.toLowerCase());
  });
  if (option instanceof HTMLElement) {
    await moveCursor(centerOf(option), 'act.select');
    option.click();
    return { selected: accessibleName(option), native: false };
  }
  return { selected: false, reason: `option not found: ${value}` };
}

async function actOnTarget(
  primitive: string,
  payload: Record<string, unknown>,
  context: PrimitiveContext,
  handler: (element: HTMLElement, point: { x: number; y: number }) => Promise<unknown> | unknown,
) {
  const target = (payload.target || payload) as TargetPayload;
  const element = resolveTarget(target);
  if (!element) {
    return {
      status: 'blocked' as const,
      error: { code: 'TARGET_NOT_FOUND', message: `Target not found for ${primitive}` },
      result: { target },
    };
  }
  const point = centerOf(element);
  await moveCursor(point, primitive, context);
  const result = await handler(element, point);
  return {
    status: 'ok' as const,
    result: {
      target: {
        role: roleFor(element),
        name: accessibleName(element),
        testId: element.getAttribute('data-testid') || '',
        dataAttrs: dataAttrsFor(element),
        bounds: boundsFor(element),
      },
      value: result,
    },
  };
}

async function waitForSelector(selector: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const element = document.querySelector(selector);
    if (element && isVisible(element)) return element;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  return null;
}

function compactUnknown(value: unknown, maxChars = 2000) {
  if (value === undefined) return undefined;
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxChars) return value;
    return { truncated: true, chars: text.length, preview: text.slice(0, maxChars) };
  } catch {
    const text = String(value);
    return text.length > maxChars ? { truncated: true, chars: text.length, preview: text.slice(0, maxChars) } : text;
  }
}

function replayPoint() {
  const route = observeRoute();
  return {
    routeId: route.routeId,
    pathname: route.pathname,
    logSeq,
    networkSeq,
  };
}

function replayTarget(result: unknown) {
  if (!result || typeof result !== 'object') return undefined;
  const record = result as Record<string, unknown>;
  return record.target || undefined;
}

async function runIntent(payload: Record<string, unknown>, context: PrimitiveContext): Promise<PrimitiveResult> {
  const intent = String(payload.intent || payload.action || payload.name || '').trim();
  if (!intent) {
    return { status: 'blocked', error: { code: 'INTENT_REQUIRED', message: 'act.intent requires intent' } };
  }
  const timeoutMs = Math.min(Math.max(Number(payload.timeoutMs || 5000), 1), 30000);
  return new Promise(resolve => {
    let settled = false;
    let unsupportedTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const settle = (result: PrimitiveResult) => {
      if (settled) return;
      settled = true;
      if (unsupportedTimer) clearTimeout(unsupportedTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve(result);
    };
    const detail: WfBrowserIntentDetail = {
      intent,
      payload,
      context,
      handled: false,
      resolve: value => settle({ status: 'ok', result: value }),
      reject: error => settle({
        status: 'failed',
        error: { code: 'INTENT_FAILED', message: error instanceof Error ? error.message : String(error) },
      }),
    };
    window.dispatchEvent(new CustomEvent('harness:wf-browser:intent', { detail }));
    unsupportedTimer = setTimeout(() => {
      if (!detail.handled) {
        settle({ status: 'unsupported', error: { code: 'INTENT_UNSUPPORTED', message: `Unsupported wf-browser intent: ${intent}` } });
      }
    }, 0);
    timeoutTimer = setTimeout(() => {
      settle({ status: 'blocked', error: { code: 'INTENT_TIMEOUT', message: `Timed out running wf-browser intent: ${intent}` } });
    }, timeoutMs);
  });
}

async function runPrimitiveInner(primitive: string, payload: Record<string, unknown> = {}, context: PrimitiveContext = {}): Promise<PrimitiveResult> {
  try {
    if (primitive === 'observe.route') return { status: 'ok', result: observeRoute() };
    if (primitive === 'observe.capabilities') return { status: 'ok', result: observeCapabilities() };
    if (primitive === 'observe.uiTree') return { status: 'ok', result: observeUiTree(payload) };
    if (primitive === 'observe.state') return { status: 'ok', result: observeState() };
    if (primitive === 'observe.network') return { status: 'ok', result: observeNetwork(payload) };
    if (primitive === 'observe.replay') return { status: 'ok', result: observeReplay(payload) };
    if (primitive === 'observe.diff') return { status: 'ok', result: observeDiff(payload) };
    if (primitive === 'observe.logs') {
      const limit = Math.min(Math.max(Number(payload.limit || 80), 1), 300);
      return { status: 'ok', result: { entries: logBuffer.slice(-limit) } };
    }
    if (primitive === 'observe.screenshot') {
      return {
        status: 'unsupported',
        error: { code: 'SCREENSHOT_UNSUPPORTED', message: 'Browser JavaScript cannot capture a trusted viewport screenshot without a fallback driver.' },
      };
    }
    if (primitive === 'act.intent') return runIntent(payload, context);
    if (primitive === 'act.hover') {
      return actOnTarget(primitive, payload, context, async (element, point) => {
        dispatchPointer(element, 'pointermove', point);
        dispatchMouse(element, 'mousemove', point);
        dispatchPointer(element, 'pointerover', point);
        dispatchMouse(element, 'mouseover', point);
        return true;
      });
    }
    if (primitive === 'act.click') {
      return actOnTarget(primitive, payload, context, async (element, point) => {
        dispatchPointer(element, 'pointermove', point);
        dispatchMouse(element, 'mousemove', point);
        dispatchPointer(element, 'pointerdown', point, 1);
        dispatchMouse(element, 'mousedown', point, 1);
        dispatchPointer(element, 'pointerup', point);
        dispatchMouse(element, 'mouseup', point);
        element.click();
        await moveCursor(point, primitive, context, true);
        return true;
      });
    }
    if (primitive === 'act.contextMenu') {
      return actOnTarget(primitive, payload, context, async (element, point) => {
        dispatchPointer(element, 'pointermove', point);
        dispatchMouse(element, 'mousemove', point);
        dispatchPointer(element, 'pointerdown', point, 2, 1, 2);
        dispatchMouse(element, 'mousedown', point, 2, 2);
        dispatchMouse(element, 'contextmenu', point, 0, 2);
        dispatchPointer(element, 'pointerup', point, 0, 1, 2);
        dispatchMouse(element, 'mouseup', point, 0, 2);
        await moveCursor(point, primitive, context, true);
        return true;
      });
    }
    if (primitive === 'act.focus') {
      return actOnTarget(primitive, payload, context, async (element) => {
        element.focus();
        return { focused: document.activeElement === element };
      });
    }
    if (primitive === 'act.type') {
      return actOnTarget(primitive, payload, context, async (element) => {
        element.focus();
        inputText(element, String(payload.text || ''), payload.replace === true);
        return { length: String(payload.text || '').length, replaced: payload.replace === true };
      });
    }
    if (primitive === 'act.clear') {
      return actOnTarget(primitive, payload, context, async (element) => {
        element.focus();
        inputText(element, '', true);
        return { cleared: true };
      });
    }
    if (primitive === 'act.select') {
      return actOnTarget(primitive, payload, context, async (element) => selectValue(element, payload));
    }
    if (primitive === 'act.press') {
      const key = String(payload.key || '');
      if (!key) return { status: 'blocked', error: { code: 'KEY_REQUIRED', message: 'act.press requires key' } };
      const target = document.activeElement || document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));
      target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key }));
      return { status: 'ok', result: { key } };
    }
    if (primitive === 'act.drag') {
      const sourceTarget = (payload.from || payload.target || payload) as TargetPayload;
      const element = resolveTarget(sourceTarget);
      if (!element) {
        return {
          status: 'blocked',
          error: { code: 'TARGET_NOT_FOUND', message: 'Target not found for act.drag' },
          result: { target: sourceTarget },
        };
      }
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const start = pointFromUnknown(sourceTarget) || centerOf(element);
      const destinationTarget = (payload.to || payload.destination || {}) as TargetPayload;
      const destinationElement = resolveTarget(destinationTarget);
      const explicitEnd = pointFromUnknown(payload.to)
        || pointFromUnknown(payload.destination)
        || (Number.isFinite(Number(payload.toX)) && Number.isFinite(Number(payload.toY))
          ? { x: Math.round(Number(payload.toX)), y: Math.round(Number(payload.toY)) }
          : null);
      const dx = Number(payload.dx);
      const dy = Number(payload.dy);
      const end = explicitEnd
        || (destinationElement ? centerOf(destinationElement) : null)
        || (Number.isFinite(dx) || Number.isFinite(dy)
          ? { x: start.x + (Number.isFinite(dx) ? dx : 0), y: start.y + (Number.isFinite(dy) ? dy : 0) }
          : null);
      if (!end) {
        return {
          status: 'blocked',
          error: { code: 'DESTINATION_REQUIRED', message: 'act.drag requires to, destination, toX/toY, dx/dy, or target point' },
          result: { target: sourceTarget },
        };
      }
      const steps = Math.min(Math.max(Number(payload.steps || 10), 2), 40);
      const pointerId = Math.max(Number(payload.pointerId || 1), 1);
      await moveCursor(start, primitive, context);
      dispatchPointer(element, 'pointerover', start, 0, pointerId);
      dispatchMouse(element, 'mouseover', start);
      dispatchPointer(element, 'pointermove', start, 0, pointerId);
      dispatchMouse(element, 'mousemove', start);
      dispatchPointer(element, 'pointerdown', start, 1, pointerId);
      dispatchMouse(element, 'mousedown', start, 1);
      for (let i = 1; i <= steps; i += 1) {
        const ratio = i / steps;
        const point = {
          x: Math.round(start.x + (end.x - start.x) * ratio),
          y: Math.round(start.y + (end.y - start.y) * ratio),
        };
        await moveCursor(point, primitive, context, i === steps);
        const target = elementAt(point);
        dispatchPointer(target, 'pointermove', point, 1, pointerId);
        dispatchMouse(target, 'mousemove', point, 1);
      }
      const finalTarget = elementAt(end);
      dispatchPointer(finalTarget, 'pointerup', end, 0, pointerId);
      dispatchMouse(finalTarget, 'mouseup', end);
      dispatchPointer(finalTarget, 'pointerout', end, 0, pointerId);
      return { status: 'ok', result: { from: start, to: end, steps, target: accessibleName(element) } };
    }
    if (primitive === 'act.scroll') {
      const target = (payload.target || payload) as TargetPayload;
      const element = resolveTarget(target);
      const dx = Number(payload.dx || 0);
      const dy = Number(payload.dy || 0);
      if (element) element.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
      else window.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
      await new Promise(resolve => setTimeout(resolve, 180));
      return { status: 'ok', result: { dx, dy, targetFound: Boolean(element) } };
    }
    if (primitive === 'act.wait') {
      const timeoutMs = Math.min(Math.max(Number(payload.timeoutMs || 1000), 1), 30000);
      if (payload.selector) {
        const found = await waitForSelector(String(payload.selector), timeoutMs);
        return found
          ? { status: 'ok', result: { selector: payload.selector, found: true } }
          : { status: 'blocked', error: { code: 'WAIT_TIMEOUT', message: `Timed out waiting for ${payload.selector}` } };
      }
      await new Promise(resolve => setTimeout(resolve, timeoutMs));
      return { status: 'ok', result: { waitedMs: timeoutMs } };
    }
    return {
      status: 'unsupported',
      error: { code: 'PRIMITIVE_UNSUPPORTED', message: `Unsupported wf-browser primitive: ${primitive}` },
    };
  } catch (err) {
    return {
      status: 'failed',
      error: { code: 'PRIMITIVE_FAILED', message: err instanceof Error ? err.message : String(err) },
    };
  }
}

async function runPrimitive(primitive: string, payload: Record<string, unknown> = {}, context: PrimitiveContext = {}): Promise<PrimitiveResult> {
  const started = performance.now();
  const before = replayPoint();
  const output = await runPrimitiveInner(primitive, payload, context);
  const after = replayPoint();
  pushReplay({
    at: new Date().toISOString(),
    primitive,
    status: output.status,
    durationMs: Math.round(performance.now() - started),
    commandId: context.commandId || '',
    agentId: context.agentId || '',
    leaseId: context.leaseId || '',
    payload: compactUnknown(payload, 1200),
    target: replayTarget(output.result),
    result: compactUnknown(output.result, 1600),
    error: compactUnknown(output.error, 800),
    before,
    after,
  });
  return {
    ...output,
    events: [
      ...(output.events || []),
      { type: 'replay.entry', seq: replaySeq, primitive, status: output.status },
    ],
  };
}

function sendHello(ws: WebSocket, config: RuntimeConfig) {
  ws.send(JSON.stringify({
    type: 'hello',
    role: 'frontend',
    runId: config.runId,
    windowId: config.windowId,
    agentId: config.agentId,
    leaseId: config.leaseId,
    route: observeRoute(),
    capabilities: observeCapabilities().capabilities,
      supports: {
        observe: ['observe.route', 'observe.capabilities', 'observe.uiTree', 'observe.state', 'observe.logs', 'observe.network', 'observe.replay', 'observe.diff'],
        act: ['act.intent', 'act.hover', 'act.click', 'act.contextMenu', 'act.focus', 'act.type', 'act.clear', 'act.select', 'act.press', 'act.drag', 'act.scroll', 'act.wait'],
      },
  }));
}

export function WfBrowserDebugRuntime() {
  const config = useMemo(readConfig, []);
  const [cursor, setCursor] = useState<CursorState>({
    visible: false,
    x: 24,
    y: 24,
    operation: '',
    label: 'agent',
    pulse: false,
  });
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    installLogCapture();
    installNetworkCapture();
    cursorSink = setCursor;
    window.__WF_BROWSER_DEBUG__ = {
      registerCapability: registerWfBrowserCapability,
      observe: {
        route: observeRoute,
        capabilities: observeCapabilities,
        uiTree: observeUiTree,
        state: observeState,
        logs: (limit = 80) => ({ entries: logBuffer.slice(-limit) }),
        network: observeNetwork,
        replay: observeReplay,
        diff: observeDiff,
      },
      runPrimitive,
      config,
    };
    return () => {
      if (cursorSink === setCursor) cursorSink = null;
    };
  }, [config]);

  useEffect(() => {
    if (!config.enabled) return undefined;
    let mounted = true;
    const connect = () => {
      if (!mounted) return;
      const ws = new WebSocket(wsUrl('/ws/wf-browser'));
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        sendHello(ws, config);
      };
      ws.onmessage = async (event) => {
        if (typeof event.data !== 'string') return;
        let msg: any;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type === 'command') {
          ws.send(JSON.stringify({
            type: 'ack',
            commandId: msg.commandId,
            status: 'accepted',
            runId: msg.runId,
            windowId: msg.windowId,
            ts: new Date().toISOString(),
          }));
          const output = await runPrimitive(msg.primitive, msg.payload || {}, {
            commandId: msg.commandId,
            agentId: msg.agentId,
            leaseId: msg.leaseId,
          });
          ws.send(JSON.stringify({
            type: 'result',
            commandId: msg.commandId,
            status: output.status,
            result: output.result ?? null,
            events: output.events || [],
            error: output.error || null,
            ts: new Date().toISOString(),
          }));
        }
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (mounted) reconnectRef.current = setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        setConnected(false);
      };
    };
    connect();
    const onCapabilitiesChanged = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) sendHello(wsRef.current, config);
    };
    window.addEventListener('wf-browser:capabilities-changed', onCapabilitiesChanged);
    return () => {
      mounted = false;
      window.removeEventListener('wf-browser:capabilities-changed', onCapabilitiesChanged);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [config]);

  if (!config.overlay) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 2147483000,
      }}
    >
      <div
        style={{
          position: 'fixed',
          left: cursor.x,
          top: cursor.y,
          transform: 'translate(-2px, -2px)',
          transition: 'left 120ms ease, top 120ms ease',
          opacity: cursor.visible ? 1 : 0.25,
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: connected ? '#13b981' : '#64748b',
            border: '2px solid #ffffff',
            boxShadow: cursor.pulse ? '0 0 0 12px rgba(19, 185, 129, 0.18)' : '0 3px 12px rgba(15, 23, 42, 0.35)',
          }}
        />
        <div
          style={{
            marginTop: 6,
            marginLeft: 8,
            padding: '3px 7px',
            borderRadius: 6,
            background: 'rgba(15, 23, 42, 0.86)',
            color: '#ffffff',
            fontSize: 11,
            lineHeight: '14px',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          {cursor.label}{cursor.operation ? ` ${cursor.operation}` : ''}
        </div>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    __WF_BROWSER_DEBUG__?: {
      registerCapability: typeof registerWfBrowserCapability;
      observe: {
        route: typeof observeRoute;
        capabilities: typeof observeCapabilities;
        uiTree: typeof observeUiTree;
        state: typeof observeState;
        logs: (limit?: number) => { entries: typeof logBuffer };
        network: typeof observeNetwork;
        replay: typeof observeReplay;
        diff: typeof observeDiff;
      };
      runPrimitive: typeof runPrimitive;
      config: RuntimeConfig;
    };
  }
}
