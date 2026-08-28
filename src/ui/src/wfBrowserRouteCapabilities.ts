import { useMemo } from 'react';
import { useWfBrowserCapabilities, type WfBrowserCapability } from './wfBrowserDebug';

type RouteCapabilityContext = {
  activeTerminalSession?: string | null;
  connection?: string;
};

const OBSERVE_CAPTURES: WfBrowserCapability['captures'] = ['ui-tree', 'state'];
const FULL_CAPTURES: WfBrowserCapability['captures'] = ['ui-tree', 'state', 'logs'];

function safeQueryAll(selector: string) {
  if (typeof document === 'undefined') return [];
  try {
    return [...document.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function safeQuery(selector: string) {
  return safeQueryAll(selector)[0] || null;
}

function isVisible(element: Element) {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function count(selector: string) {
  return safeQueryAll(selector).length;
}

function visibleCount(selector: string) {
  return safeQueryAll(selector).filter(isVisible).length;
}

function exists(selector: string) {
  const element = safeQuery(selector);
  return Boolean(element && isVisible(element));
}

function inputValue(selector: string) {
  const element = safeQuery(selector);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return element.value;
  }
  return '';
}

function selectedText(selector: string, limit = 120) {
  return safeQueryAll(selector)
    .map(element => (element.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 8)
    .map(text => text.length > limit ? `${text.slice(0, limit)}...` : text);
}

function pageCapability(id: string, label: string, pathname: string, selector: string): WfBrowserCapability {
  return {
    id,
    kind: 'route',
    label,
    selectors: { selector },
    keys: { pathname },
    state: () => ({
      pathname,
      mounted: exists(selector),
      activeTerminalSession: Boolean(safeQuery('[data-testid="terminal-window"], [data-testid="terminal-minimized"]')),
    }),
    actions: {
      'observe.uiTree': { label: 'Observe route UI tree' },
      'observe.state': { label: 'Observe route state' },
    },
    captures: FULL_CAPTURES,
  };
}

function workflowCapabilities(pathname: string): WfBrowserCapability[] {
  const nodeSelector = '[data-testid="workflow-node"], [data-testid="workflow-node-terminal"], [data-testid="workflow-component-node"]';
  return [
    pageCapability('page.workflow', 'Workflow Page', pathname, '.wf-canvas-shell'),
    {
      id: 'workflow.canvas',
      kind: 'canvas',
      label: 'Workflow Canvas',
      selectors: { testId: 'workflow-canvas', selector: '[data-testid="workflow-canvas"]' },
      state: () => ({
        mounted: exists('[data-testid="workflow-canvas"]'),
        nodes: count(nodeSelector),
        visibleNodes: visibleCount(nodeSelector),
        edges: count('[data-testid="workflow-edge"], .react-flow__edge'),
        selectedNodes: count('.react-flow__node.selected, [aria-selected="true"]'),
        contextMenuOpen: exists('[data-testid="workflow-context-menu"], [data-testid="workflow-node-context-menu"]'),
        configOpen: exists('[data-testid="workflow-node-config"]'),
      }),
      actions: {
        'act.intent': { label: 'Run semantic workflow graph command' },
        'act.click': { label: 'Click canvas' },
        'act.drag': { label: 'Drag canvas or node' },
        'act.scroll': { label: 'Pan or scroll canvas' },
      },
      captures: FULL_CAPTURES,
    },
    {
      id: 'workflow.nodes',
      kind: 'graph',
      label: 'Workflow Nodes',
      selectors: { selector: nodeSelector },
      state: () => ({
        total: count(nodeSelector),
        terminalNodes: count('[data-testid="workflow-node-terminal"]'),
        componentNodes: count('[data-testid="workflow-component-node"]'),
        visibleStatuses: selectedText('[data-testid="workflow-node-status"]', 40),
      }),
      actions: {
        'act.intent': { label: 'Run semantic workflow node or graph command' },
        'act.click': { label: 'Select first visible workflow node' },
        'act.drag': { label: 'Drag first visible workflow node' },
      },
      captures: OBSERVE_CAPTURES,
    },
    {
      id: 'workflow.toolbar',
      kind: 'component',
      label: 'Workflow Toolbar',
      selectors: { selector: '.workflow-top-toolbar' },
      state: () => ({
        createNodeVisible: exists('[data-testid="workflow-create-node"]'),
        undoEnabled: Boolean(safeQuery('[data-testid="workflow-undo"]:not(:disabled)')),
        selectionCount: selectedText('[data-testid="workflow-selection-count"], [data-testid="workflow-edge-selection-count"]', 48),
        inputOwner: safeQuery('[data-testid="terminal-input-owner"]')?.getAttribute('data-owner-surface') || 'none',
      }),
      actions: {
        'act.click': { label: 'Click toolbar control' },
      },
      captures: OBSERVE_CAPTURES,
    },
    {
      id: 'workflow.createNode',
      kind: 'element',
      label: 'Create Workflow Node',
      selectors: { testId: 'workflow-create-node', role: 'button', name: 'Create node' },
      state: () => ({ panelOpen: exists('[data-testid="workflow-create-node-panel"]') }),
      actions: { 'act.click': { label: 'Open create-node panel' } },
      captures: OBSERVE_CAPTURES,
    },
    {
      id: 'workflow.createNodePanel',
      kind: 'form',
      label: 'Create Node Panel',
      selectors: { testId: 'workflow-create-node-panel', selector: '[data-testid="workflow-create-node-panel"]' },
      state: () => ({
        open: exists('[data-testid="workflow-create-node-panel"]'),
        options: visibleCount('[data-testid="workflow-create-node-option"]'),
        agentKind: inputValue('[data-testid="workflow-agent-kind"]'),
        agentMode: inputValue('[data-testid="workflow-agent-mode"]'),
      }),
      actions: {
        'act.click': { label: 'Choose or submit create-node option' },
        'act.type': { label: 'Type create-node field' },
        'act.select': { label: 'Select create-node option' },
      },
      captures: FULL_CAPTURES,
    },
    {
      id: 'workflow.nodeConfig',
      kind: 'form',
      label: 'Workflow Node Config',
      selectors: { testId: 'workflow-node-config', selector: '[data-testid="workflow-node-config"]' },
      state: () => ({
        open: exists('[data-testid="workflow-node-config"]'),
        canStart: Boolean(safeQuery('[data-testid="workflow-node-config-start"]:not(:disabled), [data-testid="workflow-node-start"]:not(:disabled)')),
        canDelete: Boolean(safeQuery('[data-testid="workflow-node-config-delete"]:not(:disabled), [data-testid="workflow-node-delete"]:not(:disabled)')),
      }),
      actions: {
        'act.click': { label: 'Click node config control' },
        'act.type': { label: 'Edit node config field' },
      },
      captures: FULL_CAPTURES,
    },
    {
      id: 'workflow.bridgePanel',
      kind: 'component',
      label: 'Workflow Bridge Panel',
      selectors: { testId: 'workflow-bridge-panel', selector: '[data-testid="workflow-bridge-panel"]' },
      state: () => ({
        open: exists('[data-testid="workflow-bridge-panel"]'),
        messageCount: count('[data-testid="workflow-bridge-messages"] [data-testid], [data-testid="workflow-bridge-label"]'),
      }),
      actions: { 'act.click': { label: 'Click bridge panel control' } },
      captures: FULL_CAPTURES,
    },
  ];
}

function taskCapabilities(pathname: string): WfBrowserCapability[] {
  return [
    pageCapability('page.tasks', 'Tasks Page', pathname, '[data-testid="task-list"]'),
    {
      id: 'tasks.list',
      kind: 'component',
      label: 'Task List',
      selectors: { testId: 'task-list', selector: '[data-testid="task-list"]' },
      state: () => ({
        rows: count('[data-testid="task-row"]'),
        visibleRows: visibleCount('[data-testid="task-row"]'),
        search: inputValue('[data-testid="task-search"]'),
        inspectorOpen: exists('[data-testid="task-inspector"]'),
      }),
      actions: {
        'act.click': { label: 'Select task row' },
        'act.scroll': { label: 'Scroll task list' },
      },
      captures: OBSERVE_CAPTURES,
    },
    {
      id: 'tasks.search',
      kind: 'form',
      label: 'Task Search',
      selectors: { testId: 'task-search', role: 'textbox', name: 'Filter tasks' },
      state: () => ({ value: inputValue('[data-testid="task-search"]') }),
      actions: {
        'act.focus': { label: 'Focus task search' },
        'act.type': { label: 'Filter tasks' },
        'act.clear': { label: 'Clear task search' },
      },
      captures: OBSERVE_CAPTURES,
    },
    {
      id: 'tasks.inspector',
      kind: 'component',
      label: 'Task Inspector',
      selectors: { testId: 'task-inspector', selector: '[data-testid="task-inspector"]' },
      state: () => ({
        open: exists('[data-testid="task-inspector"]'),
        title: selectedText('[data-testid="task-inspector"] h3', 80)[0] || '',
        stateViewToggle: exists('[data-testid="task-state-view-toggle"]'),
        visualStateOpen: exists('[data-testid="task-state-visual"]'),
      }),
      actions: {
        'act.click': { label: 'Click inspector action' },
        'act.scroll': { label: 'Scroll inspector' },
      },
      captures: FULL_CAPTURES,
    },
  ];
}

function agentsCapabilities(pathname: string): WfBrowserCapability[] {
  return [
    pageCapability('page.agents', 'Agent Terminals Page', pathname, '[data-testid="agents-consistency-panel"]'),
    {
      id: 'agents.consistency',
      kind: 'component',
      label: 'Workflow Consistency Panel',
      selectors: { testId: 'agents-consistency-panel', selector: '[data-testid="agents-consistency-panel"]' },
      state: () => ({
        mounted: exists('[data-testid="agents-consistency-panel"]'),
        summary: selectedText('[data-testid="agents-consistency-panel"]', 160)[0] || '',
      }),
      actions: { 'act.click': { label: 'Refresh consistency' } },
      captures: FULL_CAPTURES,
    },
    {
      id: 'agents.resources',
      kind: 'component',
      label: 'Agent Resource Summary',
      selectors: { testId: 'agents-resource-summary', selector: '[data-testid="agents-resource-summary"]' },
      state: () => ({
        mounted: exists('[data-testid="agents-resource-summary"]'),
        summary: selectedText('[data-testid="agents-resource-summary"]', 160)[0] || '',
      }),
      captures: OBSERVE_CAPTURES,
    },
    {
      id: 'agents.launcher',
      kind: 'form',
      label: 'New Agent Terminal Launcher',
      selectors: { testId: 'agent-add-box', role: 'button', name: 'New Agent Terminal' },
      state: () => ({
        runtimes: count('[data-testid="detected-runtime-card"]'),
        pickerOpen: exists('[data-testid="agents-runtime-picker"] [role="listbox"]'),
      }),
      actions: {
        'act.click': { label: 'Open terminal launcher' },
        'act.select': { label: 'Select runtime' },
      },
      captures: FULL_CAPTURES,
    },
    {
      id: 'agents.list',
      kind: 'component',
      label: 'Running Agent Sessions',
      selectors: { testId: 'agents-list', selector: '[data-testid="agents-list"], [data-testid="agents-empty"]' },
      state: () => ({
        rows: count('[data-testid="agent-row"]'),
        empty: exists('[data-testid="agents-empty"]'),
        resourceRows: count('[data-testid="agent-resource-usage"]'),
      }),
      actions: {
        'act.click': { label: 'Open or stop agent terminal' },
        'act.scroll': { label: 'Scroll agent list' },
      },
      captures: FULL_CAPTURES,
    },
    {
      id: 'agents.cleanup',
      kind: 'component',
      label: 'Agent Cleanup Panel',
      selectors: { testId: 'cleanup-panel', selector: '[data-testid="cleanup-panel"]' },
      state: () => ({
        mounted: exists('[data-testid="cleanup-panel"]'),
        canApply: Boolean(safeQuery('[data-testid="cleanup-apply"]:not(:disabled)')),
      }),
      actions: { 'act.click': { label: 'Run cleanup action' } },
      captures: FULL_CAPTURES,
    },
  ];
}

function rolesCapabilities(pathname: string): WfBrowserCapability[] {
  return [
    pageCapability('page.roles', 'Roles Page', pathname, 'main'),
    {
      id: 'roles.graph',
      kind: 'graph',
      label: 'Role Graph',
      selectors: { selector: 'main section' },
      state: () => ({
        roleButtons: count('main section button'),
        selectedDetails: selectedText('main aside', 180)[0] || '',
      }),
      actions: {
        'act.click': { label: 'Select role node or refresh roles' },
      },
      captures: OBSERVE_CAPTURES,
    },
  ];
}

function settingsCapabilities(pathname: string): WfBrowserCapability[] {
  return [
    pageCapability('page.settings', 'Settings Page', pathname, 'main'),
    {
      id: 'settings.form',
      kind: 'form',
      label: 'Settings Form',
      selectors: { selector: 'main' },
      state: () => ({
        inputs: count('main input'),
        selects: count('main select, main [aria-haspopup="listbox"]'),
        defaultRuntime: inputValue('[data-testid="settings-default-runtime"] button'),
        savedVisible: selectedText('main', 220).some(text => text.includes('Settings saved')),
        errors: selectedText('main', 220).filter(text => text.toLowerCase().includes('failed')),
      }),
      actions: {
        'act.click': { label: 'Click settings control' },
        'act.type': { label: 'Edit settings input' },
        'act.select': { label: 'Select settings option' },
      },
      captures: FULL_CAPTURES,
    },
    {
      id: 'settings.defaultRuntime',
      kind: 'form',
      label: 'Default Runtime Picker',
      selectors: { testId: 'settings-default-runtime', selector: '[data-testid="settings-default-runtime"]' },
      state: () => ({
        mounted: exists('[data-testid="settings-default-runtime"]'),
        open: exists('[data-testid="settings-default-runtime"] [role="listbox"]'),
        current: selectedText('[data-testid="settings-default-runtime"] button', 80)[0] || '',
      }),
      actions: {
        'act.click': { label: 'Open default runtime picker' },
        'act.select': { label: 'Select default runtime' },
      },
      captures: OBSERVE_CAPTURES,
    },
  ];
}

function terminalCapabilities(activeTerminalSession?: string | null): WfBrowserCapability[] {
  if (!activeTerminalSession && !exists('[data-testid="terminal-window"], [data-testid="terminal-minimized"]')) return [];
  return [
    {
      id: 'terminal.drawer',
      kind: 'component',
      label: 'Terminal Drawer',
      selectors: { testId: 'terminal-window', selector: '[data-testid="terminal-window"], [data-testid="terminal-minimized"]' },
      keys: { sessionId: activeTerminalSession || '' },
      state: () => ({
        sessionId: selectedText('[data-testid="terminal-session-id"]', 120)[0] || activeTerminalSession || '',
        minimized: exists('[data-testid="terminal-minimized"]'),
        open: exists('[data-testid="terminal-window"]'),
        attachEnabled: selectedText('[data-testid="terminal-attach-toggle"]', 30)[0] || '',
        outputMounted: exists('[data-testid="terminal-output"]'),
        updatePromptOpen: exists('[data-testid="codex-update-prompt"]'),
      }),
      actions: {
        'act.click': { label: 'Click terminal control' },
        'act.type': { label: 'Type terminal input when attach mode is enabled' },
        'act.drag': { label: 'Move terminal window' },
      },
      captures: FULL_CAPTURES,
    },
    {
      id: 'terminal.output',
      kind: 'component',
      label: 'Terminal Output',
      selectors: { testId: 'terminal-output', selector: '[data-testid="terminal-output"]' },
      state: () => ({
        mounted: exists('[data-testid="terminal-output"]'),
        updatePromptOpen: exists('[data-testid="codex-update-prompt"]'),
      }),
      actions: {
        'act.click': { label: 'Claim terminal input owner' },
        'act.type': { label: 'Type into terminal' },
        'act.press': { label: 'Press terminal key' },
      },
      captures: FULL_CAPTURES,
    },
  ];
}

export function wfBrowserRouteCapabilities(pathname: string, context: RouteCapabilityContext = {}): WfBrowserCapability[] {
  const normalized = pathname === '/' ? '/tasks' : pathname;
  const capabilities = normalized === '/workflow'
    ? workflowCapabilities(normalized)
    : normalized === '/agents'
      ? agentsCapabilities(normalized)
      : normalized === '/roles'
        ? rolesCapabilities(normalized)
        : normalized === '/settings'
          ? settingsCapabilities(normalized)
          : taskCapabilities(normalized);

  return [
    ...capabilities,
    ...terminalCapabilities(context.activeTerminalSession),
    {
      id: 'runtime.health',
      kind: 'component',
      label: 'WF Browser Runtime Health',
      selectors: { selector: 'body' },
      keys: { connection: context.connection || '' },
      state: () => ({
        pathname: normalized,
        connection: context.connection || '',
        registeredRouteCapabilities: capabilities.length,
        activeTerminalSession: context.activeTerminalSession || '',
      }),
      captures: ['state', 'logs'],
    },
  ];
}

export function useWfBrowserRouteCapabilities(pathname: string, context: RouteCapabilityContext = {}) {
  const capabilities = useMemo(
    () => wfBrowserRouteCapabilities(pathname, context),
    [pathname, context.activeTerminalSession, context.connection],
  );
  useWfBrowserCapabilities(capabilities);
}
