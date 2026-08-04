import type { ComponentType } from 'react';
import type { WorkflowRuntimeNode } from './nodeRuntimeClient';
import MarkdownNodeSettings from './MarkdownNodeSettings';
import ExcalidrawNodeSettings from './ExcalidrawNodeSettings';
import FileNodeSettings from './FileNodeSettings';
import AgentNodeSettings from './AgentNodeSettings';

export interface NodeRenderer {
  kind: string;
  SettingsComponent: ComponentType<{
    node: WorkflowRuntimeNode;
    onClose: () => void;
    onDelete: () => void;
  }>;
}

const registry: Record<string, NodeRenderer> = {
  markdown: { kind: 'markdown', SettingsComponent: MarkdownNodeSettings },
  excalidraw: { kind: 'excalidraw', SettingsComponent: ExcalidrawNodeSettings },
  file: { kind: 'file', SettingsComponent: FileNodeSettings },
  agent: { kind: 'agent', SettingsComponent: AgentNodeSettings },
};

export function getNodeRenderer(kind: string): NodeRenderer | undefined {
  return registry[kind];
}

export function getSupportedKinds(): string[] {
  return Object.keys(registry);
}
