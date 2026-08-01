import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
} from '@xyflow/react';
import type { Connection, Edge, EdgeProps, Node, NodeMouseHandler, NodeProps, ReactFlowInstance, Viewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  Bot,
  Boxes,
  Copy,
  ExternalLink,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Maximize2,
  MousePointer2,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Settings2,
  Shapes,
  Square,
  StickyNote,
  Terminal,
  Trash2,
  Undo2,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { apiJson, apiJsonCached, invalidateApiCache, wsUrl } from '../api';
import type {
  RuntimeInfo,
  Session,
  TaskOption,
  WorkflowComponentNodeState,
  WorkflowComponentType,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowSnapshot,
} from '../types';
import LoadingView from './LoadingView';
import RuntimePicker from './RuntimePicker';
import { useT } from '../i18n/index';
import { RuntimeBrandLabel, RuntimeBrandMark, runtimeAccentColor, runtimeDisplayName } from '../runtimeBrand';
import {
  announceTerminalInputOwner,
  copyTerminalSelection,
  handleTerminalDrop,
  handleTerminalPaste,
  installTerminalResponseGuards,
  pasteClipboardToTerminal,
  readWorkspaceItem,
  stripTerminalResponseInput,
  terminalShouldHandleKey as terminalControlShouldHandleKey,
  type TerminalSurface,
  uploadUserFiles,
} from '../terminalControl';
import WorkspaceExplorerPanel from './WorkspaceExplorerPanel';
import WorkflowNodeSettingsPanel from './WorkflowNodeSettingsPanel';
import WorkflowComponentNode from './WorkflowComponentNode';
import type { WorkflowComponentFlowNode } from './WorkflowComponentNode';

type Props = { onSelectSession: (sessionId: string) => void };

type CanvasNode = WorkflowNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  custom?: boolean;
  componentState?: WorkflowComponentNodeState;
};

type NodeMode = 'card' | 'terminal';
type AgentKind = 'main' | 'subagent';
type CreateNodeKind = 'agent' | 'file' | 'markdown' | 'diagram';
type GraphPosition = { x: number; y: number };
type WorkflowGraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  offset?: number;
};
type WorkflowGraphState = {
  schemaVersion: number;
  version: number;
  positions: Record<string, GraphPosition>;
  edges: WorkflowGraphEdge[];
  undoStack: { positions: Record<string, GraphPosition>; edges: WorkflowGraphEdge[] }[];
  redoStack: { positions: Record<string, GraphPosition>; edges: WorkflowGraphEdge[] }[];
};
type CreatePanelState = { x: number; y: number; flowX: number; flowY: number; kind?: CreateNodeKind | null } | null;
type BridgePanelState = {
  x: number;
  y: number;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  fromSessionId: string;
  toSessionId: string;
  label: string;
} | null;
type BridgeMessage = {
  seq?: number;
  ts?: string;
  fromSessionId?: string;
  toSessionId?: string;
  data?: string;
};
type TerminalInputOwnerState = { sessionId: string; surface: TerminalSurface; inputOwnerId?: string } | null;
type NodeConfigOverride = {
  config: Partial<WorkflowNodeConfig>;
  restartRequired?: boolean;
  restartRequiredFields?: string[];
};
type ComponentNodeOverride = {
  node?: WorkflowNode;
  state: WorkflowComponentNodeState;
  position?: GraphPosition;
};

type NodeCallbacks = {
  onOpenSession: (sessionId: string) => void;
  onOpenConfig: (nodeId: string) => void;
  onStartNode: (nodeId: string) => void;
  onStopNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onToggleMode: (nodeId: string) => void;
  onSaveComponentNode: (nodeId: string, patch: Partial<WorkflowComponentNodeState>) => Promise<WorkflowComponentNodeState | null>;
};

type WfNodeData = Record<string, unknown> & NodeCallbacks & {
  workflowNode: WorkflowNode;
  mode: NodeMode;
  starting: boolean;
  stopping: boolean;
  deleting: boolean;
  viewportZoom: number;
};

type AgentFlowNode = Node<WfNodeData, 'wfNode'>;
type FlowNode = AgentFlowNode | WorkflowComponentFlowNode;
type BridgeEdgeData = Record<string, unknown> & {
  sourceNodeId?: string;
  targetNodeId?: string;
  fromSessionId?: string;
  toSessionId?: string;
  relation?: string;
  bridgeId?: string;
  offset?: number;
  zoom?: number;
  selected?: boolean;
  onEdgeSelect?: (event: { stopPropagation: () => void }, edgeId: string) => void;
  onEdgeLabelClick?: (event: ReactMouseEvent | globalThis.MouseEvent, edgeId: string) => void;
  onEdgeOffsetChange?: (edgeId: string, offset: number, commit?: boolean) => void;
};
type FlowEdge = Edge<BridgeEdgeData, 'wfBridge'>;

type CanvasMenu = { x: number; y: number; flowX: number; flowY: number };
type NodeMenu = CanvasMenu & { nodeId: string };
type NodeClipboardItem = {
  node: WorkflowNode;
  position: GraphPosition;
  componentState?: WorkflowComponentNodeState;
};

const CARD_NODE_W = 278;
const CARD_NODE_H = 140;
const TERMINAL_NODE_W = 560;
const TERMINAL_NODE_H = 358;
const CREATE_PANEL_W = 344;
const CREATE_PANEL_MAX_H = 536;
const BRIDGE_PANEL_W = 420;
const BRIDGE_PANEL_MAX_H = 420;
const GRAPH_DB_NAME = 'harness-wf-ui-workflow-graph';
const GRAPH_STORE_NAME = 'graphs';
const GRAPH_STORAGE_KEY = 'harness:wf-ui:workflow-graph:v2';
const graphSchemaVersion = 1;
const WORKFLOW_GREEN = '#15803d';
const WORKFLOW_GREEN_DARK = '#166534';
const WORKFLOW_GREEN_BORDER = 'rgba(22,163,74,0.44)';
const WORKFLOW_GREEN_GLOW = 'rgba(22,163,74,0.20)';
const WORKSPACE_ITEM_TRANSFER_TYPE = 'application/x-harness-workspace-item';
const BRIDGE_LABEL_DRAG_THRESHOLD = 4;
const PANEL: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'rgba(255,255,255,0.92)',
  boxShadow: '0 12px 38px rgba(0,0,0,0.08)',
  backdropFilter: 'blur(16px)',
};

function statusColor(status: string | undefined) {
  const state = displaySessionStatus(status);
  if (state === 'running' || state === 'active' || state === 'ready') return '#166534';
  if (state === 'blocked' || state === 'exited') return '#991b1b';
  if (state === 'stopped') return '#64748b';
  if (state === 'starting' || state === 'idle') return '#d97706';
  return '#6b7280';
}

function statusTone(status: string | undefined) {
  const state = displaySessionStatus(status);
  if (state === 'running' || state === 'active' || state === 'ready') return { color: '#166534', bg: '#dcfce7', border: '#86efac' };
  if (state === 'blocked' || state === 'exited') return { color: '#991b1b', bg: '#fee2e2', border: '#fecaca' };
  if (state === 'stopped') return { color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' };
  if (state === 'starting' || state === 'idle') return { color: '#b45309', bg: '#fef3c7', border: '#fde68a' };
  return { color: '#4b5563', bg: '#f3f4f6', border: '#d1d5db' };
}

function displaySessionStatus(status: string | undefined) {
  if (status === 'saved') return 'stopped';
  return status || 'unknown';
}

function agentKindColor(agentKind: string | undefined) {
  if (agentKind === 'main') return WORKFLOW_GREEN_DARK;
  if (agentKind === 'subagent') return '#0f766e';
  return '#4b5563';
}

function liveNodeBackground(node: WorkflowNode, live: boolean, selected: boolean) {
  void node;
  if (selected) return 'linear-gradient(180deg, rgba(240,253,244,0.99), rgba(255,255,255,0.98))';
  return live
    ? 'linear-gradient(180deg, rgba(240,253,244,0.98), rgba(255,255,255,0.97))'
    : 'linear-gradient(180deg, rgba(240,253,244,0.90), rgba(255,255,255,0.96))';
}

function isLiveStatus(status: string | undefined) {
  const state = displaySessionStatus(status);
  return state === 'running' || state === 'starting';
}

function isMainAgentNode(node: WorkflowNode | null | undefined) {
  if (!node) return false;
  const role = String(node.role || '').toLowerCase();
  return node.agentKind === 'main' || role.includes('main') || role.includes('ceo');
}

function canStartNode(node: WorkflowNode | null | undefined) {
  if (!node?.sessionId || node.kind !== 'terminal-session') return false;
  return node.control?.canStart ?? !isLiveStatus(displaySessionStatus(node.status));
}

function canStopNode(node: WorkflowNode | null | undefined) {
  if (!node) return false;
  return node.control?.canStop ?? isLiveStatus(node.status);
}

function canDeleteNode(node: WorkflowNode | null | undefined) {
  if (!node) return false;
  if (isComponentNode(node)) return node.control?.canDelete ?? true;
  if (!node.sessionId) return false;
  return node.control?.canDelete ?? !isLiveStatus(node.status);
}

function canOpenTerminal(node: WorkflowNode | null | undefined) {
  if (!node?.sessionId) return false;
  return node.control?.canOpenTerminal ?? isLiveStatus(node.status);
}

function clampOverlayPosition(
  bounds: DOMRect | undefined,
  x: number,
  y: number,
  width: number,
  maxHeight: number,
) {
  const canvasW = Math.max(320, bounds?.width || 420);
  const canvasH = Math.max(240, bounds?.height || 420);
  const margin = 8;
  const panelH = Math.min(maxHeight, canvasH - margin * 2);
  return {
    x: Math.max(margin, Math.min(x, Math.max(margin, canvasW - width - margin))),
    y: Math.max(margin, Math.min(y, Math.max(margin, canvasH - panelH - margin))),
  };
}

function shortId(value: string | undefined) {
  if (!value) return '';
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function basename(value: string | undefined) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized.split('/').filter(Boolean).pop() || normalized || 'file';
}

function cloneJson<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function copiedTitle(value: string | undefined, fallback = 'Node') {
  const title = String(value || fallback).trim() || fallback;
  return title.toLowerCase().endsWith(' copy') ? title : `${title} Copy`;
}

function mimeHintForPath(value: string | undefined) {
  const ext = String(value || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  if (ext === 'pdf') return 'application/pdf';
  if (['mp4', 'webm', 'mov'].includes(ext)) return `video/${ext === 'mov' ? 'quicktime' : ext}`;
  if (['txt', 'md', 'markdown', 'json', 'csv', 'yaml', 'yml', 'log'].includes(ext)) return 'text/plain';
  if (['xls', 'xlsx'].includes(ext)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return '';
}

function filesFromTransfer(dataTransfer: DataTransfer | null) {
  const files = Array.from(dataTransfer?.files || []);
  for (const item of Array.from(dataTransfer?.items || [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && !files.some(existing => existing.name === file.name && existing.size === file.size)) files.push(file);
  }
  return files;
}

function transferHasType(dataTransfer: DataTransfer | null, expectedType: string) {
  const expected = expectedType.toLowerCase();
  return Array.from(dataTransfer?.types || []).some(type => String(type).toLowerCase() === expected);
}

function transferHasFileCandidate(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;
  return transferHasType(dataTransfer, 'files')
    || dataTransfer.files.length > 0
    || Array.from(dataTransfer.items || []).some(item => item.kind === 'file');
}

function transferHasCanvasDropCandidate(dataTransfer: DataTransfer | null) {
  return transferHasType(dataTransfer, WORKSPACE_ITEM_TRANSFER_TYPE) || transferHasFileCandidate(dataTransfer);
}

function transferHasCanvasDragCandidate(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;
  return transferHasCanvasDropCandidate(dataTransfer) || transferHasType(dataTransfer, 'text/plain');
}

function shouldIgnoreCanvasFileGesture(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element?.closest('[data-canvas-control="true"], input, textarea, select, [contenteditable="true"], .xterm'));
}

function shouldIgnoreCanvasPaneGesture(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  return Boolean(element?.closest('[data-canvas-control="true"], .nodrag, .nopan, .nowheel'));
}

function shouldIgnoreCanvasPaneEvent(event: { target?: EventTarget | null; clientX?: number; clientY?: number } | null | undefined) {
  if (shouldIgnoreCanvasPaneGesture(event?.target ?? null)) return true;
  const clientX = Number(event?.clientX);
  const clientY = Number(event?.clientY);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  const elementAtPoint = document.elementFromPoint(clientX, clientY);
  return shouldIgnoreCanvasPaneGesture(elementAtPoint);
}

function nodeKindIcon(kind: string) {
  if (kind === 'terminal-session') return Terminal;
  return Bot;
}

function stripRepeatedAgentRole(value: string) {
  return value
    .replace(/\bmain\s+agent\b/ig, '')
    .replace(/\bsubagent\b/ig, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[-_:|]\s*$/g, '')
    .trim();
}

function displayNodeTitle(node: WorkflowNode) {
  const label = stripRepeatedAgentRole(node.label || node.kind || '');
  if (!node.runtime) return label || node.label || node.kind || '';
  const runtime = String(node.runtime).toLowerCase();
  const brand = runtimeDisplayName(node.runtime);
  const lower = label.toLowerCase();
  const brandLower = brand.toLowerCase();
  if (!label || lower === runtime || lower === brandLower) return brand;
  if (lower.startsWith(brandLower)) return label;
  return lower.startsWith(runtime)
    ? `${brand}${label.slice(runtime.length)}`
    : label;
}

function roleBadge(node: WorkflowNode) {
  if (node.agentKind === 'main') return 'MAIN AGENT';
  if (node.agentKind === 'subagent') return 'SUBAGENT';
  if (String(node.role || '').toLowerCase().includes('ceo')) return 'MAIN AGENT';
  if (node.sessionId) return 'AGENT';
  return node.kind.toUpperCase();
}

function emptyGraphState(): WorkflowGraphState {
  return {
    schemaVersion: graphSchemaVersion,
    version: 1,
    positions: {},
    edges: [],
    undoStack: [],
    redoStack: [],
  };
}

function normalizeGraphState(value: Partial<WorkflowGraphState> | null | undefined): WorkflowGraphState {
  const fallback = emptyGraphState();
  if (!value || typeof value !== 'object') return fallback;
  return {
    schemaVersion: graphSchemaVersion,
    version: Number(value.version || 1),
    positions: value.positions && typeof value.positions === 'object' ? value.positions : {},
    edges: Array.isArray(value.edges) ? value.edges.filter(edge => edge.source && edge.target) : [],
    undoStack: Array.isArray(value.undoStack) ? value.undoStack : [],
    redoStack: Array.isArray(value.redoStack) ? value.redoStack : [],
  };
}

function normalizePosition(value: unknown): GraphPosition | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as { x?: unknown; y?: unknown };
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function graphStateFromWorkflow(workflow: WorkflowSnapshot | null, translate: (key: string) => string): WorkflowGraphState {
  const graph = workflow?.graph;
  if (!graph) return emptyGraphState();
  const positions: Record<string, GraphPosition> = {};
  for (const [nodeId, value] of Object.entries(graph.positions || {})) {
    const point = normalizePosition(value);
    if (point) positions[nodeId] = point;
  }
  for (const node of graph.nodes || []) {
    const point = normalizePosition(node.position);
    if (node.nodeId && point && !positions[node.nodeId]) positions[node.nodeId] = point;
  }
  const graphIdToCanvasId = new Map<string, string>();
  for (const node of workflow?.nodes || []) {
    graphIdToCanvasId.set(node.id, node.id);
    if (node.graphNodeId) graphIdToCanvasId.set(node.graphNodeId, node.id);
  }
  return normalizeGraphState({
    schemaVersion: graphSchemaVersion,
    version: Number(graph.version || 1),
    positions,
    edges: (graph.edges || []).map(edge => {
      const rawSource = edge.from || edge.source || '';
      const rawTarget = edge.to || edge.target || '';
      const source = graphIdToCanvasId.get(rawSource) || rawSource;
      const target = graphIdToCanvasId.get(rawTarget) || rawTarget;
      return {
        id: edge.id || `project-${source}-${target}`,
        source,
        target,
        label: bridgeRelationLabel(edge.relation, translate),
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
        offset: Number.isFinite(Number(edge.offset)) ? Number(edge.offset) : undefined,
      };
    }).filter(edge => edge.source && edge.target),
    undoStack: Array.isArray(graph.undoStack) ? graph.undoStack as WorkflowGraphState['undoStack'] : [],
    redoStack: Array.isArray(graph.redoStack) ? graph.redoStack as WorkflowGraphState['redoStack'] : [],
  });
}

function readGraphStateFromLocalStorage() {
  try {
    return normalizeGraphState(JSON.parse(window.localStorage.getItem(GRAPH_STORAGE_KEY) || 'null'));
  } catch {
    return emptyGraphState();
  }
}

function saveGraphStateToLocalStorage(state: WorkflowGraphState) {
  try {
    window.localStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Browser storage can be unavailable in hardened contexts.
  }
}

function openGraphDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(GRAPH_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(GRAPH_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

async function loadGraphStateFromIndexedDB(workflowId: string) {
  const db = await openGraphDb();
  return new Promise<WorkflowGraphState>((resolve, reject) => {
    const tx = db.transaction(GRAPH_STORE_NAME, 'readonly');
    const request = tx.objectStore(GRAPH_STORE_NAME).get(workflowId);
    request.onsuccess = () => resolve(normalizeGraphState(request.result));
    request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
    tx.oncomplete = () => db.close();
  });
}

async function saveGraphStateToIndexedDB(workflowId: string, state: WorkflowGraphState) {
  const db = await openGraphDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(GRAPH_STORE_NAME, 'readwrite');
    tx.objectStore(GRAPH_STORE_NAME).put(state, workflowId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
  });
}

function layoutRow(nodes: WorkflowNode[], y: number, width: number, height: number, gap = 318): CanvasNode[] {
  const startX = 460 - nodes.length * gap / 2 + gap / 2 - width / 2;
  return nodes.map((node, index) => ({
    ...node,
    x: startX + index * gap,
    y,
    width,
    height,
  }));
}

function isWorkflowComponentType(value: unknown): value is WorkflowComponentType {
  return value === 'markdown' || value === 'excalidraw' || value === 'file';
}

function componentTypeFromNode(node: WorkflowNode | null | undefined): WorkflowComponentType | null {
  const value = node?.componentType || node?.type;
  return isWorkflowComponentType(value) ? value : null;
}

function isComponentNode(node: WorkflowNode | null | undefined) {
  return Boolean(node && (node.kind === 'component-node' || componentTypeFromNode(node)));
}

function defaultComponentState(type: WorkflowComponentType, nodeId: string, title: string): WorkflowComponentNodeState {
  const file = type === 'file'
    ? { source: 'workspace', path: '', name: '', mime: '', size: 0 }
    : undefined;
  return {
    nodeId,
    type,
    title,
    revision: 1,
    markdown: type === 'markdown' ? '' : undefined,
    scene: type === 'excalidraw'
      ? { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }
      : undefined,
    file,
    observableInputs: type === 'file' ? ['file'] : ['selection'],
    observableOutputs: type === 'file' ? ['file', 'path'] : ['content'],
    statePath: `Harness/a2a/component-nodes/${nodeId}.json`,
  };
}

function collectComponentStates(
  workflow: WorkflowSnapshot | null,
  overrides: Record<string, ComponentNodeOverride> = {},
) {
  const states = new Map<string, WorkflowComponentNodeState>();
  for (const [nodeId, state] of Object.entries(workflow?.componentNodes || {})) {
    const type = isWorkflowComponentType(state.type) ? state.type : 'markdown';
    states.set(nodeId, {
      ...defaultComponentState(type, state.nodeId || nodeId, state.title || nodeId),
      ...state,
      nodeId: state.nodeId || nodeId,
      type,
    });
  }
  for (const [nodeId, override] of Object.entries(overrides)) {
    const type = isWorkflowComponentType(override.state.type) ? override.state.type : 'markdown';
    states.set(nodeId, {
      ...defaultComponentState(type, override.state.nodeId || nodeId, override.state.title || nodeId),
      ...override.state,
      nodeId: override.state.nodeId || nodeId,
      type,
    });
  }
  return states;
}

function componentStateForNode(
  node: WorkflowNode,
  states: Map<string, WorkflowComponentNodeState>,
) {
  const type = componentTypeFromNode(node) || 'markdown';
  return states.get(node.id) || defaultComponentState(type, node.id, node.label || node.id);
}

function componentNodeFromState(state: WorkflowComponentNodeState): WorkflowNode {
  return {
    id: state.nodeId,
    label: state.title || state.nodeId,
    kind: 'component-node',
    componentType: state.type,
    type: state.type,
    level: 0,
    status: 'ready',
    lifecycle: 'stateful',
    runtimeState: 'ready',
    managedByCurrentServer: true,
    revision: state.revision,
    statePath: state.statePath,
    observableInputs: state.observableInputs,
    observableOutputs: state.observableOutputs,
    graphNodeId: state.nodeId,
  };
}

function layoutNodes(
  workflow: WorkflowSnapshot | null,
  graphPositions: Record<string, GraphPosition>,
  componentOverrides: Record<string, ComponentNodeOverride> = {},
): CanvasNode[] {
  const base = workflow?.nodes || [];
  const graphOrder = new Map((workflow?.graph?.nodes || []).map((node, index) => [node.nodeId, index]));
  const componentStates = collectComponentStates(workflow, componentOverrides);
  const sessionNodes = base
    .filter(node => node.kind === 'terminal-session')
    .map(node => ({
      ...node,
      label: node.label || (node.runtime ? `${node.runtime} node` : 'agent node'),
      level: node.level ?? 2,
    }))
    .sort((a, b) => {
      const left = graphOrder.get(a.graphNodeId || a.id) ?? Number.MAX_SAFE_INTEGER;
      const right = graphOrder.get(b.graphNodeId || b.id) ?? Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return String(a.label).localeCompare(String(b.label));
    });

  const mainNodes = sessionNodes.filter(node => node.agentKind === 'main' || String(node.role || '').toLowerCase().includes('ceo'));
  const subagentNodes = sessionNodes.filter(node => !mainNodes.includes(node));
  const componentNodeById = new Map<string, WorkflowNode & { componentState?: WorkflowComponentNodeState }>();
  for (const node of base.filter(isComponentNode)) {
    const state = componentStateForNode(node, componentStates);
    componentNodeById.set(node.id, {
      ...node,
      label: node.label || state.title || node.id,
      kind: 'component-node',
      componentType: componentTypeFromNode(node) || state.type,
      type: componentTypeFromNode(node) || state.type,
      revision: node.revision ?? state.revision,
      statePath: node.statePath || state.statePath,
      observableInputs: node.observableInputs || state.observableInputs,
      observableOutputs: node.observableOutputs || state.observableOutputs,
      componentState: state,
    });
  }
  for (const [nodeId, state] of componentStates) {
    const overrideNode = componentOverrides[nodeId]?.node;
    componentNodeById.set(nodeId, {
      ...componentNodeFromState(state),
      ...(overrideNode || {}),
      id: nodeId,
      kind: 'component-node',
      componentType: state.type,
      type: state.type,
      label: overrideNode?.label || state.title || nodeId,
      revision: state.revision,
      statePath: state.statePath,
      observableInputs: state.observableInputs,
      observableOutputs: state.observableOutputs,
      componentState: state,
    });
  }
  const componentNodes = [...componentNodeById.values()].sort((a, b) => {
    const left = graphOrder.get(a.graphNodeId || a.id) ?? Number.MAX_SAFE_INTEGER;
    const right = graphOrder.get(b.graphNodeId || b.id) ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return String(a.label).localeCompare(String(b.label));
  });
  return [
    ...layoutRow(mainNodes, 170, CARD_NODE_W, CARD_NODE_H),
    ...layoutRow(subagentNodes, mainNodes.length > 0 ? 390 : 240, CARD_NODE_W, CARD_NODE_H),
    ...layoutRow(componentNodes, mainNodes.length > 0 ? 430 : 300, 352, 314, 398),
  ].map(node => {
    const overridePosition = isComponentNode(node) ? componentOverrides[node.id]?.position : undefined;
    const saved = graphPositions[node.id] || (node.graphNodeId ? graphPositions[node.graphNodeId] : undefined) || overridePosition;
    return saved ? { ...node, x: saved.x, y: saved.y } : node;
  });
}

function stringConfig(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function mergeNodeConfig(node: CanvasNode, override: NodeConfigOverride | undefined): CanvasNode {
  if (!override) return node;
  const config = { ...(node.config || {}), ...(override.config || {}) };
  return {
    ...node,
    role: stringConfig(config.role, node.role),
    objective: stringConfig(config.prompt, node.objective),
    model: stringConfig(config.model, node.model),
    provider: stringConfig(config.provider, node.provider),
    cwd: stringConfig(config.cwd, node.cwd),
    skills: Array.isArray(config.skills) ? config.skills.map(String) : node.skills,
    permissions: config.permissions || node.permissions,
    config,
    restartRequired: override.restartRequired ?? node.restartRequired,
    restartRequiredFields: override.restartRequiredFields ?? node.restartRequiredFields,
  };
}

function bridgeRelationLabel(relation: string | undefined, translate: (key: string) => string) {
  const value = String(relation || '').trim();
  if (!value || value === 'can-communicate') return 'wf-bridge';
  return value || translate('wf bridge');
}

function numericEdgeOffset(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(-180, Math.min(180, next)) : fallback;
}

function defaultEdgeOffset(edge: FlowEdge, siblings: FlowEdge[]) {
  const explicit = numericEdgeOffset(edge.data?.offset, Number.NaN);
  const hasReverse = siblings.some(item => item.id !== edge.id && item.source === edge.target && item.target === edge.source);
  if (Number.isFinite(explicit) && (!hasReverse || Math.abs(explicit) > 0.5)) return explicit;
  if (!hasReverse) return 0;
  return edge.source < edge.target ? -26 : 26;
}

function sameStringSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function sameGraphPositions(
  left: Record<string, GraphPosition>,
  right: Record<string, GraphPosition>,
) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;
  for (const [nodeId, point] of leftEntries) {
    const other = right[nodeId];
    if (!other || point.x !== other.x || point.y !== other.y) return false;
  }
  return true;
}

function sameGraphEdges(left: WorkflowGraphEdge[], right: WorkflowGraphEdge[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.id !== b.id) return false;
    if (a.source !== b.source || a.target !== b.target) return false;
    if ((a.label || '') !== (b.label || '')) return false;
    if ((a.sourceHandle || '') !== (b.sourceHandle || '')) return false;
    if ((a.targetHandle || '') !== (b.targetHandle || '')) return false;
    if (numericEdgeOffset(a.offset) !== numericEdgeOffset(b.offset)) return false;
  }
  return true;
}

function graphCommitSignature(state: WorkflowGraphState) {
  return JSON.stringify({
    version: state.version,
    positions: state.positions,
    edges: state.edges,
    undoStackLength: state.undoStack.length,
    redoStackLength: state.redoStack.length,
  });
}

function storedEdgesToFlowEdges(edges: WorkflowGraphEdge[], translate: (key: string) => string): FlowEdge[] {
  return edges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || undefined,
    targetHandle: edge.targetHandle || undefined,
    type: 'wfBridge',
    label: bridgeRelationLabel(edge.label, translate),
    data: { offset: numericEdgeOffset(edge.offset) },
  }));
}

