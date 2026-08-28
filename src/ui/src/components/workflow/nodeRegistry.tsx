import type { ComponentType } from 'react';
import {
  BellRing,
  Bot,
  Boxes,
  Clock3,
  File as FileIcon,
  FileText,
  Github,
  Network,
  Shapes,
  StickyNote,
  Target,
} from 'lucide-react';
import type { WorkflowRuntimeNode } from './nodeRuntimeClient';
import MarkdownNodeSettings from './MarkdownNodeSettings';
import ExcalidrawNodeSettings from './ExcalidrawNodeSettings';
import FileNodeSettings from './FileNodeSettings';
import DisplayNodeSettings from './DisplayNodeSettings';
import AgentNodeSettings from './AgentNodeSettings';
import TimerNodeSettings from './TimerNodeSettings';
import GoalNodeSettings from './GoalNodeSettings';

export interface NodeRenderer {
  kind: string;
  SettingsComponent: ComponentType<{
    node: WorkflowRuntimeNode;
    onClose: () => void;
    onDelete: () => void;
  }>;
}

export type CreateNodeCreateMode = 'agent' | 'file' | 'markdown' | 'diagram' | 'display' | 'timer' | 'goal';
export type CreateNodeCatalogKind =
  | CreateNodeCreateMode
  | 'timer'
  | 'goal'
  | 'trigger'
  | 'github-trigger'
  | 'mcp'
  | 'group';
export type CreateNodeCategory = 'agent' | 'resource' | 'event' | 'capability' | 'structure';
export type CreateNodeState = 'ready' | 'planned';

export interface CreateNodeCatalogItem {
  kind: CreateNodeCatalogKind;
  createMode?: CreateNodeCreateMode;
  hub?: 'skills' | 'mcp';
  category: CreateNodeCategory;
  label: string;
  description: string;
  agentSemantics: string;
  state: CreateNodeState;
  icon: ComponentType<{ size?: number; className?: string }>;
  searchText: string;
}

const registry: Record<string, NodeRenderer> = {
  markdown: { kind: 'markdown', SettingsComponent: MarkdownNodeSettings },
  excalidraw: { kind: 'excalidraw', SettingsComponent: ExcalidrawNodeSettings },
  file: { kind: 'file', SettingsComponent: FileNodeSettings },
  display: { kind: 'display', SettingsComponent: DisplayNodeSettings },
  agent: { kind: 'agent', SettingsComponent: AgentNodeSettings },
  timer: { kind: 'timer', SettingsComponent: TimerNodeSettings },
  goal: { kind: 'goal', SettingsComponent: GoalNodeSettings },
};

const createNodeCatalog: CreateNodeCatalogItem[] = [
  {
    kind: 'agent',
    createMode: 'agent',
    category: 'agent',
    label: 'Agent node',
    description: 'Execution core with terminal, model, task, settings, and graph context.',
    agentSemantics: 'Runs work and reads or controls connected nodes through typed actions.',
    state: 'ready',
    icon: Bot,
    searchText: 'agent runtime terminal codex claude opencode executor thinking',
  },
  {
    kind: 'markdown',
    createMode: 'markdown',
    category: 'resource',
    label: 'Markdown node',
    description: 'Revisioned text resource for notes, context, and agent output.',
    agentSemantics: 'A readable and writable document surface exposed as semantic port markdown.',
    state: 'ready',
    icon: StickyNote,
    searchText: 'markdown notes text document context output resource',
  },
  {
    kind: 'diagram',
    createMode: 'diagram',
    category: 'resource',
    label: 'Diagram node',
    description: 'Revisioned Excalidraw scene with preview and fullscreen editor.',
    agentSemantics: 'A readable and writable visual scene exposed as semantic port scene.',
    state: 'ready',
    icon: Shapes,
    searchText: 'diagram excalidraw scene drawing whiteboard visual resource',
  },
  {
    kind: 'file',
    createMode: 'file',
    category: 'resource',
    label: 'File node',
    description: 'Workspace or user-file reference with preview and bounded reads.',
    agentSemantics: 'A file resource agents can inspect through meta, bytes, or text capabilities.',
    state: 'ready',
    icon: FileIcon,
    searchText: 'file folder workspace upload reference pdf image text resource',
  },
  {
    kind: 'display',
    createMode: 'display',
    category: 'resource',
    label: 'Display node',
    description: 'HTML report surface agents write to; the user reads it fullscreen on the canvas.',
    agentSemantics: 'Agents write self-contained HTML reports via display.write (theme: white/blue/black + Claude yellow; {{excalidraw:<id>}} embeds diagrams). The user views it fullscreen.',
    state: 'ready',
    icon: FileText,
    searchText: 'display report html presentation dashboard findings summary results user output',
  },
  {
    kind: 'timer',
    createMode: 'timer',
    category: 'event',
    label: 'Timer node',
    description: 'Advanced scheduler with interval sequences, health checks, loop, and Agent control.',
    agentSemantics: 'Emits event edges and accepts explicit control edges from connected agents.',
    state: 'ready',
    icon: Clock3,
    searchText: 'timer cron schedule interval delay trigger event heartbeat health check loop',
  },
  {
    kind: 'goal',
    createMode: 'goal',
    category: 'structure',
    label: 'Goal node',
    description: 'Active task anchor with objective, plan, acceptance, and completion proposal state.',
    agentSemantics: 'A task-state node agents can read and update through explicit goal actions.',
    state: 'ready',
    icon: Target,
    searchText: 'goal task objective acceptance plan checklist progress completion active task',
  },
  {
    kind: 'trigger',
    category: 'event',
    label: 'Trigger node',
    description: 'Generic webhook or event receiver with replay and dedupe.',
    agentSemantics: 'Turns external events into bounded prompts for connected agents.',
    state: 'planned',
    icon: BellRing,
    searchText: 'trigger webhook event payload replay dedupe',
  },
  {
    kind: 'github-trigger',
    category: 'event',
    label: 'GitHub trigger',
    description: 'Connector-backed repo event shell; implementation extension point only.',
    agentSemantics: 'Converts GitHub webhook events into explicit agent-readable event context.',
    state: 'planned',
    icon: Github,
    searchText: 'github git pull request pr issue push release workflow_run webhook',
  },
  {
    kind: 'mcp',
    category: 'capability',
    label: 'MCP connector',
    description: 'Tool/resource provider selected from an MCP hub or local server.',
    agentSemantics: 'Advertises tools and resources to agents without executing independently.',
    state: 'ready',
    hub: 'mcp',
    icon: Network,
    searchText: 'mcp connector server tools resources hub model context protocol',
  },
  {
    kind: 'group',
    category: 'structure',
    label: 'Group / subgraph',
    description: 'Collapsed node bundle with explicit boundary ports.',
    agentSemantics: 'Keeps internal nodes organized while exposing declared graph ports.',
    state: 'planned',
    icon: Boxes,
    searchText: 'group subgraph bundle collapse boundary ports structure',
  },
];

export function getNodeRenderer(kind: string): NodeRenderer | undefined {
  return registry[kind];
}

export function getSupportedKinds(): string[] {
  return Object.keys(registry);
}

export function getCreateNodeCatalog(): CreateNodeCatalogItem[] {
  return createNodeCatalog;
}

export const createNodeCategoryLabels: Record<CreateNodeCategory, string> = {
  agent: 'Agents',
  resource: 'Resources',
  event: 'Events',
  capability: 'Capabilities',
  structure: 'Structure',
};
