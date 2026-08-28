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
  Download,
  Copy,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  Maximize2,
  MessagesSquare,
  MousePointer2,
  Network,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Scissors,
  Search,
  Settings2,
  Square,
  Terminal,
  Trash2,
  Undo2,
  Upload,
  Workflow,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { apiJson, apiJsonCached, invalidateApiCache, wsUrl } from '../api';
import type {
  RuntimeInfo,
  Session,
  TaskOption,
  WorkflowCapabilityNodeType,
  WorkflowCapabilityNodeState,
  WorkflowComponentNodeState,
  WorkflowComponentType,
  WorkflowEdgeDirection,
  WorkflowEventNodeType,
  WorkflowEventNodeState,
  WorkflowGoalNodeState,
  WorkflowEdge,
  WorkflowAgentControl,
  WorkflowCapsuleLink,
  WorkflowCapsuleRole,
  WorkflowCapsuleSummary,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowOperation,
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
  loadTerminalWebglAddon,
  pasteClipboardToTerminal,
  readWorkspaceItem,
  stripTerminalResponseInput,
  terminalShouldHandleKey as terminalControlShouldHandleKey,
  type TerminalSurface,
  uploadUserFiles,
} from '../terminalControl';
import WorkspaceExplorerPanel from './WorkspaceExplorerPanel';
import WorkflowNodeSettingsPanel from './WorkflowNodeSettingsPanel';
import AgentNodeSettings from './workflow/AgentNodeSettings';
import WorkflowComponentNode from './WorkflowComponentNode';
import type { WorkflowComponentFlowNode } from './WorkflowComponentNode';
import WorkflowEventNode from './WorkflowEventNode';
import type { WorkflowEventFlowNode } from './WorkflowEventNode';
import WorkflowCapabilityNode from './WorkflowCapabilityNode';
import type { WorkflowCapabilityFlowNode } from './WorkflowCapabilityNode';
import WorkflowGoalNode from './WorkflowGoalNode';
import type { WorkflowGoalFlowNode } from './WorkflowGoalNode';
import WorkflowTimerExpandedNode from './WorkflowTimerExpandedNode';
import WorkflowGoalExpandedNode from './WorkflowGoalExpandedNode';
import WorkflowCapsuleStrip from './workflow/WorkflowCapsuleStrip';
import WorkflowFloatingPanel from './workflow/WorkflowFloatingPanel';
import WorkflowFileBigView from './WorkflowFileBigView';
import WorkflowDisplayView from './WorkflowDisplayView';
import WorkflowSkillsHubOverlay, { SKILL_GROUP_TRANSFER_TYPE } from './WorkflowSkillsHubOverlay';
import type {
  SkillGroupDragPayload,
  WorkflowSkillsOverlayAgent,
  WorkflowSkillsOverlayGroup,
  WorkflowSkillsOverlayGroupRow,
  WorkflowSkillsOverlayHub,
  WorkflowSkillsOverlayPack,
  WorkflowSkillsOverlaySkill,
} from './WorkflowSkillsHubOverlay';
import NodeLoadingPlaceholder from './workflow/NodeLoadingPlaceholder';
import {
  createNodeCategoryLabels,
  getCreateNodeCatalog,
  getNodeRenderer,
  type CreateNodeCreateMode,
} from './workflow/nodeRegistry';
import {
  createEdge as createRuntimeEdge,
  createNodeResponse as createRuntimeNode,
  deleteEdge as deleteRuntimeEdge,
  executeNodeActionResponse as executeRuntimeNodeAction,
  fetchMcpHub,
  fetchSkillsMarket,
  fetchSkillsHub,
  fetchNode as fetchRuntimeNode,
  installSkillsMarketPack,
  patchNodeStateResponse as patchRuntimeNodeState,
  type WorkflowMcpHubResponse,
  type WorkflowSkillsMarketPack,
  type WorkflowSkillsMarketResponse,
  type WorkflowSkillsHubResponse,
  type WorkflowRuntimeNode,
} from './workflow/nodeRuntimeClient';

type Props = { onSelectSession: (sessionId: string) => void };

type CanvasNode = WorkflowNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  custom?: boolean;
  componentState?: WorkflowComponentNodeState;
  eventState?: WorkflowEventNodeState;
  capabilityState?: WorkflowCapabilityNodeState;
  goalState?: WorkflowGoalNodeState;
};

type NodeMode = 'card' | 'terminal';
type AgentKind = 'main' | 'subagent';
type CreateNodeKind = CreateNodeCreateMode;
type CapabilityHubKind = 'skills' | 'mcp';
type SkillsHubTab = 'installed' | 'market' | 'groups';
type CapabilityHubState = {
  kind: CapabilityHubKind;
  origin: 'create-panel' | 'canvas-menu' | 'agent-menu' | 'agent-settings' | 'node-config';
  targetAgentId?: string;
  targetCapabilityId?: string;
  createPosition?: GraphPosition;
} | null;

type NodeConfigPatchResponse = {
  ok?: boolean;
  node?: {
    id?: string;
    config?: Partial<WorkflowNodeConfig>;
    restartRequired?: boolean;
    restartRequiredFields?: string[];
  };
  restartRequired?: boolean;
  restartRequiredFields?: string[];
  revision?: number;
};
type GraphPosition = { x: number; y: number };
type WorkflowGraphEdge = {
  id: string;
  from?: string;
  to?: string;
  source: string;
  target: string;
  label?: string;
  relation?: string;
  direction?: WorkflowEdgeDirection;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  protocolSourceHandle?: string | null;
  protocolTargetHandle?: string | null;
  uiSourceHandle?: string | null;
  uiTargetHandle?: string | null;
  offset?: number;
};
type CapsuleDockSide = 'left' | 'right' | 'top' | 'bottom';
type CapsuleDockEdgeRetention = 'keep' | 'delete-on-detach';
type CapsuleDockEdgeBinding = {
  edgeId: string;
  retention: CapsuleDockEdgeRetention;
};
type CapsuleDockConnection = {
  id: string;
  source: string;
  target: string;
  relation: string;
  direction: WorkflowEdgeDirection;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};
type CapsuleDockLink = {
  id: string;
  nodeIds: [string, string];
  anchorId: string;
  draggedId: string;
  side: CapsuleDockSide;
  edges: CapsuleDockEdgeBinding[];
  connections: CapsuleDockConnection[];
};
type DeletedNodeRecovery = {
  nodeId: string;
  graphId: string;
  node: WorkflowNode;
  edges: WorkflowGraphEdge[];
  requiresStop: boolean;
};
type GraphHistoryEntry = {
  positions: Record<string, GraphPosition>;
  edges: WorkflowGraphEdge[];
  capsuleDockLinks?: CapsuleDockLink[];
  deletedNodes?: DeletedNodeRecovery[];
};
type WorkflowGraphState = {
  schemaVersion: number;
  version: number;
  positions: Record<string, GraphPosition>;
  edges: WorkflowGraphEdge[];
  capsuleDockLinks: CapsuleDockLink[];
  undoStack: GraphHistoryEntry[];
  redoStack: GraphHistoryEntry[];
};
type CreatePanelState = { x: number; y: number; flowX: number; flowY: number; kind?: CreateNodeKind | null } | null;
type ExpandedRuntimeNodeState = { nodeId: string; kind: 'timer' | 'goal'; nonce: number } | null;
type DeleteConfirmState = { nodeIds: string[]; liveNodeIds: string[] } | null;
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
// agent.readMessages entry shape (workflow-node-types/agent-node.mjs): the
// mailbox flow used by the node communications panel (user D-H).
type CommMessageEntry = {
  seq?: number;
  ts?: string;
  messageId?: string;
  threadId?: string;
  fromNodeId?: string;
  toNodeId?: string;
  fromSessionId?: string;
  toSessionId?: string;
  requestId?: string;
  replyTo?: string;
  data?: string;
  topic?: string;
  deliveryMode?: string;
  toRole?: string;
};
type WorkflowToastKind = 'status' | 'loading' | 'success' | 'error';
type WorkflowToastInput = {
  message: string;
  kind?: WorkflowToastKind;
  durationMs: number;
  dedupeKey: string;
};
type WorkflowToastState = WorkflowToastInput & {
  id: string;
  kind: WorkflowToastKind;
  createdAt: number;
};

declare global {
  interface Window {
    alert_toast?: (input: WorkflowToastInput) => () => void;
  }
}
type TerminalInputOwnerState = { sessionId: string; surface: TerminalSurface; inputOwnerId?: string } | null;
type CapsuleDockPreview = {
  draggedId: string;
  anchorId: string;
  side: CapsuleDockSide;
} | null;
type CapsuleRole = WorkflowCapsuleRole | 'resource';
type CapsuleMagnetDrag = {
  draggedId: string;
  role: CapsuleRole;
} | null;
type CapsuleDockCandidate = {
  node: CanvasNode;
  side: CapsuleDockSide;
  distance: number;
  connections: CapsuleDockConnection[];
};
type DetachCapsuleDockOptions = {
  includeLooseCapsuleEdges?: boolean;
  position?: GraphPosition;
};
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
  onFileNodeRefreshed: (nodeId: string) => void;
};

type WfNodeData = Record<string, unknown> & NodeCallbacks & {
  workflowNode: WorkflowNode;
  mode: NodeMode;
  starting: boolean;
  stopping: boolean;
  deleting: boolean;
  viewportZoom: number;
  agentControl?: WorkflowAgentControl;
  capsule?: WorkflowCapsuleSummary;
};

type AgentFlowNode = Node<WfNodeData, 'wfNode'>;
type FlowNode = AgentFlowNode | WorkflowComponentFlowNode | WorkflowEventFlowNode | WorkflowCapabilityFlowNode | WorkflowGoalFlowNode;

/**
 * Client-only placeholder shown while a workflow node is being created on the
 * backend. It is rendered through the same ReactFlow nodes state but is never
 * written to the graph state, so it cannot become a server artifact.
 */
type PendingNodePlaceholder = {
  x: number;
  y: number;
  kind: string;
  label?: string;
  width: number;
  height: number;
};
type BridgeEdgeData = Record<string, unknown> & {
  sourceNodeId?: string;
  targetNodeId?: string;
  fromSessionId?: string;
  toSessionId?: string;
  relation?: string;
  direction?: WorkflowEdgeDirection;
  bridgeId?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  protocolSourceHandle?: string | null;
  protocolTargetHandle?: string | null;
  displaySourceHandle?: string | null;
  displayTargetHandle?: string | null;
  offset?: number;
  zoom?: number;
  routing?: EdgeRoutingInfo | null;
  selected?: boolean;
  agentFlowActive?: boolean;
  agentFlowOperationId?: string;
  agentFlowColor?: string;
  labelCompact?: boolean;
  onEdgeSelect?: (event: EdgeSelectionEvent, edgeId: string) => void;
  onEdgeLabelClick?: (event: ReactMouseEvent | globalThis.MouseEvent, edgeId: string) => void;
  onEdgeOffsetChange?: (edgeId: string, offset: number, commit?: boolean) => void;
};

type EdgeSelectionEvent = {
  stopPropagation: () => void;
  preventDefault?: () => void;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

type FlowEdge = Edge<BridgeEdgeData, 'wfBridge'>;
type AgentControlRenderState = {
  active: boolean;
  operationId: string;
  actorNodeId: string;
  targetNodeIds: Set<string>;
  edgeIds: Set<string>;
  color: string;
};
type ComponentHeaderDragEvent = {
  target: EventTarget | null;
  clientX: number;
  clientY: number;
};
type GraphConnectionEndpoint = {
  nodeId: string;
  handleId: string | null;
};
type GraphConnectionStart = GraphConnectionEndpoint & { startedAt: number };
type GraphConnectionEndEvent = {
  target?: EventTarget | null;
  clientX?: number;
  clientY?: number;
} | null | undefined;

type CanvasMenu = { x: number; y: number; flowX: number; flowY: number };
type NodeMenu = CanvasMenu & { nodeId: string };
type NodeClipboardItem = {
  node: WorkflowNode;
  position: GraphPosition;
  componentState?: WorkflowComponentNodeState;
};

const CARD_NODE_W = 278;
const CARD_NODE_H = 178;
const TERMINAL_NODE_W = 560;
const TERMINAL_NODE_H = 358;
const COMPONENT_NODE_W = 352;
const COMPONENT_NODE_H = 314;
const EVENT_NODE_W = 276;
const EVENT_NODE_H = 292;
const CAPABILITY_NODE_W = 276;
const CAPABILITY_NODE_H = 158;
const GOAL_NODE_W = 320;
const GOAL_NODE_H = 220;
const CAPSULE_DOCK_GAP = 14;
const CREATE_PANEL_W = 344;
const CREATE_PANEL_MAX_H = 536;
const CREATE_PANEL_TOP_RESERVED = 72;
const BRIDGE_PANEL_W = 420;
const BRIDGE_PANEL_MAX_H = 420;
const GRAPH_DB_NAME = 'harness-wf-ui-workflow-graph';
const GRAPH_STORE_NAME = 'graphs';
const GRAPH_STORAGE_KEY = 'harness:wf-ui:workflow-graph:v2';
const graphSchemaVersion = 1;
const CAPSULE_DOCK_MIN_ZOOM = 0.58;
const WORKFLOW_GREEN = '#15803d';
const WORKFLOW_GREEN_DARK = '#166534';
const WORKFLOW_GREEN_BORDER = 'rgba(22,163,74,0.44)';
const WORKFLOW_GREEN_GLOW = 'rgba(22,163,74,0.20)';
const WORKSPACE_ITEM_TRANSFER_TYPE = 'application/x-harness-workspace-item';
const BRIDGE_LABEL_DRAG_THRESHOLD = 4;
// zIndex layering (lowest -> highest):
//   0                canvas base (xyflow background/pane)
//   NODE_CARD_Z      ALL node cards share this one zIndex — no card may stack above another card
//   360              nodes layer container (CSS) — carries every node card
//   420              edge labels (--wf-z-bridge-label)
//   900-940          floating panels/menus (--wf-z-panel / --wf-z-menu) — user-opened popovers
//   DELETE_MODAL_Z   user-opened modal overlay (delete confirm) — above the nodes layer
//   1180+            settings/terminal overlays (--wf-z-settings), toast (2000), fullscreen (2600)
const NODE_CARD_Z = 35;
const DELETE_MODAL_Z = 920;
const BRIDGE_LABEL_ICON_SIZE = 30;
const PANEL: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'rgba(255,255,255,0.92)',
  boxShadow: '0 12px 38px rgba(0,0,0,0.08)',
  backdropFilter: 'blur(16px)',
};
const CANVAS_CONTEXT_MENU_BLOCK_SELECTOR = [
  '[data-canvas-control="true"]',
  '[data-testid="workflow-node"]',
  '[data-testid="workflow-node-terminal"]',
  '[data-testid="workflow-component-node"]',
  '[data-testid="workflow-event-node"]',
  '[data-testid="workflow-capability-node"]',
  '[data-testid="workflow-goal-node"]',
  '.react-flow__node',
  '.react-flow__edge',
  '.react-flow__handle',
  '.react-flow__controls',
  '.react-flow__minimap',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '.xterm',
].join(',');
const WORKFLOW_NODE_CONTENT_SIZE_SELECTOR = [
  '[data-testid="workflow-node"]',
  '[data-testid="workflow-node-terminal"]',
  '[data-testid="workflow-component-node"]',
  '[data-testid="workflow-event-node"]',
  '[data-testid="workflow-capability-node"]',
  '[data-testid="workflow-goal-node"]',
].join(',');

type NodeVisualSize = { width: number; height: number };
type NodeVisualSizeMap = Map<string, NodeVisualSize>;

function finiteDimension(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function styleDimension(value: unknown) {
  if (typeof value === 'number') return finiteDimension(value);
  if (typeof value !== 'string') return 0;
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/);
  return match ? finiteDimension(match[1]) : 0;
}

function measuredFlowNodeSize(node: FlowNode): NodeVisualSize | null {
  const measured = (node as any).measured || {};
  const style = (node as any).style || {};
  const width = finiteDimension(measured.width)
    || finiteDimension((node as any).width)
    || styleDimension(style.width);
  const height = finiteDimension(measured.height)
    || finiteDimension((node as any).height)
    || styleDimension(style.height);
  return width && height ? { width, height } : null;
}

function measuredFlowNodeSizeMap(nodes: FlowNode[]): NodeVisualSizeMap {
  const sizes: NodeVisualSizeMap = new Map();
  for (const node of nodes) {
    const size = measuredFlowNodeSize(node);
    if (size) sizes.set(node.id, size);
  }
  return sizes;
}

function mergeVisualSizeMaps(base: NodeVisualSizeMap, override: NodeVisualSizeMap): NodeVisualSizeMap {
  if (override.size === 0) return base;
  const sizes: NodeVisualSizeMap = new Map(base);
  for (const [nodeId, size] of override) {
    // A fresh DOM measurement wins over the stored size. The stored size can be
    // stale (e.g. a file node's rendered height changes once its preview
    // loads), and Math.max with the inflated value breaks capsule-snap math.
    sizes.set(nodeId, size);
  }
  return sizes;
}

function measuredDomNodeSizeMap(root: HTMLElement | null, zoom: number): NodeVisualSizeMap {
  const sizes: NodeVisualSizeMap = new Map();
  if (!root) return sizes;
  const scale = Math.max(0.05, Number(zoom) || 1);
  root.querySelectorAll<HTMLElement>(WORKFLOW_NODE_CONTENT_SIZE_SELECTOR).forEach(element => {
    const rect = element.getBoundingClientRect();
    const size = {
      width: rect.width / scale,
      height: rect.height / scale,
    };
    if (!size.width || !size.height) return;
    const flowNodeId = element.closest<HTMLElement>('.react-flow__node')?.dataset.id || '';
    const graphNodeId = element.dataset.nodeId || '';
    for (const nodeId of [flowNodeId, graphNodeId]) {
      if (nodeId) sizes.set(nodeId, size);
    }
  });
  return sizes;
}
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

function isAgentNode(node: WorkflowNode | null | undefined) {
  if (!node) return false;
  if (node.kind === 'terminal-session') return true;
  if (node.agentKind) return true;
  const role = String(node.role || '').toLowerCase();
  return role.includes('agent') || role.includes('main') || role.includes('subagent') || role.includes('ceo');
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
  if (isEventNode(node)) return node.control?.canDelete ?? true;
  if (isCapabilityNode(node)) return node.control?.canDelete ?? true;
  if (isGoalNode(node)) return node.control?.canDelete ?? true;
  if (!node.sessionId) return false;
  return node.control?.canDelete ?? !isLiveStatus(node.status);
}

function canRequestDeleteNode(node: WorkflowNode | null | undefined) {
  if (canDeleteNode(node)) return true;
  return Boolean(node && isAgentNode(node) && node.sessionId && isLiveStatus(node.status));
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
  minY = 8,
) {
  const canvasW = Math.max(320, bounds?.width || 420);
  const canvasH = Math.max(240, bounds?.height || 420);
  const margin = 8;
  const topMargin = Math.max(margin, minY);
  const panelH = Math.min(maxHeight, Math.max(140, canvasH - topMargin - margin));
  return {
    x: Math.max(margin, Math.min(x, Math.max(margin, canvasW - width - margin))),
    y: Math.max(topMargin, Math.min(y, Math.max(topMargin, canvasH - panelH - margin))),
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
  return transferHasType(dataTransfer, WORKSPACE_ITEM_TRANSFER_TYPE)
    || transferHasType(dataTransfer, SKILL_GROUP_TRANSFER_TYPE)
    || transferHasFileCandidate(dataTransfer);
}

function readSkillGroupTransfer(dataTransfer: DataTransfer | null): SkillGroupDragPayload | null {
  if (!dataTransfer) return null;
  const raw = dataTransfer.getData(SKILL_GROUP_TRANSFER_TYPE);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as Partial<SkillGroupDragPayload>;
    const skillIds = Array.isArray(payload?.skillIds)
      ? payload.skillIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (skillIds.length === 0) return null;
    return { skillIds, label: String(payload.label || 'Skill Group') };
  } catch {
    return null;
  }
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

function shouldOpenCanvasContextMenu(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  if (element.closest(CANVAS_CONTEXT_MENU_BLOCK_SELECTOR)) {
    return false;
  }
  return Boolean(element.closest('.wf-flow, .react-flow, .react-flow__pane, .react-flow__renderer, .react-flow__viewport'));
}

function fallbackHandleId(handle: HTMLElement) {
  const portId = handle.getAttribute('data-port-id');
  const side = handle.getAttribute('data-side') || handle.getAttribute('data-handle-side');
  if (portId && side) return `${portId}:${side}`;
  if (handle.getAttribute('data-input-id')) return handle.getAttribute('data-input-id');
  if (handle.getAttribute('data-output-id')) return handle.getAttribute('data-output-id');
  if (side) {
    if (handle.classList.contains('workflow-goal-node-handle-left')) return 'goal:left';
    if (handle.classList.contains('workflow-goal-node-handle-right')) return 'goal:right';
    return side;
  }
  if (handle.classList.contains('wf-flow-handle-left')) return 'left';
  if (handle.classList.contains('wf-flow-handle-right')) return 'right';
  if (handle.classList.contains('wf-flow-handle-bottom')) return 'bottom';
  if (handle.classList.contains('wf-flow-handle-top')) return 'top';
  return null;
}

function graphConnectionStartFromEvent(
  target: EventTarget | null,
  clientX?: number,
  clientY?: number,
): GraphConnectionEndpoint | null {
  const targetElement = target instanceof Element ? target : null;
  const pointElement = Number.isFinite(clientX) && Number.isFinite(clientY)
    ? document.elementFromPoint(clientX!, clientY!)
    : null;
  const handle = (
    targetElement?.closest('.react-flow__handle')
    || pointElement?.closest('.react-flow__handle')
  ) as HTMLElement | null;
  if (!handle) return null;
  const flowNode = handle.closest<HTMLElement>('.react-flow__node');
  const ownedNode = handle.closest<HTMLElement>('[data-node-id]');
  const nodeId = handle.getAttribute('data-nodeid')
    || flowNode?.getAttribute('data-id')
    || ownedNode?.getAttribute('data-node-id')
    || '';
  if (!nodeId) return null;
  return {
    nodeId,
    handleId: handle.getAttribute('data-handleid')
      || handle.getAttribute('data-handle-id')
      || fallbackHandleId(handle),
  };
}

function orientConnectionFromGesture(connection: Connection, start: GraphConnectionStart | null): Connection {
  if (!start?.nodeId) return connection;
  if (connection.source === start.nodeId) {
    return {
      ...connection,
      sourceHandle: connection.sourceHandle || start.handleId,
    };
  }
  if (connection.target === start.nodeId && connection.source !== start.nodeId) {
    return {
      source: connection.target,
      target: connection.source,
      sourceHandle: connection.targetHandle || start.handleId,
      targetHandle: connection.sourceHandle,
    };
  }
  return connection;
}

function manualConnectionKey(
  source: string,
  target: string,
  direction: WorkflowEdgeDirection,
  relation: string,
  sourceHandle: string | null,
  targetHandle: string | null,
) {
  if (direction !== 'source-to-target') {
    return `bidirectional:${[source, target].sort().join('<->')}`;
  }
  return [
    'source-to-target',
    source,
    sourceHandle || '',
    relation,
    target,
    targetHandle || '',
  ].join('>');
}

function nodeKindIcon(kind: string) {
  if (kind === 'terminal-session') return Terminal;
  return Bot;
}

// Role identity (agent-team-cooperation-spec §3.1, AC-003 create path): the
// canonical roleTitle vocabulary plus free-form roles preserved as-is.
const ROLE_TITLE_PRESETS = ['ceo', 'manager', 'implementer', 'reviewer', 'verifier', 'planner', 'terminal-controller'];
const CUSTOM_ROLE_TITLE = '__custom__';

function stripRepeatedAgentRole(value: string) {
  return value
    .replace(/\bmain\s+agent\b/ig, '')
    .replace(/\bsubagent\b/ig, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[-_:|]\s*$/g, '')
    .trim();
}

function displayNodeTitle(node: WorkflowNode) {
  // Role identity (agent-team-cooperation-spec §3.3, AC-003/T5): displayName
  // wins when the session record carries one; legacy sessions fall back to
  // the runtime-branded label below.
  const displayName = String((node as WorkflowNode & { displayName?: string }).displayName || '').trim();
  if (displayName) return displayName;
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
  // Role identity (agent-team-cooperation-spec §3.1, AC-003/T5): roleTitle is
  // the role chip when the session record carries one; legacy sessions fall
  // back to the agentKind-derived badge below.
  const roleTitle = String((node as WorkflowNode & { roleTitle?: string }).roleTitle || '').trim();
  if (roleTitle) return roleTitle.toUpperCase();
  if (node.agentKind === 'main') return 'MAIN AGENT';
  if (node.agentKind === 'subagent') return 'SUBAGENT';
  if (String(node.role || '').toLowerCase().includes('ceo')) return 'MAIN AGENT';
  if (node.sessionId) return 'AGENT';
  return node.kind.toUpperCase();
}

function capsuleDockPairId(left: string, right: string) {
  return [left, right].sort().join('::');
}

function normalizeCapsuleDockSide(value: unknown): CapsuleDockSide {
  const side = String(value || '').trim();
  return side === 'left' || side === 'right' || side === 'top' || side === 'bottom' ? side : 'right';
}

function capsuleConnectionId(connection: {
  source?: string | null;
  target?: string | null;
  relation?: string | null;
  direction?: WorkflowEdgeDirection | string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}) {
  const source = String(connection.source || '').trim();
  const target = String(connection.target || '').trim();
  const relation = String(connection.relation || 'wf-bridge').trim();
  const direction = normalizeWorkflowEdgeDirection(connection.direction);
  const sourceHandle = String(connection.sourceHandle || '').trim();
  const targetHandle = String(connection.targetHandle || '').trim();
  return `${source}->${target}:${relation}:${direction}:${sourceHandle}->${targetHandle}`;
}

function normalizeCapsuleDockConnection(value: unknown): CapsuleDockConnection | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as {
    id?: unknown;
    from?: unknown;
    to?: unknown;
    source?: unknown;
    target?: unknown;
    relation?: unknown;
    direction?: unknown;
    sourceHandle?: unknown;
    targetHandle?: unknown;
  };
  const source = String(record.source || record.from || '').trim();
  const target = String(record.target || record.to || '').trim();
  if (!source || !target || source === target) return null;
  const relation = String(record.relation || 'wf-bridge').trim() || 'wf-bridge';
  const direction = normalizeWorkflowEdgeDirection(record.direction);
  const sourceHandle = String(record.sourceHandle || '').trim();
  const targetHandle = String(record.targetHandle || '').trim();
  const connection = {
    id: String(record.id || capsuleConnectionId({ source, target, relation, direction, sourceHandle, targetHandle })).trim(),
    source,
    target,
    relation,
    direction,
    sourceHandle: sourceHandle || null,
    targetHandle: targetHandle || null,
  };
  return connection.id ? connection : null;
}

function normalizeCapsuleDockLinks(value: unknown, edges: WorkflowGraphEdge[] = []): CapsuleDockLink[] {
  if (!Array.isArray(value)) return [];
  const validEdgeIds = new Set(edges.map(edge => edge.id));
  const edgeById = new Map(edges.map(edge => [edge.id, edge]));
  const links = new Map<string, CapsuleDockLink>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as {
      id?: unknown;
      nodeIds?: unknown;
      anchorId?: unknown;
      draggedId?: unknown;
      side?: unknown;
      edges?: unknown;
      edgeIds?: unknown;
      connections?: unknown;
    };
    const rawNodeIds = Array.isArray(record.nodeIds) ? record.nodeIds.map(nodeId => String(nodeId || '').trim()) : [];
    const anchorId = String(record.anchorId || rawNodeIds[0] || '').trim();
    const draggedId = String(record.draggedId || rawNodeIds[1] || '').trim();
    if (!anchorId || !draggedId || anchorId === draggedId) continue;
    const sortedNodeIds = [anchorId, draggedId].sort() as [string, string];
    const rawEdges = Array.isArray(record.edges) ? record.edges : (Array.isArray(record.edgeIds) ? record.edgeIds : []);
    const edgeBindings = rawEdges
      .map(binding => {
        if (typeof binding === 'string') {
          return { edgeId: binding, retention: 'keep' as CapsuleDockEdgeRetention };
        }
        if (!binding || typeof binding !== 'object') return null;
        const edgeBinding = binding as { edgeId?: unknown; id?: unknown; retention?: unknown };
        const edgeId = String(edgeBinding.edgeId || edgeBinding.id || '').trim();
        if (!edgeId) return null;
        const retention = edgeBinding.retention === 'delete-on-detach' ? 'delete-on-detach' : 'keep';
        return { edgeId, retention } satisfies CapsuleDockEdgeBinding;
      })
      .filter((binding): binding is CapsuleDockEdgeBinding => Boolean(binding?.edgeId))
      .filter(binding => validEdgeIds.has(binding.edgeId));
    const pairId = capsuleDockPairId(sortedNodeIds[0], sortedNodeIds[1]);
    const side = normalizeCapsuleDockSide(record.side);
    const rawConnections = Array.isArray(record.connections) ? record.connections : [];
    const connections = rawConnections
      .map(normalizeCapsuleDockConnection)
      .filter((connection): connection is CapsuleDockConnection => Boolean(connection));
    if (connections.length === 0) {
      for (const binding of edgeBindings) {
        const edge = edgeById.get(binding.edgeId);
        if (!edge) continue;
        const connection = normalizeCapsuleDockConnection({
          id: `dock:${pairId}:${edge.id}`,
          source: edge.source || edge.from,
          target: edge.target || edge.to,
          relation: edge.relation,
          direction: edge.direction,
          sourceHandle: edge.protocolSourceHandle ?? edge.sourceHandle,
          targetHandle: edge.protocolTargetHandle ?? edge.targetHandle,
        });
        if (connection) connections.push(connection);
      }
    }
    if (connections.length === 0) continue;
    links.set(pairId, {
      id: String(record.id || `dock:${pairId}`),
      nodeIds: sortedNodeIds,
      anchorId,
      draggedId,
      side,
      edges: edgeBindings,
      connections,
    });
  }
  return [...links.values()];
}

function normalizeGraphHistoryEntries(value: unknown): GraphHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const result: GraphHistoryEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Partial<GraphHistoryEntry>;
    const edges: WorkflowGraphEdge[] = Array.isArray(record.edges)
      ? record.edges
        .filter(edge => edge.source && edge.target)
        .map(edge => ({ ...edge, direction: normalizeWorkflowEdgeDirection(edge.direction) }))
      : [];
    result.push({
      positions: record.positions && typeof record.positions === 'object' ? record.positions : {},
      edges,
      capsuleDockLinks: normalizeCapsuleDockLinks(record.capsuleDockLinks, edges),
      ...(Array.isArray(record.deletedNodes) ? { deletedNodes: record.deletedNodes } : {}),
    });
  }
  return result;
}

function emptyGraphState(): WorkflowGraphState {
  return {
    schemaVersion: graphSchemaVersion,
    version: 1,
    positions: {},
    edges: [],
    capsuleDockLinks: [],
    undoStack: [],
    redoStack: [],
  };
}

function normalizeGraphState(value: Partial<WorkflowGraphState> | null | undefined): WorkflowGraphState {
  const fallback = emptyGraphState();
  if (!value || typeof value !== 'object') return fallback;
  const edges = Array.isArray(value.edges)
    ? value.edges
      .filter(edge => edge.source && edge.target)
      .map(edge => ({ ...edge, direction: normalizeWorkflowEdgeDirection(edge.direction) }))
    : [];
  const capsuleDockLinks = normalizeCapsuleDockLinks(value.capsuleDockLinks, edges);
  const legacyDockEdgeIds = capsuleDockDeleteOnDetachEdgeIds(capsuleDockLinks);
  const cleanEdges = legacyDockEdgeIds.size > 0
    ? edges.filter(edge => !legacyDockEdgeIds.has(String(edge.id || '').trim()))
    : edges;
  const cleanCapsuleDockLinks = legacyDockEdgeIds.size > 0
    ? pruneCapsuleDockLinksByEdgeIds(capsuleDockLinks, legacyDockEdgeIds)
    : capsuleDockLinks;
  return {
    schemaVersion: graphSchemaVersion,
    version: Number(value.version || 1),
    positions: value.positions && typeof value.positions === 'object' ? value.positions : {},
    edges: cleanEdges,
    capsuleDockLinks: cleanCapsuleDockLinks,
    undoStack: normalizeGraphHistoryEntries(value.undoStack),
    redoStack: normalizeGraphHistoryEntries(value.redoStack),
  };
}

function normalizeWorkflowEdgeDirection(value: unknown): WorkflowEdgeDirection {
  return String(value || '').trim() === 'source-to-target' ? 'source-to-target' : 'bidirectional';
}

function bridgeArrowForDirection(direction: WorkflowEdgeDirection) {
  return direction === 'source-to-target' ? '->' : '<->';
}

function normalizePosition(value: unknown): GraphPosition | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as { x?: unknown; y?: unknown };
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function resourcePrimaryPort(type: WorkflowComponentType | null) {
  if (type === 'markdown') return 'markdown';
  if (type === 'excalidraw') return 'scene';
  if (type === 'file') return 'file';
  return '';
}

function capabilityPrimaryPort(type: WorkflowCapabilityNodeType | null) {
  return type ? 'capability' : '';
}

function resourceHandleAliases(type: WorkflowComponentType | null) {
  if (type === 'markdown') {
    return new Set(['markdown', 'plaintext', 'content', 'selection', 'input', 'output', 'left', 'right']);
  }
  if (type === 'excalidraw') {
    return new Set(['scene', 'image', 'diagram', 'excalidraw', 'content', 'selection', 'input', 'output', 'left', 'right']);
  }
  return new Set<string>();
}

function normalizeComponentEdgeHandle(type: WorkflowComponentType | null, role: 'source' | 'target', value: unknown) {
  if (type !== 'markdown' && type !== 'excalidraw') {
    const handle = String(value || '').trim();
    return handle || null;
  }
  const primary = resourcePrimaryPort(type);
  const handle = String(value || '').trim();
  if (!handle) return `${primary}:${role === 'source' ? 'right' : 'left'}`;
  const physicalMatch = handle.match(/^([^:]+):(left|right)$/);
  if (physicalMatch && physicalMatch[1] === primary) return `${primary}:${physicalMatch[2]}`;
  const side = handle.toLowerCase();
  if (side === 'left' || side === 'right') return `${primary}:${side}`;
  const semantic = handle.split(':')[0].trim().toLowerCase();
  if (resourceHandleAliases(type).has(semantic)) return `${primary}:${role === 'source' ? 'right' : 'left'}`;
  return `${primary}:${role === 'source' ? 'right' : 'left'}`;
}

function normalizeWorkflowEdgeHandle(node: WorkflowNode | undefined, role: 'source' | 'target', value: unknown) {
  const componentType = componentTypeFromNode(node);
  const eventType = eventTypeFromNode(node);
  const capabilityType = capabilityTypeFromNode(node);
  const goalType = goalTypeFromNode(node);
  if (goalType) {
    const handle = String(value || '').trim();
    if (!handle) return `goal:${role === 'source' ? 'right' : 'left'}`;
    const physicalMatch = handle.match(/^([^:]+):(left|right|top|bottom)$/);
    if (physicalMatch && physicalMatch[1] === 'goal') return `goal:${physicalMatch[2]}`;
    const side = handle.toLowerCase();
    if (side === 'left' || side === 'right' || side === 'top' || side === 'bottom') return `goal:${side}`;
    const semantic = handle.split(':')[0].trim().toLowerCase();
    if (['goal', 'task', 'acceptance', 'context', 'input', 'output'].includes(semantic)) {
      return `goal:${role === 'source' ? 'right' : 'left'}`;
    }
    return `goal:${role === 'source' ? 'right' : 'left'}`;
  }
  if (eventType === 'timer') {
    const handle = String(value || '').trim();
    if (handle === 'left' || handle === 'right' || handle === 'top' || handle === 'bottom') {
      return role === 'source' ? 'event' : 'config';
    }
    if (handle) return handle;
    return role === 'source' ? 'event' : 'config';
  }
  if (capabilityType) {
    const primary = capabilityPrimaryPort(capabilityType);
    const handle = String(value || '').trim();
    if (!handle) return `${primary}:${role === 'source' ? 'right' : 'left'}`;
    const physicalMatch = handle.match(/^([^:]+):(left|right)$/);
    if (physicalMatch && physicalMatch[1] === primary) return `${primary}:${physicalMatch[2]}`;
    const side = handle.toLowerCase();
    if (side === 'left' || side === 'right') return `${primary}:${side}`;
    const semantic = handle.split(':')[0].trim().toLowerCase();
    if (['capability', 'skill-group', 'skills', 'skill', 'mcp', 'mcp-connector', 'connector', 'server', 'tool', 'tools', 'input', 'output'].includes(semantic)) {
      return `${primary}:${role === 'source' ? 'right' : 'left'}`;
    }
    return `${primary}:${role === 'source' ? 'right' : 'left'}`;
  }
  if (componentType === 'markdown' || componentType === 'excalidraw') {
    return normalizeComponentEdgeHandle(componentType, role, value);
  }
  if (isAgentNode(node)) {
    const handle = String(value || '').trim();
    if (!handle) return role === 'source' ? 'right' : 'left';
    if (handle === 'output') return 'bottom';
    return handle;
  }
  const handle = String(value || '').trim();
  if (!handle) return null;
  if (role === 'target' && handle === 'left' && node && !isComponentNode(node)) return 'context';
  if (role === 'source' && handle === 'output' && node && !isComponentNode(node)) return 'bottom';
  return handle;
}

function normalizeAgentPhysicalHandle(value: unknown, role: 'source' | 'target') {
  const handle = String(value || '').trim();
  if (handle === 'left' || handle === 'right' || handle === 'top' || handle === 'bottom') return handle;
  if (handle === 'context' || handle === 'event.in' || handle === 'input') return 'left';
  if (handle === 'output') return 'bottom';
  return role === 'source' ? 'right' : 'left';
}

function physicalSideHandle(value: unknown): 'left' | 'right' | 'top' | 'bottom' | null {
  const handle = String(value || '').trim().toLowerCase();
  if (handle === 'left' || handle === 'right' || handle === 'top' || handle === 'bottom') return handle;
  const side = handle.match(/:(left|right|top|bottom)$/)?.[1];
  return side === 'left' || side === 'right' || side === 'top' || side === 'bottom' ? side : null;
}

function workflowEdgeRenderHandle(
  node: WorkflowNode | undefined,
  role: 'source' | 'target',
  protocolHandle: unknown,
  uiHandle: unknown,
) {
  if (isAgentNode(node)) {
    const requestedUiHandle = String(uiHandle || '').trim();
    if (requestedUiHandle) return normalizeAgentPhysicalHandle(requestedUiHandle, role);
    return normalizeAgentPhysicalHandle(protocolHandle, role);
  }
  return normalizeWorkflowEdgeHandle(node, role, uiHandle || protocolHandle);
}

function semanticHandleForDisplay(node: WorkflowNode | undefined, role: 'source' | 'target', value: unknown) {
  const componentType = componentTypeFromNode(node);
  const eventType = eventTypeFromNode(node);
  const capabilityType = capabilityTypeFromNode(node);
  if (goalTypeFromNode(node)) return 'goal';
  if (eventType === 'timer') return normalizeWorkflowEdgeHandle(node, role, value);
  if (capabilityType) return capabilityPrimaryPort(capabilityType);
  if (componentType === 'markdown' || componentType === 'excalidraw') {
    return resourcePrimaryPort(componentType);
  }
  return normalizeWorkflowEdgeHandle(node, role, value);
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
  const nodeByCanvasId = new Map<string, WorkflowNode>();
  for (const node of workflow?.nodes || []) {
    graphIdToCanvasId.set(node.id, node.id);
    if (node.graphNodeId) graphIdToCanvasId.set(node.graphNodeId, node.id);
    nodeByCanvasId.set(node.id, node);
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
      const sourceNode = nodeByCanvasId.get(source);
      const targetNode = nodeByCanvasId.get(target);
      const protocolSourceHandle = normalizeWorkflowEdgeHandle(sourceNode, 'source', edge.sourceHandle);
      const protocolTargetHandle = normalizeWorkflowEdgeHandle(targetNode, 'target', edge.targetHandle);
      const sourceHandle = workflowEdgeRenderHandle(sourceNode, 'source', protocolSourceHandle, edge.uiSourceHandle);
      const targetHandle = workflowEdgeRenderHandle(targetNode, 'target', protocolTargetHandle, edge.uiTargetHandle);
      const displaySourceHandle = semanticHandleForDisplay(sourceNode, 'source', protocolSourceHandle);
      const displayTargetHandle = semanticHandleForDisplay(targetNode, 'target', protocolTargetHandle);
      const relation = semanticBridgeRelation(displaySourceHandle, displayTargetHandle, edge.relation);
      const direction = normalizeWorkflowEdgeDirection(edge.direction);
      return {
        id: edge.id || `project-${source}-${target}`,
        from: source,
        to: target,
        source,
        target,
        label: bridgeDisplayLabel(edge.relation || relation, displaySourceHandle, displayTargetHandle, translate, direction),
        relation,
        direction,
        sourceHandle,
        targetHandle,
        protocolSourceHandle,
        protocolTargetHandle,
        uiSourceHandle: sourceHandle,
        uiTargetHandle: targetHandle,
        offset: Number.isFinite(Number(edge.offset)) ? Number(edge.offset) : undefined,
      };
    }).filter(edge => edge.source && edge.target),
    capsuleDockLinks: graph.capsuleDockLinks as unknown as CapsuleDockLink[],
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
  return value === 'markdown' || value === 'excalidraw' || value === 'file' || value === 'display';
}

function isWorkflowEventType(value: unknown): value is WorkflowEventNodeType {
  return value === 'timer' || value === 'github-trigger';
}

function isWorkflowCapabilityType(value: unknown): value is WorkflowCapabilityNodeType {
  return value === 'skill-group' || value === 'mcp-connector';
}

function isWorkflowGoalType(value: unknown): value is 'goal' {
  return value === 'goal';
}

function componentTypeFromNode(node: WorkflowNode | null | undefined): WorkflowComponentType | null {
  const value = node?.componentType || node?.type;
  return isWorkflowComponentType(value) ? value : null;
}

function isComponentNode(node: WorkflowNode | null | undefined) {
  return Boolean(node && (node.kind === 'component-node' || componentTypeFromNode(node)));
}

function eventTypeFromNode(node: WorkflowNode | null | undefined): WorkflowEventNodeType | null {
  const value = node?.type || node?.kind;
  return isWorkflowEventType(value) ? value : null;
}

function isEventNode(node: WorkflowNode | null | undefined) {
  return Boolean(node && (node.kind === 'event-node' || eventTypeFromNode(node)));
}

function capabilityTypeFromNode(node: WorkflowNode | null | undefined): WorkflowCapabilityNodeType | null {
  const value = node?.type || node?.kind;
  return isWorkflowCapabilityType(value) ? value : null;
}

function isCapabilityNode(node: WorkflowNode | null | undefined) {
  return Boolean(node && (node.kind === 'capability-node' || capabilityTypeFromNode(node)));
}

function goalTypeFromNode(node: WorkflowNode | null | undefined): 'goal' | null {
  const value = node?.type || node?.kind;
  return isWorkflowGoalType(value) || value === 'goal-node' ? 'goal' : null;
}

function isGoalNode(node: WorkflowNode | null | undefined) {
  return Boolean(node && (node.kind === 'goal-node' || goalTypeFromNode(node)));
}

function capsuleRoleForNode(node: WorkflowNode | null | undefined): CapsuleRole | null {
  if (isGoalNode(node)) return 'goal';
  if (eventTypeFromNode(node) === 'timer') return 'timer';
  if (isAgentNode(node)) return 'agent';
  if (isComponentNode(node)) return 'resource';
  return null;
}

function capsuleNodeKeys(node: WorkflowNode | null | undefined) {
  return [node?.id, node?.graphNodeId, node?.sessionId].filter(Boolean).map(String);
}

function formatCapsuleDuration(value: unknown) {
  const seconds = Math.max(1, Math.floor(Number(value) || 0));
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function timerSequenceLabel(node: CanvasNode | null | undefined) {
  const sequence = node?.eventState?.schedule?.cadence?.sequenceSeconds;
  if (!Array.isArray(sequence) || sequence.length === 0) return '';
  const values = sequence
    .filter(value => Number.isFinite(Number(value)) && Number(value) > 0)
    .slice(0, 4)
    .map(formatCapsuleDuration);
  if (values.length === 0) return '';
  return `${values.join(' -> ')}${sequence.length > values.length ? '...' : ''}`;
}

function capsuleLinkTitle(node: CanvasNode) {
  return displayNodeTitle(node) || node.goalState?.title || node.eventState?.title || node.label || node.id;
}

function capsuleStatus(node: CanvasNode) {
  if (eventTypeFromNode(node) === 'timer') {
    if (node.eventState?.heartbeat?.watchdog?.enabled) {
      return String(node.eventState.heartbeat.watchdog.state || 'watchdog');
    }
    return node.eventState?.enabled ? 'enabled' : 'paused';
  }
  if (isGoalNode(node)) return node.goalState?.status || node.status;
  return displaySessionStatus(node.status);
}

function sameCapsuleLink(left: WorkflowCapsuleLink, right: WorkflowCapsuleLink) {
  return left.nodeId === right.nodeId
    && left.title === right.title
    && left.role === right.role
    && left.relation === right.relation
    && left.direction === right.direction
    && (left.status || '') === (right.status || '')
    && (left.edgeId || '') === (right.edgeId || '')
    && (left.handle || '') === (right.handle || '');
}

function sameCapsuleLinks(left: WorkflowCapsuleLink[] = [], right: WorkflowCapsuleLink[] = []) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => sameCapsuleLink(item, right[index]));
}

function sameCapsuleSummary(left: WorkflowCapsuleSummary | undefined, right: WorkflowCapsuleSummary | undefined) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.nodeId === right.nodeId
    && left.mode === right.mode
    && left.stateLabel === right.stateLabel
    && left.nextLabel === right.nextLabel
    && (left.sequenceLabel || '') === (right.sequenceLabel || '')
    && (left.wdtState || '') === (right.wdtState || '')
    && left.protocolSteps.join('|') === right.protocolSteps.join('|')
    && sameCapsuleLinks(left.goals, right.goals)
    && sameCapsuleLinks(left.timers, right.timers)
    && sameCapsuleLinks(left.agents, right.agents);
}

function focusCapsuleNodeIds(capsuleByNodeId: Map<string, WorkflowCapsuleSummary>) {
  const seen = new Set<string>();
  let best: { ids: string[]; score: number } | null = null;
  for (const capsule of capsuleByNodeId.values()) {
    const links = [...capsule.goals, ...capsule.timers, ...capsule.agents];
    const key = links
      .map(link => `${link.role}:${link.nodeId}`)
      .sort()
      .join('|');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const roles = new Set(links.map(link => link.role));
    if (roles.size < 2) continue;
    const score = roles.size * 10
      + links.length
      + (roles.has('goal') ? 2 : 0)
      + (roles.has('timer') ? 2 : 0)
      + (roles.has('agent') ? 2 : 0);
    if (!best || score > best.score) best = { ids: links.map(link => link.nodeId), score };
  }
  return best?.ids || [];
}

function isCapsuleDockedEdge(edge: FlowEdge, dockLinks: CapsuleDockLink[]) {
  const runtimeEdgeId = String(edge.data?.runtimeEdgeId || '').trim();
  const flowEdgeId = String(edge.id || '').trim();
  return dockLinks.some(link => link.edges.some(binding => (
    binding.edgeId === runtimeEdgeId || binding.edgeId === flowEdgeId
  )));
}

function runtimeEdgeIdFromFlowEdge(edge: FlowEdge) {
  return String(edge.data?.runtimeEdgeId || edge.id || '').trim();
}

function addFlowEdgeIdAliases(target: Set<string>, edge: FlowEdge) {
  const flowEdgeId = String(edge.id || '').trim();
  const runtimeEdgeId = runtimeEdgeIdFromFlowEdge(edge);
  if (flowEdgeId) target.add(flowEdgeId);
  if (runtimeEdgeId) target.add(runtimeEdgeId);
}

function flowEdgeMatchesIds(edge: FlowEdge, ids: Set<string>) {
  const flowEdgeId = String(edge.id || '').trim();
  const runtimeEdgeId = runtimeEdgeIdFromFlowEdge(edge);
  return (flowEdgeId && ids.has(flowEdgeId)) || (runtimeEdgeId && ids.has(runtimeEdgeId));
}

function graphEdgeMatchesIds(edge: WorkflowGraphEdge, ids: Set<string>) {
  const edgeId = String(edge.id || '').trim();
  return Boolean(edgeId && ids.has(edgeId));
}

function pruneCapsuleDockLinksByEdgeIds(dockLinks: CapsuleDockLink[], edgeIds: Set<string>) {
  if (edgeIds.size === 0) return dockLinks;
  return dockLinks
    .map(link => ({
      ...link,
      edges: link.edges.filter(binding => !edgeIds.has(binding.edgeId)),
    }))
    .filter(link => link.connections.length > 0);
}

function capsuleDockLinkPairId(link: Pick<CapsuleDockLink, 'nodeIds'>) {
  return capsuleDockPairId(link.nodeIds[0], link.nodeIds[1]);
}

function capsuleDockDeleteOnDetachEdgeIds(dockLinks: CapsuleDockLink[]) {
  const edgeIds = new Set<string>();
  for (const link of dockLinks) {
    for (const binding of link.edges) {
      if (binding.retention !== 'delete-on-detach') continue;
      const edgeId = String(binding.edgeId || '').trim();
      if (edgeId) edgeIds.add(edgeId);
    }
  }
  return edgeIds;
}

function pruneCapsuleDockLinksByPairIds(dockLinks: CapsuleDockLink[], pairIds: Set<string>) {
  if (pairIds.size === 0) return dockLinks;
  return dockLinks.filter(link => !pairIds.has(capsuleDockLinkPairId(link)));
}

function filterGraphStateEdgeIds(state: WorkflowGraphState, edgeIds: Set<string>) {
  if (edgeIds.size === 0) return state;
  const edges = state.edges.filter(edge => !graphEdgeMatchesIds(edge, edgeIds));
  const capsuleDockLinks = pruneCapsuleDockLinksByEdgeIds(state.capsuleDockLinks, edgeIds);
  if (edges.length === state.edges.length && sameCapsuleDockLinks(state.capsuleDockLinks, capsuleDockLinks)) return state;
  return normalizeGraphState({
    ...state,
    edges,
    capsuleDockLinks,
  });
}

function filterGraphStateDockPairIds(state: WorkflowGraphState, pairIds: Set<string>) {
  if (pairIds.size === 0) return state;
  const capsuleDockLinks = pruneCapsuleDockLinksByPairIds(state.capsuleDockLinks, pairIds);
  if (sameCapsuleDockLinks(state.capsuleDockLinks, capsuleDockLinks)) return state;
  return normalizeGraphState({
    ...state,
    capsuleDockLinks,
  });
}

function retireResolvedEdgeTombstones(state: WorkflowGraphState, tombstones: Set<string>) {
  if (tombstones.size === 0) return;
  const liveIds = new Set(state.edges.map(edge => String(edge.id || '').trim()).filter(Boolean));
  for (const id of [...tombstones]) {
    if (!liveIds.has(id)) tombstones.delete(id);
  }
}

function retireResolvedCapsuleDockTombstones(state: WorkflowGraphState, tombstones: Set<string>) {
  if (tombstones.size === 0) return;
  const livePairIds = new Set(state.capsuleDockLinks.map(capsuleDockLinkPairId));
  for (const pairId of [...tombstones]) {
    if (!livePairIds.has(pairId)) tombstones.delete(pairId);
  }
}

type CapsuleAccumulator = {
  node: CanvasNode;
  role: WorkflowCapsuleRole;
  goals: Map<string, WorkflowCapsuleLink>;
  timers: Map<string, WorkflowCapsuleLink>;
  agents: Map<string, WorkflowCapsuleLink>;
};

function capsuleMapForRole(accumulator: CapsuleAccumulator, role: WorkflowCapsuleRole) {
  if (role === 'goal') return accumulator.goals;
  if (role === 'timer') return accumulator.timers;
  return accumulator.agents;
}

function buildWorkflowCapsuleSummaries(nodes: CanvasNode[], edges: WorkflowGraphEdge[], dockLinks: CapsuleDockLink[] = []) {
  const nodeByAnyId = new Map<string, CanvasNode>();
  const accumulators = new Map<string, CapsuleAccumulator>();
  for (const node of nodes) {
    for (const key of capsuleNodeKeys(node)) nodeByAnyId.set(key, node);
    const role = capsuleRoleForNode(node);
    if (!role || role === 'resource') continue;
    accumulators.set(node.id, {
      node,
      role,
      goals: new Map(),
      timers: new Map(),
      agents: new Map(),
    });
  }

  const addLink = (
    owner: CanvasNode,
    peer: CanvasNode,
    edge: WorkflowGraphEdge,
    handle: string | null | undefined,
  ) => {
    const ownerAccumulator = accumulators.get(owner.id);
    const peerRole = capsuleRoleForNode(peer);
    if (!ownerAccumulator || !peerRole || peerRole === 'resource' || owner.id === peer.id) return;
    capsuleMapForRole(ownerAccumulator, peerRole).set(peer.id, {
      nodeId: peer.id,
      title: capsuleLinkTitle(peer),
      role: peerRole,
      relation: edge.relation || 'wf-bridge',
      direction: normalizeWorkflowEdgeDirection(edge.direction),
      status: capsuleStatus(peer),
      edgeId: edge.id,
      handle: String(handle || '').trim(),
    });
  };

  for (const edge of edges) {
    const source = nodeByAnyId.get(String(edge.source || edge.from || ''));
    const target = nodeByAnyId.get(String(edge.target || edge.to || ''));
    if (!source || !target) continue;
    if (!capsuleRoleForNode(source) || !capsuleRoleForNode(target)) continue;
    addLink(source, target, edge, edge.targetHandle);
    addLink(target, source, edge, edge.sourceHandle);
  }
  for (const dockLink of dockLinks) {
    for (const connection of dockLink.connections) {
      const source = nodeByAnyId.get(String(connection.source || ''));
      const target = nodeByAnyId.get(String(connection.target || ''));
      if (!source || !target) continue;
      if (!capsuleRoleForNode(source) || !capsuleRoleForNode(target)) continue;
      const edge: WorkflowGraphEdge = {
        id: connection.id,
        source: source.id,
        target: target.id,
        from: source.id,
        to: target.id,
        relation: connection.relation,
        direction: connection.direction,
        sourceHandle: connection.sourceHandle || null,
        targetHandle: connection.targetHandle || null,
      };
      addLink(source, target, edge, edge.targetHandle);
      addLink(target, source, edge, edge.sourceHandle);
    }
  }

  const result = new Map<string, WorkflowCapsuleSummary>();
  for (const accumulator of accumulators.values()) {
    const goals = [...accumulator.goals.values()].sort((left, right) => left.title.localeCompare(right.title));
    const timers = [...accumulator.timers.values()].sort((left, right) => left.title.localeCompare(right.title));
    const agents = [...accumulator.agents.values()].sort((left, right) => left.title.localeCompare(right.title));
    const hasGoal = accumulator.role === 'goal' || goals.length > 0;
    const hasTimer = accumulator.role === 'timer' || timers.length > 0;
    const hasAgent = accumulator.role === 'agent' || agents.length > 0;
    const mode = hasGoal && hasTimer && hasAgent
      ? 'goal-loop'
      : (hasGoal && hasTimer
          ? 'goal-timer'
          : (hasGoal && hasAgent
              ? 'goal-agent'
              : (hasTimer && hasAgent ? 'timer-agent' : 'standalone')));
    const timerNodes = [
      ...(accumulator.role === 'timer' ? [accumulator.node] : []),
      ...timers.map(link => nodeByAnyId.get(link.nodeId)).filter(Boolean),
    ] as CanvasNode[];
    const sequenceLabel = timerNodes.map(timerSequenceLabel).find(Boolean) || '';
    const watchdogTimer = timerNodes.find(timer => timer.eventState?.heartbeat?.watchdog?.enabled);
    const ownGoalWdt = accumulator.node.goalState?.wdt;
    const wdtState = String(watchdogTimer?.eventState?.heartbeat?.watchdog?.state || ownGoalWdt?.state || '').trim();
    const stateLabel = mode === 'goal-loop'
      ? 'Goal loop'
      : (mode === 'goal-timer'
          ? 'Timed goal'
          : (mode === 'goal-agent'
              ? 'Goal owner'
              : (mode === 'timer-agent'
                  ? 'Timed agent'
                  : 'Standalone')));
    const nextLabel = mode === 'goal-loop'
      ? (sequenceLabel || 'Connect -> prompt -> ack')
      : (mode === 'goal-timer'
          ? 'Drop Agent to run'
          : (mode === 'goal-agent'
              ? 'Drop Timer for checks'
              : (mode === 'timer-agent'
                  ? 'Drop Goal to anchor'
                  : (accumulator.role === 'goal'
                      ? 'Drop Timer or Agent'
                      : (accumulator.role === 'timer' ? 'Drop Goal or Agent' : 'Drop Goal or Timer')))));
    const protocolSteps = mode === 'goal-loop'
      ? ['connect', 'prompt', 'ack']
      : (mode === 'timer-agent'
          ? ['connect', 'trigger', 'ack']
          : (mode === 'standalone' ? ['connect'] : ['connect', 'sync']));
    result.set(accumulator.node.id, {
      nodeId: accumulator.node.id,
      mode,
      goals,
      timers,
      agents,
      stateLabel,
      nextLabel,
      protocolSteps,
      sequenceLabel: sequenceLabel || undefined,
      wdtState: wdtState || undefined,
    });
  }
  return result;
}

function createCapsuleDockConnection(
  source: string,
  target: string,
  relation: string,
  direction: WorkflowEdgeDirection,
  sourceHandle: string,
  targetHandle: string,
): CapsuleDockConnection {
  return {
    id: capsuleConnectionId({ source, target, relation, direction, sourceHandle, targetHandle }),
    source,
    target,
    relation,
    direction,
    sourceHandle,
    targetHandle,
  };
}

function capsuleDockConnections(left: CanvasNode, right: CanvasNode): CapsuleDockConnection[] {
  const leftRole = capsuleRoleForNode(left);
  const rightRole = capsuleRoleForNode(right);
  if (!leftRole || !rightRole || leftRole === rightRole) return [];
  const byRole = new Map<CapsuleRole, CanvasNode>([
    [leftRole, left],
    [rightRole, right],
  ]);
  const goal = byRole.get('goal');
  const timer = byRole.get('timer');
  const agent = byRole.get('agent');
  const resource = byRole.get('resource');
  if (timer && goal) {
    return [createCapsuleDockConnection(timer.id, goal.id, 'event', 'source-to-target', 'event', 'goal:left')];
  }
  if (timer && agent) {
    return [
      createCapsuleDockConnection(timer.id, agent.id, 'event', 'source-to-target', 'event', 'event.in'),
      createCapsuleDockConnection(agent.id, timer.id, 'control', 'source-to-target', 'context', 'config'),
    ];
  }
  if (goal && agent) {
    return [createCapsuleDockConnection(goal.id, agent.id, 'goal', 'bidirectional', 'goal:right', 'context')];
  }
  if (resource && agent) {
    const port = resourcePrimaryPort(componentTypeFromNode(resource)) || 'markdown';
    return [createCapsuleDockConnection(resource.id, agent.id, 'resource', 'bidirectional', `${port}:right`, 'context')];
  }
  if (resource && timer) {
    const port = resourcePrimaryPort(componentTypeFromNode(resource)) || 'markdown';
    return [createCapsuleDockConnection(resource.id, timer.id, 'resource', 'source-to-target', `${port}:right`, 'config')];
  }
  if (resource && goal) {
    const port = resourcePrimaryPort(componentTypeFromNode(resource)) || 'markdown';
    return [createCapsuleDockConnection(resource.id, goal.id, 'resource', 'bidirectional', `${port}:right`, 'goal:left')];
  }
  return [];
}

function oppositeCapsuleDockSide(side: CapsuleDockSide): CapsuleDockSide {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  if (side === 'top') return 'bottom';
  return 'top';
}

function graphEdgeMatchesCapsuleConnection(
  edge: WorkflowGraphEdge,
  connection: CapsuleDockConnection,
  nodeById: Map<string, CanvasNode>,
) {
  const source = String(connection.source || '').trim();
  const target = String(connection.target || '').trim();
  if (!source || !target) return false;
  const sourceNode = nodeById.get(source);
  const targetNode = nodeById.get(target);
  const edgeSourceNode = nodeById.get(edge.source);
  const edgeTargetNode = nodeById.get(edge.target);
  const sourceHandle = normalizeWorkflowEdgeHandle(sourceNode, 'source', connection.sourceHandle);
  const targetHandle = normalizeWorkflowEdgeHandle(targetNode, 'target', connection.targetHandle);
  const edgeSourceHandle = normalizeWorkflowEdgeHandle(edgeSourceNode, 'source', edge.protocolSourceHandle ?? edge.sourceHandle);
  const edgeTargetHandle = normalizeWorkflowEdgeHandle(edgeTargetNode, 'target', edge.protocolTargetHandle ?? edge.targetHandle);
  const relation = String(connection.relation || '').trim();
  const edgeRelation = String(edge.relation || '').trim();
  const direction = normalizeWorkflowEdgeDirection(connection.direction);
  const edgeDirection = normalizeWorkflowEdgeDirection(edge.direction);
  if (
    edge.source === source
      && edge.target === target
      && String(edgeSourceHandle || '') === String(sourceHandle || '')
      && String(edgeTargetHandle || '') === String(targetHandle || '')
      && edgeDirection === direction
      && (!relation || !edgeRelation || edgeRelation === relation)
  ) {
    return true;
  }

  const connectionRoles = new Set([capsuleRoleForNode(sourceNode), capsuleRoleForNode(targetNode)].filter(Boolean));
  const edgeRoles = new Set([capsuleRoleForNode(edgeSourceNode), capsuleRoleForNode(edgeTargetNode)].filter(Boolean));
  const sameUnorderedPair = (
    (edge.source === source && edge.target === target)
      || (edge.source === target && edge.target === source)
  );
  return sameUnorderedPair
    && connectionRoles.has('goal')
    && connectionRoles.has('agent')
    && edgeRoles.has('goal')
    && edgeRoles.has('agent')
    && normalizeWorkflowEdgeDirection(edge.direction) !== 'source-to-target';
}

function findCapsuleEdgeForConnection(
  connection: CapsuleDockConnection,
  edges: WorkflowGraphEdge[],
  nodeById: Map<string, CanvasNode>,
  usedEdgeIds: Set<string> = new Set(),
) {
  return edges.find(edge => !usedEdgeIds.has(edge.id) && graphEdgeMatchesCapsuleConnection(edge, connection, nodeById)) || null;
}

function fallbackNodeVisualSize(node: CanvasNode, nodeModes?: Record<string, NodeMode>): NodeVisualSize {
  if (node.sessionId && nodeModes?.[node.id] === 'terminal') {
    return { width: TERMINAL_NODE_W, height: TERMINAL_NODE_H };
  }
  if (isComponentNode(node)) {
    return {
      width: Math.max(finiteDimension(node.width), COMPONENT_NODE_W),
      height: Math.max(finiteDimension(node.height), COMPONENT_NODE_H),
    };
  }
  if (isEventNode(node)) {
    return {
      width: Math.max(finiteDimension(node.width), EVENT_NODE_W),
      height: Math.max(finiteDimension(node.height), EVENT_NODE_H),
    };
  }
  if (isCapabilityNode(node)) {
    return {
      width: Math.max(finiteDimension(node.width), CAPABILITY_NODE_W),
      height: Math.max(finiteDimension(node.height), CAPABILITY_NODE_H),
    };
  }
  if (isGoalNode(node)) {
    return {
      width: Math.max(finiteDimension(node.width), GOAL_NODE_W),
      height: Math.max(finiteDimension(node.height), GOAL_NODE_H),
    };
  }
  return {
    width: Math.max(finiteDimension(node.width), CARD_NODE_W),
    height: Math.max(finiteDimension(node.height), CARD_NODE_H),
  };
}

function displayedNodeSize(
  node: CanvasNode,
  nodeModes?: Record<string, NodeMode>,
  visualSizes?: NodeVisualSizeMap,
): NodeVisualSize {
  const fallback = fallbackNodeVisualSize(node, nodeModes);
  const measured = visualSizes?.get(node.id)
    || visualSizes?.get(node.graphNodeId || '')
    || visualSizes?.get(node.sessionId || '');
  if (!measured) return fallback;
  // Measured (DOM) sizes are authoritative. Math.max with the fallback would
  // inflate the size with a stale declared value and break capsule-snap math.
  return measured;
}

function nodeRect(
  node: CanvasNode,
  position?: GraphPosition,
  nodeModes?: Record<string, NodeMode>,
  visualSizes?: NodeVisualSizeMap,
) {
  const x = position?.x ?? node.x;
  const y = position?.y ?? node.y;
  const { width, height } = displayedNodeSize(node, nodeModes, visualSizes);
  return { x, y, width, height };
}

/**
 * Nearest free spot for a brand-new node (AC-001): outward square spiral
 * around `preferred`, returning the first top-left corner whose rect keeps
 * >= `gap` clearance from every occupied rect. Existing nodes never move.
 */
function findNearestFreePosition(options: {
  preferred: GraphPosition;
  selfSize: { width: number; height: number };
  occupied: Array<{ x: number; y: number; width: number; height: number }>;
  gap?: number;
}): GraphPosition {
  const { preferred, selfSize, occupied, gap = 16 } = options;
  const { width, height } = selfSize;
  const isFree = (x: number, y: number) => {
    for (const other of occupied) {
      const sepX = Math.max(x, other.x) - Math.min(x + width, other.x + other.width);
      const sepY = Math.max(y, other.y) - Math.min(y + height, other.y + other.height);
      if (Math.max(sepX, sepY) < gap) return false;
    }
    return true;
  };
  // Classic outward square spiral (1 step = `gap` px on the preferred grid).
  let dx = 0;
  let dy = -1;
  let x = 0;
  let y = 0;
  for (let i = 0; i < 4096; i++) {
    const cx = preferred.x + x * gap;
    const cy = preferred.y + y * gap;
    if (isFree(cx, cy)) return { x: cx, y: cy };
    if (x === y || (x < 0 && x === -y) || (x > 0 && x === 1 - y)) {
      const next = dx;
      dx = -dy;
      dy = next;
    }
    x += dx;
    y += dy;
  }
  // Fallback (practically unreachable): hard offset right of the crowded area.
  return { x: preferred.x + width + gap, y: preferred.y };
}

function horizontalOverlapAmount(left: ReturnType<typeof nodeRect>, right: ReturnType<typeof nodeRect>) {
  return Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
}

function verticalOverlapAmount(left: ReturnType<typeof nodeRect>, right: ReturnType<typeof nodeRect>) {
  return Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
}

function rectsMateriallyOverlap(left: ReturnType<typeof nodeRect>, right: ReturnType<typeof nodeRect>) {
  return horizontalOverlapAmount(left, right) > 18 && verticalOverlapAmount(left, right) > 18;
}

function capsuleDockCandidateFor(
  dragged: CanvasNode,
  anchor: CanvasNode,
  position: GraphPosition,
  nodeModes?: Record<string, NodeMode>,
  visualSizes?: NodeVisualSizeMap,
): CapsuleDockCandidate | null {
  const connections = capsuleDockConnections(dragged, anchor);
  if (connections.length === 0) return null;
  const draggedRect = nodeRect(dragged, position, nodeModes, visualSizes);
  const anchorRect = nodeRect(anchor, undefined, nodeModes, visualSizes);
  const verticalDelta = Math.abs((draggedRect.y + draggedRect.height / 2) - (anchorRect.y + anchorRect.height / 2));
  const horizontalDelta = Math.abs((draggedRect.x + draggedRect.width / 2) - (anchorRect.x + anchorRect.width / 2));
  const overlapX = horizontalOverlapAmount(draggedRect, anchorRect);
  const overlapY = verticalOverlapAmount(draggedRect, anchorRect);

  const leftGap = anchorRect.x - (draggedRect.x + draggedRect.width);
  const rightGap = draggedRect.x - (anchorRect.x + anchorRect.width);
  const topGap = anchorRect.y - (draggedRect.y + draggedRect.height);
  const bottomGap = draggedRect.y - (anchorRect.y + anchorRect.height);
  const minGap = -24;
  const maxGap = 96;
  const verticalLimit = Math.max(58, Math.min(draggedRect.height, anchorRect.height) * 0.74);
  const horizontalLimit = Math.max(78, Math.min(draggedRect.width, anchorRect.width) * 0.74);
  const candidates: { side: CapsuleDockSide; gap: number; cross: number }[] = [];
  if (overlapX <= 12 && verticalDelta <= verticalLimit && leftGap >= minGap && leftGap <= maxGap) {
    candidates.push({ side: 'left', gap: leftGap, cross: verticalDelta });
  }
  if (overlapX <= 12 && verticalDelta <= verticalLimit && rightGap >= minGap && rightGap <= maxGap) {
    candidates.push({ side: 'right', gap: rightGap, cross: verticalDelta });
  }
  if (overlapY <= 12 && horizontalDelta <= horizontalLimit && topGap >= minGap && topGap <= maxGap) {
    candidates.push({ side: 'top', gap: topGap, cross: horizontalDelta });
  }
  if (overlapY <= 12 && horizontalDelta <= horizontalLimit && bottomGap >= minGap && bottomGap <= maxGap) {
    candidates.push({ side: 'bottom', gap: bottomGap, cross: horizontalDelta });
  }
  const best = candidates
    .sort((left, right) => (Math.abs(left.gap) + left.cross / 10) - (Math.abs(right.gap) + right.cross / 10))[0];
  if (!best) return null;
  return {
    node: anchor,
    side: best.side,
    distance: Math.abs(best.gap) + best.cross / 10,
    connections,
  };
}

function findCapsuleDockCandidate(
  dragged: CanvasNode,
  position: GraphPosition,
  canvasNodes: CanvasNode[],
  nodeModes?: Record<string, NodeMode>,
  visualSizes?: NodeVisualSizeMap,
): CapsuleDockCandidate | null {
  const draggedRect = nodeRect(dragged, position, nodeModes, visualSizes);
  const overlapsCapsuleNode = canvasNodes.some(node => (
    node.id !== dragged.id
      && capsuleRoleForNode(node)
      && rectsMateriallyOverlap(draggedRect, nodeRect(node, undefined, nodeModes, visualSizes))
  ));
  if (overlapsCapsuleNode) return null;
  return canvasNodes
    .filter(node => node.id !== dragged.id && capsuleRoleForNode(node))
    .map(node => capsuleDockCandidateFor(dragged, node, position, nodeModes, visualSizes))
    .filter((candidate): candidate is CapsuleDockCandidate => Boolean(candidate))
    .sort((left, right) => left.distance - right.distance)[0] || null;
}

function snapCapsulePosition(
  dragged: CanvasNode,
  anchor: CanvasNode,
  position: GraphPosition,
  side: CapsuleDockSide,
  nodeModes?: Record<string, NodeMode>,
  visualSizes?: NodeVisualSizeMap,
) {
  const draggedRect = nodeRect(dragged, position, nodeModes, visualSizes);
  const anchorRect = nodeRect(anchor, undefined, nodeModes, visualSizes);
  const gap = CAPSULE_DOCK_GAP;
  if (side === 'top' || side === 'bottom') {
    return {
      x: Math.round((anchorRect.x + (anchorRect.width - draggedRect.width) / 2) * 100) / 100,
      y: Math.round((side === 'top' ? anchorRect.y - draggedRect.height - gap : anchorRect.y + anchorRect.height + gap) * 100) / 100,
    };
  }
  return {
    x: Math.round((side === 'left' ? anchorRect.x - draggedRect.width - gap : anchorRect.x + anchorRect.width + gap) * 100) / 100,
    y: Math.round((anchorRect.y + (anchorRect.height - draggedRect.height) / 2) * 100) / 100,
  };
}

function defaultObservableInputs(type: WorkflowComponentType) {
  if (type === 'markdown') return ['markdown'];
  if (type === 'file') return ['file'];
  return ['scene'];
}

function defaultObservableOutputs(type: WorkflowComponentType) {
  if (type === 'markdown') return ['markdown', 'plainText'];
  if (type === 'file') return ['file', 'path'];
  return ['scene', 'image'];
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
    observableInputs: defaultObservableInputs(type),
    observableOutputs: defaultObservableOutputs(type),
    statePath: `Harness/a2a/component-nodes/${nodeId}/state.json`,
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

function defaultEventState(type: WorkflowEventNodeType, nodeId: string, title: string): WorkflowEventNodeState {
  return {
    nodeId,
    type,
    title,
    revision: 1,
    enabled: false,
    schedule: { mode: 'manual', intervalSeconds: 60, cron: '', cadence: { kind: 'fixed', sequenceSeconds: [] } },
    heartbeat: {
      base: { enabled: false, intervalSeconds: 60, lastAt: '', nextDueAt: '', count: 0 },
      watchdog: { enabled: false, intervalSeconds: 600, timeoutSeconds: 1800, lastPingAt: '', lastAckAt: '', state: 'disabled', missedCount: 0 },
    },
    controlPolicy: {
      agentCanDisable: false,
      agentCanSetInterval: false,
      agentCanSetMode: true,
      agentCanAckWatchdog: true,
      minIntervalSeconds: 5,
      maxIntervalSeconds: 86400,
    },
    payloadTemplate: {},
    eventCount: 0,
    lastFiredAt: '',
    lastEvent: null,
    statePath: `Harness/a2a/event-nodes/${nodeId}/state.json`,
  };
}

function collectEventStates(workflow: WorkflowSnapshot | null) {
  const states = new Map<string, WorkflowEventNodeState>();
  for (const [nodeId, state] of Object.entries(workflow?.eventNodes || {})) {
    const type = isWorkflowEventType(state.type) ? state.type : 'timer';
    states.set(nodeId, {
      ...defaultEventState(type, state.nodeId || nodeId, state.title || nodeId),
      ...state,
      nodeId: state.nodeId || nodeId,
      type,
    });
  }
  return states;
}

function defaultGoalState(nodeId: string, title: string): WorkflowGoalNodeState {
  const taskId = nodeId.startsWith('goal-') ? nodeId.slice('goal-'.length) : nodeId;
  return {
    nodeId,
    type: 'goal',
    title,
    taskId,
    status: 'active',
    phase: null,
    gate: null,
    revision: 0,
    acceptance: [],
    progress: { verified: 0, total: 0 },
    confirmation: null,
    wdt: { enabled: false, state: 'unbound', timerNodeId: '', lastAckAt: '' },
    statePath: `Harness/a2a/goal-nodes/${nodeId}/state.json`,
  };
}

function collectGoalStates(workflow: WorkflowSnapshot | null) {
  const states = new Map<string, WorkflowGoalNodeState>();
  for (const [nodeId, state] of Object.entries(workflow?.goalNodes || {})) {
    states.set(nodeId, {
      ...defaultGoalState(state.nodeId || nodeId, state.title || nodeId),
      ...state,
      nodeId: state.nodeId || nodeId,
      type: 'goal',
    });
  }
  return states;
}

function defaultCapabilityState(type: WorkflowCapabilityNodeType, nodeId: string, title: string): WorkflowCapabilityNodeState {
  const isMcp = type === 'mcp-connector';
  return {
    nodeId,
    type,
    title: title || (isMcp ? 'MCP Connector' : 'Skill Group'),
    revision: 1,
    description: '',
    sourceGroup: null,
    skills: [],
    skillNames: [],
    skillCount: 0,
    servers: [],
    serverNames: [],
    serverCount: 0,
    transports: [],
    envKeyNames: [],
    envKeyCount: 0,
    redactedFieldCount: 0,
    nodeSemantics: {
      role: isMcp ? 'agent-attached-mcp-provider' : 'agent-attached-capability-provider',
      defaultConnection: 'bidirectional capability port to Agent nodes',
      executor: 'agent',
      ...(isMcp ? { safety: 'metadata-only-no-spawn-no-secret' } : {}),
    },
    statePath: `Harness/a2a/capability-nodes/${nodeId}/state.json`,
  };
}

function collectCapabilityStates(workflow: WorkflowSnapshot | null) {
  const states = new Map<string, WorkflowCapabilityNodeState>();
  for (const [nodeId, state] of Object.entries(workflow?.capabilityNodes || {})) {
    const type = isWorkflowCapabilityType(state.type) ? state.type : 'skill-group';
    states.set(nodeId, {
      ...defaultCapabilityState(type, state.nodeId || nodeId, state.title || nodeId),
      ...state,
      nodeId: state.nodeId || nodeId,
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

function eventStateForNode(
  node: WorkflowNode,
  states: Map<string, WorkflowEventNodeState>,
) {
  const type = eventTypeFromNode(node) || 'timer';
  return states.get(node.id) || states.get(node.graphNodeId || '') || defaultEventState(type, node.id, node.label || node.id);
}

function capabilityStateForNode(
  node: WorkflowNode,
  states: Map<string, WorkflowCapabilityNodeState>,
) {
  const type = capabilityTypeFromNode(node) || 'skill-group';
  return states.get(node.id) || states.get(node.graphNodeId || '') || defaultCapabilityState(type, node.id, node.label || node.id);
}

function goalStateForNode(
  node: WorkflowNode,
  states: Map<string, WorkflowGoalNodeState>,
) {
  return states.get(node.id) || states.get(node.graphNodeId || '') || defaultGoalState(node.id, node.label || node.id);
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

function runtimeHandleIds(
  runtimeNode: WorkflowRuntimeNode | null | undefined,
  role: 'input' | 'output',
  fallback: string[],
) {
  const handles = runtimeNode?.graph?.handles;
  const rawIds = Array.isArray(handles)
    ? handles.filter(handle => handle.role === role).map(handle => handle.id)
    : handles?.[role === 'input' ? 'inputs' : 'outputs'] || [];
  const ids = rawIds.map(id => String(id || '').trim()).filter(Boolean);
  return ids.length > 0 ? ids : fallback;
}

function componentStateFromRuntime(
  type: WorkflowComponentType,
  runtimeNode: WorkflowRuntimeNode,
  statePayload: Record<string, unknown> | null | undefined,
  fallbackTitle: string,
  previous?: WorkflowComponentNodeState,
): WorkflowComponentNodeState {
  const nodeId = runtimeNode.nodeId;
  const raw = statePayload && typeof statePayload === 'object' ? statePayload as Record<string, any> : {};
  const defaultState = defaultComponentState(type, nodeId, fallbackTitle);
  const title = String(
    raw.title
      || runtimeNode.ui?.labels?.title
      || previous?.title
      || fallbackTitle
      || nodeId,
  );
  const revision = Number(raw.revision || runtimeNode.stateRef?.revision || runtimeNode.version || previous?.revision || defaultState.revision);
  return {
    ...defaultState,
    ...(previous || {}),
    ...raw,
    nodeId,
    type,
    title,
    revision,
    statePath: String(runtimeNode.stateRef?.path || raw.statePath || previous?.statePath || defaultState.statePath),
    markdown: raw.markdown !== undefined ? String(raw.markdown) : previous?.markdown ?? defaultState.markdown,
    scene: raw.scene !== undefined ? raw.scene : previous?.scene ?? defaultState.scene,
    file: raw.file !== undefined ? raw.file : previous?.file ?? defaultState.file,
    observableInputs: Array.isArray(raw.observableInputs)
      ? raw.observableInputs
      : Array.isArray(raw.inputs)
        ? raw.inputs.map((item: any) => String(item?.id || '')).filter(Boolean)
        : runtimeHandleIds(runtimeNode, 'input', previous?.observableInputs || defaultState.observableInputs || []),
    observableOutputs: Array.isArray(raw.observableOutputs)
      ? raw.observableOutputs
      : Array.isArray(raw.outputs)
        ? raw.outputs.map((item: any) => String(item?.id || '')).filter(Boolean)
        : runtimeHandleIds(runtimeNode, 'output', previous?.observableOutputs || defaultState.observableOutputs || []),
  };
}

function componentWorkflowNodeFromRuntime(runtimeNode: WorkflowRuntimeNode, state: WorkflowComponentNodeState): WorkflowNode {
  return {
    ...componentNodeFromState(state),
    id: runtimeNode.nodeId,
    label: state.title || runtimeNode.ui?.labels?.title || runtimeNode.nodeId,
    level: 0,
    status: runtimeNode.status?.state || 'ready',
    lifecycle: runtimeNode.lifecycle,
    runtimeState: runtimeNode.status?.state || runtimeNode.lifecycle,
    managedByCurrentServer: true,
    control: {
      canReadGraph: true,
      canModifyGraph: true,
      canDelete: true,
      canCreateComponentNode: true,
    },
    revision: state.revision,
    statePath: state.statePath,
    observableInputs: state.observableInputs,
    observableOutputs: state.observableOutputs,
  };
}

function runtimeNodeFromCanvasNode(node: CanvasNode, state?: WorkflowComponentNodeState): WorkflowRuntimeNode | null {
  const type = componentTypeFromNode(node);
  const nodeState = state || node.componentState;
  if (!type || !nodeState) return null;
  return {
    nodeId: node.graphNodeId || node.id,
    kind: type,
    version: Number(nodeState.revision || node.revision || 1),
    lifecycle: node.lifecycle || 'ready',
    status: { state: node.status || node.runtimeState || 'ready', updatedAt: new Date().toISOString() },
    graph: {
      position: { x: node.x, y: node.y },
      handles: [
        ...(nodeState.observableInputs || []).map(id => ({ id, role: 'input' as const, type: id, label: id })),
        ...(nodeState.observableOutputs || []).map(id => ({ id, role: 'output' as const, type: id, label: id })),
      ],
      connections: [],
    },
    stateRef: { path: nodeState.statePath || `Harness/a2a/component-nodes/${nodeState.nodeId}/state.json`, revision: Number(nodeState.revision || 1) },
    settings: { schemaId: `${type}-settings`, values: {}, revision: 0 },
    capabilities: [],
    ui: {
      previewKind: type,
      settingsPanel: `${type}-settings`,
      testId: `workflow-${type}-node`,
      labels: { title: nodeState.title || node.label || type },
    },
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
  const eventStates = collectEventStates(workflow);
  const capabilityStates = collectCapabilityStates(workflow);
  const goalStates = collectGoalStates(workflow);
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
  const eventNodeById = new Map<string, WorkflowNode & { eventState?: WorkflowEventNodeState }>();
  for (const node of base.filter(isEventNode)) {
    const state = eventStateForNode(node, eventStates);
    eventNodeById.set(node.id, {
      ...node,
      label: state.title || node.label || node.id,
      kind: 'event-node',
      type: eventTypeFromNode(node) || state.type || 'timer',
      graphNodeId: node.graphNodeId || node.id,
      revision: node.revision ?? state.revision,
      statePath: node.statePath || state.statePath,
      eventState: state,
    });
  }
  for (const [nodeId, state] of eventStates) {
    if (eventNodeById.has(nodeId)) continue;
    eventNodeById.set(nodeId, {
      id: nodeId,
      label: state.title || nodeId,
      kind: 'event-node',
      type: state.type || 'timer',
      level: 0,
      status: 'ready',
      lifecycle: 'event-source',
      runtimeState: 'ready',
      managedByCurrentServer: true,
      revision: state.revision,
      statePath: state.statePath,
      graphNodeId: nodeId,
      eventState: state,
    });
  }
  const eventNodes = [...eventNodeById.values()].sort((a, b) => {
    const left = graphOrder.get(a.graphNodeId || a.id) ?? Number.MAX_SAFE_INTEGER;
    const right = graphOrder.get(b.graphNodeId || b.id) ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return String(a.label).localeCompare(String(b.label));
  });
  const capabilityNodeById = new Map<string, WorkflowNode & { capabilityState?: WorkflowCapabilityNodeState }>();
  for (const node of base.filter(isCapabilityNode)) {
    const state = capabilityStateForNode(node, capabilityStates);
    capabilityNodeById.set(node.id, {
      ...node,
      label: node.label || state.title || node.id,
      kind: 'capability-node',
      type: capabilityTypeFromNode(node) || state.type || 'skill-group',
      graphNodeId: node.graphNodeId || node.id,
      revision: node.revision ?? state.revision,
      statePath: node.statePath || state.statePath,
      capabilityState: state,
    });
  }
  for (const [nodeId, state] of capabilityStates) {
    if (capabilityNodeById.has(nodeId)) continue;
    capabilityNodeById.set(nodeId, {
      id: nodeId,
      label: state.title || nodeId,
      kind: 'capability-node',
      type: state.type || 'skill-group',
      level: 0,
      status: 'ready',
      lifecycle: 'capability-provider',
      runtimeState: 'ready',
      managedByCurrentServer: true,
      revision: state.revision,
      statePath: state.statePath,
      graphNodeId: nodeId,
      capabilityState: state,
    });
  }
  const capabilityNodes = [...capabilityNodeById.values()].sort((a, b) => {
    const left = graphOrder.get(a.graphNodeId || a.id) ?? Number.MAX_SAFE_INTEGER;
    const right = graphOrder.get(b.graphNodeId || b.id) ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return String(a.label).localeCompare(String(b.label));
  });
  const goalNodeById = new Map<string, WorkflowNode & { goalState?: WorkflowGoalNodeState }>();
  for (const node of base.filter(isGoalNode)) {
    const state = goalStateForNode(node, goalStates);
    goalNodeById.set(node.id, {
      ...node,
      label: state.title || node.label || node.id,
      kind: 'goal-node',
      type: 'goal',
      graphNodeId: node.graphNodeId || node.id,
      revision: node.revision ?? state.revision,
      statePath: node.statePath || state.statePath,
      goalState: state,
    });
  }
  for (const [nodeId, state] of goalStates) {
    if (goalNodeById.has(nodeId)) continue;
    goalNodeById.set(nodeId, {
      id: nodeId,
      label: state.title || nodeId,
      kind: 'goal-node',
      type: 'goal',
      level: 1,
      status: state.status || 'active',
      lifecycle: 'goal-anchor',
      runtimeState: state.status || 'active',
      managedByCurrentServer: true,
      revision: state.revision,
      statePath: state.statePath,
      taskId: state.taskId,
      graphNodeId: nodeId,
      goalState: state,
    });
  }
  const goalNodes = [...goalNodeById.values()].sort((a, b) => {
    const left = graphOrder.get(a.graphNodeId || a.id) ?? Number.MAX_SAFE_INTEGER;
    const right = graphOrder.get(b.graphNodeId || b.id) ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return String(a.label).localeCompare(String(b.label));
  });
  return [
    ...layoutRow(mainNodes, 170, CARD_NODE_W, CARD_NODE_H),
    ...layoutRow(goalNodes, mainNodes.length > 0 ? 320 : 220, GOAL_NODE_W, GOAL_NODE_H, 360),
    ...layoutRow(subagentNodes, mainNodes.length > 0 ? 390 : 240, CARD_NODE_W, CARD_NODE_H),
    ...layoutRow(componentNodes, mainNodes.length > 0 ? 430 : 300, COMPONENT_NODE_W, COMPONENT_NODE_H, 398),
    ...layoutRow(capabilityNodes, mainNodes.length > 0 ? 610 : 420, CAPABILITY_NODE_W, CAPABILITY_NODE_H, 320),
    ...layoutRow(eventNodes, mainNodes.length > 0 ? 790 : 580, EVENT_NODE_W, EVENT_NODE_H, 320),
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

function isDisplayBridgeLabel(value: string) {
  return /(?:<->|->)/.test(value);
}

function semanticBridgeRelation(
  sourceHandle?: string | null,
  targetHandle?: string | null,
  fallback?: string | null,
) {
  const relation = String(fallback || '').trim();
  if (relation && relation !== 'wf-bridge' && relation !== 'can-communicate' && !isDisplayBridgeLabel(relation)) {
    return relation;
  }
  const source = String(sourceHandle || '').trim();
  const target = String(targetHandle || '').trim();
  const channel = target || source;
  return channel ? `wf-bridge/${channel}` : 'wf-bridge';
}

function bridgeDisplayLabel(
  relation: string | undefined,
  sourceHandle?: string | null,
  targetHandle?: string | null,
  translate?: (key: string) => string,
  direction: WorkflowEdgeDirection = 'bidirectional',
) {
  const value = String(relation || '').trim();
  const legacyHandleLabel = value.match(/^(.+?)\s*(?:<->|->)\s*(.+)$/);
  const arrow = bridgeArrowForDirection(direction);
  if (legacyHandleLabel) return `${legacyHandleLabel[1].trim() || 'source'} ${arrow} ${legacyHandleLabel[2].trim() || 'target'}`;
  const source = String(sourceHandle || '').trim();
  const target = String(targetHandle || '').trim();
  if (source || target) return `${source || 'source'} ${arrow} ${target || 'target'}`;
  return bridgeRelationLabel(value, translate || ((key: string) => key));
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

function edgeHandlePosition(value: unknown, fallback: Position) {
  const handle = String(value || '').toLowerCase();
  if (handle.endsWith(':left') || handle === 'left') return Position.Left;
  if (handle.endsWith(':right') || handle === 'right') return Position.Right;
  if (handle.endsWith(':top') || handle === 'top') return Position.Top;
  if (handle.endsWith(':bottom') || handle === 'bottom') return Position.Bottom;
  return fallback;
}

function edgeHandlePoint(node: CanvasNode | undefined, handle: unknown, endpoint: 'source' | 'target') {
  if (!node) return null;
  const position = edgeHandlePosition(handle, endpoint === 'source' ? Position.Right : Position.Left);
  const width = Number(node.width) || CARD_NODE_W;
  const height = Number(node.height) || CARD_NODE_H;
  if (position === Position.Left) return { x: node.x, y: node.y + height / 2, position };
  if (position === Position.Top) return { x: node.x + width / 2, y: node.y, position };
  if (position === Position.Bottom) return { x: node.x + width / 2, y: node.y + height, position };
  return { x: node.x + width, y: node.y + height / 2, position };
}

type EdgeLabelPreview = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function edgeLabelPreview(
  edge: FlowEdge,
  siblings: FlowEdge[],
  canvasNodeById: Map<string, CanvasNode>,
  viewportZoom: number,
): EdgeLabelPreview | null {
  const sourceNode = canvasNodeById.get(edge.source);
  const targetNode = edge.target ? canvasNodeById.get(edge.target) : undefined;
  const sourceHandle = edge.sourceHandle || edge.data?.sourceHandle;
  const targetHandle = edge.targetHandle || edge.data?.targetHandle;
  const sourcePoint = edgeHandlePoint(sourceNode, sourceHandle, 'source');
  const targetPoint = edgeHandlePoint(targetNode, targetHandle, 'target');
  if (!sourcePoint || !targetPoint) return null;
  const [, x, y] = bridgeStepPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    sourcePosition: sourcePoint.position,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    targetPosition: targetPoint.position,
    offset: defaultEdgeOffset(edge, siblings),
  });
  return edgeLabelBoxAt(x, y, viewportZoom);
}

function edgeLabelBoxesOverlap(left: EdgeLabelPreview, right: EdgeLabelPreview, gap: number) {
  return Math.abs(left.x - right.x) * 2 <= left.width + right.width + gap * 2
    && Math.abs(left.y - right.y) * 2 <= left.height + right.height + gap * 2;
}

function edgeLabelIntersectsNode(
  preview: EdgeLabelPreview,
  node: CanvasNode,
  viewportZoom: number,
) {
  const width = Number(node.width) || CARD_NODE_W;
  const height = Number(node.height) || CARD_NODE_H;
  const padding = 8 / Math.max(0.05, viewportZoom);
  return edgeLabelBoxesOverlap(preview, {
    x: node.x + width / 2,
    y: node.y + height / 2,
    width: width + padding * 2,
    height: height + padding * 2,
  }, 0);
}

function edgeHasActiveAgentFlow(edge: FlowEdge, agentControl: AgentControlRenderState | null) {
  const runtimeEdgeId = typeof edge.data?.runtimeEdgeId === 'string' ? edge.data.runtimeEdgeId : '';
  return Boolean(agentControl?.active && (
    agentControl.edgeIds.has(edge.id)
    || (runtimeEdgeId && agentControl.edgeIds.has(runtimeEdgeId))
  ));
}

function compactBridgeLabels(
  edges: FlowEdge[],
  selectedEdgeIds: Set<string>,
  canvasNodeById: Map<string, CanvasNode>,
  viewportZoom: number,
  agentControl: AgentControlRenderState | null,
) {
  const compactById = new Map<string, boolean>();
  const candidates = edges.map(edge => ({
    edge,
    preview: edgeLabelPreview(edge, edges, canvasNodeById, viewportZoom),
    selected: selectedEdgeIds.has(edge.id),
    agentFlow: edgeHasActiveAgentFlow(edge, agentControl),
  })).filter(candidate => candidate.preview !== null) as Array<{
    edge: FlowEdge;
    preview: EdgeLabelPreview;
    selected: boolean;
    agentFlow: boolean;
  }>;
  const gap = 6 / Math.max(0.05, viewportZoom);
  const hasPeerCollision = (candidate: typeof candidates[number]) => candidates.some(other => (
    other.edge.id !== candidate.edge.id
    && edgeLabelBoxesOverlap(candidate.preview, other.preview, gap)
  ));

  candidates.sort((left, right) => {
    const leftPriority = left.selected ? 3 : left.agentFlow ? 2 : 1;
    const rightPriority = right.selected ? 3 : right.agentFlow ? 2 : 1;
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;
    if (left.preview.width !== right.preview.width) return left.preview.width - right.preview.width;
    return left.edge.id.localeCompare(right.edge.id);
  });

  const occupied: EdgeLabelPreview[] = [];
  for (const candidate of candidates) {
    const blockedByNode = [...canvasNodeById.values()].some(node => (
      edgeLabelIntersectsNode(candidate.preview, node, viewportZoom)
    ));
    const blockedByLabel = occupied.some(box => edgeLabelBoxesOverlap(candidate.preview, box, gap));
    const preserveText = candidate.selected || candidate.agentFlow;
    const crowded = hasPeerCollision(candidate);
    const compact = !preserveText && ((blockedByNode && !crowded) || blockedByLabel);
    compactById.set(candidate.edge.id, compact);
    occupied.push(compact
      ? { ...candidate.preview, width: 26 / Math.max(0.05, viewportZoom), height: 24 / Math.max(0.05, viewportZoom) }
      : candidate.preview);
  }

  return compactById;
}

function sameStringSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function uniqueStringList(values: unknown[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function skillsForNode(node: WorkflowNode | null | undefined) {
  const configSkills = Array.isArray(node?.config?.skills) ? node?.config?.skills : [];
  const nodeSkills = Array.isArray(node?.skills) ? node?.skills : [];
  return uniqueStringList([...(configSkills || []), ...(nodeSkills || [])]);
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
    if ((a.relation || '') !== (b.relation || '')) return false;
    if ((a.sourceHandle || '') !== (b.sourceHandle || '')) return false;
    if ((a.targetHandle || '') !== (b.targetHandle || '')) return false;
    if ((a.protocolSourceHandle || '') !== (b.protocolSourceHandle || '')) return false;
    if ((a.protocolTargetHandle || '') !== (b.protocolTargetHandle || '')) return false;
    if ((a.uiSourceHandle || '') !== (b.uiSourceHandle || '')) return false;
    if ((a.uiTargetHandle || '') !== (b.uiTargetHandle || '')) return false;
    if (numericEdgeOffset(a.offset) !== numericEdgeOffset(b.offset)) return false;
  }
  return true;
}

function sameCapsuleDockLinks(left: CapsuleDockLink[], right: CapsuleDockLink[]) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.id !== b.id) return false;
    if (a.anchorId !== b.anchorId || a.draggedId !== b.draggedId || a.side !== b.side) return false;
    if (a.nodeIds.join('|') !== b.nodeIds.join('|')) return false;
    if (a.edges.length !== b.edges.length) return false;
    for (let edgeIndex = 0; edgeIndex < a.edges.length; edgeIndex += 1) {
      if (a.edges[edgeIndex].edgeId !== b.edges[edgeIndex].edgeId) return false;
      if (a.edges[edgeIndex].retention !== b.edges[edgeIndex].retention) return false;
    }
    if (a.connections.length !== b.connections.length) return false;
    for (let connectionIndex = 0; connectionIndex < a.connections.length; connectionIndex += 1) {
      const leftConnection = a.connections[connectionIndex];
      const rightConnection = b.connections[connectionIndex];
      if (leftConnection.id !== rightConnection.id) return false;
      if (leftConnection.source !== rightConnection.source || leftConnection.target !== rightConnection.target) return false;
      if (leftConnection.relation !== rightConnection.relation) return false;
      if (leftConnection.direction !== rightConnection.direction) return false;
      if ((leftConnection.sourceHandle || '') !== (rightConnection.sourceHandle || '')) return false;
      if ((leftConnection.targetHandle || '') !== (rightConnection.targetHandle || '')) return false;
    }
  }
  return true;
}

function graphCommitSignature(state: WorkflowGraphState) {
  return JSON.stringify({
    version: state.version,
    positions: state.positions,
    edges: state.edges,
    capsuleDockLinks: state.capsuleDockLinks,
    undoStackLength: state.undoStack.length,
    redoStackLength: state.redoStack.length,
  });
}

function safeFlowEdgeId(value: unknown, fallback: string) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const safe = raw.replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || fallback;
}

function waitForUiFrames(frameCount = 2) {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      resolve();
      return;
    }
    let remaining = Math.max(1, Math.floor(frameCount));
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  });
}

function operationTime(value: unknown) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

function createLocalOperation(kind: string, patch: Partial<WorkflowOperation> = {}): WorkflowOperation {
  const now = Date.now();
  return {
    id: `op-ui-${now.toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
    kind,
    actor: { type: 'browser' },
    targetNodeIds: [],
    edgeIds: [],
    status: 'completed',
    startedAt: new Date(now).toISOString(),
    completedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 4200).toISOString(),
    ...patch,
  };
}

function isWorkflowOperation(value: unknown): value is WorkflowOperation {
  return Boolean(value && typeof value === 'object' && typeof (value as WorkflowOperation).id === 'string' && typeof (value as WorkflowOperation).kind === 'string');
}

function operationFromRuntimeResponse(response: unknown, fallbackKind: string, fallback: Partial<WorkflowOperation> = {}) {
  const source = response && typeof response === 'object' ? response as { operation?: unknown; result?: unknown } : {};
  if (isWorkflowOperation(source.operation)) return source.operation;
  const result = source.result && typeof source.result === 'object' ? source.result as { operation?: unknown } : {};
  if (isWorkflowOperation(result.operation)) return result.operation;
  return createLocalOperation(fallbackKind, fallback);
}

function mergeOperationRecords(...groups: Array<WorkflowOperation[] | undefined>) {
  const byId = new Map<string, WorkflowOperation>();
  for (const group of groups) {
    for (const record of group || []) {
      if (isWorkflowOperation(record)) byId.set(record.id, record);
    }
  }
  return [...byId.values()].slice(-20);
}

function isAgentControlOperation(operation: WorkflowOperation) {
  const actorType = String(operation.actor?.type || operation.actor?.kind || '').toLowerCase();
  const agentKind = String(operation.actor?.agentKind || '').toLowerCase();
  return actorType === 'agent' || Boolean(agentKind) || operation.kind.startsWith('agent.');
}

function canvasIdForOperationNode(canvasNodes: CanvasNode[], nodeId: unknown) {
  const id = String(nodeId || '').trim();
  if (!id) return '';
  const direct = canvasNodes.find(node => node.id === id);
  if (direct) return direct.id;
  const mapped = canvasNodes.find(node => node.graphNodeId === id || node.sessionId === id);
  return mapped?.id || id;
}

function buildAgentControlRenderState(
  operations: WorkflowOperation[],
  now: number,
  canvasNodes: CanvasNode[],
): AgentControlRenderState | null {
  let latest: WorkflowOperation | null = null;
  let latestExpiresAt = 0;
  const targetNodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const operation of operations) {
    if (!isAgentControlOperation(operation)) continue;
    const expiresAt = operationTime(operation.expiresAt);
    if (!expiresAt || expiresAt <= now) continue;
    if (expiresAt >= latestExpiresAt) {
      latest = operation;
      latestExpiresAt = expiresAt;
    }
    for (const nodeId of operation.targetNodeIds || []) {
      const canvasId = canvasIdForOperationNode(canvasNodes, nodeId);
      if (canvasId) targetNodeIds.add(canvasId);
    }
    for (const edgeId of operation.edgeIds || []) {
      const text = String(edgeId || '').trim();
      if (text) edgeIds.add(text);
    }
  }

  if (!latest) return null;
  return {
    active: true,
    operationId: latest.id,
    actorNodeId: canvasIdForOperationNode(canvasNodes, latest.actor?.nodeId || latest.actor?.sessionId || ''),
    targetNodeIds,
    edgeIds,
    color: '#22c55e',
  };
}

function agentControlForNode(nodeId: string, state: AgentControlRenderState | null): WorkflowAgentControl | undefined {
  if (!state?.active || !state.targetNodeIds.has(nodeId)) return undefined;
  return {
    active: true,
    operationId: state.operationId,
    actorNodeId: state.actorNodeId,
    color: state.color,
  };
}

function storedEdgesToFlowEdges(
  edges: WorkflowGraphEdge[],
  translate: (key: string) => string,
  nodeByCanvasId: Map<string, WorkflowNode> = new Map(),
): FlowEdge[] {
  return edges.map((edge, index) => {
    const sourceNode = nodeByCanvasId.get(edge.source);
    const targetNode = edge.target ? nodeByCanvasId.get(edge.target) : undefined;
    const protocolSourceHandle = normalizeWorkflowEdgeHandle(sourceNode, 'source', edge.protocolSourceHandle ?? edge.sourceHandle);
    const protocolTargetHandle = normalizeWorkflowEdgeHandle(targetNode, 'target', edge.protocolTargetHandle ?? edge.targetHandle);
    const sourceHandle = workflowEdgeRenderHandle(sourceNode, 'source', protocolSourceHandle, edge.uiSourceHandle ?? edge.sourceHandle);
    const targetHandle = workflowEdgeRenderHandle(targetNode, 'target', protocolTargetHandle, edge.uiTargetHandle ?? edge.targetHandle);
    const displaySourceHandle = semanticHandleForDisplay(sourceNode, 'source', protocolSourceHandle);
    const displayTargetHandle = semanticHandleForDisplay(targetNode, 'target', protocolTargetHandle);
    const relation = semanticBridgeRelation(displaySourceHandle, displayTargetHandle, edge.relation);
    const direction = normalizeWorkflowEdgeDirection(edge.direction);
    return {
      id: safeFlowEdgeId(edge.id, `edge-${edge.source}-${edge.target}-${index}`),
      source: edge.source,
      target: edge.target,
      sourceHandle,
      targetHandle,
      type: 'wfBridge',
      label: bridgeDisplayLabel(edge.label || relation, displaySourceHandle, displayTargetHandle, translate, direction),
      data: {
        runtimeEdgeId: edge.id,
        relation,
        direction,
        sourceHandle: sourceHandle || undefined,
        targetHandle: targetHandle || undefined,
        protocolSourceHandle: protocolSourceHandle || undefined,
        protocolTargetHandle: protocolTargetHandle || undefined,
        displaySourceHandle,
        displayTargetHandle,
        offset: numericEdgeOffset(edge.offset),
      },
    };
  });
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

function orthogonalPathMidpoint(points: Array<{ x: number; y: number }>) {
  const segments = points.slice(1).map((point, index) => {
    const previous = points[index];
    return {
      from: previous,
      to: point,
      length: Math.hypot(point.x - previous.x, point.y - previous.y),
    };
  });
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total <= 0) return points[0] || { x: 0, y: 0 };
  const halfway = total / 2;
  let walked = 0;
  for (const segment of segments) {
    if (walked + segment.length >= halfway) {
      const progress = segment.length <= 0 ? 0 : (halfway - walked) / segment.length;
      return {
        x: segment.from.x + (segment.to.x - segment.from.x) * progress,
        y: segment.from.y + (segment.to.y - segment.from.y) * progress,
      };
    }
    walked += segment.length;
  }
  return points[points.length - 1] || { x: 0, y: 0 };
}

// ── Channel-aware trunk routing (edge-layout upgrade B) ─────────────────────
// Candidate trunk coordinates are the free gutters BETWEEN node rect bands:
// a trunk routed through a channel never has to cross a node card. Both axes
// are covered — horizontal channels (Y values) come from vertical gaps between
// adjacent rect bands, vertical channels (X) mirror that. Each candidate is
// verified against every rect (with a margin), so a channel coordinate is
// clean by construction; the two extremes beyond all rects cover same-side
// loop routing. When even the channeled 3-segment path is blocked by a THIRD
// node (e.g. source and target stacked in one column behind a card), the edge
// takes a 5-segment dogleg through a clear swing column/row: depart the port
// outward, swing around the obstacle, approach the target port from its own
// side. Source/target rects never count as blockers (ports sit on them).
type EdgeRoutingRect = { id: string; x: number; y: number; w: number; h: number };
type EdgeRoutingInfo = { channels: { horizontalYs: number[]; verticalXs: number[] }; rects: EdgeRoutingRect[] };

function edgeRoutingFromNodes(
  canvasNodeById: Map<string, CanvasNode>,
  nodeModes: Record<string, NodeMode> | undefined,
  visualSizes: NodeVisualSizeMap | null | undefined,
): EdgeRoutingInfo {
  const GUTTER_MIN = 24; // a trunk needs a real gap, not a 2px seam
  const MARGIN = 8; // keep the trunk clear of rect borders
  const rects: EdgeRoutingRect[] = [];
  for (const node of canvasNodeById.values()) {
    const rect = nodeRect(node, undefined, nodeModes, visualSizes ?? undefined);
    rects.push({ id: node.id, x: rect.x, y: rect.y, w: rect.width, h: rect.height });
  }
  const axisChannels = (ranges: Array<[number, number]>) => {
    const boundaries = [...new Set(ranges.flat())].sort((a, b) => a - b);
    const candidates: number[] = [];
    for (let i = 0; i < boundaries.length - 1; i += 1) {
      if (boundaries[i + 1] - boundaries[i] >= GUTTER_MIN) {
        candidates.push((boundaries[i] + boundaries[i + 1]) / 2);
      }
    }
    if (boundaries.length > 0) {
      candidates.push(boundaries[0] - GUTTER_MIN);
      candidates.push(boundaries[boundaries.length - 1] + GUTTER_MIN);
    }
    return candidates.filter((coord) => (
      ranges.every(([start, end]) => coord <= start - MARGIN || coord >= end + MARGIN)
    ));
  };
  return {
    channels: {
      horizontalYs: axisChannels(rects.map((rect) => [rect.y, rect.y + rect.h])),
      verticalXs: axisChannels(rects.map((rect) => [rect.x, rect.x + rect.w])),
    },
    rects,
  };
}

// Closest channel coordinate to `naive` that satisfies `inRange`; falls back
// to `naive` when no channel qualifies (e.g., a node spans the whole band
// between the ports — obstacle-avoiding routing is out of scope for B).
function pickTrunkChannel(naive: number, channels: number[], inRange: (coord: number) => boolean): number {
  const sorted = [...channels].sort((a, b) => Math.abs(a - naive) - Math.abs(b - naive));
  return sorted.find(inRange) ?? naive;
}

// Closest channel to `ref` restricted to one side (dir -1 = at/below ref,
// +1 = at/above ref); null when no channel exists on that side.
function nearestChannelOnSide(channels: number[], ref: number, dir: -1 | 1): number | null {
  const side = channels.filter((coord) => (dir < 0 ? coord <= ref : coord >= ref));
  if (!side.length) return null;
  return side.reduce((best, coord) => (Math.abs(coord - ref) < Math.abs(best - ref) ? coord : best));
}

const EDGE_BLOCK_MARGIN = 4;

// Axis-aligned segment vs rect overlap (with margin). Touching the border
// does not count as blocked.
function segmentHitsRect(a: { x: number; y: number }, b: { x: number; y: number }, rect: EdgeRoutingRect): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return (
    maxX > rect.x - EDGE_BLOCK_MARGIN && minX < rect.x + rect.w + EDGE_BLOCK_MARGIN
    && maxY > rect.y - EDGE_BLOCK_MARGIN && minY < rect.y + rect.h + EDGE_BLOCK_MARGIN
  );
}

function polylineBlocked(
  points: Array<{ x: number; y: number }>,
  rects: EdgeRoutingRect[],
  skipIds: Array<string | undefined>,
): boolean {
  const skip = new Set(skipIds.filter(Boolean) as string[]);
  for (let i = 0; i < points.length - 1; i += 1) {
    for (const rect of rects) {
      if (skip.has(rect.id)) continue;
      if (segmentHitsRect(points[i], points[i + 1], rect)) return true;
    }
  }
  return false;
}

// Orthogonal polyline with 8px fillets at interior corners (capped by half
// the shorter adjacent segment). Mirrors the 3-segment path style.
function filletedPolylinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return '';
  const parts = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const radius = Math.max(0, Math.min(8, inLen / 2, outLen / 2));
    const inUx = inLen > 0 ? (cur.x - prev.x) / inLen : 0;
    const inUy = inLen > 0 ? (cur.y - prev.y) / inLen : 0;
    const outUx = outLen > 0 ? (next.x - cur.x) / outLen : 0;
    const outUy = outLen > 0 ? (next.y - cur.y) / outLen : 0;
    parts.push(`L ${cur.x - inUx * radius} ${cur.y - inUy * radius}`);
    parts.push(`Q ${cur.x} ${cur.y} ${cur.x + outUx * radius} ${cur.y + outUy * radius}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${last.x} ${last.y}`);
  return parts.join(' ');
}

function bridgeStepPath({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  offset,
  routing,
  sourceId,
  targetId,
}: {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
  offset: number;
  routing?: EdgeRoutingInfo | null;
  sourceId?: string;
  targetId?: string;
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
    const naiveMidY = sameVerticalSide
      ? (sourceDir > 0 ? Math.max(sourceY, targetY) + gap : Math.min(sourceY, targetY) - gap)
      : (sourceY + targetY) / 2;
    // Channel-aware trunk: prefer a clean gutter between node bands over the
    // naive midpoint so the trunk never crosses a node card. Same-side loops
    // only use channels on their own side; opposite-side trunks stay between
    // the ports. The user's dragged offset still applies on top.
    const horizontalYs = routing && routing.channels.horizontalYs.length ? routing.channels.horizontalYs : null;
    const midY = (horizontalYs
      ? (sameVerticalSide
        ? pickTrunkChannel(naiveMidY, horizontalYs, (c) => (
          sourceDir > 0 ? c >= Math.max(sourceY, targetY) + gap : c <= Math.min(sourceY, targetY) - gap
        ))
        : pickTrunkChannel(naiveMidY, horizontalYs, (c) => (
          c > Math.min(sourceY, targetY) && c < Math.max(sourceY, targetY)
        )))
      : naiveMidY) + offset;
    // Dogleg: when a THIRD node still blocks the channeled 3-segment path
    // (source and target behind one card), swing around it through a clear
    // vertical channel — depart the source port outward, approach the target
    // port from its own side.
    if (routing && routing.rects.length > 0) {
      const directPoints = [
        { x: sourceX, y: sourceY },
        { x: sourceX, y: midY },
        { x: targetX, y: midY },
        { x: targetX, y: targetY },
      ];
      if (polylineBlocked(directPoints, routing.rects, [sourceId, targetId])) {
        const swingX = routing.channels.verticalXs.length
          ? pickTrunkChannel((sourceX + targetX) / 2, routing.channels.verticalXs, () => true)
          : null;
        if (swingX !== null) {
          const departAbove = sourcePosition === Position.Top;
          const approachBelow = targetPosition === Position.Bottom;
          const y1 = nearestChannelOnSide(routing.channels.horizontalYs, sourceY, departAbove ? -1 : 1)
            ?? (departAbove ? sourceY - gap - 8 : sourceY + gap + 8);
          const y2 = nearestChannelOnSide(routing.channels.horizontalYs, targetY, approachBelow ? 1 : -1)
            ?? (approachBelow ? targetY + gap + 8 : targetY - gap - 8);
          const dogleg = [
            { x: sourceX, y: sourceY },
            { x: sourceX, y: y1 + offset },
            { x: swingX, y: y1 + offset },
            { x: swingX, y: y2 + offset },
            { x: targetX, y: y2 + offset },
            { x: targetX, y: targetY },
          ];
          const midpoint = orthogonalPathMidpoint(dogleg);
          return [filletedPolylinePath(dogleg), midpoint.x, midpoint.y];
        }
      }
    }
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
    const midpoint = orthogonalPathMidpoint([
      { x: sourceX, y: sourceY },
      { x: sourceX, y: midY },
      { x: targetX, y: midY },
      { x: targetX, y: targetY },
    ]);
    return [path, midpoint.x, midpoint.y];
  }

  const sourceDir = sourcePosition === Position.Right ? 1 : -1;
  const sameHorizontalSide = sourcePosition === targetPosition
    && (sourcePosition === Position.Left || sourcePosition === Position.Right);
  const naiveMidX = sameHorizontalSide
    ? (sourceDir > 0 ? Math.max(sourceX, targetX) + gap : Math.min(sourceX, targetX) - gap)
    : (sourceX + targetX) / 2;
  // Channel-aware trunk (mirror of the vertical case): prefer a clean gutter
  // between node columns over the naive midpoint.
  const verticalXs = routing && routing.channels.verticalXs.length ? routing.channels.verticalXs : null;
  const midX = (verticalXs
    ? (sameHorizontalSide
      ? pickTrunkChannel(naiveMidX, verticalXs, (c) => (
        sourceDir > 0 ? c >= Math.max(sourceX, targetX) + gap : c <= Math.min(sourceX, targetX) - gap
      ))
      : pickTrunkChannel(naiveMidX, verticalXs, (c) => (
        c > Math.min(sourceX, targetX) && c < Math.max(sourceX, targetX)
      )))
    : naiveMidX) + offset;
  // Dogleg (mirror of the vertical case): a THIRD node blocking the channeled
  // 3-segment path forces a swing ROW around it.
  if (routing && routing.rects.length > 0) {
    const directPoints = [
      { x: sourceX, y: sourceY },
      { x: midX, y: sourceY },
      { x: midX, y: targetY },
      { x: targetX, y: targetY },
    ];
    if (polylineBlocked(directPoints, routing.rects, [sourceId, targetId])) {
      const swingY = routing.channels.horizontalYs.length
        ? pickTrunkChannel((sourceY + targetY) / 2, routing.channels.horizontalYs, () => true)
        : null;
      if (swingY !== null) {
        const departRight = sourcePosition === Position.Right;
        const approachLeft = targetPosition === Position.Left;
        const x1 = nearestChannelOnSide(routing.channels.verticalXs, sourceX, departRight ? 1 : -1)
          ?? (departRight ? sourceX + gap + 8 : sourceX - gap - 8);
        const x2 = nearestChannelOnSide(routing.channels.verticalXs, targetX, approachLeft ? -1 : 1)
          ?? (approachLeft ? targetX - gap - 8 : targetX + gap + 8);
        const dogleg = [
          { x: sourceX, y: sourceY },
          { x: x1 + offset, y: sourceY },
          { x: x1 + offset, y: swingY },
          { x: x2 + offset, y: swingY },
          { x: x2 + offset, y: targetY },
          { x: targetX, y: targetY },
        ];
        const midpoint = orthogonalPathMidpoint(dogleg);
        return [filletedPolylinePath(dogleg), midpoint.x, midpoint.y];
      }
    }
  }
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
  const midpoint = orthogonalPathMidpoint([
    { x: sourceX, y: sourceY },
    { x: midX, y: sourceY },
    { x: midX, y: targetY },
    { x: targetX, y: targetY },
  ]);
  return [path, midpoint.x, midpoint.y];
}

function edgeLabelBoxAt(x: number, y: number, viewportZoom: number): EdgeLabelPreview {
  const scale = 1 / Math.max(0.05, viewportZoom);
  const size = BRIDGE_LABEL_ICON_SIZE * scale;
  return {
    x,
    y,
    width: size,
    height: size,
  };
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
    const relation = semanticBridgeRelation(edge.sourceHandle, edge.targetHandle, edge.relation);
    const direction = normalizeWorkflowEdgeDirection(edge.direction);
    return {
      id,
      source: edge.from,
      target: edge.to,
      type: 'wfBridge',
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
      label: bridgeDisplayLabel(edge.relation || relation, edge.sourceHandle, edge.targetHandle, t, direction),
      data: {
        fromSessionId: edge.fromSessionId,
        toSessionId: edge.toSessionId,
        relation,
        direction,
        sourceHandle: edge.sourceHandle || undefined,
        targetHandle: edge.targetHandle || undefined,
        offset: numericEdgeOffset(edge.offset),
      },
      animated: active,
      markerStart: direction === 'source-to-target' ? undefined : { type: MarkerType.ArrowClosed, color: active ? WORKFLOW_GREEN : '#9ca3af' },
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
  agentControl: AgentControlRenderState | null,
  labelCompaction: Map<string, boolean>,
  routing?: EdgeRoutingInfo | null,
): FlowEdge {
  const selected = selectedEdgeIds.has(edge.id);
  const agentFlow = edgeHasActiveAgentFlow(edge, agentControl);
  const sourceNode = canvasNodeById.get(edge.source);
  const targetNode = edge.target ? canvasNodeById.get(edge.target) : null;
  const offset = defaultEdgeOffset(edge, siblings);
  const protocolSourceHandle = normalizeWorkflowEdgeHandle(
    sourceNode,
    'source',
    edge.data?.protocolSourceHandle ?? edge.sourceHandle ?? edge.data?.sourceHandle ?? null,
  );
  const protocolTargetHandle = normalizeWorkflowEdgeHandle(
    targetNode || undefined,
    'target',
    edge.data?.protocolTargetHandle ?? edge.targetHandle ?? edge.data?.targetHandle ?? null,
  );
  const sourceHandle = workflowEdgeRenderHandle(sourceNode, 'source', protocolSourceHandle, edge.sourceHandle || edge.data?.sourceHandle || null);
  const targetHandle = workflowEdgeRenderHandle(targetNode || undefined, 'target', protocolTargetHandle, edge.targetHandle || edge.data?.targetHandle || null);
  const displaySourceHandle = semanticHandleForDisplay(sourceNode, 'source', protocolSourceHandle);
  const displayTargetHandle = semanticHandleForDisplay(targetNode || undefined, 'target', protocolTargetHandle);
  const relation = semanticBridgeRelation(displaySourceHandle, displayTargetHandle, typeof edge.data?.relation === 'string' ? edge.data.relation : undefined);
  const direction = normalizeWorkflowEdgeDirection(edge.data?.direction);
  const labelCompact = !selected && Boolean(labelCompaction.get(edge.id));
  return {
    ...edge,
    type: 'wfBridge',
    label: bridgeDisplayLabel(
      typeof edge.label === 'string' ? edge.label : edge.data?.relation,
      displaySourceHandle,
      displayTargetHandle,
      t,
      direction,
    ),
    data: {
      ...edge.data,
      sourceNodeId: edge.source,
      targetNodeId: edge.target || '',
      fromSessionId: edge.data?.fromSessionId || sourceNode?.sessionId,
      toSessionId: edge.data?.toSessionId || targetNode?.sessionId,
      relation,
      sourceHandle,
      targetHandle,
      protocolSourceHandle,
      protocolTargetHandle,
      displaySourceHandle,
      displayTargetHandle,
      direction,
      offset,
      zoom: viewportZoom,
      routing,
      selected,
      agentFlowActive: agentFlow,
      agentFlowOperationId: agentFlow ? agentControl?.operationId : undefined,
      agentFlowColor: agentFlow ? agentControl?.color : undefined,
      labelCompact,
      ...callbacks,
    },
    animated: selected || agentFlow,
    markerStart: direction === 'source-to-target' ? undefined : { type: MarkerType.ArrowClosed, color: selected || agentFlow ? WORKFLOW_GREEN : WORKFLOW_GREEN_DARK },
    markerEnd: { type: MarkerType.ArrowClosed, color: selected || agentFlow ? WORKFLOW_GREEN : WORKFLOW_GREEN_DARK },
    style: edgeStyle(selected || agentFlow, true),
    labelStyle: { fill: WORKFLOW_GREEN_DARK, fontSize: 10, fontWeight: 700 },
    labelBgStyle: { fill: 'rgba(255,255,255,0.84)' },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
  };
}

function capsuleDockClassName(
  node: CanvasNode,
  preview: CapsuleDockPreview,
  magnetDrag: CapsuleMagnetDrag,
  dockLinks: CapsuleDockLink[],
  viewportZoom: number,
) {
  const classes: string[] = [];
  const role = capsuleRoleForNode(node);
  if (magnetDrag && preview?.anchorId === node.id && viewportZoom >= CAPSULE_DOCK_MIN_ZOOM && role && role !== magnetDrag.role && magnetDrag.draggedId !== node.id) {
    classes.push('workflow-capsule-magnet-target');
  }
  for (const link of dockLinks) {
    if (!link.nodeIds.includes(node.id)) continue;
    const side = node.id === link.anchorId ? link.side : oppositeCapsuleDockSide(link.side);
    classes.push(
      'workflow-capsule-docked',
      `workflow-capsule-docked-${side}`,
      node.id === link.anchorId ? 'workflow-capsule-docked-anchor' : 'workflow-capsule-docked-peer',
    );
  }
  if (preview) {
    if (node.id === preview.draggedId) classes.push('workflow-capsule-dock-dragged', `workflow-capsule-dock-${preview.side}`);
    if (node.id === preview.anchorId) classes.push('workflow-capsule-dock-anchor', `workflow-capsule-dock-${preview.side}`);
  }
  return classes.length ? [...new Set(classes)].join(' ') : undefined;
}

/**
 * ReactFlow node component for {@link PendingNodePlaceholder} entries. Sizes
 * travel in the flow node's data so rendering does not depend on ReactFlow
 * passing width/height through props.
 */
function PendingNodeFlowComponent({ data }: NodeProps) {
  const pending = (data || {}) as PendingNodePlaceholder;
  return (
    <NodeLoadingPlaceholder
      kind={pending.kind || 'node'}
      width={Number(pending.width) || 300}
      height={Number(pending.height) || 200}
      label={pending.label}
    />
  );
}

function toFlowNodes(
  canvasNodes: CanvasNode[],
  previous: FlowNode[],
  nodeModes: Record<string, NodeMode>,
  componentFullscreenRequest: { nodeId: string; nonce: number } | null,
  pendingStarts: Set<string>,
  pendingStops: Set<string>,
  pendingDeletes: Set<string>,
  capsuleByNodeId: Map<string, WorkflowCapsuleSummary>,
  capsuleDockPreview: CapsuleDockPreview,
  capsuleMagnetDrag: CapsuleMagnetDrag,
  capsuleDockLinks: CapsuleDockLink[],
  viewportZoom: number,
  agentControl: AgentControlRenderState | null,
  fileChangedNodeIds: Set<string>,
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
        zIndex: NODE_CARD_Z,
        className: capsuleDockClassName(node, capsuleDockPreview, capsuleMagnetDrag, capsuleDockLinks, viewportZoom),
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
          agentControl: agentControlForNode(node.id, agentControl),
          fullscreenRequest: componentFullscreenRequest?.nodeId === node.id ? componentFullscreenRequest.nonce : 0,
          onSaveComponentNode: callbacks.onSaveComponentNode,
          fileChanged: fileChangedNodeIds.has(node.id),
          onFileNodeRefreshed: callbacks.onFileNodeRefreshed,
        },
        draggable: true,
      } satisfies WorkflowComponentFlowNode;
    }
    if (isEventNode(node)) {
      const width = Math.max(finiteDimension(node.width), EVENT_NODE_W);
      const height = Math.max(finiteDimension(node.height), EVENT_NODE_H);
      const capsule = capsuleByNodeId.get(node.id);
      return {
        id: node.id,
        type: 'workflowEventNode',
        position: previousNode?.position || { x: node.x, y: node.y },
        width,
        height,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        zIndex: NODE_CARD_Z,
        className: capsuleDockClassName(node, capsuleDockPreview, capsuleMagnetDrag, capsuleDockLinks, viewportZoom),
        selected: previousNode?.selected,
        data: {
          workflowNode: node,
          eventState: node.eventState,
          capsule,
          viewportZoom,
          agentControl: agentControlForNode(node.id, agentControl),
        },
        draggable: true,
      } satisfies WorkflowEventFlowNode;
    }
    if (isCapabilityNode(node)) {
      const width = Math.max(finiteDimension(node.width), CAPABILITY_NODE_W);
      const height = Math.max(finiteDimension(node.height), CAPABILITY_NODE_H);
      return {
        id: node.id,
        type: 'workflowCapabilityNode',
        position: previousNode?.position || { x: node.x, y: node.y },
        width,
        height,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        zIndex: NODE_CARD_Z,
        selected: previousNode?.selected,
        data: {
          workflowNode: node,
          capabilityState: node.capabilityState,
          viewportZoom,
          agentControl: agentControlForNode(node.id, agentControl),
        },
        draggable: true,
      } satisfies WorkflowCapabilityFlowNode;
    }
    if (isGoalNode(node)) {
      const width = Math.max(finiteDimension(node.width), GOAL_NODE_W);
      const height = Math.max(finiteDimension(node.height), GOAL_NODE_H);
      const capsule = capsuleByNodeId.get(node.id);
      return {
        id: node.id,
        type: 'workflowGoalNode',
        position: previousNode?.position || { x: node.x, y: node.y },
        width,
        height,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        zIndex: NODE_CARD_Z,
        className: capsuleDockClassName(node, capsuleDockPreview, capsuleMagnetDrag, capsuleDockLinks, viewportZoom),
        selected: previousNode?.selected,
        data: {
          workflowNode: node,
          goalState: node.goalState,
          capsule,
          viewportZoom,
          agentControl: agentControlForNode(node.id, agentControl),
        },
        draggable: true,
      } satisfies WorkflowGoalFlowNode;
    }
    const mode: NodeMode = node.sessionId && nodeModes[node.id] === 'terminal' ? 'terminal' : 'card';
    const width = mode === 'terminal' ? TERMINAL_NODE_W : node.width;
    const height = mode === 'terminal' ? TERMINAL_NODE_H : node.height;
    const capsule = capsuleByNodeId.get(node.id);
    return {
      id: node.id,
      type: 'wfNode',
      position: previousNode?.position || { x: node.x, y: node.y },
      width,
      height,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      zIndex: NODE_CARD_Z,
      className: capsuleDockClassName(node, capsuleDockPreview, capsuleMagnetDrag, capsuleDockLinks, viewportZoom),
      selected: previousNode?.selected,
      data: {
        workflowNode: node,
        mode,
        starting: pendingStarts.has(node.id),
        stopping: pendingStops.has(node.id),
        deleting: pendingDeletes.has(node.id),
        capsule,
        viewportZoom,
        agentControl: agentControlForNode(node.id, agentControl),
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
    if ((left.className || '') !== (right.className || '')) return false;
    if (left.selected !== right.selected) return false;
    if (left.width !== right.width || left.height !== right.height) return false;
    if (left.position.x !== right.position.x || left.position.y !== right.position.y) return false;
    const leftData = left.data;
    const rightData = right.data;
    const leftControl = (leftData as any).agentControl as WorkflowAgentControl | undefined;
    const rightControl = (rightData as any).agentControl as WorkflowAgentControl | undefined;
    if (Boolean(leftControl?.active) !== Boolean(rightControl?.active)) return false;
    if ((leftControl?.operationId || '') !== (rightControl?.operationId || '')) return false;
    if (!sameCapsuleSummary((leftData as any).capsule, (rightData as any).capsule)) return false;
    const leftComponent = (leftData as any).componentState as WorkflowComponentNodeState | undefined;
    const rightComponent = (rightData as any).componentState as WorkflowComponentNodeState | undefined;
    if (leftComponent || rightComponent) {
      if (!leftComponent || !rightComponent) return false;
      if ((leftData as any).fullscreenRequest !== (rightData as any).fullscreenRequest) return false;
      // AC-3/AC-9: the file.changed badge flag must reach the card renderer.
      if (Boolean((leftData as any).fileChanged) !== Boolean((rightData as any).fileChanged)) return false;
      if (leftComponent.nodeId !== rightComponent.nodeId) return false;
      if (leftComponent.type !== rightComponent.type) return false;
      if (leftComponent.revision !== rightComponent.revision) return false;
      if (leftComponent.title !== rightComponent.title) return false;
      if (leftComponent.statePath !== rightComponent.statePath) return false;
      if ((leftComponent.file?.path || '') !== (rightComponent.file?.path || '')) return false;
      if ((leftComponent.file?.mime || '') !== (rightComponent.file?.mime || '')) return false;
      continue;
    }
    const leftEvent = (leftData as any).eventState as WorkflowEventNodeState | undefined;
    const rightEvent = (rightData as any).eventState as WorkflowEventNodeState | undefined;
    if (leftEvent || rightEvent) {
      if (!leftEvent || !rightEvent) return false;
      if (leftEvent.nodeId !== rightEvent.nodeId) return false;
      if (leftEvent.revision !== rightEvent.revision) return false;
      if (leftEvent.eventCount !== rightEvent.eventCount) return false;
      if (leftEvent.enabled !== rightEvent.enabled) return false;
      if ((leftEvent.heartbeat?.watchdog?.state || '') !== (rightEvent.heartbeat?.watchdog?.state || '')) return false;
      continue;
    }
    const leftGoal = (leftData as any).goalState as WorkflowGoalNodeState | undefined;
    const rightGoal = (rightData as any).goalState as WorkflowGoalNodeState | undefined;
    if (leftGoal || rightGoal) {
      if (!leftGoal || !rightGoal) return false;
      if (leftGoal.nodeId !== rightGoal.nodeId) return false;
      if (leftGoal.revision !== rightGoal.revision) return false;
      if (leftGoal.status !== rightGoal.status) return false;
      if ((leftGoal.progress?.verified || 0) !== (rightGoal.progress?.verified || 0)) return false;
      if ((leftGoal.progress?.total || 0) !== (rightGoal.progress?.total || 0)) return false;
      continue;
    }
    if (leftData.mode !== rightData.mode) return false;
    if (leftData.starting !== rightData.starting) return false;
    if (leftData.stopping !== rightData.stopping) return false;
    if (leftData.deleting !== rightData.deleting) return false;
    if (leftData.viewportZoom !== rightData.viewportZoom) return false;
    const leftNode = leftData.workflowNode;
    const rightNode = rightData.workflowNode;
    // Client-only loading placeholders carry no workflowNode. Their flow-node
    // objects are rebuilt on every merge-effect run, so compare the rendered
    // fields (position and size are already checked above) instead of treating
    // them as always changed: an always-different placeholder made the merge
    // effect call setNodes on every render, which looped through ReactFlow's
    // node adoption until React unmounted the canvas (error #185).
    if (!leftNode || !rightNode) {
      if (leftNode || rightNode) return false;
      return leftData.kind === rightData.kind
        && (leftData.label ?? '') === (rightData.label ?? '')
        && leftData.width === rightData.width
        && leftData.height === rightData.height;
    }
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
  const fingerprintRef = useRef<string>('');

  const load = async (refresh = false) => {
    try {
      if (refresh) {
        invalidateApiCache('/api/a2a/snapshot');
        invalidateApiCache('/api/runtimes');
        invalidateApiCache('/api/tasks');
        fingerprintRef.current = '';
      }
      // Incremental polling (P1a): send the last fingerprint; an unchanged
      // graph+session state returns { unchanged: true } and skips the full
      // snapshot build, setWorkflow, and canvas re-render.
      const snapshotUrl = fingerprintRef.current
        ? `/api/a2a/snapshot?since=${encodeURIComponent(fingerprintRef.current)}`
        : '/api/a2a/snapshot';
      const [snapshot, runtimeRows, taskRows, project] = await Promise.all([
        apiJsonCached<WorkflowSnapshot>(snapshotUrl, { ttlMs: refresh ? 0 : 1200, refresh }).catch(() => null),
        apiJsonCached<RuntimeInfo[]>(refresh ? '/api/runtimes?refresh=1' : '/api/runtimes', { ttlMs: 12000, refresh }).catch(() => null),
        apiJsonCached<TaskOption[]>('/api/tasks', { ttlMs: 8000, refresh }).catch(() => []),
        apiJsonCached<{ root: string }>('/api/project', { ttlMs: 8000, refresh }).catch(() => ({ root: '' })),
      ]);
      if (!snapshot) {
        setLoading(false);
        return;
      }
      const incremental = snapshot as WorkflowSnapshot & { unchanged?: boolean; fingerprint?: string };
      if (incremental.unchanged === true) {
        setError(null);
        return;
      }
      fingerprintRef.current = incremental.fingerprint || '';
      setWorkflow(snapshot);
      if (runtimeRows !== null) setRuntimes(runtimeRows ?? []);
      setTasks(taskRows ?? []);
      // Metadata is auxiliary to the graph. A transient empty response during
      // push-refresh must not turn into a canvas error after a drag commit.
      setProjectRoot(typeof project?.root === 'string' ? project.root : '');
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
    // Push reload (P1b): the backend broadcasts graph changes (dock/undock,
    // node create/delete, edge edits) as harness:graph-changed; trailing-
    // debounce bursts, keep the 5s interval as the fallback.
    let graphChangedTimer: number | null = null;
    const onGraphChanged = () => {
      if (graphChangedTimer !== null) window.clearTimeout(graphChangedTimer);
      graphChangedTimer = window.setTimeout(() => load(false), 250);
    };
    window.addEventListener('harness:graph-changed', onGraphChanged);
    return () => {
      clearInterval(interval);
      window.removeEventListener('harness:sessions-changed', onSessionsChanged);
      window.removeEventListener('harness:graph-changed', onGraphChanged);
      if (graphChangedTimer !== null) window.clearTimeout(graphChangedTimer);
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
  // Role identity (agent-team-cooperation-spec §3.2/3.3, AC-003 create path):
  // main → ceo, subagent → implementer defaults match the backend defaults.
  const [agentDisplayName, setAgentDisplayName] = useState('');
  const [agentRoleTitle, setAgentRoleTitle] = useState('');
  const [agentRoleCustom, setAgentRoleCustom] = useState(false);
  const [agentResponsibility, setAgentResponsibility] = useState('');
  const [agentCapabilities, setAgentCapabilities] = useState('');
  const defaultRoleTitle = agentKind === 'main' ? 'ceo' : 'implementer';
  const effectiveRoleTitle = agentRoleTitle || defaultRoleTitle;
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [launchingAgent, setLaunchingAgent] = useState(false);
  const [tidyLayoutBusy, setTidyLayoutBusy] = useState(false);
  const [pendingStarts, setPendingStarts] = useState<Set<string>>(() => new Set());
  const [pendingStops, setPendingStops] = useState<Set<string>>(() => new Set());
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(() => new Set());
  const [optimisticHiddenNodeIds, setOptimisticHiddenNodeIds] = useState<Set<string>>(() => new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>(null);
  const [showConfig, setShowConfig] = useState(false);
  // Node communications panel (user D-H): mailbox flow for the selected node,
  // sourced from agent.readMessages per peer. Same panel layer as the settings
  // panel (--wf-z-panel) — a user-opened modal, allowed above the nodes layer.
  const [commPanelNodeId, setCommPanelNodeId] = useState<string | null>(null);
  const [commPanelLoading, setCommPanelLoading] = useState(false);
  const [commPanelError, setCommPanelError] = useState('');
  const [commEntries, setCommEntries] = useState<CommMessageEntry[]>([]);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [contextMenu, setContextMenu] = useState<CanvasMenu | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeMenu | null>(null);
  const [nodeClipboard, setNodeClipboard] = useState<{ items: NodeClipboardItem[] } | null>(null);
  const [createPanel, setCreatePanel] = useState<CreatePanelState>(null);
  const [capabilityHub, setCapabilityHub] = useState<CapabilityHubState>(null);
  const [skillsHubTab, setSkillsHubTab] = useState<SkillsHubTab>('installed');
  const [expandedRuntimeNode, setExpandedRuntimeNode] = useState<ExpandedRuntimeNodeState>(null);
  const [createNodeSearch, setCreateNodeSearch] = useState('');
  const [capabilityHubSearch, setCapabilityHubSearch] = useState('');
  const [skillsHub, setSkillsHub] = useState<WorkflowSkillsHubResponse | null>(null);
  const [skillsHubLoading, setSkillsHubLoading] = useState(false);
  const [skillsHubError, setSkillsHubError] = useState('');
  const [skillsMarket, setSkillsMarket] = useState<WorkflowSkillsMarketResponse | null>(null);
  const [skillsMarketLoading, setSkillsMarketLoading] = useState(false);
  const [skillsMarketError, setSkillsMarketError] = useState('');
  const [skillsMarketInstallTarget, setSkillsMarketInstallTarget] = useState('project-agents');
  const [skillsMarketBusyPackId, setSkillsMarketBusyPackId] = useState('');
  const [mcpHub, setMcpHub] = useState<WorkflowMcpHubResponse | null>(null);
  const [mcpHubLoading, setMcpHubLoading] = useState(false);
  const [mcpHubError, setMcpHubError] = useState('');
  const [capabilityHubBusySkillId, setCapabilityHubBusySkillId] = useState('');
  const [capabilityHubBusyGroupId, setCapabilityHubBusyGroupId] = useState('');
  const [capabilityHubBusyMcpServerId, setCapabilityHubBusyMcpServerId] = useState('');
  const [fileNodePath, setFileNodePath] = useState('');
  const [uploadingFileNode, setUploadingFileNode] = useState(false);
  const [bridgePanel, setBridgePanel] = useState<BridgePanelState>(null);
  const [bridgeMessages, setBridgeMessages] = useState<BridgeMessage[]>([]);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [statusToast, setStatusToast] = useState<WorkflowToastState | null>(null);
  const [localWorkflowOperations, setLocalWorkflowOperations] = useState<WorkflowOperation[]>([]);
  const [suppressedAgentOperationIds, setSuppressedAgentOperationIds] = useState<Set<string>>(() => new Set());
  const [operationNow, setOperationNow] = useState(() => Date.now());
  const [nodeModes, setNodeModes] = useState<Record<string, NodeMode>>({});
  const [componentFullscreenRequest, setComponentFullscreenRequest] = useState<{ nodeId: string; nonce: number } | null>(null);
  const [fileBigViewNodeId, setFileBigViewNodeId] = useState<string | null>(null);
  // AC-3/AC-9: nodeIds whose bound workspace file changed on disk (WS
  // file.changed events). File cards show a badge until the user refreshes.
  const [fileChangedNodeIds, setFileChangedNodeIds] = useState<Set<string>>(() => new Set());
  const [displayViewRequest, setDisplayViewRequest] = useState<{ nodeId: string; title: string } | null>(null);
  const [skillsOverlay, setSkillsOverlay] = useState<{ open: boolean; mode: 'hub' | 'group'; groupNodeId?: string }>({ open: false, mode: 'hub' });
  // Set while a composed skill-set drag is in flight so a cancelled drag can
  // restore the hub overlay instead of leaving the user without a surface.
  const skillsDraftDragActiveRef = useRef(false);
  // While true the skills overlay stays mounted but visually hidden, so a
  // composition drag can land on the canvas without discarding its draft.
  const [skillsDragHideActive, setSkillsDragHideActive] = useState(false);
  // Client-only loading placeholders for nodes currently being created on the
  // backend. Rendered via the ReactFlow nodes state; never written to graph
  // state, so they cannot become server artifacts.
  const [pendingNodes, setPendingNodes] = useState<Record<string, PendingNodePlaceholder>>({});
  const pendingNodeCounterRef = useRef(0);
  // Per-entry expiry timers so a create request that never settles cannot leave
  // a permanent loading placeholder on the canvas.
  const pendingNodeTimersRef = useRef<Record<string, number>>({});
  const removePendingNode = useCallback((pendingId: string) => {
    const timer = pendingNodeTimersRef.current[pendingId];
    if (timer !== undefined) {
      clearTimeout(timer);
      delete pendingNodeTimersRef.current[pendingId];
    }
    setPendingNodes(current => {
      if (!(pendingId in current)) return current;
      const next = { ...current };
      delete next[pendingId];
      return next;
    });
  }, []);
  const addPendingPlaceholder = useCallback((
    position: GraphPosition,
    kind: string,
    nodeLike: Partial<CanvasNode> | undefined,
    label?: string,
  ): string => {
    const id = `pending-${Date.now()}-${(pendingNodeCounterRef.current += 1)}`;
    const size = fallbackNodeVisualSize({ kind, ...nodeLike } as CanvasNode);
    setPendingNodes(current => ({
      ...current,
      [id]: { x: position.x, y: position.y, kind, label, width: size.width, height: size.height },
    }));
    // Safety net: if the create request never settles, expire the placeholder
    // after a minute instead of leaving a permanent loading node. Resolve and
    // catch paths remove the entry through removePendingNode, which clears this
    // timer.
    pendingNodeTimersRef.current[id] = window.setTimeout(() => removePendingNode(id), 60000);
    return id;
  }, [removePendingNode]);
  // Local mirror of per-skill enabled flags returned by skill-group.setSkillEnabled
  // actions so the overlay reflects toggles before the next snapshot poll.
  const [skillsOverlaySkillEnabledOverride, setSkillsOverlaySkillEnabledOverride] = useState<Record<string, boolean>>({});
  const [graphState, setGraphState] = useState<WorkflowGraphState>(() => emptyGraphState());
  const [graphLoaded, setGraphLoaded] = useState(false);
  const [manualEdges, setManualEdges] = useState<FlowEdge[]>([]);
  const [capsuleDockPreview, setCapsuleDockPreview] = useState<CapsuleDockPreview>(null);
  const [capsuleMagnetDrag, setCapsuleMagnetDrag] = useState<CapsuleMagnetDrag>(null);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(() => new Set());
  const [viewportZoom, setViewportZoom] = useState(1);
  const [terminalInputOwner, setTerminalInputOwner] = useState<TerminalInputOwnerState>(null);
  const [nodeConfigOverrides, setNodeConfigOverrides] = useState<Record<string, NodeConfigOverride>>({});
  const [componentNodeOverrides, setComponentNodeOverrides] = useState<Record<string, ComponentNodeOverride>>({});
  const [selectedRuntimeNode, setSelectedRuntimeNode] = useState<WorkflowRuntimeNode | null>(null);
  const [selectedRuntimeLoading, setSelectedRuntimeLoading] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [flowReady, setFlowReady] = useState(false);
  const [flowSettled, setFlowSettled] = useState(false);
  const flowWrapperRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const flowNodeVisualSizes = useMemo(() => measuredFlowNodeSizeMap(nodes), [nodes]);
  const flowNodeVisualSizesRef = useRef<NodeVisualSizeMap>(flowNodeVisualSizes);
  flowNodeVisualSizesRef.current = flowNodeVisualSizes;
  useEffect(() => {
    // Visual sizes are mode-dependent (terminal vs card). A mode switch changes
    // the node's rendered size; the max-merge cache must not keep the previous
    // mode's dimensions, or capsule-dock geometry breaks after returning to
    // card mode. The cache self-heals from the next DOM measurement.
    flowNodeVisualSizesRef.current = new Map();
  }, [nodeModes]);
  const fittedOnce = useRef(false);
  const canvasControlGestureActiveRef = useRef(false);
  // Mirrors `viewportZoom` so the per-frame onMove handler can skip its
  // setState when the zoom bucket hasn't changed (pure-pan frames).
  const viewportZoomRef = useRef(1);
  const canvasControlGestureViewportRef = useRef<Viewport | null>(null);
  const canvasControlGestureReleaseTimerRef = useRef<number | null>(null);
  const canvasControlGestureGuardUntilRef = useRef(0);
  const graphConnectionGestureActiveRef = useRef(false);
  const graphConnectionStartRef = useRef<GraphConnectionStart | null>(null);
  const graphConnectionStartClearTimerRef = useRef<number | null>(null);
  const graphConnectionFallbackTimerRef = useRef<number | null>(null);
  const graphConnectionCompletedAtRef = useRef(0);
  const manualConnectionInFlightRef = useRef<Set<string>>(new Set());
  const pendingDeletePromisesRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const connectWorkflowEndpointsRef = useRef<((connection: Connection) => Promise<void>) | null>(null);
  const settleCapsuleDockAfterDragRef = useRef<((nodeId: string, position: GraphPosition) => void) | null>(null);
  const capsuleDragStopHandledRef = useRef<Map<string, { position: GraphPosition; at: number }>>(new Map());
  const capsuleDockSettleSeqRef = useRef(0);
  const capsuleSnapFramesRef = useRef<Map<string, number>>(new Map());
  const autoStartedMainNodes = useRef<Set<string>>(new Set());
  const graphCommitPendingRef = useRef(false);
  const graphCommitEdgesRef = useRef<WorkflowGraphEdge[] | null>(null);
  const graphLocalOnlyEdgeSignatureRef = useRef<string | null>(null);
  const edgeDeleteTombstonesRef = useRef<Set<string>>(new Set());
  const capsuleDockTombstonesRef = useRef<Set<string>>(new Set());
  const toastTimerRef = useRef<number | null>(null);
  const toastNonceRef = useRef(0);
  const lastGraphPersistenceSignatureRef = useRef('');
  const lastGraphPutSignatureRef = useRef('');
  const graphPutDebounceRef = useRef<number | null>(null);
  const graphPutFlushRef = useRef<(() => void) | null>(null);
  const graphWorkflowIdRef = useRef('');
  const graphStateRef = useRef<WorkflowGraphState>(graphState);
  const manualEdgesRef = useRef<FlowEdge[]>(manualEdges);
  const graphBaseVersionRef = useRef<number | null>(null);
  const translateRef = useRef(t);
  const reloadRef = useRef(reload);
  const middleCanvasPanRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startViewport: Viewport;
  } | null>(null);
  translateRef.current = t;
  reloadRef.current = reload;

  const currentNodeVisualSizes = useCallback(() => {
    const zoom = flowRef.current?.getZoom?.() || viewportZoom || 1;
    const sizes = mergeVisualSizeMaps(
      flowNodeVisualSizesRef.current,
      measuredDomNodeSizeMap(flowWrapperRef.current, zoom),
    );
    flowNodeVisualSizesRef.current = sizes;
    return sizes;
  }, [viewportZoom]);

  const alertToast = useCallback((input: WorkflowToastInput) => {
    const message = String(input?.message || '').trim();
    const dedupeKey = String(input?.dedupeKey || '').trim();
    const rawDuration = Number(input?.durationMs);
    const durationMs = Number.isFinite(rawDuration) ? Math.max(250, Math.min(60000, Math.floor(rawDuration))) : 0;
    if (!message || !dedupeKey || durationMs <= 0) {
      console.warn('alert_toast requires message, durationMs, and dedupeKey', input);
      return () => {};
    }
    const kind: WorkflowToastKind = input.kind || 'status';
    const id = `${dedupeKey}:${Date.now()}:${++toastNonceRef.current}`;
    const nextToast: WorkflowToastState = {
      id,
      message,
      kind,
      durationMs,
      dedupeKey,
      createdAt: Date.now(),
    };
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setStatusToast(current => (
      current?.dedupeKey === dedupeKey
        ? { ...current, ...nextToast }
        : nextToast
    ));
    toastTimerRef.current = window.setTimeout(() => {
      setStatusToast(current => current?.id === id ? null : current);
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    }, durationMs);
    return () => {
      setStatusToast(current => current?.id === id ? null : current);
    };
  }, []);

  const componentStateById = useMemo(() => collectComponentStates(workflow, componentNodeOverrides), [componentNodeOverrides, workflow]);
  const eventStateById = useMemo(() => collectEventStates(workflow), [workflow]);
  const goalStateById = useMemo(() => collectGoalStates(workflow), [workflow]);
  const canvasNodesBase = useMemo(() => layoutNodes(workflow, graphState.positions, componentNodeOverrides), [componentNodeOverrides, graphState.positions, workflow]);
  const canvasNodes = useMemo(() => canvasNodesBase.map(node => {
    const override = nodeConfigOverrides[node.id] || (node.graphNodeId ? nodeConfigOverrides[node.graphNodeId] : undefined);
    return mergeNodeConfig(node, override);
  }), [canvasNodesBase, nodeConfigOverrides]);
  const visibleCanvasNodes = useMemo(() => canvasNodes.filter(node => (
    !optimisticHiddenNodeIds.has(node.id)
      && !optimisticHiddenNodeIds.has(node.graphNodeId || '')
  )), [canvasNodes, optimisticHiddenNodeIds]);
  const mergedWorkflowOperationRecords = useMemo(
    () => mergeOperationRecords(workflow?.workflow?.operations?.recent, localWorkflowOperations),
    [localWorkflowOperations, workflow?.workflow?.operations?.recent],
  );
  const workflowOperationRecords = useMemo(
    () => mergedWorkflowOperationRecords.filter(record => !suppressedAgentOperationIds.has(record.id)),
    [mergedWorkflowOperationRecords, suppressedAgentOperationIds],
  );
  const activeAgentControl = useMemo(
    () => buildAgentControlRenderState(workflowOperationRecords, operationNow, canvasNodes),
    [canvasNodes, operationNow, workflowOperationRecords],
  );
  const capsuleByNodeId = useMemo(
    () => buildWorkflowCapsuleSummaries(canvasNodes, graphState.edges, graphState.capsuleDockLinks),
    [canvasNodes, graphState.capsuleDockLinks, graphState.edges],
  );

  useEffect(() => {
    if (viewportZoom >= CAPSULE_DOCK_MIN_ZOOM) return;
    setCapsuleDockPreview(null);
    setCapsuleMagnetDrag(null);
  }, [viewportZoom]);

  const noteWorkflowOperation = useCallback((operation: unknown, fallbackKind = 'graph.operation', fallback: Partial<WorkflowOperation> = {}) => {
    const record = isWorkflowOperation(operation) ? operation : createLocalOperation(fallbackKind, fallback);
    setLocalWorkflowOperations(current => mergeOperationRecords(current, [record]));
    setOperationNow(Date.now());
    return record;
  }, []);

  const suppressVisibleAgentControlOperations = useCallback(() => {
    const now = Date.now();
    setLocalWorkflowOperations(current => current.filter(record => !isAgentControlOperation(record)));
    setSuppressedAgentOperationIds(current => {
      const next = new Set(current);
      for (const record of mergedWorkflowOperationRecords) {
        if (!isAgentControlOperation(record)) continue;
        const expiresAt = operationTime(record.expiresAt);
        if (!expiresAt || expiresAt <= now) continue;
        next.add(record.id);
      }
      return sameStringSet(current, next) ? current : next;
    });
    setOperationNow(now);
  }, [mergedWorkflowOperationRecords]);

  const cancelCapsuleSnapAnimation = useCallback((nodeId?: string) => {
    const frames = capsuleSnapFramesRef.current;
    if (nodeId) {
      const frame = frames.get(nodeId);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frames.delete(nodeId);
      return;
    }
    for (const frame of frames.values()) window.cancelAnimationFrame(frame);
    frames.clear();
  }, []);

  const animateCapsuleNodePosition = useCallback((nodeId: string, from: GraphPosition, to: GraphPosition) => {
    cancelCapsuleSnapAnimation(nodeId);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (reduceMotion || distance < 1) {
      setNodes(current => current.map(flowNode => (
        flowNode.id === nodeId ? { ...flowNode, position: to } : flowNode
      )));
      return;
    }
    const startedAt = window.performance.now();
    const durationMs = 190;
    const damp = 1 - Math.exp(-7);
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
      const eased = (1 - Math.exp(-7 * progress)) / damp;
      const nextPosition = {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
      };
      setNodes(current => current.map(flowNode => (
        flowNode.id === nodeId ? { ...flowNode, position: nextPosition } : flowNode
      )));
      if (progress < 1) {
        capsuleSnapFramesRef.current.set(nodeId, window.requestAnimationFrame(step));
        return;
      }
      capsuleSnapFramesRef.current.delete(nodeId);
      setNodes(current => current.map(flowNode => (
        flowNode.id === nodeId ? { ...flowNode, position: to } : flowNode
      )));
    };
    capsuleSnapFramesRef.current.set(nodeId, window.requestAnimationFrame(step));
  }, [cancelCapsuleSnapAnimation, setNodes]);

  useEffect(() => () => cancelCapsuleSnapAnimation(), [cancelCapsuleSnapAnimation]);
  const nodeIds = useMemo(() => new Set(canvasNodes.map(node => node.id)), [canvasNodes]);
  const canvasNodeById = useMemo(() => new Map(canvasNodes.map(node => [node.id, node])), [canvasNodes]);
  const resolveCanvasNode = useCallback((nodeId: string | null | undefined) => {
    const value = String(nodeId || '').trim();
    if (!value) return null;
    return canvasNodeById.get(value)
      || canvasNodes.find(node => node.graphNodeId === value || node.sessionId === value)
      || null;
  }, [canvasNodeById, canvasNodes]);
  const terminalModeKey = useMemo(() => canvasNodes
    .filter(node => node.sessionId && nodeModes[node.id] === 'terminal')
    .map(node => node.id)
    .join('|'), [canvasNodes, nodeModes]);

  useEffect(() => {
    const initialNow = Date.now();
    setOperationNow(initialNow);
    const hasActiveOrPending = workflowOperationRecords.some(record => {
      const expiresAt = operationTime(record.expiresAt);
      return expiresAt > initialNow;
    });
    if (!hasActiveOrPending) return undefined;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setOperationNow(now);
      setLocalWorkflowOperations(current => current.filter(record => {
        const expiresAt = operationTime(record.expiresAt);
        return !expiresAt || expiresAt > now - 1000;
      }));
    }, 200);
    return () => window.clearInterval(interval);
  }, [workflowOperationRecords]);

  const currentRuntime = runtimes.find(runtime => runtime.id === runtimeId) || null;
  const createNodeCatalog = useMemo(() => getCreateNodeCatalog(), []);
  const createNodeGroups = useMemo(() => {
    const query = createNodeSearch.trim().toLowerCase();
    const matches = createNodeCatalog.filter(item => {
      if (!query) return true;
      return `${item.kind} ${item.label} ${item.description} ${item.agentSemantics} ${item.searchText}`
        .toLowerCase()
        .includes(query);
    });
    const groups = new Map<string, typeof createNodeCatalog>();
    for (const item of matches) {
      const group = groups.get(item.category) || [];
      group.push(item);
      groups.set(item.category, group);
    }
    return groups;
  }, [createNodeCatalog, createNodeSearch]);
  const skillsById = useMemo(() => new Map((skillsHub?.skills || []).map(skill => [skill.id, skill])), [skillsHub]);
  const capabilityHubTargetAgent = useMemo(() => {
    const target = capabilityHub?.targetAgentId || '';
    if (!target) return null;
    return resolveCanvasNode(target);
  }, [capabilityHub?.targetAgentId, resolveCanvasNode]);
  const capabilityHubTargetCapability = useMemo(() => {
    const target = capabilityHub?.targetCapabilityId || '';
    if (!target) return null;
    return resolveCanvasNode(target);
  }, [capabilityHub?.targetCapabilityId, resolveCanvasNode]);
  const selectedNode = nodes.find(node => node.id === selectedNodeId)?.data.workflowNode
    || nodes.find(node => selectedNodeIds.has(node.id))?.data.workflowNode
    || canvasNodes[0]
    || null;
  const selectedRuntimeRenderer = selectedRuntimeNode ? getNodeRenderer(selectedRuntimeNode.kind) : undefined;
  const SelectedRuntimeSettings = selectedRuntimeRenderer?.SettingsComponent;
  const selectedNodeComponentState = (selectedNode as CanvasNode | null)?.componentState;
  // Preview runtime node for terminal-session agent nodes while the real
  // runtime node is still loading: lets AgentNodeSettings render its shell
  // (header + skeleton body) immediately so the panel never swaps between two
  // different settings components.
  const agentSettingsPreviewNode: WorkflowRuntimeNode | null = !selectedRuntimeNode
    && selectedNode?.kind === 'terminal-session'
    && Boolean(selectedNode.sessionId)
    ? {
      nodeId: selectedNode.graphNodeId || selectedNode.id,
      kind: 'agent',
      version: 1,
      lifecycle: 'ready',
      status: { state: selectedNode.status || 'ready', updatedAt: new Date().toISOString() },
      sessionId: selectedNode.sessionId,
      graph: { position: { x: 0, y: 0 }, handles: [], connections: [] },
      stateRef: { path: '', revision: 0 },
      settings: { schemaId: 'agent-settings', values: {}, revision: 0 },
      capabilities: [],
      ui: { previewKind: 'agent', settingsPanel: 'agent-settings', testId: 'workflow-agent-node', labels: { title: selectedNode.label || 'agent' } },
    }
    : null;
  const deletableSelectedNodeIds = useMemo(() => [...selectedNodeIds].filter(nodeId => {
    const node = canvasNodeById.get(nodeId);
    return Boolean(node && canRequestDeleteNode(node));
  }), [canvasNodeById, selectedNodeIds]);
  const selectedNodeLive = canOpenTerminal(selectedNode);
  const selectedNodeCanStart = canStartNode(selectedNode);
  const selectedNodeCanStop = canStopNode(selectedNode);
  const selectedNodeCanDelete = canRequestDeleteNode(selectedNode);
  const markdownTargets = useMemo(() => canvasNodes
    .filter(node => componentTypeFromNode(node) === 'markdown')
    .map(node => ({
      nodeId: node.graphNodeId || node.id,
      title: node.label || node.id,
    })), [canvasNodes]);
  const expandedNode = expandedRuntimeNode ? resolveCanvasNode(expandedRuntimeNode.nodeId) : null;
  const expandedTimerState = expandedNode && expandedRuntimeNode?.kind === 'timer'
    ? eventStateForNode(expandedNode, eventStateById)
    : null;
  const expandedGoalState = expandedNode && expandedRuntimeNode?.kind === 'goal'
    ? goalStateForNode(expandedNode, goalStateById)
    : null;

  const saveExpandedRuntimeNode = useCallback(async (target: CanvasNode, action: string, payload: Record<string, unknown>) => {
    const graphId = target.graphNodeId || target.id;
    const response = await executeRuntimeNodeAction(graphId, action, payload);
    if (response.node) {
      invalidateApiCache('/api/workflow/nodes');
      invalidateApiCache('/api/a2a/snapshot');
    }
    await reload(true);
  }, [reload]);

  useEffect(() => {
    if (!showConfig || !selectedNode) {
      setSelectedRuntimeNode(null);
      setSelectedRuntimeLoading(false);
      return;
    }
    const graphId = selectedNode.graphNodeId || selectedNode.id;
    const fallback = isComponentNode(selectedNode)
      ? runtimeNodeFromCanvasNode(selectedNode as CanvasNode, componentStateById.get(selectedNode.id) || selectedNodeComponentState)
      : null;
    let cancelled = false;
    setSelectedRuntimeLoading(true);
    fetchRuntimeNode(graphId)
      .then(node => {
        if (!cancelled) setSelectedRuntimeNode(node);
      })
      .catch(() => {
        if (!cancelled) setSelectedRuntimeNode(fallback);
      })
      .finally(() => {
        if (!cancelled) setSelectedRuntimeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    componentStateById,
    selectedNode?.graphNodeId,
    selectedNode?.id,
    selectedNode?.revision,
    selectedNodeComponentState?.revision,
    showConfig,
  ]);

  useEffect(() => {
    if (!capabilityHub || capabilityHub.kind !== 'skills') return;
    let cancelled = false;
    setSkillsHubLoading(true);
    setSkillsHubError('');
    fetchSkillsHub(capabilityHubSearch)
      .then(result => {
        if (!cancelled) setSkillsHub(result);
      })
      .catch((e: any) => {
        if (!cancelled) {
          setSkillsHub(null);
          setSkillsHubError(e?.message || t('Failed to load Skills Hub'));
        }
      })
      .finally(() => {
        if (!cancelled) setSkillsHubLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [capabilityHub, capabilityHubSearch, t]);

  useEffect(() => {
    if (!capabilityHub || capabilityHub.kind !== 'skills' || skillsHubTab !== 'market') return;
    let cancelled = false;
    setSkillsMarketLoading(true);
    setSkillsMarketError('');
    fetchSkillsMarket(capabilityHubSearch)
      .then(result => {
        if (!cancelled) {
          setSkillsMarket(result);
          const defaultTarget = result.installTargets.find(target => target.default)?.id || result.installTargets[0]?.id || 'project-agents';
          setSkillsMarketInstallTarget(current => result.installTargets.some(target => target.id === current) ? current : defaultTarget);
        }
      })
      .catch((e: any) => {
        if (!cancelled) {
          setSkillsMarket(null);
          setSkillsMarketError(e?.message || t('Failed to load Skills Market'));
        }
      })
      .finally(() => {
        if (!cancelled) setSkillsMarketLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [capabilityHub, capabilityHubSearch, skillsHubTab, t]);

  useEffect(() => {
    if (!capabilityHub || capabilityHub.kind !== 'mcp') return;
    let cancelled = false;
    setMcpHubLoading(true);
    setMcpHubError('');
    fetchMcpHub(capabilityHubSearch)
      .then(result => {
        if (!cancelled) setMcpHub(result);
      })
      .catch((e: any) => {
        if (!cancelled) {
          setMcpHub(null);
          setMcpHubError(e?.message || t('Failed to load MCP Hub'));
        }
      })
      .finally(() => {
        if (!cancelled) setMcpHubLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [capabilityHub, capabilityHubSearch, t]);

  const updateGraph = useCallback((
    patch: Partial<Pick<WorkflowGraphState, 'positions' | 'edges' | 'capsuleDockLinks'>>,
    options: { forceCommit?: boolean; deletedNodes?: DeletedNodeRecovery[] } = {},
  ) => {
    const current = graphStateRef.current;
    const positions = patch.positions || current.positions;
    const edges = patch.edges || current.edges;
    const capsuleDockLinks = patch.capsuleDockLinks || current.capsuleDockLinks;
    const unchanged = sameGraphPositions(current.positions, positions)
      && sameGraphEdges(current.edges, edges)
      && sameCapsuleDockLinks(current.capsuleDockLinks, capsuleDockLinks);
    if (unchanged && !options.forceCommit) return;
    const recordsHistory = !unchanged || Boolean(options.deletedNodes?.length);
    const next = normalizeGraphState({
      ...current,
      positions,
      edges,
      capsuleDockLinks,
      version: current.version + 1,
      undoStack: recordsHistory ? [...current.undoStack, {
        positions: current.positions,
        edges: current.edges,
        capsuleDockLinks: current.capsuleDockLinks,
        ...(options.deletedNodes?.length ? { deletedNodes: options.deletedNodes } : {}),
      }].slice(-40) : current.undoStack,
      redoStack: recordsHistory ? [] : current.redoStack,
    });
    graphStateRef.current = next;
    graphCommitEdgesRef.current = patch.edges ? next.edges : current.edges;
    graphCommitPendingRef.current = true;
    setGraphState(next);
    if (patch.edges || patch.capsuleDockLinks) {
      const nextManualEdges = storedEdgesToFlowEdges(next.edges, t, canvasNodeById);
      if (patch.edges) {
        manualEdgesRef.current = nextManualEdges;
        setManualEdges(nextManualEdges);
      }
      setSelectedEdgeIds(current => {
        if (current.size === 0) return current;
        const visibleEdgeIds = new Set(
          nextManualEdges
            .filter(edge => !isCapsuleDockedEdge(edge, next.capsuleDockLinks))
            .map(edge => edge.id),
        );
        const selected = new Set([...current].filter(edgeId => visibleEdgeIds.has(edgeId)));
        return selected.size === current.size ? current : selected;
      });
    }
  }, [canvasNodeById, t]);

  const applyGraphStateLocally = useCallback((next: WorkflowGraphState) => {
    const normalized = normalizeGraphState(next);
    graphStateRef.current = normalized;
    graphCommitEdgesRef.current = normalized.edges;
    graphCommitPendingRef.current = true;
    setGraphState(normalized);
    const nextManualEdges = storedEdgesToFlowEdges(normalized.edges, t, canvasNodeById);
    manualEdgesRef.current = nextManualEdges;
    setManualEdges(nextManualEdges);
  }, [canvasNodeById, t]);

  const markGraphConnectionGesture = useCallback((
    event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement> | ReactDragEvent<HTMLDivElement>,
  ) => {
    const start = graphConnectionStartFromEvent(
      event.target,
      'clientX' in event ? event.clientX : undefined,
      'clientY' in event ? event.clientY : undefined,
    );
    if (!start) return;
    graphConnectionGestureActiveRef.current = true;
    graphConnectionStartRef.current = { ...start, startedAt: Date.now() };
    if (graphConnectionStartClearTimerRef.current !== null) {
      window.clearTimeout(graphConnectionStartClearTimerRef.current);
      graphConnectionStartClearTimerRef.current = null;
    }
  }, []);

  const finishGraphConnectionGesture = useCallback((
    event?: GraphConnectionEndEvent,
    options: { allowFallback?: boolean } = {},
  ) => {
    if (!graphConnectionGestureActiveRef.current) return;
    const start = graphConnectionStartRef.current;
    graphConnectionGestureActiveRef.current = false;
    const allowFallback = options.allowFallback !== false;
    if (allowFallback && start) {
      const end = graphConnectionStartFromEvent(
        event?.target ?? null,
        event?.clientX,
        event?.clientY,
      );
      if (end && end.nodeId && end.nodeId !== start.nodeId) {
        const fallbackConnection: Connection = {
          source: start.nodeId,
          target: end.nodeId,
          sourceHandle: start.handleId,
          targetHandle: end.handleId,
        };
        if (graphConnectionFallbackTimerRef.current !== null) {
          window.clearTimeout(graphConnectionFallbackTimerRef.current);
        }
        graphConnectionFallbackTimerRef.current = window.setTimeout(() => {
          graphConnectionFallbackTimerRef.current = null;
          if (graphConnectionCompletedAtRef.current >= start.startedAt) return;
          connectWorkflowEndpointsRef.current?.(fallbackConnection);
        }, 80);
      }
    }
    if (graphConnectionStartClearTimerRef.current !== null) {
      window.clearTimeout(graphConnectionStartClearTimerRef.current);
    }
    graphConnectionStartClearTimerRef.current = window.setTimeout(() => {
      graphConnectionStartRef.current = null;
      graphConnectionStartClearTimerRef.current = null;
    }, 300);
  }, []);

  const beginMiddleCanvasPan = useCallback((event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) return false;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('[data-canvas-control="true"], input, textarea, select, .xterm')) return false;
    if (!target.closest('.wf-flow, .react-flow, .react-flow__pane, .react-flow__renderer, .react-flow__viewport, .react-flow__node')) return false;
    const viewport = flowRef.current?.getViewport();
    if (!viewport) return false;
    event.preventDefault();
    event.stopPropagation();
    middleCanvasPanRef.current = {
      pointerId: 'pointerId' in event ? event.pointerId : -1,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewport: viewport,
    };
    return true;
  }, []);

  useEffect(() => {
    const begin = (event: PointerEvent | MouseEvent) => {
      if (event.button !== 1 || middleCanvasPanRef.current) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !flowWrapperRef.current?.contains(target)) return;
      if (target.closest('[data-canvas-control="true"], input, textarea, select, .xterm')) return;
      if (!target.closest('.wf-flow, .react-flow, .react-flow__pane, .react-flow__renderer, .react-flow__viewport, .react-flow__node')) return;
      const viewport = flowRef.current?.getViewport();
      if (!viewport) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      middleCanvasPanRef.current = {
        pointerId: 'pointerId' in event ? event.pointerId : -1,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: viewport,
      };
    };
    const move = (event: PointerEvent | MouseEvent) => {
      const pan = middleCanvasPanRef.current;
      if (!pan) return;
      if ('pointerId' in event && pan.pointerId !== -1 && event.pointerId !== pan.pointerId) return;
      event.preventDefault();
      const nextViewport = {
        x: pan.startViewport.x + event.clientX - pan.startClientX,
        y: pan.startViewport.y + event.clientY - pan.startClientY,
        zoom: pan.startViewport.zoom,
      };
      void flowRef.current?.setViewport(nextViewport);
    };
    const end = (event: PointerEvent | MouseEvent) => {
      const pan = middleCanvasPanRef.current;
      if (!pan) return;
      if ('pointerId' in event && pan.pointerId !== -1 && event.pointerId !== pan.pointerId) return;
      middleCanvasPanRef.current = null;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('pointerdown', begin, { capture: true, passive: false });
    window.addEventListener('mousedown', begin, { capture: true, passive: false });
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('mousemove', move, { passive: false });
    window.addEventListener('pointerup', end, { passive: false });
    window.addEventListener('pointercancel', end, { passive: false });
    window.addEventListener('mouseup', end, { passive: false });
    return () => {
      window.removeEventListener('pointerdown', begin, { capture: true });
      window.removeEventListener('mousedown', begin, { capture: true });
      window.removeEventListener('pointermove', move);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('mouseup', end);
    };
  }, []);

  const componentHeaderDragRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    startPosition: GraphPosition | null;
    zoom: number;
  } | null>(null);

  const beginComponentHeaderDrag = useCallback((event: ComponentHeaderDragEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.workflow-component-node-header')) return;
    const nodeElement = target.closest<HTMLElement>('[data-testid="workflow-component-node"]');
    const nodeId = nodeElement?.getAttribute('data-node-id') || '';
    if (!nodeId) return;
    const position = flowRef.current?.getNode(nodeId)?.position || graphStateRef.current.positions[nodeId] || null;
    const viewport = flowRef.current?.getViewport();
    const zoom = Math.max(0.05, Number.isFinite(viewport?.zoom) ? Number(viewport?.zoom) : 1);
    componentHeaderDragRef.current = {
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: position ? { x: position.x, y: position.y } : null,
      zoom,
    };
  }, []);

  const finishComponentHeaderDragFromPoint = useCallback((clientX: number, clientY: number) => {
    const drag = componentHeaderDragRef.current;
    componentHeaderDragRef.current = null;
    if (!drag) return;
    const moved = Math.hypot(clientX - drag.startX, clientY - drag.startY);
    if (moved < BRIDGE_LABEL_DRAG_THRESHOLD) return;
    window.setTimeout(() => {
      const flowPosition = flowRef.current?.getNode(drag.nodeId)?.position || null;
      const startPosition = drag.startPosition || graphStateRef.current.positions[drag.nodeId] || flowPosition;
      if (!startPosition) return;
      const reactFlowMoved = flowPosition
        && (Math.abs(flowPosition.x - startPosition.x) > 0.1 || Math.abs(flowPosition.y - startPosition.y) > 0.1);
      const position = reactFlowMoved ? flowPosition : {
        x: Math.round((startPosition.x + ((clientX - drag.startX) / drag.zoom)) * 100) / 100,
        y: Math.round((startPosition.y + ((clientY - drag.startY) / drag.zoom)) * 100) / 100,
      };
      if (!position) return;
      setNodes(current => current.map(node => (
        node.id === drag.nodeId ? { ...node, position: { x: position.x, y: position.y } } : node
      )));
      updateGraph({
        positions: {
          ...graphStateRef.current.positions,
          [drag.nodeId]: { x: position.x, y: position.y },
        },
      }, { forceCommit: true });
    }, 0);
  }, [updateGraph]);

  const finishComponentHeaderDrag = useCallback((event: ComponentHeaderDragEvent) => {
    finishComponentHeaderDragFromPoint(event.clientX, event.clientY);
  }, [finishComponentHeaderDragFromPoint]);

  const cancelComponentHeaderDrag = useCallback(() => {
    componentHeaderDragRef.current = null;
  }, []);

  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes);
    const committedPositions: Record<string, GraphPosition> = {};
    const capsulePositions: Record<string, GraphPosition> = {};
    for (const change of changes as Array<{ id?: string; type?: string; dragging?: boolean; position?: GraphPosition }>) {
      if (change.type !== 'position' || change.dragging !== false || !change.id || !change.position) continue;
      const position = { x: change.position.x, y: change.position.y };
      const workflowNode = canvasNodeById.get(change.id);
      const role = capsuleRoleForNode(workflowNode);
      if (role) {
        capsulePositions[change.id] = position;
      } else {
        committedPositions[change.id] = position;
      }
    }
    if (Object.keys(committedPositions).length > 0) {
      updateGraph({
        positions: {
          ...graphStateRef.current.positions,
          ...committedPositions,
        },
      });
    }
    for (const [nodeId, position] of Object.entries(capsulePositions)) {
      window.setTimeout(() => {
        const handled = capsuleDragStopHandledRef.current.get(nodeId);
        const recentlyHandled = handled
          && Date.now() - handled.at < 750
          && Math.hypot(handled.position.x - position.x, handled.position.y - position.y) < 1;
        if (recentlyHandled) return;
        settleCapsuleDockAfterDragRef.current?.(nodeId, position);
      }, 0);
    }
  }, [canvasNodeById, onNodesChange, updateGraph]);

  useEffect(() => {
    const markConnectionGesture = (event: PointerEvent | MouseEvent | DragEvent) => {
      const start = graphConnectionStartFromEvent(
        event.target,
        'clientX' in event ? event.clientX : undefined,
        'clientY' in event ? event.clientY : undefined,
      );
      if (start) {
        graphConnectionGestureActiveRef.current = true;
        graphConnectionStartRef.current = { ...start, startedAt: Date.now() };
        if (graphConnectionStartClearTimerRef.current !== null) {
          window.clearTimeout(graphConnectionStartClearTimerRef.current);
          graphConnectionStartClearTimerRef.current = null;
        }
      }
    };
    const startHeaderDrag = (event: PointerEvent | MouseEvent) => {
      beginComponentHeaderDrag(event);
    };
    window.addEventListener('pointerdown', markConnectionGesture, true);
    window.addEventListener('mousedown', markConnectionGesture, true);
    window.addEventListener('dragstart', markConnectionGesture, true);
    window.addEventListener('pointerdown', startHeaderDrag, true);
    window.addEventListener('mousedown', startHeaderDrag, true);
    window.addEventListener('pointerup', finishGraphConnectionGesture, true);
    window.addEventListener('pointercancel', finishGraphConnectionGesture, true);
    window.addEventListener('mouseup', finishGraphConnectionGesture, true);
    window.addEventListener('dragend', finishGraphConnectionGesture, true);
    window.addEventListener('drop', finishGraphConnectionGesture, true);
    const finishHeaderDrag = (event: PointerEvent | MouseEvent) => {
      finishComponentHeaderDragFromPoint(event.clientX, event.clientY);
    };
    window.addEventListener('pointerup', finishHeaderDrag, true);
    window.addEventListener('mouseup', finishHeaderDrag, true);
    window.addEventListener('pointercancel', cancelComponentHeaderDrag, true);
    window.addEventListener('blur', cancelComponentHeaderDrag, true);
    return () => {
      window.removeEventListener('pointerdown', markConnectionGesture, true);
      window.removeEventListener('mousedown', markConnectionGesture, true);
      window.removeEventListener('dragstart', markConnectionGesture, true);
      window.removeEventListener('pointerdown', startHeaderDrag, true);
      window.removeEventListener('mousedown', startHeaderDrag, true);
      window.removeEventListener('pointerup', finishGraphConnectionGesture, true);
      window.removeEventListener('pointercancel', finishGraphConnectionGesture, true);
      window.removeEventListener('mouseup', finishGraphConnectionGesture, true);
      window.removeEventListener('dragend', finishGraphConnectionGesture, true);
      window.removeEventListener('drop', finishGraphConnectionGesture, true);
      window.removeEventListener('pointerup', finishHeaderDrag, true);
      window.removeEventListener('mouseup', finishHeaderDrag, true);
      window.removeEventListener('pointercancel', cancelComponentHeaderDrag, true);
      window.removeEventListener('blur', cancelComponentHeaderDrag, true);
      if (graphConnectionStartClearTimerRef.current !== null) {
        window.clearTimeout(graphConnectionStartClearTimerRef.current);
        graphConnectionStartClearTimerRef.current = null;
      }
      if (graphConnectionFallbackTimerRef.current !== null) {
        window.clearTimeout(graphConnectionFallbackTimerRef.current);
        graphConnectionFallbackTimerRef.current = null;
      }
      graphConnectionStartRef.current = null;
    };
  }, [beginComponentHeaderDrag, cancelComponentHeaderDrag, finishComponentHeaderDragFromPoint, finishGraphConnectionGesture]);

  const toggleNodeMode = useCallback((nodeId: string) => {
    const node = canvasNodeById.get(nodeId);
    if (!node?.sessionId) {
      setSelectedNodeId(nodeId);
      setExpandedRuntimeNode(null);
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

  const captureDeletedNodeRecovery = useCallback((node: CanvasNode): DeletedNodeRecovery => {
    const graphId = node.graphNodeId || node.id;
    const deletedIds = new Set([node.id, graphId]);
    return {
      nodeId: node.id,
      graphId,
      node: JSON.parse(JSON.stringify(node)) as WorkflowNode,
      edges: graphStateRef.current.edges.filter(edge => deletedIds.has(edge.source) || deletedIds.has(edge.target)),
      requiresStop: Boolean(isAgentNode(node) && node.sessionId && !canDeleteNode(node) && isLiveStatus(node.status)),
    };
  }, []);

  const removeNodeFromCanvas = useCallback((recovery: DeletedNodeRecovery, recordHistory = true) => {
    const deletedIds = new Set([recovery.nodeId, recovery.graphId]);
    setOptimisticHiddenNodeIds(current => new Set([...current, ...deletedIds]));
    setSelectedNodeIds(current => new Set([...current].filter(id => !deletedIds.has(id))));
    setSelectedNodeId(current => deletedIds.has(current) ? '' : current);
    setShowConfig(false);
    setExpandedRuntimeNode(current => current && deletedIds.has(current.nodeId) ? null : current);
    setNodeContextMenu(null);
    const nextEdges = graphStateRef.current.edges.filter(edge => !deletedIds.has(edge.source) && !deletedIds.has(edge.target));
    if (recordHistory) {
      updateGraph({ edges: nextEdges }, { forceCommit: true, deletedNodes: [recovery] });
    } else {
      applyGraphStateLocally(normalizeGraphState({
        ...graphStateRef.current,
        version: graphStateRef.current.version + 1,
        edges: nextEdges,
      }));
    }
  }, [applyGraphStateLocally, updateGraph]);

  const restoreNodeLocally = useCallback((recovery: DeletedNodeRecovery) => {
    const deletedIds = new Set([recovery.nodeId, recovery.graphId]);
    setOptimisticHiddenNodeIds(current => new Set([...current].filter(id => !deletedIds.has(id))));
    const current = graphStateRef.current;
    const edgeIds = new Set(current.edges.map(edge => edge.id));
    const edges = [...current.edges, ...recovery.edges.filter(edge => !edgeIds.has(edge.id))];
    applyGraphStateLocally(normalizeGraphState({ ...current, version: current.version + 1, edges }));
  }, [applyGraphStateLocally]);

  const deleteNode = useCallback(async (
    nodeId: string,
    options: { stopFirst?: boolean; recovery?: DeletedNodeRecovery; recordHistory?: boolean } = {},
  ): Promise<boolean> => {
    const node = canvasNodeById.get(nodeId);
    if (!node) return false;
    const recovery = options.recovery || captureDeletedNodeRecovery(node);
    const requiresStop = recovery.requiresStop;
    if (!canDeleteNode(node) && !(options.stopFirst && requiresStop)) return false;
    setPendingDeletes(current => new Set(current).add(nodeId));
    setError(null);
    alertToast({ message: t('Deleting node...'), kind: 'loading', durationMs: 6000, dedupeKey: `node-delete:${nodeId}` });
    removeNodeFromCanvas(recovery, options.recordHistory !== false);
    const operation = (async () => {
      try {
        if (options.stopFirst || requiresStop) {
          if (!node.sessionId) throw new Error(t('Running Agent has no session to stop'));
          await apiJson(`/api/sessions/${encodeURIComponent(node.sessionId)}/stop`, { method: 'POST' });
          invalidateApiCache('/api/sessions');
        }
        await executeRuntimeNodeAction(recovery.graphId, 'node.delete');
        if (isComponentNode(node)) {
          setComponentNodeOverrides(current => {
            const next = { ...current };
            delete next[nodeId];
            delete next[recovery.graphId];
            return next;
          });
        }
        invalidateApiCache('/api/workflow/nodes');
        invalidateApiCache('/api/a2a/snapshot');
        invalidateApiCache('/api/sessions');
        setNodeModes(current => {
          const next = { ...current };
          delete next[nodeId];
          return next;
        });
        window.dispatchEvent(new CustomEvent('harness:sessions-changed', { detail: { sessionId: node.sessionId || nodeId, state: 'deleted' } }));
        alertToast({ message: t('Node deleted'), kind: 'success', durationMs: 2200, dedupeKey: `node-delete:${nodeId}` });
        void reloadRef.current(true).finally(() => {
          setOptimisticHiddenNodeIds(current => new Set([...current].filter(id => id !== nodeId && id !== recovery.graphId)));
        });
        return true;
      } catch (e: any) {
        restoreNodeLocally(recovery);
        setError(e?.message || t('Failed to delete node'));
        return false;
      } finally {
        setPendingDeletes(current => {
          const next = new Set(current);
          next.delete(nodeId);
          return next;
        });
      }
    })();
    pendingDeletePromisesRef.current.set(nodeId, operation);
    try {
      return await operation;
    } finally {
      if (pendingDeletePromisesRef.current.get(nodeId) === operation) pendingDeletePromisesRef.current.delete(nodeId);
    }
  }, [alertToast, canvasNodeById, captureDeletedNodeRecovery, removeNodeFromCanvas, restoreNodeLocally, setError, t]);

  const requestDeleteNodes = useCallback((nodeIds: string[]) => {
    const ids = [...new Set(nodeIds)].filter(nodeId => canRequestDeleteNode(canvasNodeById.get(nodeId)));
    if (ids.length === 0) {
      alertToast({ message: t('No selected node can be deleted'), kind: 'status', durationMs: 2600, dedupeKey: 'node-delete:none-selected' });
      return;
    }
    const liveNodeIds = ids.filter(nodeId => {
      const node = canvasNodeById.get(nodeId);
      return Boolean(node && !canDeleteNode(node) && isAgentNode(node) && isLiveStatus(node.status));
    });
    if (liveNodeIds.length > 0) {
      setDeleteConfirm({ nodeIds: ids, liveNodeIds });
      return;
    }
    void Promise.all(ids.map(nodeId => deleteNode(nodeId)));
  }, [alertToast, canvasNodeById, deleteNode, t]);

  const requestDeleteNode = useCallback((nodeId: string) => {
    requestDeleteNodes([nodeId]);
  }, [requestDeleteNodes]);

  const confirmDeleteNodes = useCallback(() => {
    if (!deleteConfirm) return;
    const confirmation = deleteConfirm;
    setDeleteConfirm(null);
    void Promise.all(confirmation.nodeIds.map(nodeId => deleteNode(nodeId, {
      stopFirst: confirmation.liveNodeIds.includes(nodeId),
    })));
  }, [deleteConfirm, deleteNode]);

  const deleteSelectedNodes = useCallback(() => {
    requestDeleteNodes([...selectedNodeIds]);
  }, [requestDeleteNodes, selectedNodeIds]);

  const openConfigForNode = useCallback((nodeId: string) => {
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setBridgePanel(null);
    setCommPanelNodeId(null);
    setExpandedRuntimeNode(null);
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
      const result = await patchRuntimeNodeState(nodeId, patch as Record<string, unknown>);
      if (!result.node) throw new Error('Component save failed: runtime node missing');
      const previous: WorkflowComponentNodeState = {
        ...current,
        ...patch,
        nodeId,
        type: current.type,
      };
      const updated = componentStateFromRuntime(
        current.type,
        result.node,
        result.state || previous as unknown as Record<string, unknown>,
        current.title,
        previous,
      );
      const node = componentWorkflowNodeFromRuntime(result.node, updated);
      setComponentNodeOverrides(overrides => ({
        ...overrides,
        [nodeId]: {
          ...overrides[nodeId],
          node,
          state: updated,
        },
      }));
      invalidateApiCache('/api/workflow/nodes');
      invalidateApiCache('/api/a2a/snapshot');
      return updated;
    } catch (e: any) {
      if (isConflictError(e)) {
        try {
          const freshNode = await fetchRuntimeNode(nodeId);
          const freshRevision = (freshNode as any)?.revision ?? (freshNode as any)?.state?.revision;
          if (freshRevision == null) throw e;
          const retryPatch = { ...patch, revision: freshRevision } as Record<string, unknown>;
          const retryResult = await patchRuntimeNodeState(nodeId, retryPatch);
          if (!retryResult.node) throw new Error('Component save failed: runtime node missing');
          const previous: WorkflowComponentNodeState = { ...current, ...patch, nodeId, type: current.type };
          const updated = componentStateFromRuntime(
            current.type, retryResult.node,
            retryResult.state || previous as unknown as Record<string, unknown>,
            current.title, previous,
          );
          const node = componentWorkflowNodeFromRuntime(retryResult.node, updated);
          setComponentNodeOverrides(overrides => ({ ...overrides, [nodeId]: { ...overrides[nodeId], node, state: updated } }));
          invalidateApiCache('/api/workflow/nodes');
          invalidateApiCache('/api/a2a/snapshot');
          return updated;
        } catch {
          throw new Error('Component save failed: stale revision');
        }
      }
      const message = String(e?.message || '');
      throw new Error(message || 'Component save failed');
    }
  }, [componentStateById]);

  // AC-3 (W3): subscribe once to the backend events hub and distribute
  // file.changed events to file node cards by nodeId (badge + manual refresh).
  // Each card reads data.fileChanged; cards clear their entry via
  // onFileNodeRefreshed after a successful refresh.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let disposed = false;
    try {
      ws = new WebSocket(wsUrl('/ws/events'));
      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const data = JSON.parse(String(event.data));
          if (data && data.type === 'file.changed' && data.nodeId) {
            const nodeId = String(data.nodeId);
            setFileChangedNodeIds(prev => {
              if (prev.has(nodeId)) return prev;
              const next = new Set(prev);
              next.add(nodeId);
              return next;
            });
          }
        } catch {
          // ignore malformed frames
        }
      };
    } catch {
      // WS unavailable — the badge degrades silently
    }
    return () => {
      disposed = true;
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const callbacks = useMemo(() => ({
    onOpenSession: onSelectSession,
    onOpenConfig: openConfigForNode,
    onStartNode: startNode,
    onStopNode: stopNode,
    onDeleteNode: requestDeleteNode,
    onToggleMode: toggleNodeMode,
    onSaveComponentNode: saveComponentNode,
    onFileNodeRefreshed: (nodeId: string) => {
      setFileChangedNodeIds(prev => {
        if (!prev.has(nodeId)) return prev;
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    },
  }), [onSelectSession, openConfigForNode, startNode, stopNode, requestDeleteNode, toggleNodeMode, saveComponentNode, setFileChangedNodeIds]);

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
    setCommPanelNodeId(null);
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
    const list = runtimes ?? [];
    setRuntimeId(current => current && list.some(runtime => runtime.id === current) ? current : list[0]?.id || '');
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
    const list = tasks ?? [];
    setTaskId(current => current && list.some(task => task.taskId === current) ? current : list[0]?.taskId || '');
  }, [tasks]);

  useEffect(() => {
    if (!graphLoaded || canvasNodes.length === 0) return;
    const candidates = canvasNodes.filter((node) => {
      const key = node.graphNodeId || node.id;
      if (!isMainAgentNode(node) || !canStartNode(node)) return false;
      if (pendingStarts.has(node.id)) return false;
      if (autoStartedMainNodes.current.has(key)) return false;
      return true;
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
    const translate = translateRef.current;
    const sameWorkflow = graphWorkflowIdRef.current === workflow.workflowId;
    if (!sameWorkflow) {
      edgeDeleteTombstonesRef.current.clear();
      capsuleDockTombstonesRef.current.clear();
    }
    const rawProjectState = graphStateFromWorkflow(workflow, translate);
    const edgeFilteredState = filterGraphStateEdgeIds(rawProjectState, edgeDeleteTombstonesRef.current);
    const projectState = filterGraphStateDockPairIds(edgeFilteredState, capsuleDockTombstonesRef.current);
    retireResolvedEdgeTombstones(rawProjectState, edgeDeleteTombstonesRef.current);
    retireResolvedCapsuleDockTombstones(rawProjectState, capsuleDockTombstonesRef.current);
    const localHistory = sameWorkflow ? graphStateRef.current : null;
    const localDockLinks = localHistory && localHistory.capsuleDockLinks.length > 0
      ? localHistory.capsuleDockLinks
      : null;
    const nextState = normalizeGraphState({
      ...projectState,
      ...(localHistory ? {
        undoStack: localHistory.undoStack,
        redoStack: localHistory.redoStack,
      } : {}),
      ...(localDockLinks && (projectState.capsuleDockLinks?.length ?? 0) === 0 ? {
        // A snapshot reload that lands mid-debounce can come back without the
        // dock links that were still queued for upload; keep the local links
        // (same precedence the undo/redo merge above uses) instead of dropping
        // them permanently.
        capsuleDockLinks: localDockLinks,
      } : {}),
    });
    graphWorkflowIdRef.current = workflow.workflowId;
    graphStateRef.current = nextState;
    graphBaseVersionRef.current = finiteGraphVersion(workflow.graph?.version);
    graphCommitPendingRef.current = false;
    graphCommitEdgesRef.current = null;
    lastGraphPutSignatureRef.current = '';
    if (graphPutDebounceRef.current !== null) {
      const pendingFlush = graphPutFlushRef.current;
      window.clearTimeout(graphPutDebounceRef.current);
      if (pendingFlush && sameWorkflow) {
        // A reload can land inside the 250ms debounce window exactly when the
        // user switches views (sessions-changed reloads). Flush the pending PUT
        // (it clears both refs and uploads the pre-reload local state) instead
        // of cancelling it mid-flight, so local dock links/positions that
        // triggered the reload are persisted rather than lost.
        void pendingFlush();
      } else {
        graphPutDebounceRef.current = null;
      }
    }
    graphPutFlushRef.current = null;
    setGraphState(nextState);
    const nextManualEdges = storedEdgesToFlowEdges(nextState.edges, translate, canvasNodeById);
    manualEdgesRef.current = nextManualEdges;
    setManualEdges(nextManualEdges);
    setGraphLoaded(true);
  }, [workflow?.workflowId, workflow?.graph?.version]);

  useEffect(() => {
    if (!workflow?.workflowId || !graphLoaded) return;
    const next = normalizeGraphState(graphState);
    const nextCommitSignature = graphCommitSignature(next);
    const nextLocalOnlyEdgeSignature = JSON.stringify({ positions: next.positions, edges: next.edges, capsuleDockLinks: next.capsuleDockLinks });
    const persistenceSignature = `${workflow.workflowId}:${nextCommitSignature}`;
    if (lastGraphPersistenceSignatureRef.current !== persistenceSignature) {
      lastGraphPersistenceSignatureRef.current = persistenceSignature;
      saveGraphStateToLocalStorage(next);
      saveGraphStateToIndexedDB(workflow.workflowId, next).catch(() => {});
    }
    if (graphLocalOnlyEdgeSignatureRef.current === nextLocalOnlyEdgeSignature) {
      graphLocalOnlyEdgeSignatureRef.current = null;
      graphCommitEdgesRef.current = null;
      graphCommitPendingRef.current = false;
      return;
    }
    if (!graphCommitPendingRef.current) return;
    if (graphLocalOnlyEdgeSignatureRef.current !== null) graphLocalOnlyEdgeSignatureRef.current = null;
    const commitEdges = graphCommitEdgesRef.current || next.edges;
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
      edges: commitEdges.map(edge => {
        const sourceNode = canvasNodeById.get(edge.source);
        const targetNode = edge.target ? canvasNodeById.get(edge.target) : undefined;
        const protocolSourceHandle = normalizeWorkflowEdgeHandle(sourceNode, 'source', edge.protocolSourceHandle ?? edge.sourceHandle);
        const protocolTargetHandle = normalizeWorkflowEdgeHandle(targetNode, 'target', edge.protocolTargetHandle ?? edge.targetHandle);
        const uiSourceHandle = workflowEdgeRenderHandle(sourceNode, 'source', protocolSourceHandle, edge.uiSourceHandle ?? edge.sourceHandle);
        const uiTargetHandle = workflowEdgeRenderHandle(targetNode, 'target', protocolTargetHandle, edge.uiTargetHandle ?? edge.targetHandle);
        const displaySourceHandle = semanticHandleForDisplay(sourceNode, 'source', protocolSourceHandle);
        const displayTargetHandle = semanticHandleForDisplay(targetNode, 'target', protocolTargetHandle);
        return {
          id: edge.id,
          from: sourceNode?.graphNodeId || edge.source,
          to: targetNode?.graphNodeId || edge.target,
          source: sourceNode?.graphNodeId || edge.source,
          target: targetNode?.graphNodeId || edge.target,
          relation: semanticBridgeRelation(displaySourceHandle, displayTargetHandle, edge.relation),
          direction: normalizeWorkflowEdgeDirection(edge.direction),
          sourceHandle: protocolSourceHandle || undefined,
          targetHandle: protocolTargetHandle || undefined,
          uiSourceHandle: uiSourceHandle || undefined,
          uiTargetHandle: uiTargetHandle || undefined,
          offset: numericEdgeOffset(edge.offset),
        };
      }),
      capsuleDockLinks: next.capsuleDockLinks,
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
      graphCommitEdgesRef.current = null;
      return;
    }
    graphCommitPendingRef.current = false;
    graphCommitEdgesRef.current = null;
    if (graphPutDebounceRef.current !== null) window.clearTimeout(graphPutDebounceRef.current);
    const firePendingGraphPut = (): Promise<void> | undefined => {
      if (graphPutDebounceRef.current === null) return undefined;
      graphPutDebounceRef.current = null;
      graphPutFlushRef.current = null;
      if (lastGraphPutSignatureRef.current === putSignature) return undefined;
      lastGraphPutSignatureRef.current = putSignature;
      return apiJson<{ version?: number; graph?: { version?: number } }>('/api/a2a/graph-map', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }).then(result => {
        const acceptedVersion = finiteGraphVersion(result?.version)
          ?? finiteGraphVersion(result?.graph?.version)
          ?? finiteGraphVersion(next.version);
        if (acceptedVersion !== null) graphBaseVersionRef.current = acceptedVersion;
      }).catch(async (putError) => {
        if (isConflictError(putError)) {
          // STALE_GRAPH_VERSION: a server-side write bumped the version between
          // our snapshot and this PUT. Positions are last-writer-wins, so
          // re-base on the server's current graph and retry ONCE with our
          // positions merged over the server's — dropping the change would
          // silently revert user gestures (drag/tidy) on reload.
          try {
            const serverGraph = await apiJson<{ version?: number; positions?: Record<string, GraphPosition> }>('/api/a2a/graph-map');
            const serverVersion = finiteGraphVersion(serverGraph?.version);
            if (serverVersion === null) throw putError;
            const mergedPositions = { ...(serverGraph?.positions || {}), ...payload.positions };
            const mergedNodes = payload.nodes.map((node: any) => ({
              ...node,
              position: mergedPositions[node.nodeId] || node.position,
            }));
            // The server stamps `version` from the payload (a2a-store
            // writeWorkflowGraphMap: `version: Number(graphPatch.version || ... )`).
            // Reusing the original payload.version (base+1) on retry would write a
            // version LOWER than the server's current one, rolling the graph-map
            // version backwards and forcing every other client into a fresh
            // STALE_GRAPH_VERSION 409 — a cross-tab retry livelock. Anchor the
            // retry on serverVersion+1 so the version stays monotonic.
            const retryPayload = { ...payload, version: serverVersion + 1, expectedVersion: serverVersion, positions: mergedPositions, nodes: mergedNodes };
            const retrySignature = JSON.stringify(retryPayload);
            const result = await apiJson<{ version?: number; graph?: { version?: number } }>('/api/a2a/graph-map', {
              method: 'PUT',
              body: JSON.stringify(retryPayload),
            });
            const acceptedVersion = finiteGraphVersion(result?.version)
              ?? finiteGraphVersion(result?.graph?.version)
              ?? serverVersion;
            graphBaseVersionRef.current = acceptedVersion;
            lastGraphPutSignatureRef.current = retrySignature;
          } catch {
            // Retry failed (or raced again): fall back to the pre-existing
            // behavior — invalidate the snapshot and reload.
            invalidateApiCache('/api/a2a/snapshot');
            reloadRef.current(true).catch(() => {});
          }
          return;
        }
        if (lastGraphPutSignatureRef.current === putSignature) lastGraphPutSignatureRef.current = '';
      });
    };
    graphPutFlushRef.current = firePendingGraphPut;
    graphPutDebounceRef.current = window.setTimeout(() => {
      graphPutFlushRef.current = null;
      void firePendingGraphPut();
    }, 250);
    return () => {
      if (graphPutDebounceRef.current !== null) {
        window.clearTimeout(graphPutDebounceRef.current);
        graphPutDebounceRef.current = null;
      }
    };
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
    if (!graphLoaded) return;
    setNodes(previous => {
      const next = toFlowNodes(
        visibleCanvasNodes,
        previous,
        nodeModes,
        componentFullscreenRequest,
        pendingStarts,
        pendingStops,
        pendingDeletes,
        capsuleByNodeId,
        capsuleDockPreview,
        capsuleMagnetDrag,
        graphState.capsuleDockLinks,
        viewportZoom,
        activeAgentControl,
        fileChangedNodeIds,
        callbacks,
      );
      const pendingIds = Object.keys(pendingNodes);
      // Loading placeholders are client-only; they are not part of the FlowNode
      // union, so the cast keeps the shared nodes state typed while still
      // letting ReactFlow render them via the 'loading-placeholder' nodeTypes
      // entry. They never reach the graph state or the backend.
      const merged: FlowNode[] = pendingIds.length === 0 ? next : [
        ...next,
        ...pendingIds.map(id => {
          const pending = pendingNodes[id];
          return {
            id,
            type: 'loading-placeholder',
            position: { x: pending.x, y: pending.y },
            width: pending.width,
            height: pending.height,
            data: { kind: pending.kind, label: pending.label, width: pending.width, height: pending.height },
            draggable: false,
            selectable: false,
          } as unknown as FlowNode;
        }),
      ];
      return sameFlowNodes(previous, merged) ? previous : merged;
    });
  }, [activeAgentControl, callbacks, capsuleByNodeId, capsuleDockPreview, capsuleMagnetDrag, componentFullscreenRequest, fileChangedNodeIds, graphLoaded, graphState.capsuleDockLinks, nodeModes, pendingDeletes, pendingNodes, pendingStarts, pendingStops, setNodes, viewportZoom, visibleCanvasNodes]);

  useEffect(() => {
    setSelectedNodeIds(current => {
      const next = new Set([...current].filter(nodeId => nodeIds.has(nodeId)));
      return next.size === current.size ? current : next;
    });
    setSelectedNodeId(current => current && nodeIds.has(current) ? current : '');
  }, [nodeIds]);

  useEffect(() => {
    setExpandedRuntimeNode(current => current && !nodeIds.has(current.nodeId) ? null : current);
  }, [nodeIds]);

  useEffect(() => {
    const showToast = (event: Event) => {
      const detail = (event as CustomEvent<Partial<WorkflowToastInput>>).detail;
      const message = String(detail?.message || '');
      alertToast({
        message,
        kind: detail?.kind || 'status',
        durationMs: Number(detail?.durationMs) || 3200,
        dedupeKey: String(detail?.dedupeKey || `workflow-toast:${message}`),
      });
    };
    window.alert_toast = alertToast;
    window.addEventListener('wf:workflow-toast', showToast);
    return () => {
      if (window.alert_toast === alertToast) delete window.alert_toast;
      window.removeEventListener('wf:workflow-toast', showToast);
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, [alertToast]);

  useEffect(() => {
    let active = true;
    let settleFrame = 0;
    const markSettled = () => {
      waitForUiFrames(2).then(() => {
        if (active) setFlowSettled(true);
      });
    };

    if (!flowReady || nodes.length === 0 || !flowRef.current) {
      setFlowSettled(false);
      return () => {
        active = false;
      };
    }
    if (!fittedOnce.current) {
      fittedOnce.current = true;
      setFlowSettled(false);
      settleFrame = requestAnimationFrame(() => {
        if (!active) return;
        const focusNodeIds = focusCapsuleNodeIds(capsuleByNodeId);
        const fitNodes = focusNodeIds.length >= 2 ? focusNodeIds.map(id => ({ id })) : undefined;
        flowRef.current?.fitView({ nodes: fitNodes, padding: fitNodes ? 0.3 : 0.22, duration: 0 });
        markSettled();
      });
      return () => {
        active = false;
        if (settleFrame) cancelAnimationFrame(settleFrame);
      };
    }
    markSettled();
    return () => {
      active = false;
    };
  }, [capsuleByNodeId, flowReady, nodes.length]);

  useEffect(() => {
    if (!terminalModeKey || !flowRef.current) return;
    requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.2, duration: 260 }));
  }, [terminalModeKey]);

  const nodeTypes = useMemo(() => ({
    wfNode: WfNodeCard,
    workflowComponentNode: WorkflowComponentNode,
    workflowEventNode: WorkflowEventNode,
    workflowCapabilityNode: WorkflowCapabilityNode,
    workflowGoalNode: WorkflowGoalNode,
    'loading-placeholder': PendingNodeFlowComponent,
  }), []);

  const flowEdgesToStored = useCallback((nextEdges: FlowEdge[]) => nextEdges.map((edge) => {
    const sourceNode = canvasNodeById.get(edge.source);
    const target = edge.target || '';
    const targetNode = target ? canvasNodeById.get(target) : undefined;
    const protocolSourceHandle = normalizeWorkflowEdgeHandle(
      sourceNode,
      'source',
      edge.data?.protocolSourceHandle ?? edge.data?.sourceHandle ?? edge.sourceHandle ?? null,
    );
    const protocolTargetHandle = normalizeWorkflowEdgeHandle(
      targetNode,
      'target',
      edge.data?.protocolTargetHandle ?? edge.data?.targetHandle ?? edge.targetHandle ?? null,
    );
    const uiSourceHandle = workflowEdgeRenderHandle(sourceNode, 'source', protocolSourceHandle, edge.sourceHandle || edge.data?.sourceHandle || null);
    const uiTargetHandle = workflowEdgeRenderHandle(targetNode, 'target', protocolTargetHandle, edge.targetHandle || edge.data?.targetHandle || null);
    const displaySourceHandle = semanticHandleForDisplay(sourceNode, 'source', protocolSourceHandle);
    const displayTargetHandle = semanticHandleForDisplay(targetNode, 'target', protocolTargetHandle);
    const relation = semanticBridgeRelation(displaySourceHandle, displayTargetHandle, typeof edge.data?.relation === 'string' ? edge.data.relation : undefined);
    const direction = normalizeWorkflowEdgeDirection(edge.data?.direction);
    const label = bridgeDisplayLabel(relation, displaySourceHandle, displayTargetHandle, t, direction);
    return {
      id: typeof edge.data?.runtimeEdgeId === 'string' ? edge.data.runtimeEdgeId : edge.id,
      from: edge.source,
      to: target,
      source: edge.source,
      target,
      label,
      relation,
      direction,
      sourceHandle: protocolSourceHandle,
      targetHandle: protocolTargetHandle,
      protocolSourceHandle,
      protocolTargetHandle,
      uiSourceHandle,
      uiTargetHandle,
      offset: numericEdgeOffset(edge.data?.offset),
    };
  }), [canvasNodeById, t]);

  const deleteSelectedEdges = useCallback(async () => {
    if (selectedEdgeIds.size === 0) return;
    const selectedIds = new Set(selectedEdgeIds);
    const current = manualEdgesRef.current;
    const deletingEdges = current.filter(edge => flowEdgeMatchesIds(edge, selectedIds));
    if (deletingEdges.length === 0) {
      setSelectedEdgeIds(new Set());
      return;
    }
    const deleteIds = new Set<string>();
    for (const edge of deletingEdges) addFlowEdgeIdAliases(deleteIds, edge);
    for (const edgeId of deleteIds) edgeDeleteTombstonesRef.current.add(edgeId);
    const runtimeEdgeIds = uniqueStringList(deletingEdges.map(edge => runtimeEdgeIdFromFlowEdge(edge)));
    const latest = graphStateRef.current;
    const nextEdges = latest.edges.filter(edge => !graphEdgeMatchesIds(edge, deleteIds));
    const nextDockLinks = pruneCapsuleDockLinksByEdgeIds(latest.capsuleDockLinks, deleteIds);
    updateGraph({ edges: nextEdges, capsuleDockLinks: nextDockLinks }, { forceCommit: true });
    suppressVisibleAgentControlOperations();
    setSelectedEdgeIds(new Set());
    setBridgePanel(currentPanel => currentPanel && deleteIds.has(currentPanel.edgeId) ? null : currentPanel);
    void Promise.all(runtimeEdgeIds.map(edgeId => deleteRuntimeEdge(edgeId))).then(() => {
        invalidateApiCache('/api/workflow/nodes');
        invalidateApiCache('/api/a2a/snapshot');
      }).catch((e: any) => {
        setError(e?.message || t('Failed to delete selected edges'));
      });
  }, [selectedEdgeIds, setError, suppressVisibleAgentControlOperations, t, updateGraph]);

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

  const selectEdge = useCallback((event: EdgeSelectionEvent, edgeId: string) => {
    event.stopPropagation();
    const additive = Boolean(event.shiftKey || event.ctrlKey || event.metaKey);
    if (additive) event.preventDefault?.();
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setBridgePanel(null);
    setShowConfig(false);
    setSelectedNodeId(current => current ? '' : current);
    setSelectedNodeIds(current => current.size === 0 ? current : new Set());
    setSelectedEdgeIds(current => {
      if (!additive) {
        const next = new Set([edgeId]);
        return sameStringSet(current, next) ? current : next;
      }
      const next = new Set(current);
      if (next.has(edgeId)) {
        next.delete(edgeId);
      } else {
        next.add(edgeId);
      }
      return sameStringSet(current, next) ? current : next;
    });
    setNodes(current => current.some(node => node.selected) ? current.map(node => ({ ...node, selected: false })) : current);
  }, [setNodes]);

  // P5-UI: the undo/redo buttons drive the backend graph.undo / graph.redo
  // actions so human and agent edits share one history. The action route
  // requires an agent graph actor node id; the first agent node is used when
  // one exists and the buttons stay disabled while the canvas has no agent
  // node. The client-local undoStack/redoStack remain in the graph state
  // model for phase 1 but no longer drive these buttons.
  const historyActorNodeId = useMemo(() => {
    for (const node of canvasNodes) {
      if (isAgentNode(node) && (node.graphNodeId || node.id)) return node.graphNodeId || node.id;
    }
    return '';
  }, [canvasNodes]);

  const undoGraph = useCallback(async () => {
    if (!historyActorNodeId) return;
    try {
      const result = await apiJson<{ ok?: boolean; applied?: boolean | null }>(`/api/workflow/nodes/${encodeURIComponent(historyActorNodeId)}/actions/graph.undo`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (result?.applied) {
        invalidateApiCache('/api/a2a/snapshot');
        await reloadRef.current(true);
      }
    } catch (e: any) {
      setError(e?.message || t('Failed to undo'));
    }
  }, [historyActorNodeId, setError, t]);

  const redoGraph = useCallback(async () => {
    if (!historyActorNodeId) return;
    try {
      const result = await apiJson<{ ok?: boolean; applied?: boolean | null }>(`/api/workflow/nodes/${encodeURIComponent(historyActorNodeId)}/actions/graph.redo`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (result?.applied) {
        invalidateApiCache('/api/a2a/snapshot');
        await reloadRef.current(true);
      }
    } catch (e: any) {
      setError(e?.message || t('Failed to redo'));
    }
  }, [historyActorNodeId, setError, t]);

  const openCreateNodePanel = useCallback((position?: { flowX: number; flowY: number; x?: number; y?: number; kind?: CreateNodeKind | null }) => {
    const bounds = flowWrapperRef.current?.getBoundingClientRect();
    const defaultX = bounds ? bounds.width - CREATE_PANEL_W - 16 : 16;
    const defaultY = bounds ? CREATE_PANEL_TOP_RESERVED : 16;
    const point = clampOverlayPosition(
      bounds,
      position?.x ?? defaultX,
      position?.y ?? defaultY,
      CREATE_PANEL_W,
      CREATE_PANEL_MAX_H,
      CREATE_PANEL_TOP_RESERVED,
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
    setCreateNodeSearch('');
    setCapabilityHub(null);
    setCapabilityHubSearch('');
  }, []);

  const createAgentNode = async () => {
    if (!runtimeId) return;
    setContextMenu(null);
    setNodeContextMenu(null);
    setLaunchingAgent(true);
    setError(null);
    const createPosition = findNearestFreePosition({
      preferred: createPanel ? { x: createPanel.flowX, y: createPanel.flowY } : { x: 260, y: 220 },
      selfSize: fallbackNodeVisualSize({ kind: 'agent' } as CanvasNode),
      occupied: canvasNodes.map(node => nodeRect(node, undefined, nodeModes, flowNodeVisualSizesRef.current)),
    });
    const pendingId = addPendingPlaceholder(createPosition, 'agent', { kind: 'agent' }, agentDisplayName.trim() || undefined);
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
          displayName: agentDisplayName.trim(),
          roleTitle: effectiveRoleTitle,
          responsibility: agentResponsibility.trim(),
          capabilities: agentCapabilities.split(',').map(item => item.trim()).filter(Boolean),
          objective: agentObjective,
          subagentMode: 'built-in-subagents',
          workflowMode,
          launchPolicy: {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'never',
          },
          graphVersion: graphStateRef.current.version,
          position: { x: createPosition.x, y: createPosition.y },
        }),
      });
      invalidateApiCache('/api/a2a/snapshot');
      invalidateApiCache('/api/sessions');
      const nodeId = `session-${session.sessionId}`;
      removePendingNode(pendingId);
      updateGraph({ positions: { ...graphStateRef.current.positions, [nodeId]: createPosition } });
      await reload(true);
      setSelectedNodeId(nodeId);
      setCreatePanel(null);
    } catch (e: any) {
      removePendingNode(pendingId);
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
    const placement = findNearestFreePosition({
      preferred: position,
      selfSize: fallbackNodeVisualSize({ kind: 'agent' } as CanvasNode),
      occupied: canvasNodes.map(node => nodeRect(node, undefined, nodeModes, flowNodeVisualSizesRef.current)),
    });
    const pendingId = addPendingPlaceholder(placement, 'agent', { kind: 'agent' }, source.label);
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
          subagentMode: source.subagentMode || 'built-in-subagents',
          workflowMode: source.workflowMode || workflowMode,
          launchPolicy: config.launchPolicy || {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'never',
          },
          graphVersion: graphStateRef.current.version,
          position: { x: placement.x, y: placement.y },
        }),
      });
      invalidateApiCache('/api/a2a/snapshot');
      invalidateApiCache('/api/sessions');
      const nodeId = `session-${session.sessionId}`;
      removePendingNode(pendingId);
      updateGraph({ positions: { ...graphStateRef.current.positions, [nodeId]: placement } });
      await reload(true);
      setSelectedNodeId(nodeId);
      setSelectedNodeIds(new Set([nodeId]));
      setCreatePanel(null);
    } catch (e: any) {
      removePendingNode(pendingId);
      setError(e?.message || t('Failed to create agent node'));
    } finally {
      setLaunchingAgent(false);
    }
  }, [addPendingPlaceholder, canvasNodes, nodeModes, projectRoot, reload, removePendingNode, runtimeId, setError, t, updateGraph, workflowMode]);

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
    const position = findNearestFreePosition({
      preferred: options.position || {
        x: 260 + componentCount * 400,
        y: canvasNodes.some(isMainAgentNode) ? 420 : 300,
      },
      selfSize: fallbackNodeVisualSize({ kind: 'component-node', type } as CanvasNode),
      occupied: canvasNodes.map(node => nodeRect(node, undefined, nodeModes, flowNodeVisualSizesRef.current)),
    });
    const defaultTitle = type === 'markdown'
      ? 'Markdown Notes'
      : type === 'file'
        ? (options.file?.name || options.file?.path?.split('/').pop() || 'File Node')
        : 'Diagram';
    const pendingId = addPendingPlaceholder(position, type, { kind: 'component-node', type }, options.title || defaultTitle);
    try {
      const result = await createRuntimeNode({
        type,
        title: options.title || defaultTitle,
        position,
        ...(options.markdown !== undefined ? { markdown: options.markdown } : {}),
        ...(options.scene !== undefined ? { scene: options.scene } : {}),
        ...(options.file ? { file: options.file as Record<string, unknown> } : {}),
      });
      if (!result.node) throw new Error('Component create failed: runtime node missing');
      const seedState = defaultComponentState(type, result.node.nodeId, options.title || defaultTitle);
      const state = componentStateFromRuntime(
        type,
        result.node,
        result.state || seedState as unknown as Record<string, unknown>,
        options.title || defaultTitle,
        {
          ...seedState,
          markdown: options.markdown ?? seedState.markdown,
          scene: options.scene ?? seedState.scene,
          file: options.file ?? seedState.file,
        },
      );
      const node = componentWorkflowNodeFromRuntime(result.node, state);
      const nodeId = state.nodeId;
      removePendingNode(pendingId);
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
      invalidateApiCache('/api/workflow/nodes');
      invalidateApiCache('/api/a2a/snapshot');
      setSelectedNodeId(nodeId);
      setSelectedNodeIds(new Set([nodeId]));
    } catch (e: any) {
      removePendingNode(pendingId);
      setError(e?.message || t('Failed to create component node'));
    }
  }, [addPendingPlaceholder, canvasNodes, nodeModes, removePendingNode, setError, t, updateGraph]);

  const createTimerNode = useCallback(async (
    options: {
      position?: GraphPosition;
      title?: string;
    } = {},
  ) => {
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setShowConfig(false);
    setError(null);
    const eventCount = canvasNodes.filter(isEventNode).length;
    const position = findNearestFreePosition({
      preferred: options.position || {
        x: 300 + eventCount * 320,
        y: canvasNodes.some(isMainAgentNode) ? 610 : 420,
      },
      selfSize: fallbackNodeVisualSize({ kind: 'event-node', type: 'timer' } as CanvasNode),
      occupied: canvasNodes.map(node => nodeRect(node, undefined, nodeModes, flowNodeVisualSizesRef.current)),
    });
    const title = options.title || 'Timer Node';
    const pendingId = addPendingPlaceholder(position, 'timer', { kind: 'event-node', type: 'timer' });
    try {
      const result = await createRuntimeNode({
        type: 'timer',
        title,
        position,
        enabled: true,
        schedule: { mode: 'loop', intervalSeconds: 60, cadence: { kind: 'fixed' } },
        heartbeat: {
          base: { enabled: true, intervalSeconds: 60 },
          watchdog: { enabled: true, intervalSeconds: 600, timeoutSeconds: 1800 },
        },
        controlPolicy: { agentCanDisable: true, agentCanSetInterval: true, minIntervalSeconds: 5, maxIntervalSeconds: 86400 },
        payloadTemplate: {},
      });
      if (!result.node) throw new Error('Timer create failed: runtime node missing');
      const nodeId = result.node.nodeId;
      removePendingNode(pendingId);
      updateGraph({
        positions: {
          ...graphStateRef.current.positions,
          [nodeId]: position,
        },
      });
      invalidateApiCache('/api/workflow/nodes');
      invalidateApiCache('/api/a2a/snapshot');
      await reload(true);
      setSelectedNodeId(nodeId);
      setSelectedNodeIds(new Set([nodeId]));
    } catch (e: any) {
      removePendingNode(pendingId);
      setError(e?.message || t('Failed to create Timer node'));
    }
  }, [addPendingPlaceholder, canvasNodes, nodeModes, reload, removePendingNode, setError, t, updateGraph]);

  const createGoalNode = useCallback(async (
    options: {
      position?: GraphPosition;
      title?: string;
    } = {},
  ) => {
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setShowConfig(false);
    setError(null);
    const goalCount = canvasNodes.filter(isGoalNode).length;
    const position = findNearestFreePosition({
      preferred: options.position || {
        x: 860 + goalCount * 360,
        y: canvasNodes.some(isMainAgentNode) ? 160 : 260,
      },
      selfSize: fallbackNodeVisualSize({ kind: 'goal-node', type: 'goal' } as CanvasNode),
      occupied: canvasNodes.map(node => nodeRect(node, undefined, nodeModes, flowNodeVisualSizesRef.current)),
    });
    const pendingId = addPendingPlaceholder(position, 'goal', { kind: 'goal-node', type: 'goal' });
    try {
      const result = await createRuntimeNode({
        type: 'goal',
        title: options.title || 'Goal Node',
        position,
      });
      if (!result.node) throw new Error('Goal create failed: runtime node missing');
      const nodeId = result.node.nodeId;
      removePendingNode(pendingId);
      updateGraph({
        positions: {
          ...graphStateRef.current.positions,
          [nodeId]: position,
        },
      });
      invalidateApiCache('/api/workflow/nodes');
      invalidateApiCache('/api/a2a/snapshot');
      await reload(true);
      setSelectedNodeId(nodeId);
      setSelectedNodeIds(new Set([nodeId]));
    } catch (e: any) {
      removePendingNode(pendingId);
      setError(e?.message || t('Failed to create Goal node'));
    }
  }, [addPendingPlaceholder, canvasNodes, nodeModes, reload, removePendingNode, setError, t, updateGraph]);

  const chooseCreateCatalogItem = useCallback((mode: CreateNodeCreateMode) => {
    if (!createPanel) return;
    if (mode === 'markdown') {
      createComponentNode('markdown', { position: { x: createPanel.flowX, y: createPanel.flowY } })
        .catch((e: any) => setError(e?.message || t('Failed to create Markdown node')));
      return;
    }
    if (mode === 'diagram') {
      createComponentNode('excalidraw', { position: { x: createPanel.flowX, y: createPanel.flowY } })
        .catch((e: any) => setError(e?.message || t('Failed to create diagram node')));
      return;
    }
    if (mode === 'display') {
      createComponentNode('display', { position: { x: createPanel.flowX, y: createPanel.flowY } })
        .catch((e: any) => setError(e?.message || t('Failed to create Display node')));
      return;
    }
    if (mode === 'timer') {
      createTimerNode({ position: { x: createPanel.flowX, y: createPanel.flowY } })
        .catch((e: any) => setError(e?.message || t('Failed to create Timer node')));
      return;
    }
    if (mode === 'goal') {
      createGoalNode({ position: { x: createPanel.flowX, y: createPanel.flowY } })
        .catch((e: any) => setError(e?.message || t('Failed to create Goal node')));
      return;
    }
    setCreatePanel(current => current ? { ...current, kind: mode } : current);
  }, [createComponentNode, createGoalNode, createPanel, createTimerNode, setError, t]);

  const openCapabilityHub = useCallback((
    kind: CapabilityHubKind,
    origin: NonNullable<CapabilityHubState>['origin'] = 'create-panel',
    targetAgentId?: string,
    createPosition?: GraphPosition,
    options: { initialTab?: SkillsHubTab; targetCapabilityId?: string } = {},
  ) => {
    setCreatePanel(null);
    setContextMenu(null);
    setNodeContextMenu(null);
    setCapabilityHub({ kind, origin, targetAgentId, createPosition, targetCapabilityId: options.targetCapabilityId });
    setSkillsHubTab(options.initialTab || 'installed');
    setCapabilityHubSearch('');
    setSkillsHubError('');
    setSkillsMarketError('');
    setMcpHubError('');
    setCapabilityHubBusySkillId('');
    setCapabilityHubBusyGroupId('');
    setSkillsMarketBusyPackId('');
    setCapabilityHubBusyMcpServerId('');
  }, []);

  const attachSkillToTargetAgent = useCallback(async (skill: WorkflowSkillsHubResponse['skills'][number]) => {
    const target = capabilityHubTargetAgent;
    if (!target) {
      setSkillsHubError(t('Select an Agent node before attaching a skill.'));
      return;
    }
    const skillName = String(skill.name || skill.id.replace(/^skill:/, '')).trim();
    if (!skillName) return;
    const currentSkills = skillsForNode(target);
    const nextSkills = uniqueStringList([...currentSkills, skillName]);
    const graphId = target.graphNodeId || target.id;
    setCapabilityHubBusySkillId(skill.id);
    setSkillsHubError('');
    try {
      const result = await apiJson<NodeConfigPatchResponse>(`/api/a2a/nodes/${encodeURIComponent(graphId)}/config`, {
        method: 'PATCH',
        body: JSON.stringify({
          skills: nextSkills,
          skillPolicy: 'manual',
        }),
      });
      const nextConfig = result.node?.config || { skills: nextSkills, skillPolicy: 'manual' as const };
      applyNodeConfigUpdate(target.id, nextConfig, {
        responseNodeId: result.node?.id,
        restartRequired: Boolean(result.restartRequired ?? result.node?.restartRequired ?? false),
        restartRequiredFields: result.restartRequiredFields || result.node?.restartRequiredFields,
      });
      invalidateApiCache('/api/a2a/snapshot');
      invalidateApiCache('/api/workflow/nodes');
      alertToast({ message: t('Skill attached to agent'), kind: 'success', durationMs: 2200, dedupeKey: `skill-attach:${target.id}:${skill.id}` });
    } catch (e: any) {
      setSkillsHubError(e?.message || t('Failed to attach skill'));
    } finally {
      setCapabilityHubBusySkillId(current => current === skill.id ? '' : current);
    }
  }, [alertToast, applyNodeConfigUpdate, capabilityHubTargetAgent, t]);

  const createSkillGroupAtPosition = useCallback(async (input: {
    skillIds: string[];
    label: string;
    position: GraphPosition;
    sourceGroup?: { id: string; label: string; kind: string };
    sourceGroupKind?: string;
    /** Pending placeholder to remove in the same block that mounts the real node. */
    pendingId?: string;
  }) => {
    const skills = input.skillIds
      .map(skillId => skillsById.get(skillId))
      .filter((skill): skill is WorkflowSkillsHubResponse['skills'][number] => Boolean(skill))
      .map(skill => ({
        id: skill.id,
        name: skill.name || skill.id.replace(/^skill:/, ''),
        title: skill.title || skill.name || skill.id,
        source: skill.sources.map(source => source.rootId || source.label).filter(Boolean).join(', ') || 'skills-hub',
        state: skill.state || 'indexed',
      }));
    if (skills.length === 0) {
      setSkillsHubError(t('Skill group has no indexed skills.'));
      return;
    }
    const target = capabilityHubTargetAgent;
    // Preferred spot is the parent agent's vicinity when the skill group will
    // be edge-connected to it (AC-001), else the caller-provided position.
    const position = findNearestFreePosition({
      preferred: target
        ? { x: target.x + (target.width || CARD_NODE_W) + 80, y: target.y }
        : input.position,
      selfSize: fallbackNodeVisualSize({ kind: 'capability-node', type: 'skill-group' } as CanvasNode),
      occupied: canvasNodes.map(node => nodeRect(node, undefined, nodeModes, flowNodeVisualSizesRef.current)),
    });
    const sourceGroupKind = input.sourceGroupKind || 'local';
    setSkillsHubError('');
    try {
      const result = await createRuntimeNode({
        type: 'skill-group',
        title: input.label || 'Skill Group',
        description: `${skills.length} skills from Skills Hub`,
        position,
        sourceGroup: input.sourceGroup || {
          id: `drop:${input.label}`,
          label: input.label || 'Skill Group',
          kind: sourceGroupKind,
        },
        category: sourceGroupKind,
        tags: [sourceGroupKind].filter(Boolean),
        loadStrategy: 'group-summary',
        skills,
      });
      if (!result.node) throw new Error('Skill group create failed: runtime node missing');
      const nodeId = result.node.nodeId;
      let nextEdges = graphStateRef.current.edges;
      if (target) {
        const sourceGraphId = target.graphNodeId || target.id;
        const edgeResult = await createRuntimeEdge(sourceGraphId, nodeId, {
          relation: 'capability',
          direction: 'bidirectional',
          sourceHandle: 'right',
          targetHandle: 'capability:left',
        });
        const runtimeEdge = edgeResult.edge;
        nextEdges = [
          ...graphStateRef.current.edges,
          {
            id: String(runtimeEdge?.id || `${sourceGraphId}->${nodeId}`),
            from: String(runtimeEdge?.from || sourceGraphId),
            to: String(runtimeEdge?.to || nodeId),
            source: target.id,
            target: nodeId,
            relation: 'capability',
            direction: 'bidirectional',
            sourceHandle: normalizeWorkflowEdgeHandle(target, 'source', runtimeEdge?.sourceHandle || 'right'),
            targetHandle: 'capability:left',
            offset: 0,
          },
        ];
      }
      if (input.pendingId) removePendingNode(input.pendingId);
      updateGraph({
        positions: {
          ...graphStateRef.current.positions,
          [nodeId]: position,
        },
        edges: nextEdges,
      }, { forceCommit: true });
      invalidateApiCache('/api/workflow/nodes');
      invalidateApiCache('/api/a2a/snapshot');
      await reload(true);
      setSelectedNodeId(nodeId);
      setSelectedNodeIds(new Set([nodeId]));
      alertToast({
        message: t('Skill group node created'),
        kind: 'success',
        durationMs: 2200,
        dedupeKey: `skill-group-create:${input.sourceGroup?.id || `${input.label}:${input.position.x}:${input.position.y}`}`,
      });
      return nodeId;
    } catch (e: any) {
      setSkillsHubError(e?.message || t('Failed to create skill group node'));
      throw e;
    }
  }, [alertToast, capabilityHubTargetAgent, canvasNodes, nodeModes, reload, removePendingNode, skillsById, t, updateGraph]);

  const createSkillGroupNode = useCallback(async (group: WorkflowSkillsHubResponse['groups'][number]) => {
    const target = capabilityHubTargetAgent;
    const fallbackPosition = target
      ? { x: target.x + (target.width || CARD_NODE_W) + 80, y: target.y }
      : { x: 320, y: 420 };
    const position = capabilityHub?.createPosition || fallbackPosition;
    setCapabilityHubBusyGroupId(group.id);
    try {
      await createSkillGroupAtPosition({
        skillIds: group.skillIds,
        label: group.label || 'Skill Group',
        position,
        sourceGroup: { id: group.id, label: group.label || 'Skill Group', kind: group.kind || 'skills-hub-group' },
        sourceGroupKind: group.kind,
      });
      setCapabilityHub(null);
    } catch {
      // The shared helper already surfaced the error via setSkillsHubError.
    } finally {
      setCapabilityHubBusyGroupId(current => current === group.id ? '' : current);
    }
  }, [capabilityHub?.createPosition, capabilityHubTargetAgent, createSkillGroupAtPosition]);

  const installSkillsPackFromMarket = useCallback(async (pack: WorkflowSkillsMarketPack) => {
    if (!pack?.slug && !pack?.packSlug) return;
    const packSlug = pack.packSlug || pack.slug;
    const target = capabilityHubTargetAgent;
    const targetGroup = capabilityHubTargetCapability && capabilityTypeFromNode(capabilityHubTargetCapability) === 'skill-group'
      ? capabilityHubTargetCapability
      : null;
    const fallbackPosition = target
      ? { x: target.x + (target.width || CARD_NODE_W) + 96, y: target.y + 140 }
      : { x: 420, y: 460 };
    const position = capabilityHub?.createPosition || fallbackPosition;
    setSkillsMarketBusyPackId(pack.id || packSlug);
    setSkillsMarketError('');
    try {
      const result = await installSkillsMarketPack({
        provider: pack.provider || 'skillstore',
        packSlug,
        targetScope: skillsMarketInstallTarget || 'project-agents',
        createGroup: true,
        groupNodeId: targetGroup ? (targetGroup.graphNodeId || targetGroup.id) : undefined,
        groupTitle: pack.name || packSlug,
        position,
      });
      const installedGroupNode = result.group?.node as any;
      const groupNodeId = installedGroupNode?.nodeId || installedGroupNode?.id || '';
      if (groupNodeId && target && !targetGroup) {
        const sourceGraphId = target.graphNodeId || target.id;
        await createRuntimeEdge(sourceGraphId, groupNodeId, {
          relation: 'capability',
          direction: 'bidirectional',
          sourceHandle: 'right',
          targetHandle: 'capability:left',
        });
      }
      invalidateApiCache('/api/workflow/nodes');
      invalidateApiCache('/api/a2a/snapshot');
      await reload(true);
      if (groupNodeId) {
        setSelectedNodeId(groupNodeId);
        setSelectedNodeIds(new Set([groupNodeId]));
      }
      setSkillsHubTab('groups');
      alertToast({
        message: targetGroup ? t('Skill group updated') : t('Skill pack installed'),
        kind: 'success',
        durationMs: 2600,
        dedupeKey: `skills-market-install:${pack.provider}:${packSlug}`,
      });
    } catch (e: any) {
      setSkillsMarketError(e?.message || t('Failed to install skill pack'));
    } finally {
      setSkillsMarketBusyPackId(current => current === (pack.id || packSlug) ? '' : current);
    }
  }, [
    alertToast,
    capabilityHub?.createPosition,
    capabilityHubTargetAgent,
    capabilityHubTargetCapability,
    reload,
    skillsMarketInstallTarget,
    t,
  ]);

  const createMcpConnectorNode = useCallback(async (server: WorkflowMcpHubResponse['servers'][number]) => {
    if (!server?.id) {
      setMcpHubError(t('MCP server metadata is missing an id.'));
      return;
    }
    const target = capabilityHubTargetAgent;
    const fallbackPosition = target
      ? { x: target.x + (target.width || CARD_NODE_W) + 80, y: target.y + 84 }
      : { x: 360, y: 460 };
    const position = capabilityHub?.createPosition || fallbackPosition;
    setCapabilityHubBusyMcpServerId(server.id);
    setMcpHubError('');
    try {
      const result = await createRuntimeNode({
        type: 'mcp-connector',
        title: `${server.title || server.name} MCP`,
        position,
        mcpServerId: server.id,
      });
      if (!result.node) throw new Error('MCP connector create failed: runtime node missing');
      const nodeId = result.node.nodeId;
      let nextEdges = graphStateRef.current.edges;
      if (target) {
        const sourceGraphId = target.graphNodeId || target.id;
        const edgeResult = await createRuntimeEdge(sourceGraphId, nodeId, {
          relation: 'capability',
          direction: 'bidirectional',
          sourceHandle: 'right',
          targetHandle: 'capability:left',
        });
        const runtimeEdge = edgeResult.edge;
        nextEdges = [
          ...graphStateRef.current.edges,
          {
            id: String(runtimeEdge?.id || `${sourceGraphId}->${nodeId}`),
            from: String(runtimeEdge?.from || sourceGraphId),
            to: String(runtimeEdge?.to || nodeId),
            source: target.id,
            target: nodeId,
            relation: 'capability',
            direction: 'bidirectional',
            sourceHandle: normalizeWorkflowEdgeHandle(target, 'source', runtimeEdge?.sourceHandle || 'right'),
            targetHandle: 'capability:left',
            offset: 0,
          },
        ];
      }
      updateGraph({
        positions: {
          ...graphStateRef.current.positions,
          [nodeId]: position,
        },
        edges: nextEdges,
      }, { forceCommit: true });
      invalidateApiCache('/api/workflow/nodes');
      invalidateApiCache('/api/a2a/snapshot');
      await reload(true);
      setCapabilityHub(null);
      setSelectedNodeId(nodeId);
      setSelectedNodeIds(new Set([nodeId]));
      alertToast({ message: t('MCP connector node created'), kind: 'success', durationMs: 2200, dedupeKey: `mcp-create:${server.id}` });
    } catch (e: any) {
      setMcpHubError(e?.message || t('Failed to create MCP connector node'));
    } finally {
      setCapabilityHubBusyMcpServerId(current => current === server.id ? '' : current);
    }
  }, [alertToast, capabilityHub?.createPosition, capabilityHubTargetAgent, reload, t, updateGraph]);

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
      if (event.key === 'Escape') {
        const hasOpenOverlay = Boolean(deleteConfirm || createPanel || capabilityHub || contextMenu || nodeContextMenu || bridgePanel || showConfig);
        if (!hasOpenOverlay) return;
        event.preventDefault();
        setCreatePanel(null);
        setCapabilityHub(null);
        setContextMenu(null);
        setNodeContextMenu(null);
        setBridgePanel(null);
        setShowConfig(false);
        setDeleteConfirm(null);
        setSelectedRuntimeNode(null);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        graphPutFlushRef.current?.();
        alertToast({ message: t('Canvas saved'), kind: 'success', durationMs: 2000, dedupeKey: 'canvas-save' });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          void redoGraph();
        } else {
          void undoGraph();
        }
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
        deleteSelectedNodes();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    alertToast,
    copyNodesToClipboard,
    bridgePanel,
    contextMenu,
    capabilityHub,
    createPanel,
    cutNodesToClipboard,
    deleteSelectedEdges,
    deleteSelectedNodes,
    flowPositionFromClient,
    nodeClipboard,
    nodeContextMenu,
    nodes,
    pasteNodeClipboardAt,
    selectedEdgeIds.size,
    selectedNodeIds,
    selectedNodeIds.size,
    redoGraph,
    setError,
    setNodes,
    showConfig,
    t,
    undoGraph,
  ]);

  const handleCanvasDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (shouldIgnoreCanvasFileGesture(event.target)) return;
    const hasDropCandidate = transferHasCanvasDropCandidate(event.dataTransfer);
    const skillGroup = readSkillGroupTransfer(event.dataTransfer);
    const workspaceItem = readWorkspaceItem(event.dataTransfer);
    const files = filesFromTransfer(event.dataTransfer);
    if (!skillGroup && !workspaceItem && files.length === 0) {
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
    if (skillGroup) {
      skillsDraftDragActiveRef.current = false;
      const pendingId = addPendingPlaceholder(position, 'skill-group', { kind: 'capability-node', type: 'skill-group' }, skillGroup.label);
      createSkillGroupAtPosition({
        skillIds: skillGroup.skillIds,
        label: skillGroup.label,
        position,
        pendingId,
      })
        .then(() => {
          // Success: unmount the hidden overlay so its draft clears with it.
          setSkillsDragHideActive(false);
          setSkillsOverlay(current => (current.open ? { open: false, mode: current.mode } : current));
        })
        .catch((e: any) => {
          // Failure: restore the hidden overlay so the draft is not lost.
          setSkillsDragHideActive(false);
          setError(e?.message || t('Failed to create skill group node'));
        })
        .finally(() => removePendingNode(pendingId));
      return;
    }
    if (workspaceItem) {
      insertWorkspaceEntryToCanvas({
        path: workspaceItem.path,
        name: workspaceItem.name || basename(workspaceItem.path),
        type: workspaceItem.kind === 'workspace-folder' ? 'directory' : 'file',
      }, position).catch((e: any) => setError(e?.message || t('Failed to create file node')));
      return;
    }
    createFileNodesFromUploads(files, position).catch((e: any) => setError(e?.message || t('Failed to upload file node')));
  }, [addPendingPlaceholder, createFileNodesFromUploads, createSkillGroupAtPosition, flowPositionFromClient, insertWorkspaceEntryToCanvas, removePendingNode, setError, setSkillsDragHideActive, setSkillsOverlay, t]);

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
    // Screenshots (Win+Shift+S / PrintScreen) land on the clipboard as
    // image/* ITEMS, not files — clipboardData.files is empty for them, so
    // read the items directly and upload the blob as a file node.
    const imageItem = Array.from(event.clipboardData?.items || []).find(
      (item) => item.kind === 'file' && String(item.type || '').startsWith('image/'),
    );
    if (imageItem) {
      const blob = imageItem.getAsFile();
      if (blob) {
        event.preventDefault();
        event.stopPropagation();
        const stamped = new File([blob], `pasted-image-${Date.now()}.png`, { type: blob.type || 'image/png' });
        createFileNodesFromUploads([stamped], position).catch((e: any) => setError(e?.message || t('Failed to upload file node')));
        return;
      }
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

  const resolveCanvasConnectionNodeId = useCallback((nodeId: string) => {
    const value = String(nodeId || '').trim();
    if (!value) return '';
    if (canvasNodeById.has(value)) return value;
    for (const node of canvasNodeById.values()) {
      if (node.graphNodeId === value || node.sessionId === value) return node.id;
    }
    return value;
  }, [canvasNodeById]);

  const applyRuntimeEdgeLocally = useCallback((runtimeEdge: Partial<WorkflowGraphEdge>) => {
    const source = resolveCanvasConnectionNodeId(String(runtimeEdge.from || runtimeEdge.source || ''));
    const target = resolveCanvasConnectionNodeId(String(runtimeEdge.to || runtimeEdge.target || ''));
    if (!source || !target) return null;
    const runtimeEdgeId = String(runtimeEdge.id || `${source}->${target}`).trim();
    if (runtimeEdgeId && edgeDeleteTombstonesRef.current.has(runtimeEdgeId)) return null;
    const sourceNode = canvasNodeById.get(source);
    const targetNode = canvasNodeById.get(target);
    const protocolSourceHandle = normalizeWorkflowEdgeHandle(sourceNode, 'source', runtimeEdge.sourceHandle || null);
    const protocolTargetHandle = normalizeWorkflowEdgeHandle(targetNode, 'target', runtimeEdge.targetHandle || null);
    const sourceHandle = workflowEdgeRenderHandle(sourceNode, 'source', protocolSourceHandle, runtimeEdge.uiSourceHandle);
    const targetHandle = workflowEdgeRenderHandle(targetNode, 'target', protocolTargetHandle, runtimeEdge.uiTargetHandle);
    const displaySourceHandle = semanticHandleForDisplay(sourceNode, 'source', protocolSourceHandle);
    const displayTargetHandle = semanticHandleForDisplay(targetNode, 'target', protocolTargetHandle);
    const relation = semanticBridgeRelation(displaySourceHandle, displayTargetHandle, runtimeEdge.relation);
    const direction = normalizeWorkflowEdgeDirection(runtimeEdge.direction);
    const edge: WorkflowGraphEdge = {
      id: runtimeEdgeId || `${source}->${target}`,
      from: source,
      to: target,
      source,
      target,
      relation,
      direction,
      sourceHandle,
      targetHandle,
      protocolSourceHandle,
      protocolTargetHandle,
      uiSourceHandle: sourceHandle,
      uiTargetHandle: targetHandle,
      offset: Number.isFinite(Number(runtimeEdge.offset)) ? Number(runtimeEdge.offset) : undefined,
    };
    const current = graphStateRef.current;
    const suppressGraphMapEdgeReconciliation = !graphCommitPendingRef.current;
    const next = normalizeGraphState({
      ...current,
      version: current.version + 1,
      edges: [...current.edges.filter(item => item.id !== edge.id), edge],
    });
    graphStateRef.current = next;
    graphLocalOnlyEdgeSignatureRef.current = suppressGraphMapEdgeReconciliation
      ? JSON.stringify({ positions: next.positions, edges: next.edges, capsuleDockLinks: next.capsuleDockLinks })
      : null;
    setGraphState(next);
    const nextManualEdges = storedEdgesToFlowEdges(next.edges, t, canvasNodeById);
    manualEdgesRef.current = nextManualEdges;
    setManualEdges(nextManualEdges);
    return edge;
  }, [canvasNodeById, resolveCanvasConnectionNodeId, t]);

  const onConnect = useCallback(async (connection: Connection) => {
    const orientedConnection = orientConnectionFromGesture(connection, graphConnectionStartRef.current);
    if (!orientedConnection.source || !orientedConnection.target || orientedConnection.source === orientedConnection.target) return;
    graphConnectionCompletedAtRef.current = Date.now();
    const current = manualEdgesRef.current;
    const sourceNode = canvasNodeById.get(orientedConnection.source);
    const targetNode = canvasNodeById.get(orientedConnection.target);
    let edgeSourceId = orientedConnection.source;
    let edgeTargetId = orientedConnection.target;
    let edgeSourceNode = sourceNode;
    let edgeTargetNode = targetNode;
    let edgeSourceHandle = normalizeWorkflowEdgeHandle(edgeSourceNode, 'source', orientedConnection.sourceHandle);
    let edgeTargetHandle = normalizeWorkflowEdgeHandle(edgeTargetNode, 'target', orientedConnection.targetHandle);
    let uiSourceHandle = physicalSideHandle(orientedConnection.sourceHandle) || edgeSourceHandle;
    let uiTargetHandle = physicalSideHandle(orientedConnection.targetHandle) || edgeTargetHandle;
    const timerGoalConnection = (
      (eventTypeFromNode(sourceNode) === 'timer' && isGoalNode(targetNode))
      || (eventTypeFromNode(targetNode) === 'timer' && isGoalNode(sourceNode))
    );
    if (timerGoalConnection) {
      if (eventTypeFromNode(targetNode) === 'timer') {
        edgeSourceId = orientedConnection.target;
        edgeTargetId = orientedConnection.source;
        edgeSourceNode = targetNode;
        edgeTargetNode = sourceNode;
      }
      edgeSourceHandle = 'event';
      edgeTargetHandle = 'goal:left';
      uiSourceHandle = edgeSourceHandle;
      uiTargetHandle = edgeTargetHandle;
    }
    const isTimerEventEdge = eventTypeFromNode(edgeSourceNode) === 'timer' && (!edgeSourceHandle || edgeSourceHandle === 'event');
    const isTimerControlEdge = eventTypeFromNode(edgeTargetNode) === 'timer' && (!edgeTargetHandle || edgeTargetHandle === 'config');
    const direction: WorkflowEdgeDirection = isTimerEventEdge || isTimerControlEdge
      ? 'source-to-target'
      : 'bidirectional';
    const requestSourceHandle = isTimerControlEdge && isAgentNode(edgeSourceNode)
      ? 'context'
      : edgeSourceHandle;
    const requestTargetHandle = timerGoalConnection
      ? 'goal:left'
      : (isTimerEventEdge && !isEventNode(edgeTargetNode)
          ? 'event.in'
          : (isAgentNode(edgeTargetNode) && !isEventNode(edgeSourceNode) ? 'context' : edgeTargetHandle));
    const renderSourceHandle = workflowEdgeRenderHandle(edgeSourceNode, 'source', requestSourceHandle, uiSourceHandle);
    const renderTargetHandle = workflowEdgeRenderHandle(edgeTargetNode, 'target', requestTargetHandle, uiTargetHandle);
    const displaySourceHandle = semanticHandleForDisplay(edgeSourceNode, 'source', requestSourceHandle);
    const displayTargetHandle = isTimerEventEdge && !isEventNode(edgeTargetNode) && !isGoalNode(edgeTargetNode)
      ? requestTargetHandle
      : semanticHandleForDisplay(edgeTargetNode, 'target', requestTargetHandle);
    const sourceGraphId = edgeSourceNode?.graphNodeId || edgeSourceId;
    const targetGraphId = edgeTargetNode?.graphNodeId || edgeTargetId;
    const relation = isTimerEventEdge
      ? 'event'
      : (isTimerControlEdge
          ? 'control'
      : (isCapabilityNode(edgeSourceNode) || isCapabilityNode(edgeTargetNode)
          ? 'capability'
          : (isGoalNode(edgeSourceNode) || isGoalNode(edgeTargetNode)
              ? 'goal'
              : semanticBridgeRelation(displaySourceHandle, displayTargetHandle))));
    if (current.some((edge) => {
      const edgeDirection = normalizeWorkflowEdgeDirection(edge.data?.direction);
      if (direction === 'source-to-target' || edgeDirection === 'source-to-target') {
        return edge.source === edgeSourceId
          && edge.target === edgeTargetId
          && edgeDirection === direction
          && String(edge.data?.relation || '') === relation;
      }
      return (
        (edge.source === orientedConnection.source && edge.target === orientedConnection.target)
        || (edge.source === orientedConnection.target && edge.target === orientedConnection.source)
      );
    })) return;
    const inFlightKey = manualConnectionKey(
      edgeSourceId,
      edgeTargetId,
      direction,
      relation,
      requestSourceHandle,
      requestTargetHandle,
    );
    if (manualConnectionInFlightRef.current.has(inFlightKey)) return;
    manualConnectionInFlightRef.current.add(inFlightKey);
    let createdRuntimeEdge: Partial<WorkflowGraphEdge> | null = null;
    try {
      const result = await createRuntimeEdge(sourceGraphId, targetGraphId, {
        relation,
        direction,
        sourceHandle: requestSourceHandle || undefined,
        targetHandle: requestTargetHandle || undefined,
      });
      const responseEdge = result.edge || {};
      createdRuntimeEdge = {
        ...responseEdge,
        id: String(responseEdge.id || `manual-${edgeSourceId}-${edgeTargetId}-${Date.now()}`),
        from: responseEdge.from || responseEdge.source || sourceGraphId,
        to: responseEdge.to || responseEdge.target || targetGraphId,
        source: responseEdge.source || responseEdge.from || sourceGraphId,
        target: responseEdge.target || responseEdge.to || targetGraphId,
        relation: responseEdge.relation || relation,
        direction: normalizeWorkflowEdgeDirection(responseEdge.direction || direction),
        sourceHandle: responseEdge.sourceHandle ?? requestSourceHandle,
        targetHandle: responseEdge.targetHandle ?? requestTargetHandle,
        protocolSourceHandle: responseEdge.sourceHandle ?? requestSourceHandle,
        protocolTargetHandle: responseEdge.targetHandle ?? requestTargetHandle,
        uiSourceHandle: renderSourceHandle,
        uiTargetHandle: renderTargetHandle,
      };
      invalidateApiCache('/api/workflow/nodes');
      invalidateApiCache('/api/a2a/snapshot');
    } catch (e: any) {
      setError(e?.message || t('Failed to connect nodes'));
      return;
    } finally {
      manualConnectionInFlightRef.current.delete(inFlightKey);
    }
    if (!createdRuntimeEdge) return;
    if (createdRuntimeEdge.id) edgeDeleteTombstonesRef.current.delete(String(createdRuntimeEdge.id));
    const localEdge = applyRuntimeEdgeLocally(createdRuntimeEdge);
    if (!localEdge) return;
    const selectedFlowEdgeId = manualEdgesRef.current.find(edge => edge.data?.runtimeEdgeId === localEdge.id)?.id
      || safeFlowEdgeId(localEdge.id, `edge-${localEdge.source}-${localEdge.target}`);
    setSelectedEdgeIds(new Set([selectedFlowEdgeId]));
    setSelectedNodeId('');
    setSelectedNodeIds(new Set());
  }, [applyRuntimeEdgeLocally, canvasNodeById, setError, t]);
  connectWorkflowEndpointsRef.current = onConnect;

  const updateCapsuleDockPreview = useCallback((nodeId: string, position: GraphPosition) => {
    if (viewportZoom < CAPSULE_DOCK_MIN_ZOOM) {
      setCapsuleDockPreview(null);
      return;
    }
    const dragged = canvasNodeById.get(nodeId);
    const visualSizes = currentNodeVisualSizes();
    const candidate = dragged && capsuleRoleForNode(dragged)
      ? findCapsuleDockCandidate(dragged, position, canvasNodes, nodeModes, visualSizes)
      : null;
    const nextPreview: CapsuleDockPreview = dragged && candidate
      ? { draggedId: dragged.id, anchorId: candidate.node.id, side: candidate.side }
      : null;
    setCapsuleDockPreview(current => (
      current?.draggedId === nextPreview?.draggedId
        && current?.anchorId === nextPreview?.anchorId
        && current?.side === nextPreview?.side
        ? current
        : nextPreview
    ));
  }, [canvasNodeById, canvasNodes, currentNodeVisualSizes, nodeModes, viewportZoom]);

  // ── P3-UI: dock mutations go through the backend typed actions
  // (agent.attachDock / agent.detachDock / agent.setDockSide) so the graph-map
  // PUT is not a second writer for dock state. The action route requires an
  // agent graph actor node; the main agent is used when one exists. Older
  // backends that do not know the action answer 404 — callers then fall back
  // to the previous PUT-based commit. ──
  const agentActorForDock = useCallback(() => {
    for (const node of canvasNodes) {
      if (isAgentNode(node) && (node.graphNodeId || node.id)) return node.graphNodeId || node.id;
    }
    return '';
  }, [canvasNodes]);

  const runDockBackendAction = useCallback(async (
    action: 'agent.attachDock' | 'agent.detachDock' | 'agent.setDockSide',
    payload: { anchorId?: string; draggedId?: string; dockId?: string; side?: string },
  ): Promise<boolean> => {
    const actorNodeId = agentActorForDock();
    if (!actorNodeId) return false;
    try {
      await apiJson(`/api/workflow/nodes/${encodeURIComponent(actorNodeId)}/actions/${action}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return true;
    } catch (e: any) {
      // apiJson rewrites the message from typed error bodies, so detect the
      // "older backend" 404s by status text or the backend's typed codes
      // (UNKNOWN_ACTION / AGENT_GRAPH_ACTOR_NOT_FOUND both answer 404).
      const message = String(e?.message || '');
      if (/\b404\b/.test(message) || /Unknown workflow node action/.test(message) || /Agent graph actor not found/.test(message)) return false;
      throw e;
    }
  }, [agentActorForDock]);

  // A dock mutation committed through the backend action must not race the
  // trailing-debounced graph PUT: drop the pending PUT (the backend action is
  // the source of truth for dock state), then let the snapshot reload converge
  // version and dock state. The drag position is re-applied afterwards because
  // the reload carries the pre-drag backend positions.
  const suppressPendingGraphPut = useCallback(() => {
    if (graphPutDebounceRef.current !== null) {
      window.clearTimeout(graphPutDebounceRef.current);
      graphPutDebounceRef.current = null;
    }
    graphPutFlushRef.current = null;
    graphCommitPendingRef.current = false;
    graphCommitEdgesRef.current = null;
    graphLocalOnlyEdgeSignatureRef.current = null;
  }, []);

  const reconcileAfterDockAction = useCallback(async (positionNodeId: string, position?: GraphPosition) => {
    invalidateApiCache('/api/a2a/snapshot');
    await reloadRef.current(true);
    if (position) {
      updateGraph({
        positions: {
          ...graphStateRef.current.positions,
          [positionNodeId]: position,
        },
      });
    }
  }, [updateGraph]);

  const detachCapsuleDockLinksForNode = useCallback(async (
    nodeId: string,
    keepPairId = '',
    options: DetachCapsuleDockOptions = {},
  ) => {
    const current = graphStateRef.current;
    // Optimistic capture: rolled back via applyGraphStateLocally if the
    // backend detach loop throws.
    const before = graphStateRef.current;
    const linksToDetach = current.capsuleDockLinks.filter(link => (
      link.nodeIds.includes(nodeId)
        && capsuleDockPairId(link.nodeIds[0], link.nodeIds[1]) !== keepPairId
    ));
    const detachPairIds = new Set(linksToDetach.map(link => capsuleDockPairId(link.nodeIds[0], link.nodeIds[1])));
    if (linksToDetach.length === 0) {
      if (options.position) {
        updateGraph({
          positions: {
            ...current.positions,
            [nodeId]: options.position,
          },
        });
      }
      return false;
    }
    // P3-UI: apply the detach locally first (optimistic) so the canvas updates
    // instantly, then commit through the backend typed action (one call per
    // detached link). Older backends (404) leave the pending full-graph PUT
    // commit to land instead.
    const deleteEdgeIds = capsuleDockDeleteOnDetachEdgeIds(linksToDetach);
    for (const pairId of detachPairIds) capsuleDockTombstonesRef.current.add(pairId);
    for (const edgeId of deleteEdgeIds) edgeDeleteTombstonesRef.current.add(edgeId);
    const latest = graphStateRef.current;
    const nextDockLinks = latest.capsuleDockLinks.filter(link => (
      !detachPairIds.has(capsuleDockPairId(link.nodeIds[0], link.nodeIds[1]))
    ));
    const nextEdges = deleteEdgeIds.size > 0
      ? latest.edges.filter(edge => !deleteEdgeIds.has(String(edge.id || '').trim()))
      : latest.edges;
    updateGraph({
      ...(options.position ? {
        positions: {
          ...latest.positions,
          [nodeId]: options.position,
        },
      } : {}),
      edges: nextEdges,
      capsuleDockLinks: nextDockLinks,
    }, { forceCommit: true });
    let backendCommitted = false;
    try {
      for (const link of linksToDetach) {
        const committed = await runDockBackendAction('agent.detachDock', {
          anchorId: link.anchorId,
          draggedId: link.draggedId,
        });
        if (!committed) {
          backendCommitted = false;
          break;
        }
        backendCommitted = true;
      }
    } catch (e: any) {
      applyGraphStateLocally(before);
      setError(e?.message || t('Failed to detach dock'));
      return false;
    }
    if (backendCommitted) {
      suppressPendingGraphPut();
      await reconcileAfterDockAction(nodeId, options.position);
    }
    suppressVisibleAgentControlOperations();
    return true;
  }, [applyGraphStateLocally, reconcileAfterDockAction, runDockBackendAction, setError, suppressPendingGraphPut, suppressVisibleAgentControlOperations, t, updateGraph]);

  const autoDockCapsuleNode = useCallback(async (
    nodeId: string,
    position: GraphPosition,
    settleSeq = capsuleDockSettleSeqRef.current,
  ) => {
    if (viewportZoom < CAPSULE_DOCK_MIN_ZOOM) return false;
    const dragged = canvasNodeById.get(nodeId);
    if (!dragged || !capsuleRoleForNode(dragged)) return false;
    const visualSizes = currentNodeVisualSizes();
    const candidate = findCapsuleDockCandidate(dragged, position, canvasNodes, nodeModes, visualSizes);
    if (!candidate) return false;
    if (settleSeq !== capsuleDockSettleSeqRef.current) return false;
    // Optimistic capture: rolled back via applyGraphStateLocally if the
    // backend attach action throws.
    const before = graphStateRef.current;
    const pairId = capsuleDockPairId(dragged.id, candidate.node.id);
    capsuleDockTombstonesRef.current.delete(pairId);
    const current = graphStateRef.current;
    const linksToDetach = current.capsuleDockLinks.filter(link => (
      link.nodeIds.includes(dragged.id)
        && capsuleDockPairId(link.nodeIds[0], link.nodeIds[1]) !== pairId
    ));
    const detachPairIds = new Set(linksToDetach.map(link => capsuleDockPairId(link.nodeIds[0], link.nodeIds[1])));
    const deleteEdgeIds = capsuleDockDeleteOnDetachEdgeIds(linksToDetach);
    for (const detachPairId of detachPairIds) capsuleDockTombstonesRef.current.add(detachPairId);
    for (const edgeId of deleteEdgeIds) edgeDeleteTombstonesRef.current.add(edgeId);
    const retainedEdges = deleteEdgeIds.size > 0
      ? current.edges.filter(edge => !deleteEdgeIds.has(String(edge.id || '').trim()))
      : current.edges;

    const usedEdgeIds = new Set<string>();
    const edgeBindings: CapsuleDockEdgeBinding[] = [];
    for (const connection of candidate.connections) {
      const existingEdge = findCapsuleEdgeForConnection(connection, retainedEdges, canvasNodeById, usedEdgeIds);
      if (existingEdge) {
        usedEdgeIds.add(existingEdge.id);
        edgeBindings.push({ edgeId: existingEdge.id, retention: 'keep' });
      }
    }

    const nextPosition = snapCapsulePosition(dragged, candidate.node, position, candidate.side, nodeModes, visualSizes);
    animateCapsuleNodePosition(dragged.id, position, nextPosition);
    setSelectedEdgeIds(new Set());
    const sortedNodeIds = [dragged.id, candidate.node.id].sort() as [string, string];
    const nextDockLinks = [
      ...current.capsuleDockLinks.filter(link => {
        const currentPairId = capsuleDockPairId(link.nodeIds[0], link.nodeIds[1]);
        return currentPairId !== pairId && !detachPairIds.has(currentPairId);
      }),
      {
        id: `dock:${pairId}`,
        nodeIds: sortedNodeIds,
        anchorId: candidate.node.id,
        draggedId: dragged.id,
        side: candidate.side,
        edges: edgeBindings,
        connections: candidate.connections,
      } satisfies CapsuleDockLink,
    ];
    // P3-UI: apply the attach locally first (optimistic) so the canvas updates
    // instantly, then commit through the backend typed action (idempotent:
    // re-attaching the same pair updates the side). Older backends (404) leave
    // the pending full-graph PUT commit to land instead.
    updateGraph({
      positions: {
        ...current.positions,
        [dragged.id]: nextPosition,
      },
      edges: retainedEdges,
      capsuleDockLinks: nextDockLinks,
    });
    let backendCommitted = false;
    try {
      backendCommitted = await runDockBackendAction('agent.attachDock', {
        anchorId: candidate.node.id,
        draggedId: dragged.id,
        side: candidate.side,
      });
    } catch (e: any) {
      applyGraphStateLocally(before);
      setError(e?.message || t('Failed to dock'));
      return false;
    }
    if (backendCommitted) {
      suppressPendingGraphPut();
      await reconcileAfterDockAction(dragged.id, nextPosition);
    }
    alertToast({
      message: `${capsuleLinkTitle(dragged)} docked with ${capsuleLinkTitle(candidate.node)}`,
      kind: 'success',
      durationMs: 2400,
      dedupeKey: `capsule-dock:${pairId}`,
    });
    return true;
  }, [alertToast, animateCapsuleNodePosition, applyGraphStateLocally, canvasNodeById, canvasNodes, currentNodeVisualSizes, nodeModes, reconcileAfterDockAction, runDockBackendAction, setError, suppressPendingGraphPut, t, updateGraph, viewportZoom]);

  const settleCapsuleDockAfterDrag = useCallback(async (nodeId: string, position: GraphPosition) => {
    const settleSeq = ++capsuleDockSettleSeqRef.current;
    const dragged = canvasNodeById.get(nodeId);
    const draggedRole = capsuleRoleForNode(dragged);
    if (!dragged || !draggedRole) return;
    const visualSizes = currentNodeVisualSizes();
    const candidate = viewportZoom >= CAPSULE_DOCK_MIN_ZOOM
      ? findCapsuleDockCandidate(dragged, position, canvasNodes, nodeModes, visualSizes)
      : null;
    if (!candidate) {
      await detachCapsuleDockLinksForNode(nodeId, '', { includeLooseCapsuleEdges: true, position });
      return;
    }
    await autoDockCapsuleNode(nodeId, position, settleSeq);
  }, [autoDockCapsuleNode, canvasNodeById, canvasNodes, currentNodeVisualSizes, detachCapsuleDockLinksForNode, nodeModes, viewportZoom]);
  settleCapsuleDockAfterDragRef.current = settleCapsuleDockAfterDrag;

  const removeRuntimeEdgeLocally = useCallback((edgeId: string) => {
    const id = String(edgeId || '').trim();
    if (!id) return;
    const deleteIds = new Set([id]);
    edgeDeleteTombstonesRef.current.add(id);
    const current = graphStateRef.current;
    const next = normalizeGraphState({
      ...current,
      version: current.version + 1,
      edges: current.edges.filter(edge => !graphEdgeMatchesIds(edge, deleteIds)),
      capsuleDockLinks: pruneCapsuleDockLinksByEdgeIds(current.capsuleDockLinks, deleteIds),
    });
    graphStateRef.current = next;
    setGraphState(next);
    const nextManualEdges = storedEdgesToFlowEdges(next.edges, t, canvasNodeById);
    manualEdgesRef.current = nextManualEdges;
    setManualEdges(nextManualEdges);
  }, [canvasNodeById, t]);

  useEffect(() => {
    const handleWfBrowserIntent = (event: Event) => {
      const detail = (event as CustomEvent<{
        intent?: string;
        payload?: Record<string, unknown>;
        handled?: boolean;
        resolve?: (value: unknown) => void;
        reject?: (error: unknown) => void;
      }>).detail;
      if (!detail || ![
        'graph.createNode',
        'graph.connectNodes',
        'graph.disconnectNodes',
        'graph.moveNode',
        'graph.deleteNode',
        'graph.deleteNodes',
      ].includes(String(detail.intent || ''))) return;
      detail.handled = true;
      const payload = detail.payload || {};
      const intent = detail.intent;
      const actorNodeId = resolveCanvasConnectionNodeId(String(payload.actorNodeId || payload.agentNodeId || ''));

      (async () => {
        if (intent === 'graph.createNode') {
          const type = String(payload.type || 'markdown') as any;
          const response = actorNodeId
            ? await executeRuntimeNodeAction(actorNodeId, 'agent.createNode', payload)
            : await createRuntimeNode({ ...payload, type } as any);
          const node = (response.node || (response.result && typeof response.result === 'object' ? (response.result as any).node : null)) as { nodeId?: string; id?: string } | null;
          const nodeId = String(node?.nodeId || node?.id || payload.nodeId || '');
          const operation = noteWorkflowOperation(
            operationFromRuntimeResponse(response, intent, {
              actor: actorNodeId ? { type: 'agent', nodeId: actorNodeId } : { type: 'browser' },
              targetNodeIds: nodeId ? [nodeId] : [],
            }),
            intent,
          );
          invalidateApiCache('/api/a2a/snapshot');
          reloadRef.current(true).catch(() => {});
          await waitForUiFrames(2);
          detail.resolve?.({ ok: true, intent, nodeId, operation, settled: true });
          return;
        }

        if (intent === 'graph.connectNodes') {
          const source = resolveCanvasConnectionNodeId(String(payload.sourceNodeId || payload.source || payload.from || ''));
          const target = resolveCanvasConnectionNodeId(String(payload.targetNodeId || payload.target || payload.to || ''));
          if (!source || !target) {
            detail.resolve?.({ ok: false, code: 'ENDPOINT_REQUIRED', source, target });
            return;
          }
          const response = actorNodeId
            ? await executeRuntimeNodeAction(actorNodeId, 'agent.connectNodes', { ...payload, from: source, to: target })
            : await createRuntimeEdge(source, target, {
                relation: String(payload.relation || 'wf-bridge/context'),
                direction: normalizeWorkflowEdgeDirection(payload.direction),
                sourceHandle: String(payload.sourceHandle || ''),
                targetHandle: String(payload.targetHandle || ''),
              });
          const edge = (response as any).edge || ((response as any).result && typeof (response as any).result === 'object' ? (response as any).result.edge : null);
          const localEdge = edge ? applyRuntimeEdgeLocally(edge) : null;
          const operation = noteWorkflowOperation(
            operationFromRuntimeResponse(response, intent, {
              actor: actorNodeId ? { type: 'agent', nodeId: actorNodeId } : { type: 'browser' },
              targetNodeIds: [source, target],
              edgeIds: [String(edge?.id || localEdge?.id || `${source}->${target}`)],
            }),
            intent,
          );
          await waitForUiFrames(2);
          detail.resolve?.({ ok: true, intent, source, target, edge: edge || localEdge, operation, settled: true });
          return;
        }

        if (intent === 'graph.disconnectNodes') {
          const edgeId = String(payload.edgeId || payload.id || '').trim();
          if (!edgeId) {
            detail.resolve?.({ ok: false, code: 'EDGE_REQUIRED' });
            return;
          }
          const response = actorNodeId
            ? await executeRuntimeNodeAction(actorNodeId, 'agent.disconnectNodes', { ...payload, edgeId })
            : await deleteRuntimeEdge(edgeId);
          removeRuntimeEdgeLocally(edgeId);
          const operation = noteWorkflowOperation(
            operationFromRuntimeResponse(response, intent, {
              actor: actorNodeId ? { type: 'agent', nodeId: actorNodeId } : { type: 'browser' },
              targetNodeIds: [
                resolveCanvasConnectionNodeId(String(payload.sourceNodeId || payload.source || payload.from || '')),
                resolveCanvasConnectionNodeId(String(payload.targetNodeId || payload.target || payload.to || '')),
              ].filter(Boolean),
              edgeIds: [edgeId],
            }),
            intent,
          );
          await waitForUiFrames(2);
          detail.resolve?.({ ok: true, intent, edgeId, operation, settled: true });
          return;
        }

        if (intent === 'graph.deleteNode' || intent === 'graph.deleteNodes') {
          const rawTargets = [
            ...(Array.isArray(payload.targetNodeIds) ? payload.targetNodeIds : []),
            ...(Array.isArray(payload.nodeIds) ? payload.nodeIds : []),
            ...(Array.isArray(payload.ids) ? payload.ids : []),
            payload.targetNodeId,
            payload.nodeId,
            payload.target,
            payload.id,
          ].filter(Boolean);
          const targetNodeIds = [...new Set(rawTargets
            .map(value => resolveCanvasConnectionNodeId(String(value || '')))
            .filter(Boolean))];
          if (payload.all !== true && targetNodeIds.length === 0) {
            detail.resolve?.({ ok: false, code: 'DELETE_TARGET_REQUIRED' });
            return;
          }

          if (actorNodeId) {
            const response = await executeRuntimeNodeAction(
              actorNodeId,
              intent === 'graph.deleteNodes' || payload.all === true ? 'agent.deleteNodes' : 'agent.deleteNode',
              {
                ...payload,
                ...(targetNodeIds.length ? { targetNodeIds } : {}),
                actorNodeId,
              },
            );
            const result = response.result && typeof response.result === 'object'
              ? response.result as { deletedNodeIds?: string[]; skippedNodeIds?: string[]; errors?: unknown[] }
              : {};
            const deletedNodeIds = Array.isArray(result.deletedNodeIds) ? result.deletedNodeIds : [];
            const skippedNodeIds = Array.isArray(result.skippedNodeIds) ? result.skippedNodeIds : [];
            const operation = noteWorkflowOperation(
              operationFromRuntimeResponse(response, intent, {
                actor: { type: 'agent', nodeId: actorNodeId },
                targetNodeIds: [...deletedNodeIds, ...skippedNodeIds, ...targetNodeIds],
              }),
              intent,
            );
            invalidateApiCache('/api/workflow/nodes');
            invalidateApiCache('/api/a2a/snapshot');
            reloadRef.current(true).catch(() => {});
            await waitForUiFrames(2);
            detail.resolve?.({ ok: response.ok, intent, deletedNodeIds, skippedNodeIds, errors: result.errors || [], operation, settled: true });
            return;
          }

          const deleteCandidates = payload.all === true
            ? canvasNodes.map(node => node.id)
            : targetNodeIds.map(id => canvasIdForOperationNode(canvasNodes, id));
          const deletedNodeIds: string[] = [];
          const skippedNodeIds: string[] = [];
          for (const canvasId of deleteCandidates) {
            const node = canvasNodeById.get(canvasId);
            if (!node || !canDeleteNode(node)) {
              skippedNodeIds.push(canvasId);
              continue;
            }
            await deleteNode(canvasId);
            deletedNodeIds.push(node.graphNodeId || node.id);
          }
          const operation = noteWorkflowOperation(
            createLocalOperation(intent, {
              actor: { type: 'browser' },
              targetNodeIds: [...deletedNodeIds, ...skippedNodeIds],
            }),
            intent,
          );
          await waitForUiFrames(2);
          detail.resolve?.({ ok: true, intent, deletedNodeIds, skippedNodeIds, operation, settled: true });
          return;
        }

        if (intent === 'graph.moveNode') {
          const targetNodeId = resolveCanvasConnectionNodeId(String(payload.targetNodeId || payload.nodeId || payload.id || ''));
          const position = normalizePosition(payload.position);
          if (!targetNodeId || !position) {
            detail.resolve?.({ ok: false, code: 'MOVE_TARGET_REQUIRED', targetNodeId });
            return;
          }
          let response: unknown = null;
          if (actorNodeId) {
            response = await executeRuntimeNodeAction(actorNodeId, 'agent.moveNode', { ...payload, targetNodeId, position });
          } else {
            updateGraph({
              positions: {
                ...graphStateRef.current.positions,
                [targetNodeId]: position,
              },
            });
          }
          const operation = noteWorkflowOperation(
            operationFromRuntimeResponse(response, intent, {
              actor: actorNodeId ? { type: 'agent', nodeId: actorNodeId } : { type: 'browser' },
              targetNodeIds: [targetNodeId],
              edgeIds: [],
            }),
            intent,
          );
          await waitForUiFrames(2);
          // The graph-map PUT is trailing-debounced to coalesce drag gestures; a
          // discrete browser intent must commit before it resolves (W18 parity).
          await graphPutFlushRef.current?.();
          detail.resolve?.({ ok: true, intent, nodeId: targetNodeId, position, operation, settled: true });
        }
      })()
        .catch(error => detail.reject?.(error));
    };
    window.addEventListener('harness:wf-browser:intent', handleWfBrowserIntent);
    return () => window.removeEventListener('harness:wf-browser:intent', handleWfBrowserIntent);
  }, [applyRuntimeEdgeLocally, canvasNodeById, canvasNodes, deleteNode, noteWorkflowOperation, removeRuntimeEdgeLocally, resolveCanvasConnectionNodeId, updateGraph]);

  const openPaneMenu = useCallback((event: ReactMouseEvent | globalThis.MouseEvent) => {
    event.preventDefault();
    const isContextMenu = event.type === 'contextmenu';
    if ((!isContextMenu && canvasControlGestureGuardActive()) || shouldIgnoreCanvasPaneEvent(event)) {
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
    setContextMenu({
      x: point.x,
      y: point.y,
      flowX: flowPosition.x,
      flowY: flowPosition.y,
    });
  }, [canvasControlGestureGuardActive, nodeClipboard?.items.length]);

  useEffect(() => {
    if (loading) return undefined;
    const handleContextMenu = (event: MouseEvent) => {
      const wrapper = flowWrapperRef.current;
      const targetNode = event.target instanceof Node ? event.target : null;
      if (!wrapper || !targetNode || !wrapper.contains(targetNode)) return;
      if (!shouldOpenCanvasContextMenu(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      openPaneMenu(event);
    };
    document.addEventListener('contextmenu', handleContextMenu, true);
    return () => document.removeEventListener('contextmenu', handleContextMenu, true);
  }, [loading, openPaneMenu]);

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
    const nodeElement = target?.closest<HTMLElement>('[data-testid="workflow-node"], [data-testid="workflow-node-terminal"], [data-testid="workflow-component-node"], [data-testid="workflow-event-node"], [data-testid="workflow-capability-node"], [data-testid="workflow-goal-node"]');
    const nodeKey = nodeElement?.getAttribute('data-node-id') || '';
    const node = canvasNodeById.get(nodeKey) || canvasNodes.find(item => item.graphNodeId === nodeKey) || null;
    if (node) {
      openNodeMenuAt(event, node.id);
      return;
    }
    if (shouldOpenCanvasContextMenu(event.target)) {
      openPaneMenu(event);
    }
  }, [canvasNodeById, canvasNodes, openPaneMenu]);

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
    const workflowNode = node.data.workflowNode;
    if (isComponentNode(workflowNode) && componentTypeFromNode(workflowNode) === 'file') {
      // File nodes open the portal-rendered WorkflowFileBigView instead of the
      // in-card fullscreen. (Also reached via the document capture-phase
      // dblclick listener for file nodes, because WorkflowComponentNode stops
      // propagation of its own dblclick.)
      setShowConfig(false);
      setExpandedRuntimeNode(null);
      setFileBigViewNodeId(node.id);
      return;
    }
    if (isComponentNode(workflowNode) && componentTypeFromNode(workflowNode) === 'display') {
      // Display nodes open the portal-rendered WorkflowDisplayView (iframe
      // report renderer) instead of the in-card fullscreen.
      setShowConfig(false);
      setExpandedRuntimeNode(null);
      setDisplayViewRequest({ nodeId: node.id, title: 'Report' });
      return;
    }
    if (isComponentNode(workflowNode)) {
      setShowConfig(false);
      setExpandedRuntimeNode(null);
      setComponentFullscreenRequest({ nodeId: node.id, nonce: Date.now() });
      return;
    }
    if (eventTypeFromNode(workflowNode) === 'timer') {
      setShowConfig(false);
      setExpandedRuntimeNode({ nodeId: node.id, kind: 'timer', nonce: Date.now() });
      return;
    }
    if (isGoalNode(workflowNode)) {
      setShowConfig(false);
      setExpandedRuntimeNode({ nodeId: node.id, kind: 'goal', nonce: Date.now() });
      return;
    }
    if (isCapabilityNode(workflowNode) && capabilityTypeFromNode(workflowNode) === 'skill-group') {
      setShowConfig(false);
      setExpandedRuntimeNode(null);
      setSkillsOverlay({ open: true, mode: 'group', groupNodeId: node.id });
      return;
    }
    if (isAgentNode(workflowNode)) {
      // Agent double-click ALWAYS opens the floating TerminalDrawer via
      // onSelectSession and NEVER toggles in-canvas terminal mode. Explicit
      // `workflow-open-terminal` buttons remain the only terminal-mode toggles.
      const ownSessionId = workflowNode?.sessionId || '';
      const resolvedSessionId = ownSessionId
        || workflow?.sessions?.find(session => (
          String(session?.graphNodeId || '') === String(workflowNode?.graphNodeId || workflowNode?.id || '')
        ))?.sessionId
        || '';
      setShowConfig(false);
      setExpandedRuntimeNode(null);
      if (resolvedSessionId) onSelectSession(resolvedSessionId);
      return;
    }
    if (workflowNode?.sessionId) {
      setShowConfig(false);
      setExpandedRuntimeNode(null);
      onSelectSession(workflowNode.sessionId);
      return;
    }
    setExpandedRuntimeNode(null);
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

  const runTidyLayout = useCallback(async () => {
    if (tidyLayoutBusy) return;
    const mainAgent = canvasNodes.find(isMainAgentNode);
    if (!mainAgent) {
      setError(t('No main agent node to act on'));
      return;
    }
    const actorNodeId = mainAgent.graphNodeId || mainAgent.id;
    setTidyLayoutBusy(true);
    try {
      const sizes: Record<string, { w: number; h: number }> = {};
      for (const node of canvasNodes) {
        const key = node.graphNodeId || node.id;
        const size = displayedNodeSize(node, nodeModes, flowNodeVisualSizesRef.current);
        // Server contract (W1-pinned): sizes are {w,h} — {width,height} keys
        // are dropped by the tidy branch (server.mjs reads size?.w/.h).
        sizes[key] = { w: size.width, h: size.height };
      }
      const data = await executeRuntimeNodeAction(actorNodeId, 'agent.layout', { mode: 'agent-tree', sizes });
      const positions = (data as unknown as { positions?: Record<string, GraphPosition> }).positions;
      if (!positions || Object.keys(positions).length === 0) {
        setError(t('Tidy layout failed'));
        return;
      }
      updateGraph({ positions: { ...graphStateRef.current.positions, ...positions } });
      // Explicitly apply the new positions to the ReactFlow nodes state —
      // updateGraph only persists graph state; without this the canvas never
      // visually moves. Same code path the drag/dock commit uses (:4566):
      // setNodes(current => current.map(node => node.id === x ? { ...node, position } : node)),
      // with the node.id||graphNodeId keying convention (graphState keyed by
      // canvas id, server positions keyed by graph nodeId).
      setNodes(current => current.map(node => {
        const pos = positions[node.id] ?? (node.data.workflowNode?.graphNodeId
          ? positions[node.data.workflowNode.graphNodeId]
          : undefined);
        return pos ? { ...node, position: { x: pos.x, y: pos.y } } : node;
      }));
      // Defer the fit until React Flow has applied the new positions, so the
      // fit uses post-update bounds (same pattern as the terminal-mode fit).
      requestAnimationFrame(() => resetView());
    } catch (e: any) {
      setError(e?.message || t('Tidy layout failed'));
    } finally {
      setTidyLayoutBusy(false);
    }
  }, [canvasNodes, nodeModes, resetView, setError, t, tidyLayoutBusy, updateGraph]);

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

  // Node communications panel (user D-H): the selected node's mailbox flow via
  // agent.readMessages, read per peer (peer filtering is optional — without a
  // peer the action requires a requestId/wakeup filter, so per-peer reads keep
  // the panel a plain "all conversations" list). Only Agent nodes own a
  // mailbox; non-agent targets show the empty state.
  const loadCommMessages = useCallback(async (nodeId: string) => {
    const target = canvasNodeById.get(nodeId) || canvasNodes.find(node => node.id === nodeId) || null;
    setCommPanelLoading(true);
    setCommPanelError('');
    try {
      if (!target || !isAgentNode(target)) {
        setCommEntries([]);
        return;
      }
      const readerNodeId = target.graphNodeId || target.id;
      if (!readerNodeId) {
        setCommEntries([]);
        return;
      }
      const peers = canvasNodes.filter(node => node.id !== target.id && isAgentNode(node));
      const collected: CommMessageEntry[] = [];
      await Promise.all(peers.map(async peer => {
        const peerNodeId = peer.graphNodeId || peer.id;
        if (!peerNodeId) return;
        try {
          const body = await apiJson<{ result?: { entries?: CommMessageEntry[] } }>(
            `/api/workflow/nodes/${encodeURIComponent(readerNodeId)}/actions/agent.readMessages`,
            { method: 'POST', body: JSON.stringify({ peer: peerNodeId, limit: 100 }) },
          );
          if (Array.isArray(body?.result?.entries)) collected.push(...body.result.entries);
        } catch {
          // per-peer mailbox read failure is non-fatal (mirrors the audit panel)
        }
      }));
      collected.sort((a, b) => {
        const tsA = String(a.ts || '');
        const tsB = String(b.ts || '');
        return tsA === tsB ? (Number(a.seq) || 0) - (Number(b.seq) || 0) : tsA.localeCompare(tsB);
      });
      setCommEntries(collected);
    } catch (e: any) {
      setCommEntries([]);
      setCommPanelError(e?.message || t('Failed to load messages'));
    } finally {
      setCommPanelLoading(false);
    }
  }, [canvasNodeById, canvasNodes, t]);

  const openCommPanelForNode = useCallback((nodeId: string) => {
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setBridgePanel(null);
    setShowConfig(false);
    setExpandedRuntimeNode(null);
    setCommPanelNodeId(current => current === nodeId ? current : nodeId);
    loadCommMessages(nodeId);
  }, [loadCommMessages]);

  const openBridgePanel = useCallback((event: ReactMouseEvent | globalThis.MouseEvent, edge: FlowEdge) => {
    event.stopPropagation();
    const bounds = flowWrapperRef.current?.getBoundingClientRect();
    const sourceNode = canvasNodeById.get(edge.source);
    const targetNode = edge.target ? canvasNodeById.get(edge.target) : null;
    const fromSessionId = edge.data?.fromSessionId || sourceNode?.sessionId || '';
    const toSessionId = edge.data?.toSessionId || targetNode?.sessionId || '';
    const sourceHandle = edge.sourceHandle || (typeof edge.data?.sourceHandle === 'string' ? edge.data.sourceHandle : null);
    const targetHandle = edge.targetHandle || (typeof edge.data?.targetHandle === 'string' ? edge.data.targetHandle : null);
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
      label: bridgeDisplayLabel(
        typeof edge.data?.relation === 'string' ? edge.data.relation : typeof edge.label === 'string' ? edge.label : 'wf-bridge',
        sourceHandle,
        targetHandle,
        t,
      ),
    };
    setContextMenu(null);
    setNodeContextMenu(null);
    setCreatePanel(null);
    setShowConfig(false);
    setSelectedNodeId(current => current ? '' : current);
    setSelectedNodeIds(current => current.size === 0 ? current : new Set());
    setSelectedEdgeIds(current => {
      const next = new Set([edge.id]);
      return sameStringSet(current, next) ? current : next;
    });
    setBridgePanel(panel);
    loadBridgeMessages(panel);
  }, [canvasNodeById, loadBridgeMessages, t]);

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
  const visibleManualEdges = useMemo(
    () => manualEdges.filter(edge => !isCapsuleDockedEdge(edge, graphState.capsuleDockLinks)),
    [graphState.capsuleDockLinks, manualEdges],
  );
  const labelCompaction = useMemo(
    () => compactBridgeLabels(visibleManualEdges, selectedEdgeIds, canvasNodeById, viewportZoom, activeAgentControl),
    [activeAgentControl, canvasNodeById, selectedEdgeIds, viewportZoom, visibleManualEdges],
  );
  const edges = useMemo(
    () => {
      // Routing context from the CURRENT node rects: edges route through the
      // free gutters between node bands and dogleg around blockers.
      const routing = edgeRoutingFromNodes(canvasNodeById, nodeModes, flowNodeVisualSizesRef.current);
      return visibleManualEdges.map(edge => styleManualEdge(edge, selectedEdgeIds, t, canvasNodeById, visibleManualEdges, edgeCallbacks, viewportZoom, activeAgentControl, labelCompaction, routing));
    },
    [activeAgentControl, canvasNodeById, edgeCallbacks, labelCompaction, nodeModes, selectedEdgeIds, t, viewportZoom, visibleManualEdges],
  );

  const copyBridgeMessages = useCallback(() => {
    if (!bridgePanel) return;
    const lines = bridgeMessages.map(entry => {
      const direction = `${shortId(entry.fromSessionId)} -> ${shortId(entry.toSessionId)}`;
      return `[${entry.seq || ''}] ${entry.ts || ''} ${direction}\n${String(entry.data || '').trimEnd()}`;
    });
    navigator.clipboard?.writeText([
      `${bridgePanel.label}: ${bridgePanel.fromSessionId} <-> ${bridgePanel.toSessionId}`,
      ...lines,
    ].join('\n\n')).catch(() => {});
  }, [bridgeMessages, bridgePanel]);

  const nodeContextTarget = nodeContextMenu ? resolveCanvasNode(nodeContextMenu.nodeId) : null;
  const nodeContextSelection = nodeContextMenu
    ? (selectedNodeIds.has(nodeContextMenu.nodeId) ? [...selectedNodeIds] : [nodeContextMenu.nodeId])
    : [];
  const nodeContextCanDelete = nodeContextSelection.length > 0
    && nodeContextSelection.every(nodeId => canRequestDeleteNode(resolveCanvasNode(nodeId)));
  const workflowToast = error
    ? {
        id: 'workflow-error',
        message: error,
        kind: 'error' as const,
        durationMs: 0,
        dedupeKey: 'workflow-error',
        createdAt: 0,
      }
    : statusToast;
  const workflowToastMessage = workflowToast?.message || '';
  const workflowToastKind = workflowToast?.kind || 'status';
  const workflowToastIsError = workflowToastKind === 'error';
  const dismissWorkflowToast = () => {
    if (workflowToastIsError) {
      setError(null);
      return;
    }
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setStatusToast(null);
  };
  const renderSkillsHubPanel = () => {
    if (!capabilityHub || capabilityHub.kind !== 'skills') return null;
    const targetGroupNode = capabilityHubTargetCapability && capabilityTypeFromNode(capabilityHubTargetCapability) === 'skill-group'
      ? capabilityHubTargetCapability
      : null;
    const targetGroupState = (targetGroupNode as CanvasNode | null)?.capabilityState;
    const targetGroupId = targetGroupNode?.graphNodeId || targetGroupNode?.id || '';
    const groupSkillNames = targetGroupState?.skillNames?.length
      ? targetGroupState.skillNames
      : (targetGroupState?.skills || []).map(skill => skill.name).filter(Boolean);
    const connectedAgents = targetGroupId
      ? manualEdges
          .map(edge => {
            const source = String(edge.source || '');
            const target = String(edge.target || '');
            const matchesSource = source === targetGroupId || source === targetGroupNode?.id;
            const matchesTarget = target === targetGroupId || target === targetGroupNode?.id;
            const peerId = matchesSource ? target : matchesTarget ? source : '';
            return peerId ? (canvasNodeById.get(peerId) || resolveCanvasNode(peerId)) : null;
          })
          .filter((node): node is CanvasNode => Boolean(node && isAgentNode(node)))
      : [];

    return (
      <>
        <div className="workflow-skills-hub-tabs" role="tablist" aria-label={t('Skills Hub sections')}>
          {(['installed', 'market', 'groups'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              data-testid="workflow-skills-hub-tab"
              data-tab={tab}
              aria-selected={skillsHubTab === tab ? 'true' : 'false'}
              onClick={() => setSkillsHubTab(tab)}
            >
              {tab === 'installed' ? t('Installed') : tab === 'market' ? t('Market') : t('Groups')}
            </button>
          ))}
        </div>

        {targetGroupState && (
          <div data-testid="workflow-skill-group-workbench" data-node-id={targetGroupId} className="workflow-skill-group-workbench">
            <div className="workflow-skill-group-workbench-title">
              <strong>{targetGroupState.title || targetGroupNode?.label || t('Skill Group')}</strong>
              <button type="button" data-testid="workflow-skills-update-group" onClick={() => setSkillsHubTab('market')}>
                <Download size={12} /> {t('Add pack')}
              </button>
            </div>
            <div className="workflow-skill-group-grid">
              <section data-testid="workflow-skill-group-section" data-section="skills">
                <span>{t('Skills')}</span>
                <strong>{targetGroupState.skillCount ?? groupSkillNames.length}</strong>
                <small>{groupSkillNames.slice(0, 4).join(', ') || t('empty')}</small>
              </section>
              <section data-testid="workflow-skill-group-section" data-section="agents">
                <span>{t('Agents')}</span>
                <strong>{connectedAgents.length}</strong>
                {connectedAgents.slice(0, 3).map(agent => (
                  <small key={agent.id} data-testid="workflow-skill-group-agent-row">{agent.label || agent.id}</small>
                ))}
              </section>
              <section data-testid="workflow-skill-group-section" data-section="policy">
                <span>{t('Policy')}</span>
                <strong>{targetGroupState.loadStrategy || 'group-summary'}</strong>
                <small>{targetGroupState.lockRef || targetGroupState.sourceGroup?.id || t('local')}</small>
              </section>
              <section data-testid="workflow-skill-group-section" data-section="context-preview">
                <span>{t('Context')}</span>
                <code data-testid="workflow-skill-group-context-preview">
                  {JSON.stringify({
                    groupId: targetGroupState.sourceGroup?.id || '',
                    category: targetGroupState.category || targetGroupState.sourceGroup?.kind || 'skills',
                    skillNames: groupSkillNames,
                    lockRef: targetGroupState.lockRef || '',
                  })}
                </code>
              </section>
            </div>
          </div>
        )}

        {skillsHubTab === 'installed' && (
          <div data-testid="workflow-skills-hub-panel" data-tab="installed" className="workflow-skills-hub-panel">
            <div data-testid="workflow-capability-hub-summary" className="workflow-capability-hub-summary">
              <span>{skillsHubLoading ? t('Loading...') : t('Skills')}</span>
              <strong>{skillsHub?.summary.skillCount ?? 0}</strong>
              <span>{t('Sources')}</span>
              <strong>{skillsHub?.summary.sourceCount ?? 0}</strong>
            </div>
            {skillsHubError && <div className="workflow-capability-hub-error">{skillsHubError}</div>}
            <div className="workflow-capability-hub-groups">
              {(skillsHub?.groups || []).slice(0, 4).map(group => (
                <button
                  type="button"
                  key={group.id}
                  data-testid="workflow-capability-hub-group"
                  data-group-id={group.id}
                  data-skill-count={group.skillIds.length}
                  title={group.skillIds.map(skillId => skillsById.get(skillId)?.name || skillId).join(', ')}
                  disabled={capabilityHubBusyGroupId === group.id || group.skillIds.length === 0}
                  onClick={() => createSkillGroupNode(group)}
                >
                  <Boxes size={12} />
                  <span>{t(group.label)} / {group.skillIds.length}</span>
                  <span data-testid="workflow-capability-create-node">
                    {capabilityHubBusyGroupId === group.id ? t('Creating') : t('Create pack')}
                  </span>
                </button>
              ))}
            </div>
            <div className="workflow-capability-hub-list">
              {(skillsHub?.skills || []).map(skill => {
                const skillName = String(skill.name || skill.id.replace(/^skill:/, '')).trim();
                const attached = Boolean(capabilityHubTargetAgent && skillsForNode(capabilityHubTargetAgent).includes(skillName));
                const busy = capabilityHubBusySkillId === skill.id;
                const attachDisabled = !capabilityHubTargetAgent || attached || busy || skill.attachable === false;
                return (
                  <div
                    key={skill.id}
                    data-testid="workflow-capability-hub-item"
                    data-skill-id={skill.id}
                    data-skill-name={skill.name}
                    data-skill-state={skill.state}
                    data-skill-semantics={skill.nodeSemantics}
                    data-attached={attached ? 'true' : 'false'}
                    className="workflow-capability-hub-item"
                  >
                    <div className="workflow-capability-hub-item-main">
                      <strong>{skill.title || skill.name}</strong>
                      <span>{skill.description || skill.name}</span>
                      <small>{skill.sources.map(source => source.path).join(' - ')}</small>
                    </div>
                    <button
                      type="button"
                      data-testid="workflow-capability-attach"
                      disabled={attachDisabled}
                      title={capabilityHubTargetAgent ? t('Attach skill to selected Agent') : t('Open from an Agent node to attach')}
                      onClick={() => attachSkillToTargetAgent(skill)}
                    >
                      {busy ? t('Attaching') : attached ? t('Attached') : t('Attach')}
                    </button>
                  </div>
                );
              })}
              {!skillsHubLoading && !skillsHubError && (skillsHub?.skills || []).length === 0 && (
                <div className="workflow-capability-hub-empty">{t('No skills found')}</div>
              )}
            </div>
          </div>
        )}

        {skillsHubTab === 'market' && (
          <div data-testid="workflow-skills-hub-panel" data-tab="market" className="workflow-skills-hub-panel">
            <div data-testid="workflow-capability-hub-summary" className="workflow-capability-hub-summary">
              <span>{skillsMarketLoading ? t('Loading...') : t('Packs')}</span>
              <strong>{skillsMarket?.summary.packCount ?? 0}</strong>
              <span>{t('Installed')}</span>
              <strong>{skillsMarket?.summary.installedPackCount ?? 0}</strong>
            </div>
            <label className="workflow-skills-install-target">
              <span>{t('Target')}</span>
              <select
                data-testid="workflow-skills-install-target"
                value={skillsMarketInstallTarget}
                onChange={event => setSkillsMarketInstallTarget(event.target.value)}
              >
                {(skillsMarket?.installTargets || skillsHub?.installTargets || []).map(target => (
                  <option key={target.id} value={target.id}>{target.label} - {target.path}</option>
                ))}
              </select>
            </label>
            {skillsMarketError && <div className="workflow-capability-hub-error">{skillsMarketError}</div>}
            <div className="workflow-capability-hub-list">
              {(skillsMarket?.packs || []).map((pack: WorkflowSkillsMarketPack) => {
                const busy = skillsMarketBusyPackId === (pack.id || pack.slug);
                const installDisabled = busy || !pack.installable || (pack.installed && !targetGroupState);
                return (
                  <div
                    key={pack.id || pack.slug}
                    data-testid="workflow-skills-pack-row"
                    data-provider={pack.provider}
                    data-pack-slug={pack.packSlug || pack.slug}
                    data-installed={pack.installed ? 'true' : 'false'}
                    data-skill-count={pack.skillCount}
                    data-lock-ref={pack.lockRef || ''}
                    className="workflow-capability-hub-item workflow-skills-pack-row"
                  >
                    <div className="workflow-capability-hub-item-main">
                      <strong>{pack.name || pack.slug}</strong>
                      <span data-testid="workflow-skills-pack-detail">
                        {[pack.category, `${pack.skillCount} ${t('skills')}`, pack.installCount ? `${pack.installCount} ${t('installs')}` : ''].filter(Boolean).join(' - ')}
                      </span>
                      <small>{pack.description || pack.slug}</small>
                    </div>
                    <button
                      type="button"
                      data-testid="workflow-skills-install-pack"
                      data-install-state={busy ? 'installing' : pack.installed ? 'installed' : 'ready'}
                      disabled={installDisabled}
                      onClick={() => installSkillsPackFromMarket(pack)}
                    >
                      {busy ? t('Installing') : targetGroupState ? t('Add') : pack.installed ? t('Installed') : t('Install')}
                    </button>
                  </div>
                );
              })}
              {!skillsMarketLoading && !skillsMarketError && (skillsMarket?.packs || []).length === 0 && (
                <div className="workflow-capability-hub-empty">{t('No packs found')}</div>
              )}
            </div>
          </div>
        )}

        {skillsHubTab === 'groups' && (
          <div data-testid="workflow-skills-hub-panel" data-tab="groups" className="workflow-skills-hub-panel">
            <div data-testid="workflow-capability-hub-summary" className="workflow-capability-hub-summary">
              <span>{skillsHubLoading ? t('Loading...') : t('Groups')}</span>
              <strong>{skillsHub?.summary.groupCount ?? 0}</strong>
              <span>{t('Skills')}</span>
              <strong>{skillsHub?.summary.skillCount ?? 0}</strong>
            </div>
            {skillsHubError && <div className="workflow-capability-hub-error">{skillsHubError}</div>}
            <div className="workflow-capability-hub-list">
              {(skillsHub?.groups || []).map(group => (
                <div
                  key={group.id}
                  data-testid="workflow-skills-pack-row"
                  data-provider="local"
                  data-pack-slug={group.id}
                  data-installed="true"
                  data-skill-count={group.skillIds.length}
                  data-lock-ref=""
                  className="workflow-capability-hub-item workflow-skills-pack-row"
                >
                  <div className="workflow-capability-hub-item-main">
                    <strong>{t(group.label)}</strong>
                    <span data-testid="workflow-skills-pack-detail">{[group.kind, `${group.skillIds.length} ${t('skills')}`].filter(Boolean).join(' - ')}</span>
                    <small>{group.skillIds.map(skillId => skillsById.get(skillId)?.name || skillId).join(', ')}</small>
                  </div>
                  <button
                    type="button"
                    data-testid="workflow-skills-create-group"
                    disabled={capabilityHubBusyGroupId === group.id || group.skillIds.length === 0}
                    onClick={() => createSkillGroupNode(group)}
                  >
                    {capabilityHubBusyGroupId === group.id ? t('Creating') : t('Create')}
                  </button>
                </div>
              ))}
              {!skillsHubLoading && !skillsHubError && (skillsHub?.groups || []).length === 0 && (
                <div className="workflow-capability-hub-empty">{t('No groups found')}</div>
              )}
            </div>
          </div>
        )}
      </>
    );
  };
  const handleNodeContextAction = (action: string) => {
    if (!nodeContextMenu) return;
    const selection = nodeContextSelection.length > 0 ? nodeContextSelection : [nodeContextMenu.nodeId];
    if (action === 'settings' || action === 'open-config') {
      openConfigForNode(nodeContextMenu.nodeId);
      return;
    }
    if (action === 'skills-hub') {
      const target = resolveCanvasNode(nodeContextMenu.nodeId);
      if (!target || !isAgentNode(target)) return;
      openCapabilityHub('skills', 'agent-menu', target.graphNodeId || target.id, {
        x: target.x + (target.width || CARD_NODE_W) + 80,
        y: target.y,
      });
      return;
    }
    if (action === 'mcp-hub') {
      const target = resolveCanvasNode(nodeContextMenu.nodeId);
      if (!target || !isAgentNode(target)) return;
      openCapabilityHub('mcp', 'agent-menu', target.graphNodeId || target.id, {
        x: target.x + (target.width || CARD_NODE_W) + 80,
        y: target.y + 84,
      });
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
      requestDeleteNodes(selection);
    }
  };

  // File node double-click opens the portal-rendered WorkflowFileBigView. The
  // document capture-phase listener is required because WorkflowComponentNode
  // stops propagation of its own dblclick for all resource kinds.
  useEffect(() => {
    if (loading || fileBigViewNodeId || displayViewRequest) return undefined;
    const handleFileNodeDblClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const fileElement = target?.closest<HTMLElement>('[data-testid="workflow-component-node"][data-component-type="file"]');
      const displayElement = target?.closest<HTMLElement>('[data-testid="workflow-component-node"][data-component-type="display"]');
      const nodeElement = fileElement || displayElement;
      if (!nodeElement) return;
      const nodeKey = nodeElement.getAttribute('data-node-id') || '';
      const node = canvasNodeById.get(nodeKey) || canvasNodes.find(item => item.graphNodeId === nodeKey) || null;
      if (!node) return;
      event.preventDefault();
      event.stopPropagation();
      setShowConfig(false);
      setExpandedRuntimeNode(null);
      if (displayElement) {
        setDisplayViewRequest({ nodeId: node.id, title: displayNodeTitle(node) || 'Report' });
      } else {
        setFileBigViewNodeId(node.id);
      }
    };
    document.addEventListener('dblclick', handleFileNodeDblClick, true);
    return () => document.removeEventListener('dblclick', handleFileNodeDblClick, true);
  }, [canvasNodeById, canvasNodes, displayViewRequest, fileBigViewNodeId, loading]);

  const skillsOverlayGroupNode = useMemo(() => {
    if (skillsOverlay.mode !== 'group' || !skillsOverlay.groupNodeId) return null;
    return canvasNodeById.get(skillsOverlay.groupNodeId) || null;
  }, [canvasNodeById, skillsOverlay.groupNodeId, skillsOverlay.mode]);

  const skillsOverlayGroup = useMemo((): WorkflowSkillsOverlayGroup | undefined => {
    if (!skillsOverlayGroupNode) return undefined;
    const state = skillsOverlayGroupNode.capabilityState;
    const rawSkills = Array.isArray(state?.skills) ? state.skills : [];
    const skills: WorkflowSkillsOverlaySkill[] = rawSkills.map(raw => {
      const skill = raw as { id?: string; name: string; title?: string; enabled?: boolean };
      const skillId = String(skill.id || skill.name || '').trim();
      return {
        id: skillId,
        name: String(skill.name || skillId),
        title: skill.title || skill.name || skillId,
        enabled: skillsOverlaySkillEnabledOverride[skillId] ?? skill.enabled ?? true,
      };
    });
    return {
      nodeId: skillsOverlayGroupNode.id,
      groupId: String(state?.sourceGroup?.id || skillsOverlayGroupNode.graphNodeId || skillsOverlayGroupNode.id),
      label: state?.title || skillsOverlayGroupNode.label || 'Skill Group',
      category: state?.category,
      tags: state?.tags,
      skillCount: Number(state?.skillCount ?? skills.length),
      loadStrategy: state?.loadStrategy,
      lockRef: state?.lockRef,
      skills,
    };
  }, [skillsOverlayGroupNode, skillsOverlaySkillEnabledOverride]);

  const skillsOverlayAgents = useMemo((): WorkflowSkillsOverlayAgent[] => {
    const group = skillsOverlayGroupNode;
    if (!group) return [];
    const groupKeys = new Set([group.graphNodeId, group.id, group.sessionId].filter(Boolean).map(String));
    const peers = new Map<string, WorkflowNode>();
    for (const edge of graphState.edges) {
      const sourceKey = String(edge.source || edge.from || '');
      const targetKey = String(edge.target || edge.to || '');
      const sourceIsGroup = groupKeys.has(sourceKey);
      const targetIsGroup = groupKeys.has(targetKey);
      if (!sourceIsGroup && !targetIsGroup) continue;
      const peerKey = sourceIsGroup ? targetKey : sourceKey;
      if (!peerKey || groupKeys.has(peerKey)) continue;
      const peer = canvasNodeById.get(peerKey)
        || canvasNodes.find(node => String(node.graphNodeId || node.id) === peerKey);
      if (peer && isAgentNode(peer)) peers.set(peer.id, peer);
    }
    return [...peers.values()].map(node => ({ nodeId: node.id, label: node.label || node.id }));
  }, [canvasNodeById, canvasNodes, graphState.edges, skillsOverlayGroupNode]);

  const skillsOverlayHub = useMemo((): WorkflowSkillsOverlayHub | undefined => (
    skillsOverlay.mode === 'hub'
      ? { tabs: ['installed', 'market', 'groups'], activeTab: skillsHubTab, installTargets: [skillsMarketInstallTarget] }
      : undefined
  ), [skillsHubTab, skillsMarketInstallTarget, skillsOverlay.mode]);

  const skillsOverlaySkills = useMemo((): WorkflowSkillsOverlaySkill[] => (
    (skillsHub?.skills || []).map(skill => ({
      id: skill.id,
      name: skill.name || skill.id.replace(/^skill:/, ''),
      title: skill.title || skill.name || skill.id,
    }))
  ), [skillsHub]);

  const skillsOverlayPacks = useMemo((): WorkflowSkillsOverlayPack[] => (
    (skillsMarket?.packs || []).map(pack => ({
      packSlug: pack.packSlug || pack.slug,
      name: pack.name,
      description: pack.description,
      category: pack.category,
      skillCount: pack.skillCount,
      installed: pack.installed,
      installable: pack.installable,
    }))
  ), [skillsMarket]);

  const skillsOverlayGroups = useMemo((): WorkflowSkillsOverlayGroupRow[] => (
    (skillsHub?.groups || []).map(group => ({
      id: group.id,
      label: group.label,
      category: group.kind,
      skillCount: group.skillIds.length,
    }))
  ), [skillsHub]);

  const canvasNodesRef = useRef(canvasNodes);
  canvasNodesRef.current = canvasNodes;

  const handleSkillsOverlaySetSkillEnabled = useCallback(async (skillId: string, enabled: boolean) => {
    const group = skillsOverlayGroupNode;
    if (!group) return;
    try {
      const response = await executeRuntimeNodeAction(group.id, 'skill-group.setSkillEnabled', { skillId, enabled });
      const result = (response?.result || response) as {
        skills?: Array<{ id?: string; name?: string; enabled?: boolean }>;
      } | null;
      if (result && Array.isArray(result.skills)) {
        const next: Record<string, boolean> = {};
        for (const skill of result.skills) {
          if (skill.enabled === undefined) continue;
          next[String(skill.id || skill.name || '')] = skill.enabled;
        }
        setSkillsOverlaySkillEnabledOverride(current => ({ ...current, ...next }));
      }
      invalidateApiCache('/api/workflow/nodes');
      invalidateApiCache('/api/a2a/snapshot');
      alertToast({ message: enabled ? t('Skill enabled') : t('Skill disabled'), kind: 'success', durationMs: 1800, dedupeKey: `skill-enabled:${skillId}` });
    } catch (e: any) {
      alertToast({ message: e?.message || t('Failed to update skill'), kind: 'error', durationMs: 2600, dedupeKey: `skill-enabled-error:${skillId}` });
    }
  }, [alertToast, executeRuntimeNodeAction, skillsOverlayGroupNode, t]);

  const handleSkillsOverlayAttachToAgent = useCallback(async (agentNodeId: string) => {
    const group = skillsOverlayGroupNode;
    const target = canvasNodeById.get(agentNodeId) || canvasNodes.find(node => node.id === agentNodeId);
    if (!group || !target) return;
    const skillNames = uniqueStringList(
      (group.capabilityState?.skillNames || (group.capabilityState?.skills || []).map(skill => skill.name))
        .filter(Boolean),
    );
    if (skillNames.length === 0) {
      alertToast({ message: t('Skill group has no skills to attach'), kind: 'error', durationMs: 2200, dedupeKey: `skill-attach-empty:${group.id}` });
      return;
    }
    const currentSkills = skillsForNode(target);
    const nextSkills = uniqueStringList([...currentSkills, ...skillNames]);
    const graphId = target.graphNodeId || target.id;
    try {
      const result = await apiJson<NodeConfigPatchResponse>(`/api/a2a/nodes/${encodeURIComponent(graphId)}/config`, {
        method: 'PATCH',
        body: JSON.stringify({ skills: nextSkills, skillPolicy: 'manual' }),
      });
      const nextConfig = result.node?.config || { skills: nextSkills, skillPolicy: 'manual' as const };
      applyNodeConfigUpdate(target.id, nextConfig, {
        responseNodeId: result.node?.id,
        restartRequired: Boolean(result.restartRequired ?? result.node?.restartRequired ?? false),
        restartRequiredFields: result.restartRequiredFields || result.node?.restartRequiredFields,
      });
      invalidateApiCache('/api/a2a/snapshot');
      invalidateApiCache('/api/workflow/nodes');
      alertToast({ message: t('Skill group mounted to agent'), kind: 'success', durationMs: 2200, dedupeKey: `skill-attach:${target.id}:${group.id}` });
    } catch (e: any) {
      alertToast({ message: e?.message || t('Failed to mount skill group'), kind: 'error', durationMs: 2600, dedupeKey: `skill-attach-error:${target.id}:${group.id}` });
    }
  }, [alertToast, applyNodeConfigUpdate, canvasNodeById, canvasNodes, skillsOverlayGroupNode, t]);

  const handleSkillsOverlayInstallPack = useCallback(async (packSlug: string) => {
    const pack = (skillsMarket?.packs || []).find(item => (item.packSlug || item.slug) === packSlug);
    if (!pack) return;
    await installSkillsPackFromMarket(pack);
  }, [installSkillsPackFromMarket, skillsMarket]);

  const handleSkillsOverlayPickGroup = useCallback(async (groupId: string) => {
    const existing = canvasNodes.find(node => (
      isCapabilityNode(node)
      && capabilityTypeFromNode(node) === 'skill-group'
      && String(node.capabilityState?.sourceGroup?.id || '') === groupId
    ));
    if (existing) {
      setSkillsOverlay({ open: true, mode: 'group', groupNodeId: existing.id });
      return;
    }
    const group = (skillsHub?.groups || []).find(item => item.id === groupId);
    if (!group) return;
    await createSkillGroupNode(group);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 50));
      const created = canvasNodesRef.current.find(node => (
        isCapabilityNode(node)
        && capabilityTypeFromNode(node) === 'skill-group'
        && String(node.capabilityState?.sourceGroup?.id || '') === groupId
      ));
      if (created) {
        setSkillsOverlay({ open: true, mode: 'group', groupNodeId: created.id });
        return;
      }
    }
  }, [canvasNodes, createSkillGroupNode, skillsHub]);

  // When the big Skills Hub overlay opens, back it with the same hub/market
  // payloads the legacy drawer uses. Group mode only needs capability-node
  // state (already in the snapshot), so the market fetch is hub-mode only.
  // The ref guard (not the loading states) dedupes fetches so a loading-state
  // change cannot re-run this effect and cancel the in-flight request.
  const skillsOverlayFetchStateRef = useRef<{ hub: 'idle' | 'loading' | 'done'; market: 'idle' | 'loading' | 'done' }>({ hub: 'idle', market: 'idle' });
  useEffect(() => {
    if (!skillsOverlay.open) return;
    let cancelled = false;
    const fetchState = skillsOverlayFetchStateRef.current;
    if (fetchState.hub === 'idle') {
      fetchState.hub = 'loading';
      setSkillsHubLoading(true);
      setSkillsHubError('');
      fetchSkillsHub(capabilityHubSearch)
        .then(result => {
          if (cancelled) return;
          setSkillsHub(result);
          fetchState.hub = 'done';
        })
        .catch((e: any) => {
          if (cancelled) return;
          setSkillsHub(null);
          setSkillsHubError(e?.message || t('Failed to load Skills Hub'));
          fetchState.hub = 'idle';
        })
        .finally(() => { if (!cancelled) setSkillsHubLoading(false); });
    }
    if (skillsOverlay.mode === 'hub' && fetchState.market === 'idle') {
      fetchState.market = 'loading';
      setSkillsMarketLoading(true);
      setSkillsMarketError('');
      fetchSkillsMarket(capabilityHubSearch)
        .then(result => {
          if (cancelled) return;
          setSkillsMarket(result);
          fetchState.market = 'done';
          const defaultTarget = result.installTargets.find(target => target.default)?.id
            || result.installTargets[0]?.id
            || 'project-agents';
          setSkillsMarketInstallTarget(current => result.installTargets.some(target => target.id === current) ? current : defaultTarget);
        })
        .catch((e: any) => {
          if (cancelled) return;
          setSkillsMarket(null);
          setSkillsMarketError(e?.message || t('Failed to load Skills Market'));
          fetchState.market = 'idle';
        })
        .finally(() => { if (!cancelled) setSkillsMarketLoading(false); });
    }
    return () => {
      cancelled = true;
      // If the overlay closed mid-fetch, allow a future open to retry.
      const fetchState = skillsOverlayFetchStateRef.current;
      if (fetchState.hub === 'loading') fetchState.hub = 'idle';
      if (fetchState.market === 'loading') fetchState.market = 'idle';
    };
  }, [capabilityHubSearch, skillsOverlay.mode, skillsOverlay.open, t]);

  // A composition drag that hides the hub overlay but never lands on the canvas
  // (window 'dragend' without a preceding successful drop) restores it; the
  // overlay stays mounted while hidden, so the user's draft is preserved. A
  // drop clears the flag first, so drop → dragend ordering leaves the hidden
  // overlay alone until the create settles (success closes it, failure
  // restores it).
  useEffect(() => {
    const onDragEnd = () => {
      if (!skillsDraftDragActiveRef.current) return;
      skillsDraftDragActiveRef.current = false;
      setSkillsDragHideActive(false);
    };
    window.addEventListener('dragend', onDragEnd);
    return () => window.removeEventListener('dragend', onDragEnd);
  }, []);

  if (loading) return <LoadingView label={t('Loading workflow canvas')} fullCanvas />;

  return (
    <div
      ref={flowWrapperRef}
      className="wf-canvas-shell"
      data-agent-control-active={activeAgentControl?.active ? 'true' : 'false'}
      data-agent-control-operation-id={activeAgentControl?.active ? activeAgentControl.operationId : ''}
      data-skills-overlay-open={skillsOverlay.open ? 'true' : 'false'}
      style={{ height: '100%', minHeight: 0, '--agent-control-color': activeAgentControl?.color || '#22c55e' } as CSSProperties}
      onDragEnterCapture={handleCanvasDragOver}
      onDragOverCapture={handleCanvasDragOver}
      onDragOver={handleCanvasDragOver}
      onDragStartCapture={markGraphConnectionGesture}
      onDragEndCapture={finishGraphConnectionGesture}
      onDrop={handleCanvasDrop}
      onDropCapture={finishGraphConnectionGesture}
      onPaste={handleCanvasPaste}
      onPointerDownCapture={(event) => {
        if (beginMiddleCanvasPan(event)) return;
        markGraphConnectionGesture(event);
        beginComponentHeaderDrag(event);
      }}
      onPointerUpCapture={(event) => {
        finishComponentHeaderDrag(event);
        finishGraphConnectionGesture();
      }}
      onPointerCancelCapture={() => {
        cancelComponentHeaderDrag();
        finishGraphConnectionGesture();
      }}
      onMouseDownCapture={(event) => {
        if (beginMiddleCanvasPan(event)) return;
        markGraphConnectionGesture(event);
        beginComponentHeaderDrag(event);
      }}
      onMouseUpCapture={(event) => {
        finishComponentHeaderDragFromPoint(event.clientX, event.clientY);
        finishGraphConnectionGesture();
      }}
      onContextMenuCapture={openNodeMenuFromCapture}
    >
      <ReactFlow
        className={`wf-flow${selectedEdgeIds.size > 0 ? ' has-selected-edge' : ''}`}
        data-testid="workflow-canvas"
        data-wf-browser-ready={flowSettled ? 'true' : 'false'}
        data-workflow-node-count={nodes.length}
        data-workflow-edge-count={visibleManualEdges.length}
        data-agent-control-active={activeAgentControl?.active ? 'true' : 'false'}
        data-agent-control-operation-id={activeAgentControl?.active ? activeAgentControl.operationId : ''}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onDragEnter={handleCanvasDragOver}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
        onNodesChange={handleNodesChange}
        onConnect={onConnect}
        onConnectEnd={(event) => finishGraphConnectionGesture(event)}
        onSelectionChange={onSelectionChange}
        onEdgeClick={(event, edge) => selectEdge(event, edge.id)}
        onInit={(instance) => {
          flowRef.current = instance;
          const initialZoom = zoomBucket(instance.getZoom());
          setViewportZoom(initialZoom);
          viewportZoomRef.current = initialZoom;
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
          // Skip the state write on pure-pan frames: when the zoom bucket is
          // unchanged there is nothing to commit, and avoiding the setState
          // keeps pan gestures off React's reconciliation path entirely.
          if (nextZoom === viewportZoomRef.current) return;
          viewportZoomRef.current = nextZoom;
          setViewportZoom(nextZoom);
        }}
        onPaneClick={closeTransientPanelsFromPane}
        onPaneContextMenu={openPaneMenu}
        onNodeClick={selectNode}
        onNodeDoubleClick={doubleClickNode}
        onNodeContextMenu={openNodeMenu}
        onMoveStart={closeTransientPanelsForCanvasMove}
        onNodeDragStart={(_event, node) => {
          // Re-measure the dragged node so snap geometry uses its current
          // rendered size, not a stale or fallback-inflated one.
          currentNodeVisualSizes();
          capsuleDockSettleSeqRef.current += 1;
          cancelCapsuleSnapAnimation(node.id);
          closeTransientPanels();
          setCapsuleDockPreview(null);
          setSelectedEdgeIds(current => current.size === 0 ? current : new Set());
          const workflowNode = canvasNodeById.get(node.id);
          const role = capsuleRoleForNode(workflowNode);
          setCapsuleMagnetDrag(role ? { draggedId: node.id, role } : null);
        }}
        onNodeDrag={(_event, node) => {
          updateCapsuleDockPreview(node.id, { x: node.position.x, y: node.position.y });
        }}
        onNodeDragStop={(_event, node) => {
          setCapsuleDockPreview(null);
          setCapsuleMagnetDrag(null);
          const position = { x: node.position.x, y: node.position.y };
          if (capsuleRoleForNode(canvasNodeById.get(node.id))) {
            capsuleDragStopHandledRef.current.set(node.id, { position, at: Date.now() });
            void settleCapsuleDockAfterDrag(node.id, position);
            return;
          }
          updateGraph({
            positions: {
              ...graphStateRef.current.positions,
              [node.id]: position,
            },
          }, { forceCommit: isComponentNode(node.data?.workflowNode) });
          void settleCapsuleDockAfterDrag(node.id, position);
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
        connectionRadius={16}
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
              // Loading-placeholder nodes carry no workflowNode; fall back to
              // the neutral status color instead of crashing the minimap.
              nodeColor={(node) => statusColor((node.data as WfNodeData | undefined)?.workflowNode?.status)}
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

        {createPanel && (
          <WorkflowFloatingPanel
            data-testid="workflow-create-node-panel"
            className="workflow-create-node-panel"
            layer="settings"
            icon={<Plus size={14} />}
            title={createPanel.kind === 'agent' ? t('Create Agent') : createPanel.kind === 'file' ? t('Create File Node') : t('Create Node')}
            subtitle={`${Math.round(createPanel.flowX)}, ${Math.round(createPanel.flowY)}`}
            actions={(
              <>
                {createPanel.kind && (
                  <button
                    type="button"
                    className="workflow-floating-panel-button"
                    onClick={() => setCreatePanel(current => current ? { ...current, kind: null } : current)}
                    title={t('Back')}
                  >
                    {t('Back')}
                  </button>
                )}
                <button
                  type="button"
                  className="workflow-floating-panel-button"
                  onClick={() => setCreatePanel(null)}
                  title={t('Close')}
                >
                  <X size={13} /> {t('Close')}
                </button>
              </>
            )}
            bodyClassName="workflow-create-node-panel-body"
            style={{
              position: 'absolute',
              left: createPanel.x,
              top: createPanel.y,
              width: CREATE_PANEL_W,
              // Viewport-based cap (--header-h is 48px): % would resolve against
              // the flow wrapper, not the viewport, and could overflow the page.
              maxHeight: `min(${CREATE_PANEL_MAX_H}px, calc(100vh - var(--header-h) - 24px))`,
            }}
          >
            {!createPanel.kind && (
              <div className="workflow-create-node-catalog">
                <label className="workflow-create-node-search">
                  <Search size={13} />
                  <input
                    data-testid="workflow-create-node-search"
                    aria-label={t('Search nodes')}
                    value={createNodeSearch}
                    onChange={event => setCreateNodeSearch(event.target.value)}
                    placeholder={t('Search nodes')}
                  />
                </label>
                <div className="workflow-create-node-options" data-testid="workflow-create-node-options">
                  {[...createNodeGroups.entries()].map(([category, items]) => (
                    <section key={category} className="workflow-create-node-group" data-testid="workflow-create-node-group" data-node-category={category}>
                      <div className="workflow-create-node-group-label">{t(createNodeCategoryLabels[category as keyof typeof createNodeCategoryLabels] || category)}</div>
                      {items.map(option => {
                        const Icon = option.icon;
                        const missingRuntime = option.createMode === 'agent' && !currentRuntime;
                        const nodeAction = option.hub ? 'open-hub' : option.createMode ? 'create-node' : 'disabled';
                        const disabled = nodeAction === 'disabled' || (option.state !== 'ready' && nodeAction !== 'open-hub') || missingRuntime || (option.createMode === 'agent' && launchingAgent);
                        const title = nodeAction === 'open-hub'
                          ? t(option.hub === 'skills' ? 'Open Skills Hub' : 'Open MCP Hub')
                          : option.state === 'planned'
                            ? t('Planned node type')
                          : missingRuntime
                            ? t('No runtime selected')
                            : option.category === 'agent'
                              ? t('Create a thinking/runtime node')
                              : t('Create a resource node');
                        return (
                          <button
                            key={option.kind}
                            type="button"
                            data-testid="workflow-create-node-option"
                            data-node-kind={option.kind}
                            data-node-category={option.category}
                            data-node-state={option.state}
                            data-node-action={nodeAction}
                            data-node-hub={option.hub || ''}
                            data-agent-semantics={option.agentSemantics}
                            disabled={disabled}
                            title={title}
                            onClick={() => {
                              if (option.hub) {
                                openCapabilityHub(
                                  option.hub,
                                  createPanel ? 'create-panel' : 'canvas-menu',
                                  undefined,
                                  createPanel ? { x: createPanel.flowX, y: createPanel.flowY } : undefined,
                                );
                                return;
                              }
                              if (!option.createMode) return;
                              chooseCreateCatalogItem(option.createMode);
                            }}
                          >
                            <Icon size={16} />
                            <span className="workflow-create-node-option-copy">
                              <span className="workflow-create-node-option-title">
                                {t(option.label)}
                                {option.state === 'planned' && <span className="workflow-create-node-option-badge">{t('Planned')}</span>}
                              </span>
                              <span className="workflow-create-node-option-description">{t(option.description)}</span>
                              <span className="workflow-create-node-option-semantics">{t(option.agentSemantics)}</span>
                            </span>
                          </button>
                        );
                      })}
                    </section>
                  ))}
                  {createNodeGroups.size === 0 && (
                    <div data-testid="workflow-create-node-empty" className="workflow-create-node-empty">{t('No node types found')}</div>
                  )}
                </div>
              </div>
            )}

            {createPanel.kind === 'file' && (
              <div className="workflow-create-node-form" style={{ display: 'grid', gap: 8 }}>
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
              <div className="workflow-create-node-form" style={{ display: 'grid', gap: 8 }}>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Agent Kind')}
                  <select data-testid="workflow-agent-kind" value={agentKind} onChange={e => setAgentKind(e.target.value as AgentKind)}
                    style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                    <option value="main">Main Agent</option>
                    <option value="subagent">Subagent</option>
                  </select>
                </label>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Display Name')}
                  <input data-testid="workflow-create-agent-display-name" value={agentDisplayName} onChange={e => setAgentDisplayName(e.target.value)}
                    placeholder={t('optional')}
                    style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
                </label>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Role Title')}
                  <select data-testid="workflow-create-agent-role-title" value={agentRoleCustom ? CUSTOM_ROLE_TITLE : effectiveRoleTitle}
                    onChange={e => {
                      setAgentRoleCustom(e.target.value === CUSTOM_ROLE_TITLE);
                      if (e.target.value !== CUSTOM_ROLE_TITLE) setAgentRoleTitle(e.target.value);
                    }}
                    style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                    {ROLE_TITLE_PRESETS.map(role => <option key={role} value={role}>{role}</option>)}
                    <option value={CUSTOM_ROLE_TITLE}>{t('Custom...')}</option>
                  </select>
                </label>
                {agentRoleCustom && (
                  <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                    {t('Custom Role')}
                    <input data-testid="workflow-create-agent-role-title-custom" value={agentRoleTitle}
                      onChange={e => setAgentRoleTitle(e.target.value)} placeholder={t('Free-form role (e.g. architect)')}
                      style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
                  </label>
                )}
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Responsibility')}
                  <textarea data-testid="workflow-create-agent-responsibility" value={agentResponsibility}
                    onChange={e => setAgentResponsibility(e.target.value)} rows={3}
                    placeholder={t('One-paragraph mandate, plain language')}
                    style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', resize: 'vertical' }} />
                </label>
                <label style={{ fontSize: 10, color: 'var(--muted)', display: 'grid', gap: 3 }}>
                  {t('Capabilities')}
                  <input data-testid="workflow-create-agent-capabilities" value={agentCapabilities}
                    onChange={e => setAgentCapabilities(e.target.value)}
                    placeholder={t('Comma-separated, e.g. typescript, playwright')}
                    style={{ padding: '7px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} />
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
          </WorkflowFloatingPanel>
        )}

        {capabilityHub && (
          <aside
            data-canvas-control="true"
            data-testid="workflow-capability-hub-drawer"
            data-hub-kind={capabilityHub.kind}
            data-origin={capabilityHub.origin}
            data-active-tab={capabilityHub.kind === 'skills' ? skillsHubTab : ''}
            data-target-agent-id={capabilityHub.targetAgentId || ''}
            data-target-capability-id={capabilityHub.targetCapabilityId || ''}
            className="workflow-capability-hub-drawer nodrag nopan nowheel"
            onPointerDown={event => event.stopPropagation()}
          >
            <div className="workflow-capability-hub-header">
              <div>
                <div className="workflow-capability-hub-title">
                  {capabilityHub.kind === 'skills' ? t('Skills Hub') : t('MCP Hub')}
                </div>
                <div className="workflow-capability-hub-subtitle">
                  {capabilityHub.kind === 'skills'
                    ? t('Agent-attached capability providers')
                    : t('MCP connector providers')}
                </div>
              </div>
              <button
                type="button"
                data-testid="workflow-capability-hub-close"
                onClick={() => setCapabilityHub(null)}
                title={t('Close')}
              >
                <X size={14} />
              </button>
            </div>

            <label className="workflow-capability-hub-search">
              <Search size={14} />
              <input
                data-testid="workflow-capability-hub-search"
                aria-label={t('Search capabilities')}
                value={capabilityHubSearch}
                onChange={event => setCapabilityHubSearch(event.target.value)}
                placeholder={capabilityHub.kind === 'skills' ? t('Search skills') : t('Search MCP servers')}
              />
            </label>

            {capabilityHub.kind === 'skills' && renderSkillsHubPanel()}

            {false && (
              <>
                <div data-testid="workflow-capability-hub-summary" className="workflow-capability-hub-summary">
                  <span>{skillsHubLoading ? t('Loading...') : t('Skills')}</span>
                  <strong>{skillsHub?.summary.skillCount ?? 0}</strong>
                  <span>{t('Sources')}</span>
                  <strong>{skillsHub?.summary.sourceCount ?? 0}</strong>
                </div>
                {skillsHubError && <div className="workflow-capability-hub-error">{skillsHubError}</div>}
                <div className="workflow-capability-hub-semantics">
                  {skillsHub?.nodeSemantics.defaultConnection || t('Skill capabilities attach to Agent nodes; Agent remains the executor.')}
                </div>
                <div className="workflow-capability-hub-groups">
                  {(skillsHub?.groups || []).slice(0, 4).map(group => (
                    <button
                      type="button"
                      key={group.id}
                      data-testid="workflow-capability-hub-group"
                      data-group-id={group.id}
                      data-skill-count={group.skillIds.length}
                      title={group.skillIds.map(skillId => skillsById.get(skillId)?.name || skillId).join(', ')}
                      disabled={capabilityHubBusyGroupId === group.id || group.skillIds.length === 0}
                      onClick={() => createSkillGroupNode(group)}
                    >
                      <Boxes size={12} />
                      <span>{t(group.label)} / {group.skillIds.length}</span>
                      <span data-testid="workflow-capability-create-node">
                        {capabilityHubBusyGroupId === group.id ? t('Creating') : t('Create pack')}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="workflow-capability-hub-list">
                  {(skillsHub?.skills || []).map(skill => {
                    const skillName = String(skill.name || skill.id.replace(/^skill:/, '')).trim();
                    const attached = Boolean(capabilityHubTargetAgent && skillsForNode(capabilityHubTargetAgent).includes(skillName));
                    const busy = capabilityHubBusySkillId === skill.id;
                    const attachDisabled = !capabilityHubTargetAgent || attached || busy || skill.attachable === false;
                    return (
                    <div
                      key={skill.id}
                      data-testid="workflow-capability-hub-item"
                      data-skill-id={skill.id}
                      data-skill-name={skill.name}
                      data-skill-state={skill.state}
                      data-skill-semantics={skill.nodeSemantics}
                      data-attached={attached ? 'true' : 'false'}
                      className="workflow-capability-hub-item"
                    >
                      <div className="workflow-capability-hub-item-main">
                        <strong>{skill.title || skill.name}</strong>
                        <span>{skill.description || skill.name}</span>
                        <small>{skill.sources.map(source => source.path).join(' · ')}</small>
                      </div>
                      <button
                        type="button"
                        data-testid="workflow-capability-attach"
                        disabled={attachDisabled}
                        title={capabilityHubTargetAgent ? t('Attach skill to selected Agent') : t('Open from an Agent node to attach')}
                        onClick={() => attachSkillToTargetAgent(skill)}
                      >
                        {busy ? t('Attaching') : attached ? t('Attached') : t('Attach')}
                      </button>
                    </div>
                    );
                  })}
                  {!skillsHubLoading && !skillsHubError && (skillsHub?.skills || []).length === 0 && (
                    <div className="workflow-capability-hub-empty">{t('No skills found')}</div>
                  )}
                </div>
              </>
            )}

            {capabilityHub.kind === 'mcp' && (
              <div data-testid="workflow-mcp-hub-panel" className="workflow-mcp-hub-panel">
                <div data-testid="workflow-capability-hub-summary" className="workflow-capability-hub-summary">
                  <span>{mcpHubLoading ? t('Loading...') : t('Servers')}</span>
                  <strong>{mcpHub?.summary.serverCount ?? 0}</strong>
                  <span>{t('Sources')}</span>
                  <strong>{mcpHub?.summary.sourceCount ?? 0}</strong>
                  <span>{t('Redacted')}</span>
                  <strong>{mcpHub?.summary.redactedFieldCount ?? 0}</strong>
                </div>
                {mcpHubError && <div className="workflow-capability-hub-error">{mcpHubError}</div>}
                <div className="workflow-capability-hub-semantics">
                  {mcpHub?.nodeSemantics.safety || t('metadata-only-no-spawn-no-secret')}
                </div>
                <div className="workflow-capability-hub-list">
                  {(mcpHub?.servers || []).map(server => {
                    const busy = capabilityHubBusyMcpServerId === server.id;
                    const createDisabled = busy || server.creatable === false;
                    return (
                      <div
                        key={server.id}
                        data-testid="workflow-capability-hub-item"
                        data-mcp-server-id={server.id}
                        data-mcp-server-name={server.name}
                        data-mcp-transport={server.transport}
                        data-mcp-semantics={server.nodeSemantics}
                        data-mcp-creatable={server.creatable ? 'true' : 'false'}
                        className="workflow-capability-hub-item"
                      >
                        <div className="workflow-capability-hub-item-main">
                          <strong>{server.title || server.name}</strong>
                          <span>
                            {[server.transport, server.commandName, server.url].filter(Boolean).join(' - ')}
                          </span>
                          <small>
                            {[
                              ...server.sources.map(source => source.path),
                              server.envKeys.length > 0 ? `env: ${server.envKeys.join(', ')}` : '',
                              Number(server.argCount || 0) > 0 ? `args: ${server.argCount}` : '',
                            ].filter(Boolean).join(' - ')}
                          </small>
                        </div>
                        <button
                          type="button"
                          data-testid="workflow-capability-attach"
                          disabled
                          title={t('Direct MCP attach is still gated; create a connector node instead.')}
                        >
                          {t('Attach')}
                        </button>
                        <button
                          type="button"
                          data-testid="workflow-capability-create-node"
                          disabled={createDisabled}
                          title={t('Create backend-owned MCP connector node')}
                          onClick={() => createMcpConnectorNode(server)}
                        >
                          {busy ? t('Creating') : t('Create connector')}
                        </button>
                      </div>
                    );
                  })}
                  {!mcpHubLoading && !mcpHubError && (mcpHub?.servers || []).length === 0 && (
                    <div className="workflow-capability-hub-empty">{t('No MCP servers found')}</div>
                  )}
                </div>
              </div>
            )}
          </aside>
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
              ...(isAgentNode(nodeContextTarget) ? [{ action: 'skills-hub', label: 'Skills Hub', icon: Boxes }] : []),
              ...(isAgentNode(nodeContextTarget) ? [{ action: 'mcp-hub', label: 'MCP Hub', icon: Network }] : []),
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

      </ReactFlow>

        {showConfig && selectedNode?.kind === 'terminal-session' && selectedNode.sessionId && (!selectedRuntimeNode || selectedRuntimeNode.kind === 'agent') && (
          <div data-canvas-control="true" className="workflow-node-settings-overlay workflow-node-settings-panel-host workflow-component-settings-panel-host nodrag nopan">
            <AgentNodeSettings
              node={(selectedRuntimeNode?.kind === 'agent' ? selectedRuntimeNode : null) || (agentSettingsPreviewNode as WorkflowRuntimeNode)}
              loading={!selectedRuntimeNode}
              onClose={() => setShowConfig(false)}
              onDelete={() => requestDeleteNode(selectedNode.id)}
            />
          </div>
        )}

        {showConfig && selectedNode?.kind === 'terminal-session' && selectedNode.sessionId && selectedRuntimeNode && selectedRuntimeNode.kind !== 'agent' && (
          <div data-canvas-control="true" className="workflow-node-settings-overlay workflow-node-settings-panel-host nodrag nopan">
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
              onDelete={() => requestDeleteNode(selectedNode.id)}
              onConfigSaved={applyNodeConfigUpdate}
              onRestarted={applyNodeRestart}
            />
          </div>
        )}

        {showConfig && selectedNode && selectedRuntimeNode && selectedRuntimeNode.kind !== 'agent' && SelectedRuntimeSettings && (
          <div data-canvas-control="true" className="workflow-node-settings-overlay workflow-node-settings-panel-host workflow-component-settings-panel-host nodrag nopan">
            <SelectedRuntimeSettings
              node={selectedRuntimeNode}
              onClose={() => setShowConfig(false)}
              onDelete={() => requestDeleteNode(selectedNode.id)}
            />
          </div>
        )}

        {showConfig && selectedNode && !(selectedNode.kind === 'terminal-session' && selectedNode.sessionId) && !(selectedRuntimeNode && SelectedRuntimeSettings) && !selectedRuntimeLoading && (
          <div data-canvas-control="true" className="workflow-node-settings-overlay workflow-node-settings-panel-host nodrag nopan">
            <aside data-canvas-control="true" data-testid="workflow-node-config" className="workflow-node-settings workflow-floating-panel nodrag nopan nowheel" style={{ width: 'min(360px, calc(100vw - (var(--wf-panel-gap) * 2)))', height: 'auto', maxHeight: 'calc(100vh - var(--header-h) - 44px)' }}>
              <div className="workflow-node-settings-header">
                <div className="workflow-node-settings-title">
                  <span style={{ color: 'var(--fg)', fontSize: 13 }}>{selectedNode.label}</span>
                  <span style={{ maxWidth: 240 }}>{selectedNode.id}</span>
                </div>
                <div className="workflow-node-settings-header-actions">
                  <button type="button" className="workflow-node-settings-icon" onClick={() => setShowConfig(false)} title={t('Close')}>
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="workflow-node-settings-body" style={{ maxHeight: 'calc(100vh - var(--header-h) - 120px)' }}>

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
                  {isAgentNode(selectedNode) && (
                    <button data-testid="workflow-node-config-comm" onClick={() => openCommPanelForNode(selectedNode.id)}
                      style={{ padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', color: 'var(--fg)', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                      <MessagesSquare size={12} /> {t('Communications')}
                    </button>
                  )}
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
                    <button data-testid="workflow-node-config-delete" onClick={() => requestDeleteNode(selectedNode.id)} disabled={pendingDeletes.has(selectedNode.id)}
                      style={{ gridColumn: '1 / -1', padding: '7px 10px', borderRadius: 'var(--radius)', border: '1px solid #fecaca', color: '#991b1b', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: pendingDeletes.has(selectedNode.id) ? 0.5 : 1 }}>
                      <Trash2 size={12} /> {pendingDeletes.has(selectedNode.id) ? t('Deleting...') : t('Delete Node')}
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {selectedNodeCanDelete && (
                    <button data-testid="workflow-node-config-delete" onClick={() => requestDeleteNode(selectedNode.id)} disabled={pendingDeletes.has(selectedNode.id)}
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
              </div>
</aside>
          </div>
      )}
      {commPanelNodeId && (
        <aside
          data-canvas-control="true"
          data-testid="workflow-comm-panel"
          data-node-id={commPanelNodeId}
          className="wf-floating-panel nodrag nopan nowheel"
          onPointerDown={event => event.stopPropagation()}
          style={{
            ...PANEL,
            position: 'absolute',
            zIndex: 'var(--wf-z-panel)',
            left: 'calc(50% - 190px)',
            top: 'calc(var(--header-h) + 16px)',
            width: 380,
            maxWidth: 'calc(100% - 32px)',
            maxHeight: 'calc(100% - var(--header-h) - 32px)',
            overflow: 'hidden',
            padding: 12,
            display: 'grid',
            gridTemplateRows: 'auto minmax(0, 1fr)',
            gap: 8,
            cursor: 'default',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                <MessagesSquare size={13} /> {t('Communications')}
              </div>
              <div data-testid="workflow-comm-panel-node" style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {commPanelNodeId}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
              <button title={t('Refresh')} onClick={() => loadCommMessages(commPanelNodeId)} style={{ width: 25, height: 25, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--muted)' }}>
                <RefreshCw size={11} />
              </button>
              <button data-testid="workflow-comm-panel-close" title={t('Close')} onClick={() => setCommPanelNodeId(null)} style={{ width: 25, height: 25, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--muted)' }}>
                <X size={12} />
              </button>
            </div>
          </div>
          <div data-testid="workflow-comm-messages" style={{ overflow: 'auto', display: 'grid', gap: 6, paddingRight: 2, alignContent: 'start' }}>
            {commPanelError && (
              <div style={{ fontSize: 11, color: '#b91c1c', padding: 6 }}>{commPanelError}</div>
            )}
            {!commPanelError && commPanelLoading && (
              <div style={{ fontSize: 11, color: 'var(--muted)', padding: 10, border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
                {t('Loading messages...')}
              </div>
            )}
            {!commPanelError && !commPanelLoading && commEntries.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--muted)', padding: 10, border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
                {t('No messages recorded for this node.')}
              </div>
            )}
            {commEntries.map(entry => (
              <div
                key={`${entry.messageId || ''}-${entry.seq || ''}-${entry.ts || ''}-${entry.fromNodeId || ''}-${entry.toNodeId || ''}`}
                data-testid="workflow-comm-entry"
                data-reply={entry.replyTo ? 'true' : 'false'}
                style={{ border: `1px solid ${entry.replyTo ? '#c7d2fe' : 'var(--border)'}`, borderRadius: 'var(--radius)', padding: 8, background: 'var(--surface)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--muted)', marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--fg)', fontWeight: 700 }}>{shortId(entry.fromNodeId)} {'->'} {shortId(entry.toNodeId)}</span>
                  <span style={{ marginLeft: 'auto' }}>{entry.ts ? new Date(entry.ts).toLocaleString() : ''}</span>
                </div>
                {(entry.requestId || entry.replyTo) && (
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {entry.requestId && <span data-testid="workflow-comm-request-id">req {shortId(entry.requestId)}</span>}
                    {entry.replyTo && <span data-testid="workflow-comm-reply-to">reply to {shortId(entry.replyTo)}</span>}
                  </div>
                )}
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 10, lineHeight: 1.45, fontFamily: 'inherit', color: 'var(--fg)' }}>
                  {String(entry.data || '').trimEnd().slice(0, 400)}
                </pre>
              </div>
            ))}
          </div>
        </aside>
      )}
      <AnimatePresence>
        {expandedRuntimeNode?.kind === 'timer' && expandedNode && expandedTimerState && (
          <WorkflowTimerExpandedNode
            key={`timer-${expandedRuntimeNode.nodeId}-${expandedRuntimeNode.nonce}`}
            node={expandedNode}
            state={expandedTimerState}
            nodes={canvasNodes}
            edges={graphState.edges}
            onClose={() => setExpandedRuntimeNode(null)}
            onSave={payload => saveExpandedRuntimeNode(expandedNode, 'timer.configure', payload)}
          />
        )}
        {expandedRuntimeNode?.kind === 'goal' && expandedNode && expandedGoalState && (
          <WorkflowGoalExpandedNode
            key={`goal-${expandedRuntimeNode.nodeId}-${expandedRuntimeNode.nonce}`}
            node={expandedNode}
            state={expandedGoalState}
            nodes={canvasNodes}
            edges={graphState.edges}
            onClose={() => setExpandedRuntimeNode(null)}
            onSave={payload => saveExpandedRuntimeNode(expandedNode, 'goal.update', payload)}
          />
        )}
      </AnimatePresence>
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
          <button onClick={undoGraph} disabled={!historyActorNodeId} data-testid="workflow-undo" title={t('Undo')} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.9)', color: historyActorNodeId ? 'var(--fg)' : 'var(--muted)', opacity: historyActorNodeId ? 1 : 0.45 }}>
            <Undo2 size={13} />
          </button>
          <button onClick={redoGraph} disabled={!historyActorNodeId} data-testid="workflow-redo" title={t('Redo')} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.9)', color: historyActorNodeId ? 'var(--fg)' : 'var(--muted)', opacity: historyActorNodeId ? 1 : 0.45 }}>
            <Redo2 size={13} />
          </button>
          <button onClick={() => setSkillsOverlay({ open: true, mode: 'hub' })} data-testid="workflow-open-skills-overlay" title={t('Skills Hub')} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.9)', color: 'var(--muted)' }}>
            <Boxes size={13} />
          </button>
          <button onClick={runTidyLayout} disabled={tidyLayoutBusy} data-testid="workflow-tidy-layout" title={t('Tidy layout')} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'rgba(255,255,255,0.9)', color: tidyLayoutBusy ? 'var(--muted)' : 'var(--fg)', opacity: tidyLayoutBusy ? 0.45 : 1 }}>
            <LayoutGrid size={13} />
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
          data-kind={workflowToastKind}
        >
          <span className="workflow-toast-orb" aria-hidden="true" />
          <span className="workflow-toast-message">{workflowToastMessage}</span>
          <button type="button" onClick={dismissWorkflowToast} title={t('dismiss')} aria-label={t('dismiss')}>
            <X size={12} />
          </button>
        </div>
      )}
      {deleteConfirm && (
        <div
          data-canvas-control="true"
          data-testid="workflow-delete-confirm"
          role="dialog"
          aria-modal="true"
          className="wf-floating-panel nodrag nopan"
          onPointerDown={event => event.stopPropagation()}
          style={{ ...PANEL, position: 'absolute', zIndex: DELETE_MODAL_Z, left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 'min(380px, calc(100% - 32px))', padding: 16 }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Square size={17} color="#b45309" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{t('Stop and delete running Agent?')}</div>
              <div style={{ marginTop: 7, color: 'var(--muted)', fontSize: 11, lineHeight: 1.5 }}>
                {t('The selected running Agent will be stopped first, then removed from the workflow.')} ({deleteConfirm.liveNodeIds.length} {t('running')})
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 16 }}>
            <button type="button" data-testid="workflow-delete-confirm-cancel" onClick={() => setDeleteConfirm(null)} style={{ padding: '7px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--fg)', fontSize: 11, fontWeight: 700 }}>
              {t('Cancel')}
            </button>
            <button type="button" data-testid="workflow-delete-confirm-accept" onClick={confirmDeleteNodes} style={{ padding: '7px 11px', border: '1px solid #f59e0b', borderRadius: 'var(--radius)', background: '#b45309', color: '#fff', fontSize: 11, fontWeight: 800 }}>
              {t('Stop and delete')}
            </button>
          </div>
        </div>
      )}
      {fileBigViewNodeId && (
        <WorkflowFileBigView nodeId={fileBigViewNodeId} onClose={() => setFileBigViewNodeId(null)} />
      )}
      <AnimatePresence>
        {displayViewRequest && (
          <WorkflowDisplayView
            open={Boolean(displayViewRequest)}
            nodeId={displayViewRequest.nodeId}
            title={displayViewRequest.title}
            onClose={() => setDisplayViewRequest(null)}
          />
        )}
      </AnimatePresence>
      {(skillsOverlay.open || skillsDragHideActive) && (
        <WorkflowSkillsHubOverlay
          open={skillsOverlay.open}
          hidden={skillsDragHideActive}
          mode={skillsOverlay.mode}
          group={skillsOverlayGroup}
          hub={skillsOverlayHub}
          agents={skillsOverlayAgents}
          skills={skillsOverlaySkills}
          packs={skillsOverlayPacks}
          groups={skillsOverlayGroups}
          onClose={() => {
            // Explicit close: unmount and clear the draft (existing behavior).
            setSkillsDragHideActive(false);
            setSkillsOverlay(current => (current.open ? { open: false, mode: current.mode } : current));
          }}
          onSetSkillEnabled={skillsOverlay.mode === 'group' ? handleSkillsOverlaySetSkillEnabled : undefined}
          onAttachToAgent={handleSkillsOverlayAttachToAgent}
          onInstallPack={handleSkillsOverlayInstallPack}
          onPickGroup={handleSkillsOverlayPickGroup}
          onDraftDragStart={() => {
            // Hide (don't close) the overlay so the composed-skill drag can
            // land on the canvas; it stays mounted with its draft, and a
            // cancelled drag (dragend listener) or failed create restores it.
            skillsDraftDragActiveRef.current = true;
            setSkillsDragHideActive(true);
          }}
        />
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
  markerStart,
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
    routing: data?.routing,
    sourceId: data?.sourceNodeId || undefined,
    targetId: data?.targetNodeId || undefined,
  });
  const rawLabelText = typeof label === 'string' && label ? label : String(data?.relation || 'wf-bridge');
  const labelText = bridgeDisplayLabel(
    rawLabelText,
    typeof data?.displaySourceHandle === 'string' ? data.displaySourceHandle : null,
    typeof data?.displayTargetHandle === 'string' ? data.displayTargetHandle : null,
    key => key,
  );
  const labelScale = 1 / Math.max(0.05, Number(data?.zoom || flow.getZoom() || 1));
  const agentFlow = Boolean(data?.agentFlowActive);
  const agentFlowColor = typeof data?.agentFlowColor === 'string' ? data.agentFlowColor : WORKFLOW_GREEN;
  const visibleStyle: CSSProperties = {
    ...style,
    stroke: isSelected || agentFlow ? WORKFLOW_GREEN : style?.stroke || WORKFLOW_GREEN_DARK,
    strokeWidth: isSelected || agentFlow ? 2.5 : style?.strokeWidth || 1.8,
    filter: isSelected || agentFlow ? `drop-shadow(0 0 7px ${WORKFLOW_GREEN_GLOW})` : undefined,
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
    if (immediate) data?.onEdgeSelect?.(event, id);
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
      data-agent-flow={agentFlow ? 'true' : undefined}
      data-agent-flow-operation-id={agentFlow ? data?.agentFlowOperationId || '' : undefined}
      className={agentFlow ? 'wf-bridge-edge-agent-flow' : undefined}
      style={{ '--agent-flow-color': agentFlowColor } as CSSProperties}
    >
      <BaseEdge
        id={id}
        path={edgePath}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={visibleStyle}
        interactionWidth={0}
      />
      {agentFlow && (
        <path
          className="wf-bridge-edge-flow"
          d={edgePath}
          fill="none"
          stroke={agentFlowColor}
          strokeWidth={5}
          strokeLinecap="round"
        />
      )}
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
          aria-label={labelText}
          title={labelText}
          className="wf-bridge-label nodrag nopan"
          data-selected={isSelected ? 'true' : 'false'}
          data-compact={data?.labelCompact ? 'true' : 'false'}
          onPointerDown={(event) => startDrag(event)}
          onClick={selectFromLabel}
          onDoubleClick={openPanelFromLabel}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px) scale(${labelScale})`,
          }}
        >
          <span className="wf-bridge-label-icon" aria-hidden="true">
            <Link2 size={15} strokeWidth={2.2} />
          </span>
          <span className="wf-bridge-label-tooltip" aria-hidden="true">{labelText}</span>
        </button>
      </EdgeLabelRenderer>
    </g>
  );
}

function EmbeddedWorkflowTerminal({ sessionId, live, canSendInput }: { sessionId: string; live: boolean; canSendInput: boolean }) {
  const t = useT();
  const attachLive = live && canSendInput;
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
    if (!data || !attachLive) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'pty:input', data }));
      return;
    }
    sendInputFallback(data).catch((e: any) => {
      terminalRef.current?.writeln(`\r\n[error] ${e?.message || t('input rejected')}`);
    });
  }, [attachLive, sendInputFallback, t]);

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
      disableStdin: !live || !canSendInput,
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
    const webglDisposable = loadTerminalWebglAddon(term);
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
      webglDisposable?.dispose();
      fit.dispose();
      term.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [attachLive, scheduleRepaintTerminal, writeInput]);

  useEffect(() => {
    const term = terminalRef.current;
    if (term) term.options.disableStdin = !live || !canSendInput;
  }, [canSendInput, live]);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    const term = terminalRef.current;
    if (!term || terminalReady === 0) return;
    const connectLiveTerminal = () => {
      if (cancelled || !live || !canSendInput || terminalRef.current !== term) return;
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
  }, [canSendInput, live, replayTranscript, scheduleRepaintTerminal, sessionId, terminalReady]);

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
    zIndex: 30,
    pointerEvents: 'all',
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
  ].map((handle): { position: Position; side: string; type: 'source'; id: string; role: 'bidirectional'; style: CSSProperties } => ({
    ...handle,
    type: 'source',
    id: handle.side,
    role: 'bidirectional',
  }));
  return (
    <>
      {sideHandles.map(handle => (
        <Handle
          key={handle.side}
          className={`wf-flow-handle nodrag nopan wf-flow-handle-${handle.side} workflow-agent-context-handle workflow-agent-event-input-hit`}
          type={handle.type}
          id={handle.id}
          position={handle.position}
          data-testid="workflow-agent-node-context-input"
          data-event-input-id="event.in"
          data-handle-side={handle.side}
          data-handle-role={handle.role}
          isConnectableStart
          isConnectableEnd
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

function WfNodeCard({ data, selected, dragging }: NodeProps<AgentFlowNode>) {
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
  const canDelete = canRequestDeleteNode(node);
  const openLiveTerminal = canOpenTerminal(node);
  const role = roleBadge(node);
  const nodeBorderColor = selected || live ? WORKFLOW_GREEN : WORKFLOW_GREEN_BORDER;
  const agentControl = data.agentControl;

  const stopEvent = (event: ReactMouseEvent) => {
    event.stopPropagation();
  };

  if (isTerminalMode) {
    return (
      <motion.div
        key="terminal"
        layout={!dragging}
        initial={{ rotateY: -8, scale: 0.96 }}
        animate={{ rotateY: 0, scale: 1 }}
        transition={dragging ? { duration: 0 } : { type: 'spring', stiffness: 430, damping: 30, mass: 0.72 }}
        className="wf-node-card"
        data-mode="terminal"
        data-dragging={dragging ? 'true' : undefined}
        data-selected={selected ? 'true' : 'false'}
        data-agent-controlled={agentControl?.active ? 'true' : undefined}
        data-agent-control-operation-id={agentControl?.active ? agentControl.operationId : undefined}
        data-testid="workflow-node-terminal"
        data-node-id={node.graphNodeId || node.id}
        style={{
          '--agent-control-color': agentControl?.color || '#22c55e',
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
        } as CSSProperties}
        >
        <RuntimeAccentStrip color={runtimeColor} />
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
          <EmbeddedWorkflowTerminal
            sessionId={node.sessionId!}
            live={live}
            canSendInput={node.control?.canSendInput !== false}
          />
        </div>
        <ConnectionHandles zoom={data.viewportZoom} />
      </motion.div>
    );
  }

  return (
    <motion.div
      key="card"
      className="wf-node-card"
      data-mode="card"
      data-selected={selected ? 'true' : 'false'}
      data-agent-controlled={agentControl?.active ? 'true' : undefined}
      data-agent-control-operation-id={agentControl?.active ? agentControl.operationId : undefined}
      data-testid="workflow-node"
      data-node-id={node.graphNodeId || node.id}
      style={{
        '--agent-control-color': agentControl?.color || '#22c55e',
        width: CARD_NODE_W,
        height: CARD_NODE_H,
        boxSizing: 'border-box',
        border: `1px solid ${nodeBorderColor}`,
        borderRadius: 'var(--radius)',
        background: liveNodeBackground(node, live, selected),
        textAlign: 'left',
        padding: '10px 10px 10px 14px',
        display: 'grid',
        gridTemplateRows: 'auto auto auto minmax(0, 1fr) 32px',
        alignContent: 'stretch',
        gap: 5,
        color: 'var(--fg)',
        transformStyle: 'preserve-3d',
        position: 'relative',
        boxShadow: live ? `0 14px 34px ${WORKFLOW_GREEN_GLOW}` : undefined,
      } as CSSProperties}
    >
      <RuntimeAccentStrip color={runtimeColor} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {node.runtime ? <RuntimeBrandMark runtime={node.runtime} size={15} /> : <Icon size={14} />}
        <span style={{ fontSize: 15, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayNodeTitle(node)}</span>
        <span style={{ marginLeft: 'auto', flex: '0 0 auto', fontSize: 10, lineHeight: 1, color: kindColor, background: `${kindColor}12`, border: `1px solid ${kindColor}30`, borderRadius: 999, padding: '4px 7px', fontWeight: 800, letterSpacing: 0 }}>{role}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span className={live ? 'wf-status-dot is-live' : 'wf-status-dot'} style={{ background: stateColor }} />
        <span data-testid="workflow-node-status" style={{ fontSize: 10, lineHeight: 1, color: tone.color, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 999, padding: '4px 7px', fontWeight: 800, letterSpacing: 0, textTransform: 'uppercase' }}>{displaySessionStatus(node.status)}</span>
        <RuntimeBrandLabel runtime={node.runtime || node.kind} model={node.model} size={13} style={{ minWidth: 0, fontSize: 12, overflow: 'hidden' }} />
      </div>
      <WorkflowCapsuleStrip capsule={data.capsule} selfRole="agent" compact />
      <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minHeight: 16, pointerEvents: 'none' }}>
        {node.objective || node.peerId || (node.sessionId ? t('managed PTY endpoint') : t('workflow control node'))}
      </div>
      <div className="nodrag nopan" style={{ display: 'flex', gap: 7, alignSelf: 'end', position: 'relative', zIndex: 5, minWidth: 0, minHeight: 32 }}>
        {node.sessionId ? (
          <>
            {canStart ? (
              <>
                <button data-testid="workflow-node-start" disabled={data.starting} onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onStartNode(node.id); }}
                  style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 800, padding: '5px 8px', border: '1px solid #86efac', borderRadius: 'var(--radius)', color: WORKFLOW_GREEN_DARK, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: data.starting ? 0.45 : 1 }}>
                  <Play size={12} /> {data.starting ? t('Starting...') : t('Start')}
                </button>
                <button data-testid="workflow-open-terminal" title={t('Open Transcript')} onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onToggleMode(node.id); }}
                  style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--muted)' }}>
                  <Terminal size={12} />
                </button>
              </>
            ) : (
              <button data-testid="workflow-open-terminal" onPointerDown={stopEvent} onClick={(e) => { e.stopPropagation(); data.onToggleMode(node.id); }}
                style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 800, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
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
            style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 800, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <Settings2 size={12} /> {t('Configure')}
          </button>
        )}
      </div>
      <ConnectionHandles zoom={data.viewportZoom} />
    </motion.div>
  );
}