function finiteGraphVersion(value: unknown) {
  if (value === undefined || value === null) return null;
  const version = Number(value);
  return Number.isFinite(version) ? version : null;
}

function isConflictError(error: unknown) {
  const message = String(error instanceof Error ? error.message : error || '');
  return /\b409\b/.test(message) || /conflict|stale/i.test(message);
}

function zoomBucket(value: number) {
  const safe = Number.isFinite(value) ? value : 1;
  return Math.round(safe * 20) / 20;
}

function bridgeStepPath({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  offset,
}: {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
  offset: number;
}): [string, number, number] {
  const gap = 16;
  const vertical = (
    sourcePosition === Position.Top
    || sourcePosition === Position.Bottom
    || targetPosition === Position.Top
    || targetPosition === Position.Bottom
  );
  if (vertical) {
    const sourceDir = sourcePosition === Position.Bottom ? 1 : -1;
    const sameVerticalSide = sourcePosition === targetPosition
      && (sourcePosition === Position.Top || sourcePosition === Position.Bottom);
    const midY = sameVerticalSide
      ? (sourceDir > 0 ? Math.max(sourceY, targetY) + gap : Math.min(sourceY, targetY) - gap) + offset
      : (sourceY + targetY) / 2 + offset;
    const xDir = targetX >= sourceX ? 1 : -1;
    const sourceYDir = midY >= sourceY ? 1 : -1;
    const targetYDir = targetY >= midY ? 1 : -1;
    const radius = Math.max(0, Math.min(
      8,
      Math.abs(targetX - sourceX) / 2,
      Math.abs(midY - sourceY) / 2,
      Math.abs(targetY - midY) / 2,
    ));
    const path = [
      `M ${sourceX} ${sourceY}`,
      `L ${sourceX} ${midY - sourceYDir * radius}`,
      `Q ${sourceX} ${midY} ${sourceX + xDir * radius} ${midY}`,
      `L ${targetX - xDir * radius} ${midY}`,
      `Q ${targetX} ${midY} ${targetX} ${midY + targetYDir * radius}`,
      `L ${targetX} ${targetY}`,
    ].join(' ');
    return [path, (sourceX + targetX) / 2, midY];
  }

  const sourceDir = sourcePosition === Position.Right ? 1 : -1;
  const sameHorizontalSide = sourcePosition === targetPosition
    && (sourcePosition === Position.Left || sourcePosition === Position.Right);
  const midX = sameHorizontalSide
    ? (sourceDir > 0 ? Math.max(sourceX, targetX) + gap : Math.min(sourceX, targetX) - gap)
    : (sourceX + targetX) / 2;
  const xDir = midX >= sourceX ? 1 : -1;
  const targetXDir = targetX >= midX ? 1 : -1;
  const yDir = targetY >= sourceY ? 1 : -1;
  const radius = Math.max(0, Math.min(
    8,
    Math.abs(midX - sourceX) / 2,
    Math.abs(targetX - midX) / 2,
    Math.abs(targetY - sourceY) / 2,
  ));
  const path = [
    `M ${sourceX} ${sourceY}`,
    `L ${midX - xDir * radius} ${sourceY}`,
    `Q ${midX} ${sourceY} ${midX} ${sourceY + yDir * radius}`,
    `L ${midX} ${targetY - yDir * radius}`,
    `Q ${midX} ${targetY} ${midX + targetXDir * radius} ${targetY}`,
    `L ${targetX} ${targetY}`,
  ].join(' ');
  return [path, midX, (sourceY + targetY) / 2 + offset];
}

function buildEdges(workflow: WorkflowSnapshot | null, nodeIds: Set<string>): WorkflowEdge[] {
  const nodeById = new Map((workflow?.nodes || []).map(node => [node.id, node]));
  return (workflow?.edges || [])
    .filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map(edge => ({
      ...edge,
      fromSessionId: nodeById.get(edge.from)?.sessionId,
      toSessionId: nodeById.get(edge.to)?.sessionId,
    }));
}

function edgeStyle(active: boolean, manual = false): CSSProperties {
  return {
    stroke: active ? WORKFLOW_GREEN : manual ? WORKFLOW_GREEN_DARK : '#9ca3af',
    strokeWidth: active ? 2.5 : manual ? 1.8 : 1.5,
    filter: active ? `drop-shadow(0 0 7px ${WORKFLOW_GREEN_GLOW})` : undefined,
  };
}

function toFlowEdges(edges: WorkflowEdge[], activeRouteEdgeIds: Set<string>, t: (key: string) => string): FlowEdge[] {
  return edges.map((edge, index) => {
    const id = `${edge.from}-${edge.to}-${index}`;
    const active = activeRouteEdgeIds.has(id);
    return {
      id,
      source: edge.from,
      target: edge.to,
      type: 'wfBridge',
      label: bridgeRelationLabel(edge.relation, t),
      data: {
        fromSessionId: edge.fromSessionId,
        toSessionId: edge.toSessionId,
        relation: edge.relation || 'wf-bridge',
        offset: numericEdgeOffset(edge.offset),
      },
      animated: active,
      markerEnd: { type: MarkerType.ArrowClosed, color: active ? WORKFLOW_GREEN : '#9ca3af' },
      style: edgeStyle(active),
      labelStyle: { fill: active ? WORKFLOW_GREEN_DARK : '#6b7280', fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: 'rgba(255,255,255,0.78)' },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 4,
    };
  });
}

function styleManualEdge(
  edge: FlowEdge,
  selectedEdgeIds: Set<string>,
  t: (key: string) => string,
  canvasNodeById: Map<string, CanvasNode>,
  siblings: FlowEdge[],
  callbacks: Pick<BridgeEdgeData, 'onEdgeSelect' | 'onEdgeLabelClick' | 'onEdgeOffsetChange'>,
  viewportZoom: number,
): FlowEdge {
  const selected = selectedEdgeIds.has(edge.id);
  const sourceNode = canvasNodeById.get(edge.source);
  const targetNode = edge.target ? canvasNodeById.get(edge.target) : null;
  const offset = defaultEdgeOffset(edge, siblings);
  return {
    ...edge,
    type: 'wfBridge',
    label: bridgeRelationLabel(typeof edge.label === 'string' ? edge.label : edge.data?.relation, t),
    data: {
      ...edge.data,
      sourceNodeId: edge.source,
      targetNodeId: edge.target || '',
      fromSessionId: edge.data?.fromSessionId || sourceNode?.sessionId,
      toSessionId: edge.data?.toSessionId || targetNode?.sessionId,
      relation: edge.data?.relation || 'wf-bridge',
      offset,
      zoom: viewportZoom,
      selected,
      ...callbacks,
    },
    animated: selected,
    markerEnd: { type: MarkerType.ArrowClosed, color: selected ? WORKFLOW_GREEN : WORKFLOW_GREEN_DARK },
    style: edgeStyle(selected, true),
    labelStyle: { fill: WORKFLOW_GREEN_DARK, fontSize: 10, fontWeight: 700 },
    labelBgStyle: { fill: 'rgba(255,255,255,0.84)' },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
  };
}

function toFlowNodes(
  canvasNodes: CanvasNode[],
  previous: FlowNode[],
  nodeModes: Record<string, NodeMode>,
  pendingStarts: Set<string>,
  pendingStops: Set<string>,
  pendingDeletes: Set<string>,
  viewportZoom: number,
  callbacks: NodeCallbacks,
): FlowNode[] {
  const previousNodes = new Map(previous.map(node => [node.id, node]));
  return canvasNodes.map(node => {
    const previousNode = previousNodes.get(node.id);
    if (isComponentNode(node)) {
      const componentState = node.componentState || componentStateForNode(node, new Map([[node.id, defaultComponentState(
        componentTypeFromNode(node) || 'markdown',
        node.id,
        node.label || node.id,
      )]]));
      return {
        id: node.id,
        type: 'workflowComponentNode',
        position: previousNode?.position || { x: node.x, y: node.y },
        width: node.width,
        height: node.height,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        zIndex: 35,
        selected: previousNode?.selected,
        data: {
          workflowNode: node,
          componentState: {
            ...componentState,
            revision: node.revision ?? componentState.revision,
            statePath: node.statePath || componentState.statePath,
            observableInputs: node.observableInputs || componentState.observableInputs,
            observableOutputs: node.observableOutputs || componentState.observableOutputs,
          },
          viewportZoom,
          onSaveComponentNode: callbacks.onSaveComponentNode,
        },
        draggable: true,
      } satisfies WorkflowComponentFlowNode;
    }
    const mode: NodeMode = node.sessionId && nodeModes[node.id] === 'terminal' ? 'terminal' : 'card';
    const width = mode === 'terminal' ? TERMINAL_NODE_W : node.width;
    const height = mode === 'terminal' ? TERMINAL_NODE_H : node.height;
    return {
      id: node.id,
      type: 'wfNode',
      position: previousNode?.position || { x: node.x, y: node.y },
      width,
      height,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      zIndex: mode === 'terminal' ? 50 : undefined,
      selected: previousNode?.selected,
      data: {
        workflowNode: node,
        mode,
        starting: pendingStarts.has(node.id),
        stopping: pendingStops.has(node.id),
        deleting: pendingDeletes.has(node.id),
        viewportZoom,
        ...callbacks,
      },
      draggable: true,
    } satisfies AgentFlowNode;
  });
}

function sameFlowNodes(a: FlowNode[], b: FlowNode[]) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left.id !== right.id) return false;
    if (left.type !== right.type) return false;
    if (left.selected !== right.selected) return false;
    if (left.width !== right.width || left.height !== right.height) return false;
    if (left.position.x !== right.position.x || left.position.y !== right.position.y) return false;
    const leftData = left.data;
    const rightData = right.data;
    const leftComponent = (leftData as any).componentState as WorkflowComponentNodeState | undefined;
    const rightComponent = (rightData as any).componentState as WorkflowComponentNodeState | undefined;
    if (leftComponent || rightComponent) {
      if (!leftComponent || !rightComponent) return false;
      if (leftComponent.nodeId !== rightComponent.nodeId) return false;
      if (leftComponent.type !== rightComponent.type) return false;
      if (leftComponent.revision !== rightComponent.revision) return false;
      if (leftComponent.title !== rightComponent.title) return false;
      if (leftComponent.statePath !== rightComponent.statePath) return false;
      if ((leftComponent.file?.path || '') !== (rightComponent.file?.path || '')) return false;
      if ((leftComponent.file?.mime || '') !== (rightComponent.file?.mime || '')) return false;
      continue;
    }
    if (leftData.mode !== rightData.mode) return false;
    if (leftData.starting !== rightData.starting) return false;
    if (leftData.stopping !== rightData.stopping) return false;
    if (leftData.deleting !== rightData.deleting) return false;
    if (leftData.viewportZoom !== rightData.viewportZoom) return false;
    const leftNode = leftData.workflowNode;
    const rightNode = rightData.workflowNode;
    if (leftNode.id !== rightNode.id || leftNode.status !== rightNode.status || leftNode.sessionId !== rightNode.sessionId) return false;
    if (leftNode.label !== rightNode.label || leftNode.kind !== rightNode.kind || leftNode.role !== rightNode.role) return false;
    if (leftNode.runtime !== rightNode.runtime || leftNode.model !== rightNode.model || leftNode.objective !== rightNode.objective) return false;
    if (leftNode.agentKind !== rightNode.agentKind || leftNode.cwd !== rightNode.cwd) return false;
    if (leftNode.control?.canStart !== rightNode.control?.canStart) return false;
    if (leftNode.control?.canStop !== rightNode.control?.canStop) return false;
    if (leftNode.control?.canDelete !== rightNode.control?.canDelete) return false;
    if (leftNode.control?.canOpenTerminal !== rightNode.control?.canOpenTerminal) return false;
  }
  return true;
}

function useAutoLoadedWorkflow() {
  const t = useT();
  const [workflow, setWorkflow] = useState<WorkflowSnapshot | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [projectRoot, setProjectRoot] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (refresh = false) => {
    try {
      if (refresh) {
        invalidateApiCache('/api/a2a/snapshot');
        invalidateApiCache('/api/runtimes');
        invalidateApiCache('/api/tasks');
      }
      const [snapshot, runtimeRows, taskRows, project] = await Promise.all([
        apiJsonCached<WorkflowSnapshot>('/api/a2a/snapshot', { ttlMs: refresh ? 0 : 1200, refresh }),
        apiJsonCached<RuntimeInfo[]>(refresh ? '/api/runtimes?refresh=1' : '/api/runtimes', { ttlMs: 12000, refresh }),
        apiJsonCached<TaskOption[]>('/api/tasks', { ttlMs: 8000, refresh }).catch(() => []),
        apiJsonCached<{ root: string }>('/api/project', { ttlMs: 8000, refresh }).catch(() => ({ root: '' })),
      ]);
      setWorkflow(snapshot);
      setRuntimes(runtimeRows);
      setTasks(taskRows);
      setProjectRoot(project.root || '');
      setError(null);
    } catch (e: any) {
      setError(e?.message || t('Failed to load workflow'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(() => load(false), 5000);
    const onSessionsChanged = () => load(true);
    window.addEventListener('harness:sessions-changed', onSessionsChanged);
    return () => {
      clearInterval(interval);
      window.removeEventListener('harness:sessions-changed', onSessionsChanged);
    };
  }, []);

  return { workflow, runtimes, tasks, projectRoot, loading, error, setError, reload: load };
}

export default function WorkflowRoute({ onSelectSession }: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowRouteInner onSelectSession={onSelectSession} />
    </ReactFlowProvider>
  );
}

function WorkflowRouteInner({ onSelectSession }: Props) {
  const t = useT();
  const { workflow, runtimes, tasks, projectRoot, loading, error, setError, reload } = useAutoLoadedWorkflow();
  const [runtimeId, setRuntimeId] = useState('');
  const [bindTask, setBindTask] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [model, setModel] = useState('');
  const [agentKind, setAgentKind] = useState<AgentKind>('main');
  const [workflowMode, setWorkflowMode] = useState('wf');
  const [agentObjective, setAgentObjective] = useState(t('Workflow agent'));
  const [agentCwd, setAgentCwd] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [launchingAgent, setLaunchingAgent] = useState(false);
  const [pendingStarts, setPendingStarts] = useState<Set<string>>(() => new Set());
  const [pendingStops, setPendingStops] = useState<Set<string>>(() => new Set());
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(() => new Set());
  const [showConfig, setShowConfig] = useState(false);
  const [showCanvasConfig, setShowCanvasConfig] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [contextMenu, setContextMenu] = useState<CanvasMenu | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeMenu | null>(null);
  const [nodeClipboard, setNodeClipboard] = useState<{ items: NodeClipboardItem[] } | null>(null);
  const [createPanel, setCreatePanel] = useState<CreatePanelState>(null);
  const [fileNodePath, setFileNodePath] = useState('');
  const [uploadingFileNode, setUploadingFileNode] = useState(false);
  const [bridgePanel, setBridgePanel] = useState<BridgePanelState>(null);
  const [bridgeMessages, setBridgeMessages] = useState<BridgeMessage[]>([]);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [nodeModes, setNodeModes] = useState<Record<string, NodeMode>>({});
  const [graphState, setGraphState] = useState<WorkflowGraphState>(() => emptyGraphState());
  const [graphLoaded, setGraphLoaded] = useState(false);
  const [manualEdges, setManualEdges] = useState<FlowEdge[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());
  const [viewportZoom, setViewportZoom] = useState(1);
  const [terminalInputOwner, setTerminalInputOwner] = useState<TerminalInputOwnerState>(null);
  const [nodeConfigOverrides, setNodeConfigOverrides] = useState<Record<string, NodeConfigOverride>>({});
  const [componentNodeOverrides, setComponentNodeOverrides] = useState<Record<string, ComponentNodeOverride>>({});
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [flowReady, setFlowReady] = useState(false);
  const flowWrapperRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const fittedOnce = useRef(false);
  const canvasControlGestureActiveRef = useRef(false);
  const canvasControlGestureViewportRef = useRef<Viewport | null>(null);
  const canvasControlGestureReleaseTimerRef = useRef<number | null>(null);
  const canvasControlGestureGuardUntilRef = useRef(0);
  const graphConnectionGestureActiveRef = useRef(false);
  const autoStartedMainNodes = useRef<Set<string>>(new Set());
  const graphCommitPendingRef = useRef(false);
  const lastGraphPersistenceSignatureRef = useRef('');
  const lastGraphPutSignatureRef = useRef('');
  const graphStateRef = useRef<WorkflowGraphState>(graphState);
  const manualEdgesRef = useRef<FlowEdge[]>(manualEdges);
  const graphBaseVersionRef = useRef<number | null>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const componentStateById = useMemo(() => collectComponentStates(workflow, componentNodeOverrides), [componentNodeOverrides, workflow]);
  const canvasNodesBase = useMemo(() => layoutNodes(workflow, graphState.positions, componentNodeOverrides), [componentNodeOverrides, graphState.positions, workflow]);
  const canvasNodes = useMemo(() => canvasNodesBase.map(node => {
    const override = nodeConfigOverrides[node.id] || (node.graphNodeId ? nodeConfigOverrides[node.graphNodeId] : undefined);
    return mergeNodeConfig(node, override);
  }), [canvasNodesBase, nodeConfigOverrides]);
  const nodeIds = useMemo(() => new Set(canvasNodes.map(node => node.id)), [canvasNodes]);
  const canvasNodeById = useMemo(() => new Map(canvasNodes.map(node => [node.id, node])), [canvasNodes]);
  const terminalModeKey = useMemo(() => canvasNodes
    .filter(node => node.sessionId && nodeModes[node.id] === 'terminal')
    .map(node => node.id)
    .join('|'), [canvasNodes, nodeModes]);
  const currentRuntime = runtimes.find(runtime => runtime.id === runtimeId) || null;
  const selectedNode = nodes.find(node => node.id === selectedNodeId)?.data.workflowNode
    || nodes.find(node => selectedNodeIds.has(node.id))?.data.workflowNode
    || canvasNodes[0]
    || null;
  const deletableSelectedNodeIds = useMemo(() => [...selectedNodeIds].filter(nodeId => {
    const node = canvasNodeById.get(nodeId);
    return Boolean(node && canDeleteNode(node));
  }), [canvasNodeById, selectedNodeIds]);
  const selectedNodeLive = canOpenTerminal(selectedNode);
  const selectedNodeCanStart = canStartNode(selectedNode);
  const selectedNodeCanStop = canStopNode(selectedNode);
  const selectedNodeCanDelete = canDeleteNode(selectedNode);
  const markdownTargets = useMemo(() => canvasNodes
    .filter(node => componentTypeFromNode(node) === 'markdown')
    .map(node => ({
      nodeId: node.graphNodeId || node.id,
      title: node.label || node.id,
    })), [canvasNodes]);

  const updateGraph = useCallback((patch: Partial<Pick<WorkflowGraphState, 'positions' | 'edges'>>) => {
    const current = graphStateRef.current;
    const positions = patch.positions || current.positions;
    const edges = patch.edges || current.edges;
    if (sameGraphPositions(current.positions, positions) && sameGraphEdges(current.edges, edges)) return;
    const next = normalizeGraphState({
      ...current,
      positions,
      edges,
      version: current.version + 1,
      undoStack: [...current.undoStack, { positions: current.positions, edges: current.edges }].slice(-40),
      redoStack: [],
    });
    graphStateRef.current = next;
    graphCommitPendingRef.current = true;
    setGraphState(next);
  }, []);

  const markGraphConnectionGesture = useCallback((
    event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement> | ReactDragEvent<HTMLDivElement>,
  ) => {
    const target = event.target instanceof Element ? event.target : null;
    const pointTarget = 'clientX' in event && 'clientY' in event
      ? document.elementFromPoint(event.clientX, event.clientY)
      : null;
    if (target?.closest('.react-flow__handle') || pointTarget?.closest('.react-flow__handle')) {
      graphConnectionGestureActiveRef.current = true;
    }
  }, []);

  const finishGraphConnectionGesture = useCallback(() => {
    if (!graphConnectionGestureActiveRef.current) return;
    graphConnectionGestureActiveRef.current = false;
  }, []);

  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes);
    const committedPositions: Record<string, GraphPosition> = {};
    for (const change of changes as Array<{ id?: string; type?: string; dragging?: boolean; position?: GraphPosition }>) {
      if (change.type !== 'position' || change.dragging !== false || !change.id || !change.position) continue;
      committedPositions[change.id] = { x: change.position.x, y: change.position.y };
    }
    if (Object.keys(committedPositions).length === 0) return;
    updateGraph({
      positions: {
        ...graphStateRef.current.positions,
        ...committedPositions,
      },
    });
  }, [onNodesChange, updateGraph]);

  useEffect(() => {
    const markConnectionGesture = (event: PointerEvent | MouseEvent | DragEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const pointTarget = 'clientX' in event && 'clientY' in event
        ? document.elementFromPoint(event.clientX, event.clientY)
        : null;
      if (target?.closest('.react-flow__handle') || pointTarget?.closest('.react-flow__handle')) {
        graphConnectionGestureActiveRef.current = true;
      }
    };
    window.addEventListener('pointerdown', markConnectionGesture, true);
    window.addEventListener('mousedown', markConnectionGesture, true);
    window.addEventListener('dragstart', markConnectionGesture, true);
    window.addEventListener('pointerup', finishGraphConnectionGesture, true);
    window.addEventListener('pointercancel', finishGraphConnectionGesture, true);
    window.addEventListener('mouseup', finishGraphConnectionGesture, true);
    window.addEventListener('dragend', finishGraphConnectionGesture, true);
    window.addEventListener('drop', finishGraphConnectionGesture, true);
    return () => {
      window.removeEventListener('pointerdown', markConnectionGesture, true);
      window.removeEventListener('mousedown', markConnectionGesture, true);
      window.removeEventListener('dragstart', markConnectionGesture, true);
      window.removeEventListener('pointerup', finishGraphConnectionGesture, true);
      window.removeEventListener('pointercancel', finishGraphConnectionGesture, true);
      window.removeEventListener('mouseup', finishGraphConnectionGesture, true);
      window.removeEventListener('dragend', finishGraphConnectionGesture, true);
      window.removeEventListener('drop', finishGraphConnectionGesture, true);
    };
  }, [finishGraphConnectionGesture]);

  const toggleNodeMode = useCallback((nodeId: string) => {
    const node = canvasNodeById.get(nodeId);
    if (!node?.sessionId) {
      setSelectedNodeId(nodeId);
      setShowConfig(true);
      return;
    }
    const next = nodeModes[nodeId] === 'terminal' ? 'card' : 'terminal';
    setNodeModes(current => ({ ...current, [nodeId]: next }));
    setSelectedNodeId(nodeId);
  }, [canvasNodeById, nodeModes]);

  const startNode = useCallback(async (nodeId: string, options: { auto?: boolean } = {}) => {
    const node = canvasNodeById.get(nodeId);
    if (!node?.sessionId || !canStartNode(node)) return;
    const graphId = node.graphNodeId || node.id;
    setPendingStarts(current => new Set(current).add(nodeId));
    if (!options.auto) setError(null);
    try {
      const result = await apiJson<{ started?: Session }>(`/api/a2a/nodes/${encodeURIComponent(graphId)}/start`, {
        method: 'POST',
        body: JSON.stringify({ previousSessionId: node.sessionId }),
      });
      invalidateApiCache('/api/a2a/snapshot');
      invalidateApiCache('/api/sessions');
      window.dispatchEvent(new CustomEvent('harness:sessions-changed', {
        detail: {
          sessionId: result.started?.sessionId || node.sessionId,
          previousSessionId: node.sessionId,
          state: result.started?.status || 'starting',
        },
      }));
      setNodeModes(current => {
        const next = { ...current };
        delete next[nodeId];
        return next;
      });
      await reload(true);
    } catch (e: any) {
      setError(e?.message || t('Failed to start node'));
    } finally {
      setPendingStarts(current => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
    }
  }, [canvasNodeById, reload, setError, t]);

  const stopNode = useCallback(async (nodeId: string) => {
    const node = canvasNodeById.get(nodeId);
    if (!node?.sessionId) return;
    setPendingStops(current => new Set(current).add(nodeId));
    setError(null);
    try {
      await apiJson(`/api/sessions/${encodeURIComponent(node.sessionId)}/stop`, { method: 'POST' });
      invalidateApiCache('/api/a2a/snapshot');
      invalidateApiCache('/api/sessions');
      window.dispatchEvent(new CustomEvent('harness:sessions-changed', { detail: { sessionId: node.sessionId, state: 'stopped' } }));
      setNodeModes(current => {
        const next = { ...current };
        delete next[nodeId];
        return next;
      });
      await reload(true);
    } catch (e: any) {
      setError(e?.message || t('Failed to stop node'));
    } finally {
      setPendingStops(current => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
    }
  }, [canvasNodeById, reload, setError]);

  const deleteNode = useCallback(async (nodeId: string) => {
    const node = canvasNodeById.get(nodeId);
    if (!node || !canDeleteNode(node)) return;
    const graphId = node.graphNodeId || node.id;
    setPendingDeletes(current => new Set(current).add(nodeId));
    setError(null);
    try {
      if (isComponentNode(node)) {
        await apiJson(`/api/a2a/component-nodes/${encodeURIComponent(graphId)}`, { method: 'DELETE' });
        setComponentNodeOverrides(current => {
          const next = { ...current };
          delete next[nodeId];
          delete next[graphId];
          return next;
        });
      } else {
        await apiJson(`/api/a2a/nodes/${encodeURIComponent(graphId)}`, { method: 'DELETE' });
      }
      invalidateApiCache('/api/a2a/snapshot');
      invalidateApiCache('/api/sessions');
      setNodeModes(current => {
        const next = { ...current };
        delete next[nodeId];
        return next;
      });
      const deletedIds = new Set([nodeId, graphId]);
      const nextManualEdges = manualEdgesRef.current.filter(edge => !deletedIds.has(edge.source) && !deletedIds.has(edge.target || ''));
      manualEdgesRef.current = nextManualEdges;
      setManualEdges(nextManualEdges);
      updateGraph({
        positions: Object.fromEntries(Object.entries(graphStateRef.current.positions).filter(([id]) => !deletedIds.has(id))),
        edges: graphStateRef.current.edges.filter(edge => !deletedIds.has(edge.source) && !deletedIds.has(edge.target)),
      });
      if (selectedNodeId === nodeId) setSelectedNodeId('');
      window.dispatchEvent(new CustomEvent('harness:sessions-changed', { detail: { sessionId: node.sessionId || nodeId, state: 'deleted' } }));
      await reload(true);
    } catch (e: any) {
      setError(e?.message || t('Failed to delete node'));
    } finally {
      setPendingDeletes(current => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
    }
  }, [canvasNodeById, reload, selectedNodeId, setError, t, updateGraph]);

  const deleteSelectedNodes = useCallback(async () => {
    const ids = [...selectedNodeIds].filter(nodeId => {
      const node = canvasNodeById.get(nodeId);
      return Boolean(node && canDeleteNode(node));
    });
    if (ids.length === 0) return;
    for (const nodeId of ids) {
      await deleteNode(nodeId);
    }
    setSelectedNodeIds(new Set());
    setNodes(current => current.map(node => ({ ...node, selected: false })));
  }, [canvasNodeById, deleteNode, selectedNodeIds, setNodes]);

  const openConfigForNode = useCallback((nodeId: string) => {
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setBridgePanel(null);
    setSelectedNodeId(current => current === nodeId ? current : nodeId);
    setSelectedNodeIds(current => {
      const next = new Set([nodeId]);
      return sameStringSet(current, next) ? current : next;
    });
    setShowConfig(true);
  }, []);

  const saveComponentNode = useCallback(async (
    nodeId: string,
    patch: Partial<WorkflowComponentNodeState>,
  ) => {
    const current = componentStateById.get(nodeId);
    if (!current) return null;
    try {
      const result = await apiJson<{
        ok?: boolean;
        nodeId?: string;
        revision?: number;
        state?: WorkflowComponentNodeState;
        sourceOfTruth?: string;
      }>(`/api/a2a/component-nodes/${encodeURIComponent(nodeId)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      const updated: WorkflowComponentNodeState = {
        ...current,
        ...patch,
        ...(result.state || {}),
        nodeId,
        type: current.type,
        revision: Number(result.state?.revision || result.revision || current.revision + 1),
        statePath: result.state?.statePath || current.statePath,
        observableInputs: result.state?.observableInputs || patch.observableInputs || current.observableInputs,
        observableOutputs: result.state?.observableOutputs || patch.observableOutputs || current.observableOutputs,
      };
      setComponentNodeOverrides(overrides => ({
        ...overrides,
        [nodeId]: {
          ...overrides[nodeId],
          state: updated,
        },
      }));
      invalidateApiCache('/api/a2a/snapshot');
      return updated;
    } catch (e: any) {
      const message = String(e?.message || '');
      if (message.includes('409')) throw new Error('Component save failed: stale revision');
      throw new Error(message || 'Component save failed');
    }
  }, [componentStateById]);

  const callbacks = useMemo(() => ({
    onOpenSession: onSelectSession,
    onOpenConfig: openConfigForNode,
    onStartNode: startNode,
    onStopNode: stopNode,
    onDeleteNode: deleteNode,
    onToggleMode: toggleNodeMode,
    onSaveComponentNode: saveComponentNode,
  }), [onSelectSession, openConfigForNode, startNode, stopNode, deleteNode, toggleNodeMode, saveComponentNode]);

  const applyNodeConfigUpdate = useCallback((
    nodeId: string,
    config: Partial<WorkflowNodeConfig>,
    meta: { responseNodeId?: string; restartRequired?: boolean; restartRequiredFields?: string[] } = {},
  ) => {
    setNodeConfigOverrides(current => {
      const next = { ...current };
      for (const key of [nodeId, meta.responseNodeId].filter(Boolean) as string[]) {
        const previous = next[key];
        next[key] = {
          config: { ...(previous?.config || {}), ...config },
          restartRequired: meta.restartRequired ?? previous?.restartRequired,
          restartRequiredFields: meta.restartRequiredFields ?? previous?.restartRequiredFields,
        };
      }
      return next;
    });
  }, []);

  const applyNodeRestart = useCallback((nodeId: string, response: { nodeId?: string; restartRequired?: boolean }) => {
    setNodeConfigOverrides(current => {
      const next = { ...current };
      for (const key of [nodeId, response.nodeId].filter(Boolean) as string[]) {
        const previous = next[key];
        next[key] = {
          config: previous?.config || {},
          restartRequired: Boolean(response.restartRequired),
          restartRequiredFields: [],
        };
      }
      return next;
    });
  }, []);

  const closeTransientPanels = useCallback(() => {
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setBridgePanel(null);
    setShowCanvasConfig(false);
  }, []);

  const beginCanvasControlGesture = useCallback(() => {
    canvasControlGestureGuardUntilRef.current = Date.now() + 350;
    if (canvasControlGestureReleaseTimerRef.current !== null) {
      window.clearTimeout(canvasControlGestureReleaseTimerRef.current);
      canvasControlGestureReleaseTimerRef.current = null;
    }
    if (canvasControlGestureActiveRef.current) return;
    canvasControlGestureActiveRef.current = true;
    canvasControlGestureViewportRef.current = flowRef.current?.getViewport() || null;
  }, []);

  const restoreCanvasControlViewport = useCallback((viewport: Viewport) => {
    const restore = () => flowRef.current?.setViewport(viewport, { duration: 0 });
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
      window.setTimeout(restore, 80);
    });
  }, []);

  const endCanvasControlGesture = useCallback(() => {
    const viewport = canvasControlGestureViewportRef.current;
    canvasControlGestureGuardUntilRef.current = Date.now() + 350;
    if (viewport) restoreCanvasControlViewport(viewport);
    if (canvasControlGestureReleaseTimerRef.current !== null) {
      window.clearTimeout(canvasControlGestureReleaseTimerRef.current);
    }
    canvasControlGestureReleaseTimerRef.current = window.setTimeout(() => {
      canvasControlGestureActiveRef.current = false;
      canvasControlGestureReleaseTimerRef.current = null;
      window.setTimeout(() => {
        if (!canvasControlGestureActiveRef.current && Date.now() >= canvasControlGestureGuardUntilRef.current) {
          canvasControlGestureViewportRef.current = null;
        }
      }, 260);
    }, 160);
  }, [restoreCanvasControlViewport]);

  const canvasControlGestureGuardActive = useCallback(() => (
    canvasControlGestureActiveRef.current || Date.now() < canvasControlGestureGuardUntilRef.current
  ), []);

  const closeTransientPanelsFromPane = useCallback((event: ReactMouseEvent) => {
    if (canvasControlGestureGuardActive() || shouldIgnoreCanvasPaneEvent(event)) {
      event.stopPropagation();
      return;
    }
    closeTransientPanels();
  }, [canvasControlGestureGuardActive, closeTransientPanels]);

  const closeTransientPanelsForCanvasMove = useCallback((event?: { target?: EventTarget | null; clientX?: number; clientY?: number; stopPropagation: () => void } | null) => {
    const target = event?.target instanceof Element ? event.target : null;
    const pointTarget = Number.isFinite(Number(event?.clientX)) && Number.isFinite(Number(event?.clientY))
      ? document.elementFromPoint(Number(event?.clientX), Number(event?.clientY))
      : null;
    if (target?.closest('.react-flow__handle') || pointTarget?.closest('.react-flow__handle')) {
      graphConnectionGestureActiveRef.current = true;
    }
    if (canvasControlGestureGuardActive() || shouldIgnoreCanvasPaneEvent(event)) {
      event?.stopPropagation();
      return;
    }
    closeTransientPanels();
  }, [canvasControlGestureGuardActive, closeTransientPanels]);

  useEffect(() => () => {
    if (canvasControlGestureReleaseTimerRef.current !== null) {
      window.clearTimeout(canvasControlGestureReleaseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    setRuntimeId(current => current && runtimes.some(runtime => runtime.id === current) ? current : runtimes[0]?.id || '');
  }, [runtimes]);

  useEffect(() => {
    const onOwner = (event: Event) => {
      const detail = (event as CustomEvent<TerminalInputOwnerState>).detail;
      if (!detail?.sessionId || !detail.surface) return;
      setTerminalInputOwner(detail);
    };
    window.addEventListener('harness:terminal-input-owner', onOwner);
    return () => window.removeEventListener('harness:terminal-input-owner', onOwner);
  }, []);

  useEffect(() => {
    setWorkflowMode(current => current || 'wf');
  }, []);

  useEffect(() => {
    setAgentCwd(current => current || projectRoot || '');
  }, [projectRoot]);

  useEffect(() => {
    setTaskId(current => current && tasks.some(task => task.taskId === current) ? current : tasks[0]?.taskId || '');
  }, [tasks]);

  useEffect(() => {
    if (!graphLoaded || canvasNodes.length === 0) return;
    const candidates = canvasNodes.filter((node) => {
      const key = node.graphNodeId || node.id;
      return isMainAgentNode(node)
        && canStartNode(node)
        && !isLiveStatus(node.status)
        && !pendingStarts.has(node.id)
        && !autoStartedMainNodes.current.has(key);
    });
    if (candidates.length === 0) return;
    for (const node of candidates) {
      autoStartedMainNodes.current.add(node.graphNodeId || node.id);
      startNode(node.id, { auto: true }).catch(() => {});
    }
  }, [canvasNodes, graphLoaded, pendingStarts, startNode]);

  useEffect(() => {
    const current = manualEdgesRef.current;
    const next = current.filter(edge => edge.source && edge.target && nodeIds.has(edge.source) && nodeIds.has(edge.target));
    if (next.length === current.length) return;
    manualEdgesRef.current = next;
    setManualEdges(next);
  }, [nodeIds]);

  useEffect(() => {
    if (!workflow?.workflowId) return;
    setGraphLoaded(false);
    const projectState = graphStateFromWorkflow(workflow, t);
    graphStateRef.current = projectState;
    graphBaseVersionRef.current = finiteGraphVersion(workflow.graph?.version);
    graphCommitPendingRef.current = false;
    lastGraphPutSignatureRef.current = '';
    setGraphState(projectState);
    const nextManualEdges = storedEdgesToFlowEdges(projectState.edges, t);
    manualEdgesRef.current = nextManualEdges;
    setManualEdges(nextManualEdges);
    setGraphLoaded(true);
  }, [t, workflow?.workflowId, workflow?.graph?.version]);

  useEffect(() => {
    if (!workflow?.workflowId || !graphLoaded) return;
    const next = normalizeGraphState(graphState);
    const persistenceSignature = `${workflow.workflowId}:${graphCommitSignature(next)}`;
    if (lastGraphPersistenceSignatureRef.current !== persistenceSignature) {
      lastGraphPersistenceSignatureRef.current = persistenceSignature;
      saveGraphStateToLocalStorage(next);
      saveGraphStateToIndexedDB(workflow.workflowId, next).catch(() => {});
    }
    if (!graphCommitPendingRef.current) return;
    const baseVersion = graphBaseVersionRef.current;
    const payload = {
      schemaVersion: next.schemaVersion,
      version: next.version,
      ...(baseVersion !== null ? { expectedVersion: baseVersion, baseVersion } : {}),
      positions: next.positions,
      nodes: canvasNodes.map(node => ({
        nodeId: node.graphNodeId || node.id,
        sessionId: node.sessionId,
        kind: node.kind,
        componentType: node.componentType,
        type: node.type,
        agentKind: node.agentKind,
        runtime: node.runtime,
        taskId: node.taskId,
        cwd: node.cwd,
        status: node.status,
        label: node.label,
        statePath: node.statePath,
        revision: node.revision,
        observableInputs: node.observableInputs,
        observableOutputs: node.observableOutputs,
        position: next.positions[node.id] || (node.graphNodeId ? next.positions[node.graphNodeId] : undefined) || { x: node.x, y: node.y },
        width: node.width,
        height: node.height,
      })),
      edges: next.edges.map(edge => ({
        id: edge.id,
        from: canvasNodeById.get(edge.source)?.graphNodeId || edge.source,
        to: canvasNodeById.get(edge.target)?.graphNodeId || edge.target,
        source: canvasNodeById.get(edge.source)?.graphNodeId || edge.source,
        target: canvasNodeById.get(edge.target)?.graphNodeId || edge.target,
        relation: bridgeRelationLabel(edge.label, t),
        sourceHandle: edge.sourceHandle || undefined,
        targetHandle: edge.targetHandle || undefined,
        offset: numericEdgeOffset(edge.offset),
      })),
      sourceOfTruth: workflow.graph?.sourceOfTruth || 'backend',
      componentStatePath: workflow.graph?.componentStatePath || 'Harness/a2a/component-nodes',
      // Undo/redo history is client-local. The shared graph-map should stay small
      // so agent context reads and canvas persistence do not grow with UI gestures.
      undoStack: [],
      redoStack: [],
    };
    const putSignature = JSON.stringify(payload);
    if (lastGraphPutSignatureRef.current === putSignature) {
      graphCommitPendingRef.current = false;
      return;
    }
    lastGraphPutSignatureRef.current = putSignature;
    graphCommitPendingRef.current = false;
    apiJson<{ version?: number; graph?: { version?: number } }>('/api/a2a/graph-map', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }).then(result => {
      const acceptedVersion = finiteGraphVersion(result?.version)
        ?? finiteGraphVersion(result?.graph?.version)
        ?? finiteGraphVersion(next.version);
      if (acceptedVersion !== null) graphBaseVersionRef.current = acceptedVersion;
    }).catch((putError) => {
      if (isConflictError(putError)) {
        invalidateApiCache('/api/a2a/snapshot');
        reloadRef.current(true).catch(() => {});
        return;
      }
      if (lastGraphPutSignatureRef.current === putSignature) lastGraphPutSignatureRef.current = '';
    });
  }, [
    canvasNodeById,
    canvasNodes,
    graphLoaded,
    graphState,
    t,
    workflow?.graph?.componentStatePath,
    workflow?.graph?.sourceOfTruth,
    workflow?.workflowId,
  ]);

  useEffect(() => {
    setNodes(previous => {
      const next = toFlowNodes(
        canvasNodes,
        previous,
        nodeModes,
        pendingStarts,
        pendingStops,
        pendingDeletes,
        viewportZoom,
        callbacks,
      );
      return sameFlowNodes(previous, next) ? previous : next;
    });
  }, [callbacks, canvasNodes, nodeModes, pendingDeletes, pendingStarts, pendingStops, setNodes, viewportZoom]);

  useEffect(() => {
    setSelectedNodeIds(current => {
      const next = new Set([...current].filter(nodeId => nodeIds.has(nodeId)));
      return next.size === current.size ? current : next;
    });
    setSelectedNodeId(current => current && nodeIds.has(current) ? current : '');
  }, [nodeIds]);

  useEffect(() => {
    if (!fittedOnce.current && flowReady && nodes.length > 0 && flowRef.current) {
      fittedOnce.current = true;
      requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.22, duration: 0 }));
    }
  }, [flowReady, nodes.length]);

  useEffect(() => {
    if (!terminalModeKey || !flowRef.current) return;
    requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.2, duration: 260 }));
  }, [terminalModeKey]);

  const nodeTypes = useMemo(() => ({ wfNode: WfNodeCard, workflowComponentNode: WorkflowComponentNode }), []);

  const flowEdgesToStored = useCallback((nextEdges: FlowEdge[]) => nextEdges.map(edge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target || '',
    label: bridgeRelationLabel(typeof edge.label === 'string' ? edge.label : edge.data?.relation, t),
    sourceHandle: edge.sourceHandle || null,
    targetHandle: edge.targetHandle || null,
    offset: numericEdgeOffset(edge.data?.offset),
  })), [t]);

  const deleteSelectedEdges = useCallback(() => {
    if (selectedEdgeIds.size === 0) return;
    const ids = new Set(selectedEdgeIds);
    const current = manualEdgesRef.current;
    const next = current.filter(edge => !ids.has(edge.id));
    if (next.length !== current.length) {
      manualEdgesRef.current = next;
      setManualEdges(next);
      updateGraph({ edges: flowEdgesToStored(next) });
    }
    setSelectedEdgeIds(new Set());
    setBridgePanel(current => current && ids.has(current.edgeId) ? null : current);
  }, [flowEdgesToStored, selectedEdgeIds, updateGraph]);

  const updateEdgeOffset = useCallback((edgeId: string, offset: number, commit = false) => {
    const nextOffset = numericEdgeOffset(offset);
    const current = manualEdgesRef.current;
    const currentEdge = current.find(edge => edge.id === edgeId);
    if (!currentEdge) return;
    const currentOffset = numericEdgeOffset(currentEdge.data?.offset);
    const offsetChanged = Math.abs(currentOffset - nextOffset) >= 0.25;
    const next = offsetChanged
      ? current.map(edge => (
          edge.id === edgeId
            ? { ...edge, data: { ...edge.data, offset: nextOffset } }
            : edge
        ))
      : current;
    if (offsetChanged) {
      manualEdgesRef.current = next;
      setManualEdges(next);
    }
    if (commit) updateGraph({ edges: flowEdgesToStored(next) });
  }, [flowEdgesToStored, updateGraph]);

  const selectEdge = useCallback((event: { stopPropagation: () => void }, edgeId: string) => {
    event.stopPropagation();
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setBridgePanel(null);
    setShowConfig(false);
    setSelectedNodeId(current => current ? '' : current);
    setSelectedNodeIds(current => current.size === 0 ? current : new Set());
    setSelectedEdgeIds(current => {
      const next = new Set([edgeId]);
      return sameStringSet(current, next) ? current : next;
    });
    setNodes(current => current.some(node => node.selected) ? current.map(node => ({ ...node, selected: false })) : current);
  }, [setNodes]);

  const undoGraph = useCallback(() => {
    const current = graphStateRef.current;
    const previous = current.undoStack[current.undoStack.length - 1];
    if (!previous) return;
    const next = normalizeGraphState({
      ...current,
      version: current.version + 1,
      positions: previous.positions,
      edges: previous.edges,
      undoStack: current.undoStack.slice(0, -1),
      redoStack: [{ positions: current.positions, edges: current.edges }, ...current.redoStack].slice(0, 40),
    });
    graphStateRef.current = next;
    graphCommitPendingRef.current = true;
    setGraphState(next);
    const nextManualEdges = storedEdgesToFlowEdges(next.edges, t);
    manualEdgesRef.current = nextManualEdges;
    setManualEdges(nextManualEdges);
  }, [t]);

  const openCreateNodePanel = useCallback((position?: { flowX: number; flowY: number; x?: number; y?: number; kind?: CreateNodeKind | null }) => {
    const bounds = flowWrapperRef.current?.getBoundingClientRect();
    const defaultX = bounds ? bounds.width - CREATE_PANEL_W - 16 : 16;
    const defaultY = bounds ? 58 : 16;
    const point = clampOverlayPosition(
      bounds,
      position?.x ?? defaultX,
      position?.y ?? defaultY,
      CREATE_PANEL_W,
      CREATE_PANEL_MAX_H,
    );
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel({
      x: point.x,
      y: point.y,
      flowX: position?.flowX ?? 260,
      flowY: position?.flowY ?? 220,
      kind: position?.kind ?? null,
    });
    setFileNodePath('');
  }, []);

  const createAgentNode = async () => {
    if (!runtimeId) return;
    setContextMenu(null);
    setNodeContextMenu(null);
    setLaunchingAgent(true);
    setError(null);
    const createPosition = createPanel ? { x: createPanel.flowX, y: createPanel.flowY } : { x: 260, y: 220 };
    try {
      const session = await apiJson<Session>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentKind,
          runtime: runtimeId,
          model,
          taskId: bindTask ? taskId : null,
          cwd: agentCwd || projectRoot,
          role: agentKind === 'main' ? 'Main Agent' : 'Subagent',
          objective: agentObjective,
          subagentMode: 'wf-subagents',
          workflowMode,
          launchPolicy: {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'never',
          },
          graphVersion: graphStateRef.current.version,
        }),
      });
      invalidateApiCache('/api/a2a/snapshot');
      invalidateApiCache('/api/sessions');
      const nodeId = `session-${session.sessionId}`;
      updateGraph({ positions: { ...graphStateRef.current.positions, [nodeId]: createPosition } });
      await reload(true);
      setSelectedNodeId(nodeId);
      setCreatePanel(null);
    } catch (e: any) {
      setError(e?.message || t('Failed to create agent node'));
    } finally {
      setLaunchingAgent(false);
    }
  };

  const createAgentNodeFromSource = useCallback(async (source: WorkflowNode, position: GraphPosition) => {
    const config = source.config || {};
    const sourceAgentKind = source.agentKind === 'subagent' ? 'subagent' : 'main';
    const sourceRuntime = source.runtime || runtimeId;
    if (!sourceRuntime) {
      setError(t('No runtime selected'));
      return;
    }
    setContextMenu(null);
    setNodeContextMenu(null);
    setLaunchingAgent(true);
    setError(null);
    try {
      const session = await apiJson<Session>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentKind: sourceAgentKind,
          runtime: sourceRuntime,
          model: source.model || String(config.model || ''),
          taskId: source.taskId || null,
          cwd: source.cwd || String(config.cwd || projectRoot || ''),
          role: source.role || String(config.role || (sourceAgentKind === 'main' ? 'Main Agent' : 'Subagent')),
          objective: source.objective || String(config.prompt || copiedTitle(source.label, 'Workflow agent')),
          subagentMode: source.subagentMode || 'wf-subagents',
          workflowMode: source.workflowMode || workflowMode,
          launchPolicy: config.launchPolicy || {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'never',
          },
          graphVersion: graphStateRef.current.version,
        }),
      });
      invalidateApiCache('/api/a2a/snapshot');
      invalidateApiCache('/api/sessions');
      const nodeId = `session-${session.sessionId}`;
      updateGraph({ positions: { ...graphStateRef.current.positions, [nodeId]: position } });
      await reload(true);
      setSelectedNodeId(nodeId);
      setSelectedNodeIds(new Set([nodeId]));
      setCreatePanel(null);
    } catch (e: any) {
      setError(e?.message || t('Failed to create agent node'));
    } finally {
      setLaunchingAgent(false);
    }
  }, [projectRoot, reload, runtimeId, setError, t, updateGraph, workflowMode]);

  const createComponentNode = useCallback(async (
    type: WorkflowComponentType,
    options: {
      position?: GraphPosition;
      title?: string;
      markdown?: string;
      scene?: WorkflowComponentNodeState['scene'];
      file?: WorkflowComponentNodeState['file'];
    } = {},
  ) => {
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setShowConfig(false);
    setError(null);
    const componentCount = canvasNodes.filter(isComponentNode).length;
    const position = options.position || {
      x: 260 + componentCount * 400,
      y: canvasNodes.some(isMainAgentNode) ? 420 : 300,
    };
    const defaultTitle = type === 'markdown'
      ? 'Markdown Notes'
      : type === 'file'
        ? (options.file?.name || options.file?.path?.split('/').pop() || 'File Node')
        : 'Diagram';
    try {
      const result = await apiJson<{
        ok?: boolean;
        nodeId?: string;
        node?: WorkflowNode & { title?: string };
        state?: WorkflowComponentNodeState;
        revision?: number;
        statePath?: string;
        sourceOfTruth?: string;
      }>('/api/a2a/component-nodes', {
        method: 'POST',
        body: JSON.stringify({
          type,
          title: options.title || defaultTitle,
          position,
          ...(options.markdown !== undefined ? { markdown: options.markdown } : {}),
          ...(options.scene !== undefined ? { scene: options.scene } : {}),
          ...(options.file ? { file: options.file } : {}),
        }),
      });
      const nodeId = result.nodeId || result.state?.nodeId || result.node?.id || `component-${type}-${Date.now()}`;
      const title = result.state?.title || result.node?.title || result.node?.label || defaultTitle;
      const defaultState = defaultComponentState(type, nodeId, title);
      const statePath = result.state?.statePath
        || result.node?.statePath
        || result.statePath
        || `Harness/a2a/component-nodes/${nodeId}/state.json`;
      const revision = Number(result.state?.revision || result.node?.revision || result.revision || defaultState.revision || 1);
      const state: WorkflowComponentNodeState = {
        ...defaultState,
        ...(result.state || {}),
        nodeId,
        type,
        title,
        revision,
        statePath,
        file: result.state?.file || options.file || defaultState.file,
        markdown: result.state?.markdown ?? options.markdown ?? defaultState.markdown,
        scene: result.state?.scene ?? options.scene ?? defaultState.scene,
        observableInputs: result.state?.observableInputs || result.node?.observableInputs || defaultState.observableInputs,
        observableOutputs: result.state?.observableOutputs || result.node?.observableOutputs || defaultState.observableOutputs,
      };
      const node: WorkflowNode = {
        ...componentNodeFromState(state),
        ...(result.node || {}),
        id: nodeId,
        kind: 'component-node',
        componentType: type,
        type,
        label: result.node?.label || state.title || nodeId,
        revision: state.revision,
        statePath: state.statePath,
        observableInputs: state.observableInputs,
        observableOutputs: state.observableOutputs,
      };
      setComponentNodeOverrides(current => ({
        ...current,
        [nodeId]: { node, state, position },
      }));
      updateGraph({
        positions: {
          ...graphStateRef.current.positions,
          [nodeId]: position,
        },
      });
      invalidateApiCache('/api/a2a/snapshot');
      setSelectedNodeId(nodeId);
      setSelectedNodeIds(new Set([nodeId]));
    } catch (e: any) {
      setError(e?.message || t('Failed to create component node'));
    }
  }, [canvasNodes, setError, t, updateGraph]);

  const flowPositionFromClient = useCallback((clientX?: number, clientY?: number): GraphPosition => {
    const bounds = flowWrapperRef.current?.getBoundingClientRect();
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      return flowRef.current?.screenToFlowPosition({ x: Number(clientX), y: Number(clientY) }) || {
        x: Number(clientX) - (bounds?.left || 0),
        y: Number(clientY) - (bounds?.top || 0),
      };
    }
    return createPanel ? { x: createPanel.flowX, y: createPanel.flowY } : { x: 260, y: 300 };
  }, [createPanel]);

  const createFileNodeFromReference = useCallback(async (
    file: NonNullable<WorkflowComponentNodeState['file']>,
    position?: GraphPosition,
  ) => {
    if (!file.path) return;
    await createComponentNode('file', {
      position,
      title: file.name || basename(file.path),
      file: {
        ...file,
        name: file.name || basename(file.path),
        mime: file.mime || mimeHintForPath(file.path),
        size: Number.isFinite(Number(file.size)) ? Number(file.size) : 0,
      },
    });
  }, [createComponentNode]);

  const insertWorkspaceEntryToCanvas = useCallback((entry: { path: string; name?: string; type?: string; size?: number }, position?: GraphPosition) => {
    const directory = entry.type === 'directory' || entry.type === 'folder';
    return createFileNodeFromReference({
      source: 'workspace',
      kind: directory ? 'folder' : 'file',
      path: entry.path,
      name: entry.name || basename(entry.path),
      mime: directory ? 'inode/directory' : mimeHintForPath(entry.path),
      size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : 0,
    }, position);
  }, [createFileNodeFromReference]);

  const createFileNodesFromUploads = useCallback(async (files: FileList | File[], position: GraphPosition) => {
    const items = await uploadUserFiles(files);
    let offset = 0;
    for (const item of items) {
      await createFileNodeFromReference({
        source: 'user-file',
        kind: 'file',
        path: item.path,
        name: item.name || basename(item.path),
        mime: item.mime || mimeHintForPath(item.path),
        size: item.size || 0,
      }, { x: position.x + offset, y: position.y + offset });
      offset += 28;
    }
  }, [createFileNodeFromReference]);

  const clipboardItemsForNodeIds = useCallback((nodeIds: string[]) => (
    nodeIds
      .map(nodeId => {
        const node = canvasNodeById.get(nodeId);
        if (!node) return null;
        const graphId = node.graphNodeId || node.id;
        const componentState = componentStateById.get(node.id)
          || componentStateById.get(graphId)
          || node.componentState;
        return {
          node: cloneJson(node),
          position: { x: node.x, y: node.y },
          ...(componentState ? { componentState: cloneJson(componentState) } : {}),
        };
      })
      .filter(Boolean) as NodeClipboardItem[]
  ), [canvasNodeById, componentStateById]);

  const pasteClipboardItems = useCallback(async (items: NodeClipboardItem[], position: GraphPosition) => {
    let offset = 0;
    for (const item of items) {
      const pastePosition = { x: position.x + offset, y: position.y + offset };
      const type = componentTypeFromNode(item.node);
      if (type && item.componentState) {
        await createComponentNode(type, {
          position: pastePosition,
          title: copiedTitle(item.componentState.title || item.node.label, type),
          markdown: item.componentState.markdown,
          scene: cloneJson(item.componentState.scene),
          file: item.componentState.file ? cloneJson(item.componentState.file) : undefined,
        });
      } else {
        await createAgentNodeFromSource(item.node, pastePosition);
      }
      offset += 36;
    }
  }, [createAgentNodeFromSource, createComponentNode]);

  const copyNodesToClipboard = useCallback((nodeIds: string[]) => {
    const items = clipboardItemsForNodeIds(nodeIds);
    if (items.length === 0) return 0;
    setNodeClipboard({ items });
    navigator.clipboard?.writeText(`[Harness workflow clipboard] ${items.length} node(s) copied`).catch(() => {});
    return items.length;
  }, [clipboardItemsForNodeIds]);

  const duplicateNodesAt = useCallback(async (nodeIds: string[], position: GraphPosition) => {
    const items = clipboardItemsForNodeIds(nodeIds);
    if (items.length === 0) return;
    setNodeContextMenu(null);
    await pasteClipboardItems(items, position);
  }, [clipboardItemsForNodeIds, pasteClipboardItems]);

  const cutNodesToClipboard = useCallback(async (nodeIds: string[]) => {
    const copied = copyNodesToClipboard(nodeIds);
    if (copied === 0) return;
    setNodeContextMenu(null);
    for (const nodeId of nodeIds) {
      await deleteNode(nodeId);
    }
  }, [copyNodesToClipboard, deleteNode]);

  const pasteNodeClipboardAt = useCallback(async (position: GraphPosition) => {
    if (!nodeClipboard?.items.length) return;
    setContextMenu(null);
    setNodeContextMenu(null);
    await pasteClipboardItems(nodeClipboard.items, position);
  }, [nodeClipboard, pasteClipboardItems]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .xterm')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undoGraph();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        if (selectedNodeIds.size === 0) return;
        event.preventDefault();
        copyNodesToClipboard([...selectedNodeIds]);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
        if (selectedNodeIds.size === 0) return;
        event.preventDefault();
        cutNodesToClipboard([...selectedNodeIds]).catch((e: any) => setError(e?.message || t('Failed to delete selected nodes')));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        if (!nodeClipboard?.items.length) return;
        event.preventDefault();
        pasteNodeClipboardAt(flowPositionFromClient(undefined, undefined)).catch((e: any) => setError(e?.message || t('Failed to create component node')));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        const ids = nodes.map(node => node.id);
        const nextIds = new Set(ids);
        setSelectedEdgeIds(current => current.size === 0 ? current : new Set());
        setSelectedNodeIds(current => sameStringSet(current, nextIds) ? current : nextIds);
        setSelectedNodeId(current => current === (ids[0] || '') ? current : ids[0] || '');
        setNodes(current => current.every(node => node.selected) ? current : current.map(node => ({ ...node, selected: true })));
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedEdgeIds.size > 0) {
          event.preventDefault();
          deleteSelectedEdges();
          return;
        }
        if (selectedNodeIds.size === 0) return;
        event.preventDefault();
        deleteSelectedNodes().catch((e: any) => setError(e?.message || t('Failed to delete selected nodes')));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    copyNodesToClipboard,
    cutNodesToClipboard,
    deleteSelectedEdges,
    deleteSelectedNodes,
    flowPositionFromClient,
    nodeClipboard,
    nodes,
    pasteNodeClipboardAt,
    selectedEdgeIds.size,
    selectedNodeIds,
    selectedNodeIds.size,
    setError,
    setNodes,
    t,
    undoGraph,
  ]);

  const handleCanvasDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (shouldIgnoreCanvasFileGesture(event.target)) return;
    const hasDropCandidate = transferHasCanvasDropCandidate(event.dataTransfer);
    const workspaceItem = readWorkspaceItem(event.dataTransfer);
    const files = filesFromTransfer(event.dataTransfer);
    if (!workspaceItem && files.length === 0) {
      if (hasDropCandidate) {
        event.preventDefault();
        event.stopPropagation();
        setError(t('Failed to read dragged workspace item'));
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const position = flowPositionFromClient(event.clientX, event.clientY);
    if (workspaceItem) {
      insertWorkspaceEntryToCanvas({
        path: workspaceItem.path,
        name: workspaceItem.name || basename(workspaceItem.path),
        type: workspaceItem.kind === 'workspace-folder' ? 'directory' : 'file',
      }, position).catch((e: any) => setError(e?.message || t('Failed to create file node')));
      return;
    }
    createFileNodesFromUploads(files, position).catch((e: any) => setError(e?.message || t('Failed to upload file node')));
  }, [createFileNodesFromUploads, flowPositionFromClient, insertWorkspaceEntryToCanvas, setError, t]);

  const handleCanvasDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (shouldIgnoreCanvasFileGesture(event.target)) return;
    if (transferHasCanvasDragCandidate(event.dataTransfer)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleCanvasPaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if (shouldIgnoreCanvasFileGesture(event.target)) return;
    const files = filesFromTransfer(event.clipboardData);
    const text = event.clipboardData?.getData('text/plain') || '';
    const position = flowPositionFromClient(undefined, undefined);
    if (files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      createFileNodesFromUploads(files, position).catch((e: any) => setError(e?.message || t('Failed to upload file node')));
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length < 120 && !trimmed.includes('\n')) return;
    event.preventDefault();
    event.stopPropagation();
    createComponentNode('markdown', {
      position,
      title: 'Clipboard Notes',
      markdown: text,
    }).catch((e: any) => setError(e?.message || t('Failed to create Markdown node')));
  }, [createComponentNode, createFileNodesFromUploads, flowPositionFromClient, setError, t]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const current = manualEdgesRef.current;
    if (current.some(edge => edge.source === connection.source && edge.target === connection.target)) return;
    const edge: FlowEdge = {
      id: `manual-${connection.source}-${connection.target}-${Date.now()}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle,
      targetHandle: connection.targetHandle,
      type: 'wfBridge',
      label: connection.sourceHandle || connection.targetHandle
        ? `${connection.sourceHandle || 'source'} -> ${connection.targetHandle || 'target'}`
        : 'wf-bridge',
      data: {
        sourceNodeId: connection.source,
        targetNodeId: connection.target,
        fromSessionId: canvasNodeById.get(connection.source)?.sessionId,
        toSessionId: canvasNodeById.get(connection.target)?.sessionId,
        relation: 'wf-bridge',
        offset: 0,
      },
    };
    const next = [...current, edge];
    manualEdgesRef.current = next;
    setManualEdges(next);
    updateGraph({ edges: flowEdgesToStored(next) });
    setSelectedEdgeIds(new Set([edge.id]));
    setSelectedNodeId('');
    setSelectedNodeIds(new Set());
  }, [canvasNodeById, flowEdgesToStored, updateGraph]);

  const openPaneMenu = (event: ReactMouseEvent | globalThis.MouseEvent) => {
    event.preventDefault();
    if (canvasControlGestureGuardActive() || shouldIgnoreCanvasPaneEvent(event)) {
      event.stopPropagation();
      return;
    }
    const bounds = flowWrapperRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const flowPosition = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) || {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    const point = clampOverlayPosition(bounds, event.clientX - bounds.left, event.clientY - bounds.top, 190, nodeClipboard?.items.length ? 202 : 160);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setShowCanvasConfig(false);
    setContextMenu({
      x: point.x,
      y: point.y,
      flowX: flowPosition.x,
      flowY: flowPosition.y,
    });
  };

  const openNodeMenuAt = (
    event: Pick<ReactMouseEvent | globalThis.MouseEvent, 'preventDefault' | 'stopPropagation' | 'clientX' | 'clientY'>,
    nodeId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const node = canvasNodeById.get(nodeId);
    if (!node) return;
    const bounds = flowWrapperRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const flowPosition = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) || {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    const point = clampOverlayPosition(bounds, event.clientX - bounds.left, event.clientY - bounds.top, 220, 306);
    setContextMenu(null);
    setCreatePanel(null);
    setBridgePanel(null);
    setShowCanvasConfig(false);
    setShowConfig(false);
    setSelectedEdgeIds(current => current.size === 0 ? current : new Set());
    setSelectedNodeId(current => current === node.id ? current : node.id);
    setSelectedNodeIds(current => current.has(node.id) ? current : new Set([node.id]));
    setNodeContextMenu({
      x: point.x,
      y: point.y,
      flowX: flowPosition.x,
      flowY: flowPosition.y,
      nodeId: node.id,
    });
  };

  const openNodeMenu: NodeMouseHandler<FlowNode> = (event, node) => {
    openNodeMenuAt(event, node.id);
  };

  const openNodeMenuFromCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const nodeElement = target?.closest<HTMLElement>('[data-testid="workflow-node"], [data-testid="workflow-node-terminal"], [data-testid="workflow-component-node"]');
    const nodeKey = nodeElement?.getAttribute('data-node-id') || '';
    const node = canvasNodeById.get(nodeKey) || canvasNodes.find(item => item.graphNodeId === nodeKey) || null;
    if (!node) return;
    openNodeMenuAt(event, node.id);
  }, [canvasNodeById, canvasNodes]);

  const selectNode: NodeMouseHandler<FlowNode> = (_event, node) => {
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setBridgePanel(null);
    setSelectedEdgeIds(current => current.size === 0 ? current : new Set());
    setSelectedNodeId(current => current === node.id ? current : node.id);
    setSelectedNodeIds(current => {
      const next = new Set([node.id]);
      return sameStringSet(current, next) ? current : next;
    });
  };

  const doubleClickNode: NodeMouseHandler<FlowNode> = (_event, node) => {
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setBridgePanel(null);
    setSelectedEdgeIds(current => current.size === 0 ? current : new Set());
    setSelectedNodeId(current => current === node.id ? current : node.id);
    setSelectedNodeIds(current => {
      const next = new Set([node.id]);
      return sameStringSet(current, next) ? current : next;
    });
    setShowConfig(true);
  };

  const onSelectionChange = useCallback(({ nodes: selectedNodes = [], edges: selectedEdges = [] }: { nodes?: FlowNode[]; edges?: FlowEdge[] }) => {
    const ids = selectedNodes.map(node => node.id);
    const edgeIds = selectedEdges.map(edge => edge.id);
    const nextNodeIds = new Set(ids);
    const nextEdgeIds = new Set(edgeIds);
    setSelectedNodeIds(current => sameStringSet(current, nextNodeIds) ? current : nextNodeIds);
    setSelectedEdgeIds(current => sameStringSet(current, nextEdgeIds) ? current : nextEdgeIds);
    setSelectedNodeId(current => {
      const next = ids.length === 1 ? ids[0] : '';
      return current === next ? current : next;
    });
  }, []);

  const resetView = () => {
    setContextMenu(null);
    setNodeContextMenu(null);
    setBridgePanel(null);
    flowRef.current?.fitView({ padding: 0.22, duration: 220 });
  };

  const loadBridgeMessages = useCallback(async (panel: NonNullable<BridgePanelState>) => {
    if (!panel.fromSessionId || !panel.toSessionId) {
      setBridgeMessages([]);
      return;
    }
    setBridgeLoading(true);
    try {
      const data = await apiJson<{ entries?: BridgeMessage[] }>(`/api/a2a/bridge-messages?fromSessionId=${encodeURIComponent(panel.fromSessionId)}&toSessionId=${encodeURIComponent(panel.toSessionId)}&limit=200`);
      setBridgeMessages(data.entries || []);
    } catch (e: any) {
      setBridgeMessages([]);
      setError(e?.message || t('Failed to load bridge messages'));
    } finally {
      setBridgeLoading(false);
    }
  }, [setError, t]);

  const openBridgePanel = useCallback((event: ReactMouseEvent | globalThis.MouseEvent, edge: FlowEdge) => {
    event.stopPropagation();
    const bounds = flowWrapperRef.current?.getBoundingClientRect();
    const sourceNode = canvasNodeById.get(edge.source);
    const targetNode = edge.target ? canvasNodeById.get(edge.target) : null;
    const fromSessionId = edge.data?.fromSessionId || sourceNode?.sessionId || '';
    const toSessionId = edge.data?.toSessionId || targetNode?.sessionId || '';
    const point = clampOverlayPosition(
      bounds,
      event.clientX - (bounds?.left || 0),
      event.clientY - (bounds?.top || 0),
      BRIDGE_PANEL_W,
      BRIDGE_PANEL_MAX_H,
    );
    const panel = {
      x: point.x,
      y: point.y,
      edgeId: edge.id,
      fromNodeId: edge.source,
      toNodeId: edge.target || '',
      fromSessionId,
      toSessionId,
      label: typeof edge.label === 'string' ? edge.label : 'wf-bridge',
    };
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setShowCanvasConfig(false);
    setShowConfig(false);
    setSelectedNodeId(current => current ? '' : current);
    setSelectedNodeIds(current => current.size === 0 ? current : new Set());
    setSelectedEdgeIds(current => {
      const next = new Set([edge.id]);
      return sameStringSet(current, next) ? current : next;
    });
    setBridgePanel(panel);
    loadBridgeMessages(panel);
  }, [canvasNodeById, loadBridgeMessages]);

  const openBridgePanelById = useCallback((event: ReactMouseEvent | globalThis.MouseEvent, edgeId: string) => {
    const edge = manualEdgesRef.current.find(item => item.id === edgeId);
    if (edge) openBridgePanel(event, edge);
  }, [openBridgePanel]);

  const edgeTypes = useMemo(() => ({ wfBridge: WfBridgeEdge }), []);
  const edgeCallbacks = useMemo(() => ({
    onEdgeSelect: selectEdge,
    onEdgeLabelClick: openBridgePanelById,
    onEdgeOffsetChange: updateEdgeOffset,
  }), [openBridgePanelById, selectEdge, updateEdgeOffset]);
  const edges = useMemo(
    () => manualEdges.map(edge => styleManualEdge(edge, selectedEdgeIds, t, canvasNodeById, manualEdges, edgeCallbacks, viewportZoom)),
    [canvasNodeById, edgeCallbacks, manualEdges, selectedEdgeIds, t, viewportZoom],
  );

  const copyBridgeMessages = useCallback(() => {
    if (!bridgePanel) return;
    const lines = bridgeMessages.map(entry => {
      const direction = `${shortId(entry.fromSessionId)} -> ${shortId(entry.toSessionId)}`;
      return `[${entry.seq || ''}] ${entry.ts || ''} ${direction}\n${String(entry.data || '').trimEnd()}`;
    });
    navigator.clipboard?.writeText([
      `${bridgePanel.label}: ${bridgePanel.fromSessionId} -> ${bridgePanel.toSessionId}`,
      ...lines,
    ].join('\n\n')).catch(() => {});
  }, [bridgeMessages, bridgePanel]);

  const nodeContextTarget = nodeContextMenu ? canvasNodeById.get(nodeContextMenu.nodeId) || null : null;
  const nodeContextSelection = nodeContextMenu
    ? (selectedNodeIds.has(nodeContextMenu.nodeId) ? [...selectedNodeIds] : [nodeContextMenu.nodeId])
    : [];
  const nodeContextCanDelete = nodeContextSelection.length > 0
    && nodeContextSelection.every(nodeId => canDeleteNode(canvasNodeById.get(nodeId)));
  const workflowToastMessage = error;
  const workflowToastIsError = Boolean(error);
  const handleNodeContextAction = (action: string) => {
    if (!nodeContextMenu) return;
    const selection = nodeContextSelection.length > 0 ? nodeContextSelection : [nodeContextMenu.nodeId];
    if (action === 'settings' || action === 'open-config') {
      openConfigForNode(nodeContextMenu.nodeId);
      return;
    }
    if (action === 'copy') {
      copyNodesToClipboard(selection);
      setNodeContextMenu(null);
      return;
    }
    if (action === 'duplicate') {
      duplicateNodesAt(selection, { x: nodeContextMenu.flowX + 36, y: nodeContextMenu.flowY + 36 })
        .catch((e: any) => setError(e?.message || t('Failed to create component node')));
      return;
    }
    if (action === 'cut') {
      cutNodesToClipboard(selection)
        .catch((e: any) => setError(e?.message || t('Failed to delete selected nodes')));
      return;
    }
    if (action === 'delete') {
      setNodeContextMenu(null);
      (async () => {
        for (const nodeId of selection) {
          await deleteNode(nodeId);
        }
        setSelectedNodeIds(current => current.size === 0 ? current : new Set());
      })().catch((e: any) => setError(e?.message || t('Failed to delete selected nodes')));
    }
  };

  if (loading) return <LoadingView label={t('Loading workflow canvas')} fullCanvas />;

  return (
    <div
      ref={flowWrapperRef}
      className="wf-canvas-shell"
      style={{ height: '100%', minHeight: 0 }}
      onDragEnterCapture={handleCanvasDragOver}
      onDragOverCapture={handleCanvasDragOver}
      onDragOver={handleCanvasDragOver}
      onDragStartCapture={markGraphConnectionGesture}
      onDragEndCapture={finishGraphConnectionGesture}
      onDrop={handleCanvasDrop}
      onDropCapture={finishGraphConnectionGesture}
      onPaste={handleCanvasPaste}
      onPointerDownCapture={markGraphConnectionGesture}
      onPointerUpCapture={finishGraphConnectionGesture}
      onPointerCancelCapture={finishGraphConnectionGesture}
      onMouseDownCapture={markGraphConnectionGesture}
      onMouseUpCapture={finishGraphConnectionGesture}
      onContextMenuCapture={openNodeMenuFromCapture}
    >
      <ReactFlow
        className="wf-flow"
        data-testid="workflow-canvas"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onDragEnter={handleCanvasDragOver}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
        onNodesChange={handleNodesChange}
        onConnect={onConnect}
        onConnectEnd={finishGraphConnectionGesture}
        onSelectionChange={onSelectionChange}
        onEdgeClick={(event, edge) => selectEdge(event, edge.id)}
        onInit={(instance) => {
          flowRef.current = instance;
          setViewportZoom(zoomBucket(instance.getZoom()));
          setFlowReady(true);
        }}
        onMove={(_event, viewport: Viewport) => {
          const controlViewport = canvasControlGestureViewportRef.current;
          if (canvasControlGestureGuardActive() && controlViewport) {
            const moved = Math.abs(viewport.x - controlViewport.x) > 0.1
              || Math.abs(viewport.y - controlViewport.y) > 0.1
              || Math.abs(viewport.zoom - controlViewport.zoom) > 0.001;
            if (moved) restoreCanvasControlViewport(controlViewport);
            return;
          }
          const nextZoom = zoomBucket(viewport.zoom);
          setViewportZoom(current => current === nextZoom ? current : nextZoom);
        }}
        onPaneClick={closeTransientPanelsFromPane}
        onPaneContextMenu={openPaneMenu}
        onNodeClick={selectNode}
        onNodeDoubleClick={doubleClickNode}
        onNodeContextMenu={openNodeMenu}
        onMoveStart={closeTransientPanelsForCanvasMove}
        onNodeDragStart={closeTransientPanels}
        onNodeDragStop={(_event, node) => {
          updateGraph({
            positions: {
              ...graphStateRef.current.positions,
              [node.id]: { x: node.position.x, y: node.position.y },
            },
          });
        }}
        minZoom={0.25}
        maxZoom={1.7}
        noDragClassName="nodrag"
        noPanClassName="nopan"
        noWheelClassName="nowheel"
        panOnDrag
        panOnScroll
        selectionOnDrag
        nodesDraggable
        nodesConnectable
        nodesFocusable
        edgesFocusable
        connectionRadius={28}
        connectionMode={ConnectionMode.Loose}
        defaultEdgeOptions={{ type: 'wfBridge' }}
        proOptions={{ hideAttribution: true }}
      >
        <Panel position="top-left">
          <WorkspaceExplorerPanel
            root={projectRoot}
            onInsertFile={entry => insertWorkspaceEntryToCanvas(entry)}
            onGestureStart={beginCanvasControlGesture}
            onGestureEnd={endCanvasControlGesture}
          />
        </Panel>
        <Background variant={BackgroundVariant.Dots} color="rgba(100,116,139,0.30)" gap={28} size={1.2} />
        <Controls position="bottom-right" showInteractive={false} />
        {showMiniMap && (
          <>
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              nodeStrokeWidth={3}
              nodeColor={(node) => statusColor((node.data as WfNodeData).workflowNode.status)}
              style={{ width: 104, height: 70, borderRadius: 6, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.84)' }}
            />
            <Panel position="bottom-left">
              <button data-canvas-control="true" data-testid="workflow-minimap-close" className="nodrag nopan" title={t('Close minimap')} onClick={() => setShowMiniMap(false)}
                style={{ marginLeft: 88, marginBottom: 54, width: 18, height: 18, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 999, background: 'rgba(255,255,255,0.96)', color: 'var(--muted)' }}>
                <X size={10} />
              </button>
            </Panel>
          </>
        )}

        {showCanvasConfig && (
          <Panel position="top-left">
            <aside data-canvas-control="true" data-testid="workflow-canvas-config" className="nodrag nopan nowheel" style={{ ...PANEL, width: 326, maxHeight: 'calc(100vh - var(--header-h) - 32px)', overflow: 'auto', padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <Boxes size={14} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{t('Canvas Config')}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {workflow?.workflowId || 'workflow-none'}
                    </div>
                  </div>
                </div>
                <button onClick={() => setShowCanvasConfig(false)} style={{ fontSize: 10, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 8px' }}>{t('Close')}</button>
              </div>

              <dl style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: '6px 8px', fontSize: 11 }}>
                <dt style={{ color: 'var(--muted)' }}>{t('Graph version')}</dt><dd>{graphState.version}</dd>
                <dt style={{ color: 'var(--muted)' }}>{t('Schema')}</dt><dd>{graphState.schemaVersion}</dd>
                <dt style={{ color: 'var(--muted)' }}>{t('Live nodes')}</dt><dd>{canvasNodes.length}</dd>
                <dt style={{ color: 'var(--muted)' }}>{t('Edges')}</dt><dd>{manualEdges.length}</dd>
                <dt style={{ color: 'var(--muted)' }}>{t('Undo')}</dt><dd>{graphState.undoStack.length}</dd>
                <dt style={{ color: 'var(--muted)' }}>{t('Map')}</dt><dd style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workflow?.graph?.graphContextPath || 'Harness/a2a/workflow-map.json'}</dd>
              </dl>
            </aside>
          </Panel>
        )}

        {createPanel && (
          <div
            data-canvas-control="true"
            data-testid="workflow-create-node-panel"
            className="wf-floating-panel workflow-create-node-panel nodrag nopan nowheel"
            onPointerDown={event => event.stopPropagation()}
            style={{ ...PANEL, position: 'absolute', zIndex: 14, left: createPanel.x, top: createPanel.y, width: CREATE_PANEL_W, maxHeight: `min(${CREATE_PANEL_MAX_H}px, calc(100% - 16px))`, overflow: 'auto', padding: 12 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>
                  {createPanel.kind === 'agent' ? t('Create Agent') : createPanel.kind === 'file' ? t('Create File Node') : t('Create Node')}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{Math.round(createPanel.flowX)}, {Math.round(createPanel.flowY)}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {createPanel.kind && (
                  <button onClick={() => setCreatePanel(current => current ? { ...current, kind: null } : current)}
                    title={t('Back')}
                    style={{ fontSize: 10, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 8px' }}>
                    {t('Back')}
                  </button>
                )}
                <button onClick={() => setCreatePanel(null)} title={t('Close')} style={{ fontSize: 10, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 8px' }}>{t('Close')}</button>
              </div>
            </div>

            {!createPanel.kind && (
              <div className="workflow-create-node-options">
                {[
                  { kind: 'agent' as const, label: 'Agent node', icon: Bot, disabled: !currentRuntime || launchingAgent },
                  { kind: 'file' as const, label: 'File node', icon: FileIcon },
                  { kind: 'markdown' as const, label: 'Markdown node', icon: StickyNote },
                  { kind: 'diagram' as const, label: 'Diagram node', icon: Shapes },
                ].map(option => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.kind}
                      type="button"
                      data-testid="workflow-create-node-option"
                      data-node-kind={option.kind}
                      disabled={option.disabled}
                      title={option.kind === 'agent' ? t('Create a thinking/runtime node') : t('Create a resource node')}
                      onClick={() => {
                        if (option.kind === 'markdown') {
                          createComponentNode('markdown', { position: { x: createPanel.flowX, y: createPanel.flowY } }).catch((e: any) => setError(e?.message || t('Failed to create Markdown node')));
                          return;
                        }
                        if (option.kind === 'diagram') {
                          createComponentNode('excalidraw', { position: { x: createPanel.flowX, y: createPanel.flowY } }).catch((e: any) => setError(e?.message || t('Failed to create diagram node')));
                          return;
                        }
                        setCreatePanel(current => current ? { ...current, kind: option.kind } : current);
                      }}
                    >
                      <Icon size={15} />
                      <span>{t(option.label)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {createPanel.kind === 'file' && (
              <div style={{ display: 'grid', gap: 8 }}>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Workspace file or folder')}
                  <input
                    data-testid="workflow-create-file-path"
                    value={fileNodePath}
                    onChange={event => setFileNodePath(event.target.value)}
                    placeholder="src/example.png"
                    style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
                  />
                </label>
                <input
                  data-testid="workflow-create-file-upload"
                  type="file"
                  multiple
                  onChange={event => {
                    const files = event.currentTarget.files;
                    if (!files?.length) return;
                    setUploadingFileNode(true);
                    createFileNodesFromUploads(files, { x: createPanel.flowX, y: createPanel.flowY })
                      .catch((e: any) => setError(e?.message || t('Failed to upload file node')))
                      .finally(() => setUploadingFileNode(false));
                  }}
                />
                <button
                  type="button"
                  data-testid="workflow-create-file-submit"
                  onClick={() => createFileNodeFromReference({
                    source: 'workspace',
                    kind: 'file',
                    path: fileNodePath,
                    name: basename(fileNodePath),
                    mime: mimeHintForPath(fileNodePath),
                    size: 0,
                  }, { x: createPanel.flowX, y: createPanel.flowY })}
                  disabled={!fileNodePath.trim() || uploadingFileNode}
                  style={{ padding: '9px 10px', borderRadius: 'var(--radius)', background: '#111', color: '#fff', fontSize: 12, fontWeight: 800, opacity: !fileNodePath.trim() || uploadingFileNode ? 0.5 : 1 }}
                >
                  <Upload size={13} /> {uploadingFileNode ? t('Uploading...') : t('Insert to canvas')}
                </button>
              </div>
            )}

            {createPanel.kind === 'agent' && (
              <div style={{ display: 'grid', gap: 8 }}>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Agent Kind')}
                  <select data-testid="workflow-agent-kind" value={agentKind} onChange={e => setAgentKind(e.target.value as AgentKind)}
                    style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                    <option value="main">Main Agent</option>
                    <option value="subagent">Subagent</option>
                  </select>
                </label>
                <div style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Runtime')}
                  <RuntimePicker
                    runtimes={runtimes}
                    value={runtimeId}
                    onChange={setRuntimeId}
                    testId="workflow-agent-runtime"
                  />
                </div>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Mode')}
                  <select data-testid="workflow-agent-mode" value={workflowMode} onChange={e => setWorkflowMode(e.target.value)}
                    style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                    <option value="wf">/wf</option>
                    <option value="wf-max">/wf-max</option>
                    <option value="">none</option>
                  </select>
                </label>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Working Directory')}
                  <input value={agentCwd} onChange={e => setAgentCwd(e.target.value)} placeholder={projectRoot || t('project root')}
                    style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
                </label>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Objective / Task')}
                  <input value={agentObjective} onChange={e => setAgentObjective(e.target.value)}
                    style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
                </label>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Model')}
                  <input value={model} onChange={e => setModel(e.target.value)} placeholder={t('optional')}
                    style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--muted)' }}>
                  <input type="checkbox" checked={bindTask} onChange={e => setBindTask(e.target.checked)} />
                  {t('Bind a task')}
                </label>
                {bindTask && (
                  <select value={taskId} onChange={e => setTaskId(e.target.value)}
                    style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                    {tasks.map(task => <option key={task.taskId} value={task.taskId}>{task.taskId}</option>)}
                  </select>
                )}
                <button data-testid="workflow-create-agent-submit" onClick={createAgentNode} disabled={!currentRuntime || launchingAgent}
                  style={{ padding: '9px 10px', borderRadius: 'var(--radius)', background: '#111', color: '#fff', fontSize: 12, fontWeight: 800, opacity: !currentRuntime || launchingAgent ? 0.5 : 1 }}>
                  {launchingAgent ? t('Creating...') : t('Create Agent')}
                </button>
              </div>
            )}
          </div>
        )}

        {contextMenu && (
          <div
            data-canvas-control="true"
            data-testid="workflow-context-menu"
            className="wf-floating-panel nodrag nopan"
            onPointerDown={event => event.stopPropagation()}
            style={{ ...PANEL, position: 'absolute', zIndex: 12, left: contextMenu.x, top: contextMenu.y, width: 190, padding: 6, cursor: 'default' }}
          >
            <button
              data-testid="workflow-context-action"
              data-action="create-node"
              onClick={() => openCreateNodePanel({ x: contextMenu.x, y: contextMenu.y, flowX: contextMenu.flowX, flowY: contextMenu.flowY })}
              style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 7, color: 'var(--fg)', fontSize: 11, fontWeight: 600 }}
            >
              <Plus size={12} /> {t('Create Node')}
            </button>
            <button
              data-testid="workflow-context-action"
              data-action="canvas-config"
              onClick={() => { setContextMenu(null); setShowCanvasConfig(true); }}
              style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 7, color: 'var(--fg)', fontSize: 11 }}
            >
              <Settings2 size={12} /> {t('Canvas Config')}
            </button>
            <button
              data-testid="workflow-context-action"
              data-action="fit-view"
              onClick={resetView}
              style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 7, color: 'var(--muted)', fontSize: 11 }}
            >
              <Maximize2 size={12} /> {t('Fit View')}
            </button>
          </div>
        )}

        {nodeContextMenu && nodeContextTarget && (
          <div
            data-canvas-control="true"
            data-testid="workflow-node-context-menu"
            data-node-id={nodeContextMenu.nodeId}
            className="wf-floating-panel nodrag nopan"
            onPointerDown={event => event.stopPropagation()}
            style={{ ...PANEL, position: 'absolute', left: nodeContextMenu.x, top: nodeContextMenu.y, width: 220, padding: 6, cursor: 'default' }}
          >
            <div style={{ padding: '5px 7px 7px', borderBottom: '1px solid var(--border)', marginBottom: 4, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nodeContextTarget.label || nodeContextTarget.id}
              </div>
              <div style={{ fontSize: 9, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nodeContextSelection.length} {t('selected')}
              </div>
            </div>
            {[
              { action: 'settings', label: 'Settings', icon: Settings2 },
              { action: 'open-config', label: 'Open Config', icon: ExternalLink },
              { action: 'copy', label: 'Copy', icon: Copy },
              { action: 'cut', label: 'Cut', icon: Scissors, disabled: !nodeContextCanDelete },
              { action: 'duplicate', label: 'Duplicate', icon: Copy },
              { action: 'delete', label: 'Delete', icon: Trash2, disabled: !nodeContextCanDelete },
            ].map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.action}
                  type="button"
                  data-testid="workflow-node-context-action"
                  data-action={item.action}
                  disabled={item.disabled}
                  onClick={() => handleNodeContextAction(item.action)}
                  style={{ width: '100%', padding: '7px 8px', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 7, color: item.action === 'delete' ? '#991b1b' : 'var(--fg)', fontSize: 11, fontWeight: item.action === 'settings' ? 700 : 600, opacity: item.disabled ? 0.45 : 1 }}
                >
                  <Icon size={12} /> {t(item.label)}
                </button>
              );
            })}
          </div>
        )}

        {bridgePanel && (
          <div
            data-canvas-control="true"
            data-testid="workflow-bridge-panel"
            className="wf-floating-panel nodrag nopan nowheel"
            onPointerDown={event => event.stopPropagation()}
            style={{ ...PANEL, position: 'absolute', zIndex: 15, left: bridgePanel.x, top: bridgePanel.y, width: BRIDGE_PANEL_W, maxHeight: `min(${BRIDGE_PANEL_MAX_H}px, calc(100% - 16px))`, overflow: 'hidden', padding: 12, display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 800 }}>{bridgePanel.label}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {shortId(bridgePanel.fromSessionId)} {'->'} {shortId(bridgePanel.toSessionId)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                <button title={t('Refresh')} onClick={() => loadBridgeMessages(bridgePanel)} style={{ width: 25, height: 25, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--muted)' }}>
                  <RefreshCw size={11} />
                </button>
                <button data-testid="workflow-bridge-copy" title={t('Copy')} onClick={copyBridgeMessages} style={{ width: 25, height: 25, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--muted)' }}>
                  <Copy size={11} />
                </button>
                <button title={t('Close')} onClick={() => setBridgePanel(null)} style={{ width: 25, height: 25, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--muted)' }}>
                  <X size={11} />
                </button>
              </div>
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: '4px 8px', fontSize: 10, marginBottom: 8 }}>
              <dt style={{ color: 'var(--muted)' }}>{t('From')}</dt><dd style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bridgePanel.fromSessionId || t('unknown')}</dd>
              <dt style={{ color: 'var(--muted)' }}>{t('To')}</dt><dd style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bridgePanel.toSessionId || t('unknown')}</dd>
              <dt style={{ color: 'var(--muted)' }}>{t('Messages')}</dt><dd>{bridgeLoading ? t('Loading...') : bridgeMessages.length}</dd>
            </dl>
            <div data-testid="workflow-bridge-messages" style={{ overflow: 'auto', display: 'grid', gap: 6, paddingRight: 2 }}>
              {!bridgePanel.fromSessionId || !bridgePanel.toSessionId ? (
                <div style={{ fontSize: 11, color: 'var(--muted)', padding: 10, border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
                  {t('This edge is not bound to two managed sessions.')}
                </div>
              ) : bridgeMessages.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--muted)', padding: 10, border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
                  {bridgeLoading ? t('Loading bridge messages') : t('No bridge messages recorded yet.')}
                </div>
              ) : bridgeMessages.map(entry => (
                <div key={`${entry.seq}-${entry.ts}`} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 8, background: 'var(--surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
                    <span style={{ color: 'var(--fg)', fontWeight: 700 }}>#{entry.seq || '?'}</span>
                    <span>{shortId(entry.fromSessionId)} {'->'} {shortId(entry.toSessionId)}</span>
                    <span style={{ marginLeft: 'auto' }}>{entry.ts ? new Date(entry.ts).toLocaleString() : ''}</span>
                  </div>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 10, lineHeight: 1.45, fontFamily: 'inherit', color: 'var(--fg)' }}>{String(entry.data || '').trimEnd()}</pre>
                </div>
              ))}
            </div>
          </div>
        )}

        {showConfig && selectedNode?.kind === 'terminal-session' && selectedNode.sessionId && (
          <Panel position="bottom-right" className="workflow-node-settings-panel-host">
            <WorkflowNodeSettingsPanel
              node={selectedNode}
              projectRoot={projectRoot}
              markdownTargets={markdownTargets}
              canStart={selectedNodeCanStart}
              canStop={selectedNodeCanStop}
              canDelete={selectedNodeCanDelete}
              canOpenTerminal={selectedNodeLive}
              starting={pendingStarts.has(selectedNode.id)}
              stopping={pendingStops.has(selectedNode.id)}
              deleting={pendingDeletes.has(selectedNode.id)}
              onClose={() => setShowConfig(false)}
              onOpenTerminal={() => setNodeModes(current => ({ ...current, [selectedNode.id]: 'terminal' }))}
              onOpenDrawer={() => onSelectSession(selectedNode.sessionId!)}
              onStart={() => startNode(selectedNode.id)}
              onStop={() => stopNode(selectedNode.id)}
              onDelete={() => deleteNode(selectedNode.id)}
              onConfigSaved={applyNodeConfigUpdate}
              onRestarted={applyNodeRestart}
            />
          </Panel>
        )}

        {showConfig && selectedNode && !(selectedNode.kind === 'terminal-session' && selectedNode.sessionId) && (
          <Panel position="bottom-right" className="workflow-node-settings-panel-host">
            <aside data-canvas-control="true" data-testid="workflow-node-config" className="wf-floating-panel nodrag nopan nowheel" style={{ ...PANEL, width: 340, maxHeight: 'calc(100vh - var(--header-h) - 44px)', overflow: 'auto', padding: 12, cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedNode.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedNode.id}</div>
                </div>
                <button onClick={() => setShowConfig(false)} style={{ fontSize: 10, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3px 8px' }}>{t('Close')}</button>
              </div>

              <dl style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: '5px 8px', fontSize: 10, marginBottom: 10 }}>
                <dt style={{ color: 'var(--muted)' }}>{t('Kind')}</dt><dd>{selectedNode.kind}</dd>
                {selectedNode.agentKind && <><dt style={{ color: 'var(--muted)' }}>{t('Agent')}</dt><dd>{selectedNode.agentKind === 'main' ? 'Main Agent' : 'Subagent'}</dd></>}
                <dt style={{ color: 'var(--muted)' }}>{t('Status')}</dt><dd style={{ color: statusColor(selectedNode.status) }}>{displaySessionStatus(selectedNode.status)}</dd>
                {selectedNode.blockedReason && <><dt style={{ color: 'var(--muted)' }}>{t('Reason')}</dt><dd>{selectedNode.blockedReason}</dd></>}
                {selectedNode.role && <><dt style={{ color: 'var(--muted)' }}>{t('Role')}</dt><dd>{selectedNode.role}</dd></>}
                {selectedNode.runtime && <><dt style={{ color: 'var(--muted)' }}>{t('Runtime')}</dt><dd>{selectedNode.runtime}</dd></>}
                {selectedNode.model && <><dt style={{ color: 'var(--muted)' }}>{t('Model')}</dt><dd>{selectedNode.model}</dd></>}
                {selectedNode.taskId && <><dt style={{ color: 'var(--muted)' }}>{t('Task')}</dt><dd>{selectedNode.taskId}</dd></>}
                {selectedNode.peerId && <><dt style={{ color: 'var(--muted)' }}>{t('Peer')}</dt><dd>{shortId(selectedNode.peerId)}</dd></>}
                {selectedNode.cwd && <><dt style={{ color: 'var(--muted)' }}>{t('Cwd')}</dt><dd style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedNode.cwd}</dd></>}
                {selectedNode.graphNodeId && <><dt style={{ color: 'var(--muted)' }}>{t('Graph Node')}</dt><dd>{shortId(selectedNode.graphNodeId)}</dd></>}
                {selectedNode.nodeHomeRel && <><dt style={{ color: 'var(--muted)' }}>{t('Node Home')}</dt><dd style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedNode.nodeHomeRel}</dd></>}
                {selectedNode.nodeInitRel && <><dt style={{ color: 'var(--muted)' }}>{t('Init File')}</dt><dd style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedNode.nodeInitRel}</dd></>}
              </dl>

              {selectedNode.sessionId ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button data-testid="workflow-open-terminal" onClick={() => setNodeModes(current => ({ ...current, [selectedNode.id]: 'terminal' }))}
                    style={{ padding: '7px 10px', borderRadius: 'var(--radius)', background: '#111', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    <Terminal size={12} /> {selectedNodeLive ? t('Open Terminal') : t('Open Transcript')}
                  </button>
                  <button onClick={() => onSelectSession(selectedNode.sessionId!)}
                    style={{ padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', color: 'var(--fg)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    <ExternalLink size={12} /> {t('Drawer')}
                  </button>
                  {selectedNodeCanStart && (
                    <button data-testid="workflow-node-config-start" onClick={() => startNode(selectedNode.id)} disabled={pendingStarts.has(selectedNode.id)}
                      style={{ gridColumn: '1 / -1', padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid #86efac', color: WORKFLOW_GREEN_DARK, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: pendingStarts.has(selectedNode.id) ? 0.5 : 1 }}>
                      <Play size={12} /> {pendingStarts.has(selectedNode.id) ? t('Starting...') : t('Start Node')}
                    </button>
                  )}
                  {selectedNodeCanStop && (
                    <button onClick={() => stopNode(selectedNode.id)} disabled={pendingStops.has(selectedNode.id)}
                      style={{ gridColumn: '1 / -1', padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid #fecaca', color: '#991b1b', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: pendingStops.has(selectedNode.id) ? 0.5 : 1 }}>
                      <Square size={12} /> {pendingStops.has(selectedNode.id) ? t('Stopping...') : t('Stop Node')}
                    </button>
                  )}
                  {selectedNodeCanDelete && (
                    <button data-testid="workflow-node-config-delete" onClick={() => deleteNode(selectedNode.id)} disabled={pendingDeletes.has(selectedNode.id)}
                      style={{ gridColumn: '1 / -1', padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid #fecaca', color: '#991b1b', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: pendingDeletes.has(selectedNode.id) ? 0.5 : 1 }}>
                      <Trash2 size={12} /> {pendingDeletes.has(selectedNode.id) ? t('Deleting...') : t('Delete Node')}
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {selectedNodeCanDelete && (
                    <button data-testid="workflow-node-config-delete" onClick={() => deleteNode(selectedNode.id)} disabled={pendingDeletes.has(selectedNode.id)}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid #fecaca', color: '#991b1b', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: pendingDeletes.has(selectedNode.id) ? 0.5 : 1 }}>
                      <Trash2 size={12} /> {pendingDeletes.has(selectedNode.id) ? t('Deleting...') : t('Delete Node')}
                    </button>
                  )}
                  <button onClick={() => openCreateNodePanel()}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 'var(--radius)', background: '#111', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    <Plus size={12} /> {t('Create Node')}
                  </button>
                </div>
              )}
            </aside>
          </Panel>
        )}
      </ReactFlow>
      <div data-canvas-control="true" className="workflow-top-toolbar-layer nodrag nopan">
        <div className="workflow-top-toolbar">
          <div style={{ ...PANEL, padding: '6px 10px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Workflow size={13} /> {t('WF Canvas')}
            <span style={{ color: 'var(--fg)' }}>{nodes.length} {t('graph node(s)')}</span>
            <span style={{ color: 'var(--muted)' }}>{canvasNodes.filter(node => isLiveStatus(node.status)).length} {t('running')}</span>
            {selectedNodeIds.size > 1 && <span data-testid="workflow-selection-count" style={{ color: WORKFLOW_GREEN_DARK }}>{selectedNodeIds.size} {t('selected')}</span>}
            {selectedEdgeIds.size > 0 && <span data-testid="workflow-edge-selection-count" style={{ color: WORKFLOW_GREEN_DARK }}>{selectedEdgeIds.size} {t('edge selected')}</span>}
          </div>
          <div
            data-testid="terminal-input-owner"
            data-owner-surface={terminalInputOwner?.surface || 'none'}
            title={terminalInputOwner?.sessionId || t('No terminal owner')}
            style={{ ...PANEL, padding: '6px 9px', fontSize: 10, fontWeight: 800, color: terminalInputOwner ? WORKFLOW_GREEN_DARK : 'var(--muted)', textTransform: 'uppercase' }}
          >
            {terminalInputOwner?.surface || 'none'} owner
          </div>
          {selectedEdgeIds.size > 0 && (
            <button data-testid="workflow-delete-selected-edges" onClick={deleteSelectedEdges}
              title={t('Delete selected edge')}
              style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid #fecaca', borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.9)', color: '#991b1b' }}>
              <Trash2 size={13} />
            </button>
          )}
          {selectedNodeIds.size > 0 && (
            <button data-testid="workflow-delete-selected" onClick={() => deleteSelectedNodes()} disabled={deletableSelectedNodeIds.length === 0}
              title={deletableSelectedNodeIds.length === 0 ? t('Selected nodes cannot be deleted while live') : t('Delete selected nodes')}
              style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid #fecaca', borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.9)', color: '#991b1b', opacity: deletableSelectedNodeIds.length === 0 ? 0.45 : 1 }}>
              <Trash2 size={13} />
            </button>
          )}
          <button onClick={() => openCreateNodePanel()} data-testid="workflow-create-node" title={t('Create node')} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: '#111', color: '#fff' }}>
            <Plus size={13} />
          </button>
          <button onClick={undoGraph} disabled={graphState.undoStack.length === 0} data-testid="workflow-undo" title={t('Undo')} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.9)', color: graphState.undoStack.length ? 'var(--fg)' : 'var(--muted)', opacity: graphState.undoStack.length ? 1 : 0.45 }}>
            <Undo2 size={13} />
          </button>
          <button onClick={() => setShowCanvasConfig(current => !current)} data-testid="workflow-canvas-settings" title={t('Canvas config')} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: `1px solid ${showCanvasConfig ? '#111' : 'var(--border)'}`, borderRadius: 'var(--radius)', background: showCanvasConfig ? '#111' : 'rgba(255,255,255,0.9)', color: showCanvasConfig ? '#fff' : 'var(--muted)' }}>
            <Settings2 size={13} />
          </button>
          <button onClick={() => reload(true)} title={t('Refresh workflow')} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.9)', color: 'var(--muted)' }}>
            <RefreshCw size={13} />
          </button>
          <button title={t('Fit view')} onClick={resetView} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.9)', color: 'var(--muted)' }}>
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
      {workflowToastMessage && (
        <div
          data-canvas-control="true"
          data-testid="workflow-toast"
          role={workflowToastIsError ? 'alert' : 'status'}
          className="workflow-toast nodrag nopan"
          data-kind={workflowToastIsError ? 'error' : 'status'}
        >
          <span>{workflowToastMessage}</span>
          {workflowToastIsError && (
            <button type="button" onClick={() => setError(null)}>{t('dismiss')}</button>
          )}
        </div>
      )}
    </div>
  );
}

function WfBridgeEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
  markerEnd,
  style,
  selected,
}: EdgeProps<FlowEdge>) {
  const flow = useReactFlow<FlowNode, FlowEdge>();
  const dragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startFlowY: number;
    startOffset: number;
    active: boolean;
    moved: boolean;
    pointerId: number;
    captureTarget: Element | null;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const offset = numericEdgeOffset(data?.offset);
  const isSelected = Boolean(selected || data?.selected);
  const edgeRuntimeRef = useRef<{ id: string; data?: BridgeEdgeData; offset: number }>({ id, data, offset });
  edgeRuntimeRef.current = { id, data, offset };
  const [edgePath, labelX, labelY] = bridgeStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    offset,
  });
  const labelText = typeof label === 'string' && label ? label : String(data?.relation || 'wf-bridge');
  const labelScale = 1 / Math.max(0.05, Number(data?.zoom || flow.getZoom() || 1));
  const visibleStyle: CSSProperties = {
    ...style,
    stroke: isSelected ? WORKFLOW_GREEN : style?.stroke || WORKFLOW_GREEN_DARK,
    strokeWidth: isSelected ? 2.5 : style?.strokeWidth || 1.8,
    filter: isSelected ? `drop-shadow(0 0 7px ${WORKFLOW_GREEN_GLOW})` : undefined,
  };

  const offsetFromPointer = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag) return edgeRuntimeRef.current.offset;
    const current = flow.screenToFlowPosition({ x: clientX, y: clientY });
    return numericEdgeOffset(drag.startOffset + current.y - drag.startFlowY);
  }, [flow]);

  const updateDragFromPointer = useCallback((clientX: number, clientY: number, commit: boolean) => {
    const drag = dragRef.current;
    if (!drag) return false;
    const runtime = edgeRuntimeRef.current;
    if (!drag.active) {
      const movedPx = Math.hypot(clientX - drag.startClientX, clientY - drag.startClientY);
      if (movedPx < BRIDGE_LABEL_DRAG_THRESHOLD) {
        if (commit) dragRef.current = null;
        return false;
      }
      drag.active = true;
      drag.moved = true;
      try {
        drag.captureTarget?.setPointerCapture(drag.pointerId);
      } catch {
        // The pointer may have left the label before the drag threshold was crossed.
      }
    }
    const nextOffset = offsetFromPointer(clientX, clientY);
    if (Math.abs(nextOffset - drag.startOffset) > 1) drag.moved = true;
    runtime.data?.onEdgeOffsetChange?.(runtime.id, nextOffset, commit && drag.moved);
    if (!commit) return true;
    try {
      drag.captureTarget?.releasePointerCapture(drag.pointerId);
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    if (drag.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    dragRef.current = null;
    return true;
  }, [offsetFromPointer]);

  const updateDragFromPointerRef = useRef(updateDragFromPointer);
  updateDragFromPointerRef.current = updateDragFromPointer;

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragRef.current) return;
      if (updateDragFromPointerRef.current(event.clientX, event.clientY, false)) event.preventDefault();
    };
    const end = (event: PointerEvent) => {
      if (!dragRef.current) return;
      if (updateDragFromPointerRef.current(event.clientX, event.clientY, true)) event.preventDefault();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end, { passive: false });
    window.addEventListener('pointercancel', end, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);

  const startDrag = (event: ReactPointerEvent<Element>, immediate = false) => {
    if (event.button !== 0) return;
    if (immediate) event.preventDefault();
    event.stopPropagation();
    data?.onEdgeSelect?.(event, id);
    dragRef.current = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startFlowY: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }).y,
      startOffset: offset,
      active: immediate,
      moved: false,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
    };
    if (immediate) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Global pointer listeners still keep drag behavior stable.
      }
    }
  };

  const selectFromLabel = (event: ReactMouseEvent) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    data?.onEdgeSelect?.(event, id);
  };

  const openPanelFromLabel = (event: ReactMouseEvent) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    data?.onEdgeLabelClick?.(event, id);
  };

  return (
    <g
      data-testid="workflow-edge"
      data-source={data?.sourceNodeId || ''}
      data-target={data?.targetNodeId || ''}
    >
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={visibleStyle}
        interactionWidth={0}
      />
      <path
        className="wf-bridge-edge-hit"
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        onPointerDown={(event) => startDrag(event, true)}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          data-testid="workflow-bridge-label"
          className="wf-bridge-label nodrag nopan"
          data-selected={isSelected ? 'true' : 'false'}
          onPointerDown={(event) => startDrag(event)}
          onClick={selectFromLabel}
          onDoubleClick={openPanelFromLabel}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(${labelScale})`,
          }}
        >
          {labelText}
        </button>
      </EdgeLabelRenderer>
    </g>
  );
}

function EmbeddedWorkflowTerminal({ sessionId, live }: { sessionId: string; live: boolean }) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef(0);
  const repaintFrameRef = useRef<number | null>(null);
  const fallbackQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const replayVersionRef = useRef(0);
  const [terminalReady, setTerminalReady] = useState(0);
  type TerminalRangeEntry = { seq?: number; stream?: string; data: string };

  const sendInputFallback = useCallback(async (data: string) => {
    const run = () => apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/input`, {
      method: 'POST',
      body: JSON.stringify({ data }),
    });
    const next = fallbackQueueRef.current.then(run, run);
    fallbackQueueRef.current = next.catch(() => {});
    await next;
  }, [sessionId]);

  const writeInput = useCallback((data: string) => {
    if (!data || !live) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'pty:input', data }));
      return;
    }
    sendInputFallback(data).catch((e: any) => {
      terminalRef.current?.writeln(`\r\n[error] ${e?.message || t('input rejected')}`);
    });
  }, [live, sendInputFallback, t]);

  const fitAndResize = useCallback(() => {
    const term = terminalRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    try {
      fit.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'pty:resize', cols: term.cols, rows: term.rows }));
      }
    } catch {
      // ReactFlow can temporarily hide the host during animated layout.
    }
  }, []);

  const repaintTerminal = useCallback(() => {
    const term = terminalRef.current;
    if (!term) return;
    fitAndResize();
    try {
      term.refresh(0, Math.max(0, term.rows - 1));
      term.scrollToBottom();
    } catch {
      // xterm can be between renderer frames during ReactFlow layout animation.
    }
  }, [fitAndResize]);

  const scheduleRepaintTerminal = useCallback(() => {
    if (repaintFrameRef.current !== null) return;
    repaintFrameRef.current = window.requestAnimationFrame(() => {
      repaintFrameRef.current = null;
      repaintTerminal();
    });
  }, [repaintTerminal]);

  const replayTranscript = useCallback(async (options: { reset?: boolean; fromSeq?: number } = {}) => {
    const term = terminalRef.current;
    if (!term) return;
    const replayVersion = replayVersionRef.current + 1;
    replayVersionRef.current = replayVersion;
    const reset = options.reset !== false;
    const query = options.fromSeq && options.fromSeq > 0
      ? `fromSeq=${options.fromSeq}`
      : `tail=${live ? 800 : 1600}`;
    const range = await apiJson<{ entries: TerminalRangeEntry[] }>(`/api/terminals/${encodeURIComponent(sessionId)}/range?${query}`);
    if (terminalRef.current !== term || replayVersionRef.current !== replayVersion) return;
    if (reset) {
      term.reset();
      lastSeqRef.current = 0;
    }
    let wroteOutput = false;
    for (const entry of range.entries || []) {
      lastSeqRef.current = Math.max(lastSeqRef.current, Number(entry.seq || 0));
      if (entry.stream === 'stdin') continue;
      const data = String(entry.data || '');
      if (!data) continue;
      wroteOutput = true;
      term.write(data);
    }
    if (!live && reset && !wroteOutput) {
      term.writeln('[stopped transcript] no captured output');
    }
    scheduleRepaintTerminal();
  }, [live, scheduleRepaintTerminal, sessionId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || terminalRef.current) return;
    const term = new XTerm({
      cursorBlink: true,
      disableStdin: !live,
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "SFMono-Regular", Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.15,
      scrollback: 8000,
      theme: {
        background: '#0b0d10',
        foreground: '#e5e7eb',
        cursor: '#f9fafb',
        selectionBackground: '#374151',
      },
    });
    term.attachCustomKeyEventHandler((event) => terminalControlShouldHandleKey(event, live, term));
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(host);
    const responseGuardDisposables = installTerminalResponseGuards(term);
    const dataDisposable = term.onData(data => {
      const input = stripTerminalResponseInput(data);
      if (input) writeInput(input);
    });
    terminalRef.current = term;
    fitRef.current = fit;
    setTerminalReady(current => current + 1);
    const observer = new ResizeObserver(() => scheduleRepaintTerminal());
    observer.observe(host);
    const timers = [0, 60, 180, 420, 900].map(delay =>
      window.setTimeout(scheduleRepaintTerminal, delay)
    );
    return () => {
      observer.disconnect();
      timers.forEach(timer => window.clearTimeout(timer));
      if (repaintFrameRef.current !== null) {
        window.cancelAnimationFrame(repaintFrameRef.current);
        repaintFrameRef.current = null;
      }
      dataDisposable.dispose();
      responseGuardDisposables.forEach(disposable => disposable.dispose());
      fit.dispose();
      term.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [live, scheduleRepaintTerminal, writeInput]);

  useEffect(() => {
    const term = terminalRef.current;
    if (term) term.options.disableStdin = !live;
  }, [live]);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    const term = terminalRef.current;
    if (!term || terminalReady === 0) return;
    const connectLiveTerminal = () => {
      if (cancelled || !live || terminalRef.current !== term) return;
      ws = new WebSocket(wsUrl(`/ws/terminal/${encodeURIComponent(sessionId)}`));
      wsRef.current = ws;
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'control:attach-mode', attachMode: true }));
        scheduleRepaintTerminal();
        term.focus();
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'pty:data') {
            const seq = Number(msg.seq || 0);
            if (Number.isFinite(seq) && seq > 0) lastSeqRef.current = Math.max(lastSeqRef.current, seq);
            term.write(String(msg.data || ''));
            scheduleRepaintTerminal();
          } else if (msg.type === 'session:error') {
            term.writeln(`\r\n[error] ${msg.message}`);
          }
        } catch {
          term.write(String(event.data || ''));
        }
      };
    };
    replayTranscript({ reset: true })
      .catch(() => {
        if (!live) term.writeln('[stopped transcript] failed to load transcript');
      })
      .finally(connectLiveTerminal);
    return () => {
      cancelled = true;
      ws?.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [live, replayTranscript, scheduleRepaintTerminal, sessionId, terminalReady]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) return;
      if (!live) {
        replayTranscript({ reset: true }).catch(() => scheduleRepaintTerminal());
        return;
      }
      scheduleRepaintTerminal();
    };
    const onFocus = () => {
      if (!live) {
        replayTranscript({ reset: true }).catch(() => scheduleRepaintTerminal());
        return;
      }
      scheduleRepaintTerminal();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [live, replayTranscript, scheduleRepaintTerminal]);

  return <div ref={hostRef} style={{ width: '100%', height: '100%', minHeight: 1 }} />;
}

function ConnectionHandles({ zoom }: { zoom: number }) {
  const safeZoom = Math.max(0.05, Number.isFinite(zoom) ? zoom : 1);
  const handleSize = 12;
  const handleScale = 1 / safeZoom;
  const handleBaseStyle: CSSProperties = {
    width: handleSize,
    height: handleSize,
    transformOrigin: 'center',
  };
  const transforms: Record<string, string> = {
    top: `translate(-50%, -50%) scale(${handleScale})`,
    right: `translate(50%, -50%) scale(${handleScale})`,
    bottom: `translate(-50%, 50%) scale(${handleScale})`,
    left: `translate(-50%, -50%) scale(${handleScale})`,
  };
  const sideHandles = [
    { position: Position.Top, side: 'top', style: { left: '50%', transform: transforms.top } },
    { position: Position.Right, side: 'right', style: { top: '50%', transform: transforms.right } },
    { position: Position.Bottom, side: 'bottom', style: { left: '50%', transform: transforms.bottom } },
    { position: Position.Left, side: 'left', style: { top: '50%', transform: transforms.left } },
  ].map((handle): { position: Position; side: string; type: 'source' | 'target'; id: string; role: 'input' | 'output'; style: CSSProperties } => ({
    ...handle,
    type: handle.side === 'left' ? 'target' : 'source',
    id: handle.side === 'left' ? 'context' : handle.side,
    role: handle.side === 'left' ? 'input' : 'output',
  }));
  return (
    <>
      {sideHandles.map(handle => (
        <Handle
          key={handle.side}
          className={`wf-flow-handle wf-flow-handle-${handle.side}${handle.side === 'left' ? ' workflow-agent-context-handle' : ''}`}
          type={handle.type}
          id={handle.id}
          position={handle.position}
          data-testid={handle.side === 'left' ? 'workflow-agent-node-context-input' : undefined}
          data-handle-role={handle.role}
          isConnectableStart={handle.type === 'source'}
          isConnectableEnd={handle.type === 'target'}
          style={{ ...handleBaseStyle, ...handle.style }}
        />
      ))}
    </>
  );
}

function RuntimeAccentStrip({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        background: color,
        opacity: 0.68,
        pointerEvents: 'none',
      }}
    />
  );
}

function WfNodeCard({ data, selected }: NodeProps<AgentFlowNode>) {
  const t = useT();
  const node = data.workflowNode;
  const Icon = nodeKindIcon(node.kind);
  const stateColor = statusColor(node.status);
  const tone = statusTone(node.status);
  const runtimeColor = runtimeAccentColor(node.runtime);
  const kindColor = agentKindColor(node.agentKind);
  const isTerminalMode = data.mode === 'terminal' && Boolean(node.sessionId);
  const live = isLiveStatus(node.status);
  const canStart = canStartNode(node);
  const canStop = canStopNode(node);
  const canDelete = canDeleteNode(node);
  const openLiveTerminal = canOpenTerminal(node);
  const role = roleBadge(node);
  const nodeBorderColor = selected || live ? WORKFLOW_GREEN : WORKFLOW_GREEN_BORDER;

  const stopEvent = (event: ReactMouseEvent) => {
    event.stopPropagation();
  };

  if (isTerminalMode) {
    return (
      <motion.div
        key="terminal"
        layout
        initial={{ rotateY: -8, scale: 0.96 }}
        animate={{ rotateY: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 430, damping: 30, mass: 0.72 }}
        className="wf-node-card"
        data-mode="terminal"
        data-selected={selected ? 'true' : 'false'}
        data-testid="workflow-node-terminal"
        data-node-id={node.graphNodeId || node.id}
        style={{
          width: TERMINAL_NODE_W,
          height: TERMINAL_NODE_H,
          border: `1px solid ${nodeBorderColor}`,
          borderRadius: 'var(--radius)',
          background: '#fff',
          color: 'var(--fg)',
          display: 'grid',
          gridTemplateRows: '40px minmax(0, 1fr)',
          overflow: 'hidden',
          transformStyle: 'preserve-3d',
          position: 'relative',
          boxShadow: live ? `0 18px 42px ${WORKFLOW_GREEN_GLOW}` : undefined,
        }}
        >
        <RuntimeAccentStrip color={runtimeColor} />
        <ConnectionHandles zoom={data.viewportZoom} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, padding: '0 9px 0 13px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.96)' }}>
          {node.runtime ? <RuntimeBrandMark runtime={node.runtime} size={15} /> : <Terminal size={14} />}
          <span style={{ fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayNodeTitle(node)}</span>
          <span className={live ? 'wf-status-dot is-live' : 'wf-status-dot'} style={{ background: stateColor }} />
          <span data-testid="workflow-node-status" style={{ fontSize: 9, lineHeight: 1, color: tone.color, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 999, padding: '3px 6px', fontWeight: 800, letterSpacing: 0, textTransform: 'uppercase', flexShrink: 0 }}>{displaySessionStatus(node.status)}</span>
          <span style={{ flex: 1 }} />
          <button className="nodrag nopan" title={t('Open drawer terminal')} onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onOpenSession(node.sessionId!); }} style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--muted)' }}>
            <ExternalLink size={11} />
          </button>
          <button className="nodrag nopan" data-testid="workflow-back-to-node" title={t('Back to Node')} onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onToggleMode(node.id); }} style={{ height: 24, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--muted)', fontSize: 10, fontWeight: 700 }}>
            <Terminal size={11} /> {t('Back to Node')}
          </button>
          {canStart && (
            <button className="nodrag nopan" data-testid="workflow-node-start" title={t('Start node')} disabled={data.starting} onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onStartNode(node.id); }} style={{ height: 24, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', border: '1px solid #86efac', borderRadius: 'var(--radius)', color: WORKFLOW_GREEN_DARK, fontSize: 10, fontWeight: 800, opacity: data.starting ? 0.45 : 1 }}>
              <Play size={11} /> {data.starting ? t('Starting...') : t('Start')}
            </button>
          )}
          {canStop && (
            <button className="nodrag nopan" data-testid="workflow-node-stop" title={t('Stop node')} disabled={data.stopping} onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onStopNode(node.id); }} style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', border: '1px solid #fecaca', borderRadius: 'var(--radius)', color: '#991b1b', opacity: data.stopping ? 0.4 : 1 }}>
              <Square size={11} />
            </button>
          )}
          {canDelete && (
            <button className="nodrag nopan" data-testid="workflow-node-delete" title={t('Delete node')} disabled={data.deleting} onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onDeleteNode(node.id); }} style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', border: '1px solid #fecaca', borderRadius: 'var(--radius)', color: '#991b1b', opacity: data.deleting ? 0.4 : 1 }}>
              <Trash2 size={11} />
            </button>
          )}
        </div>

        <div
          className="nodrag nopan nowheel"
          data-testid="workflow-terminal-attach"
          tabIndex={0}
          onPointerDown={(event) => {
            stopEvent(event);
            announceTerminalInputOwner({ sessionId: node.sessionId!, surface: 'embedded' });
          }}
          onClick={(event) => {
            event.stopPropagation();
            announceTerminalInputOwner({ sessionId: node.sessionId!, surface: 'embedded' });
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            void handleTerminalDrop(event.nativeEvent, { sessionId: node.sessionId!, surface: 'embedded' }).catch((e: any) => {
              console.warn('embedded terminal drop failed', e);
            });
          }}
          onPaste={(event) => {
            void handleTerminalPaste(event.nativeEvent, { sessionId: node.sessionId!, surface: 'embedded' }).catch((e: any) => {
              console.warn('embedded terminal paste failed', e);
            });
          }}
          style={{ minHeight: 0, background: '#0b0d10', outline: 'none' }}
        >
          <EmbeddedWorkflowTerminal sessionId={node.sessionId!} live={live} />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="card"
      layout
      initial={{ rotateY: 8, scale: 0.98 }}
      animate={{ rotateY: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 430, damping: 28, mass: 0.72 }}
      className="wf-node-card"
      data-mode="card"
      data-selected={selected ? 'true' : 'false'}
      data-testid="workflow-node"
      data-node-id={node.graphNodeId || node.id}
      style={{
        width: CARD_NODE_W,
        height: CARD_NODE_H,
        border: `1px solid ${nodeBorderColor}`,
        borderRadius: 'var(--radius)',
        background: liveNodeBackground(node, live, selected),
        textAlign: 'left',
        padding: '10px 10px 10px 14px',
        display: 'grid',
        gridTemplateRows: 'auto auto minmax(13px, 1fr) 25px',
        alignContent: 'stretch',
        gap: 7,
        color: 'var(--fg)',
        transformStyle: 'preserve-3d',
        position: 'relative',
        boxShadow: live ? `0 14px 34px ${WORKFLOW_GREEN_GLOW}` : undefined,
      }}
    >
      <RuntimeAccentStrip color={runtimeColor} />
      <ConnectionHandles zoom={data.viewportZoom} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {node.runtime ? <RuntimeBrandMark runtime={node.runtime} size={15} /> : <Icon size={14} />}
        <span style={{ fontSize: 15, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayNodeTitle(node)}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, lineHeight: 1, color: kindColor, background: `${kindColor}12`, border: `1px solid ${kindColor}30`, borderRadius: 999, padding: '4px 7px', fontWeight: 800, letterSpacing: 0 }}>{role}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span className={live ? 'wf-status-dot is-live' : 'wf-status-dot'} style={{ background: stateColor }} />
        <span data-testid="workflow-node-status" style={{ fontSize: 10, lineHeight: 1, color: tone.color, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 999, padding: '4px 7px', fontWeight: 800, letterSpacing: 0, textTransform: 'uppercase' }}>{displaySessionStatus(node.status)}</span>
        <RuntimeBrandLabel runtime={node.runtime || node.kind} model={node.model} size={13} style={{ fontSize: 12, overflow: 'hidden' }} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minHeight: 16, pointerEvents: 'none' }}>
        {node.objective || node.peerId || (node.sessionId ? t('managed PTY endpoint') : t('workflow control node'))}
      </div>
      <div className="nodrag nopan" style={{ display: 'flex', gap: 7, alignSelf: 'end', position: 'relative', zIndex: 5, minHeight: 32 }}>
        {node.sessionId ? (
          <>
            {canStart ? (
              <>
                <button data-testid="workflow-node-start" disabled={data.starting} onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onStartNode(node.id); }}
                  style={{ flex: 1, fontSize: 12, fontWeight: 800, padding: '5px 8px', border: '1px solid #86efac', borderRadius: 'var(--radius)', color: WORKFLOW_GREEN_DARK, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: data.starting ? 0.45 : 1 }}>
                  <Play size={12} /> {data.starting ? t('Starting...') : t('Start')}
                </button>
                <button data-testid="workflow-open-terminal" title={t('Open Transcript')} onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onToggleMode(node.id); }}
                  style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--muted)' }}>
                  <Terminal size={12} />
                </button>
              </>
            ) : (
              <button data-testid="workflow-open-terminal" onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onToggleMode(node.id); }}
                style={{ flex: 1, fontSize: 12, fontWeight: 800, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <Terminal size={12} /> {openLiveTerminal ? t('Open Terminal') : t('Open Transcript')}
              </button>
            )}
            <button onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onOpenSession(node.sessionId!); }}
              style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--muted)' }}>
              <ExternalLink size={12} />
            </button>
            {canStop && (
              <button data-testid="workflow-node-stop" disabled={data.stopping} onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onStopNode(node.id); }}
                style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', border: '1px solid #fecaca', borderRadius: 'var(--radius)', color: '#991b1b', opacity: data.stopping ? 0.4 : 1 }}>
                <Square size={12} />
              </button>
            )}
            {canDelete && (
              <button data-testid="workflow-node-delete" disabled={data.deleting} onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onDeleteNode(node.id); }}
                style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', border: '1px solid #fecaca', borderRadius: 'var(--radius)', color: '#991b1b', opacity: data.deleting ? 0.4 : 1 }}>
                <Trash2 size={12} />
              </button>
            )}
          </>
        ) : (
          <button onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onOpenConfig(node.id); }}
            style={{ flex: 1, fontSize: 12, fontWeight: 800, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <Settings2 size={12} /> {t('Configure')}
          </button>
        )}
      </div>
    </motion.div>
  );
}
