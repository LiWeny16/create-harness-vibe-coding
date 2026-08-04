import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { WorkflowComponentNodeState, WorkflowComponentType, WorkflowNode } from '../types';
import MarkdownComponentNode from './MarkdownComponentNode';
import ExcalidrawComponentNode from './ExcalidrawComponentNode';
import FileComponentNode from './FileComponentNode';
import ComponentBrandIcon from './ComponentBrandIcon';

export type WorkflowComponentNodeData = Record<string, unknown> & {
  workflowNode: WorkflowNode;
  componentState: WorkflowComponentNodeState;
  viewportZoom: number;
  onSaveComponentNode: (
    nodeId: string,
    patch: Partial<WorkflowComponentNodeState>,
  ) => Promise<WorkflowComponentNodeState | null>;
};

export type WorkflowComponentFlowNode = import('@xyflow/react').Node<WorkflowComponentNodeData, 'workflowComponentNode'>;

function defaultInputIds(type: WorkflowComponentType) {
  if (type === 'markdown') return ['markdown'];
  if (type === 'file') return ['file'];
  return ['scene'];
}

function defaultOutputIds(type: WorkflowComponentType) {
  if (type === 'markdown') return ['markdown', 'plainText'];
  if (type === 'file') return ['file', 'path'];
  return ['scene', 'image'];
}

function inputIds(state: WorkflowComponentNodeState, type: WorkflowComponentType) {
  return state.observableInputs && state.observableInputs.length > 0
    ? state.observableInputs
    : defaultInputIds(type);
}

function outputIds(state: WorkflowComponentNodeState, type: WorkflowComponentType) {
  return state.observableOutputs && state.observableOutputs.length > 0
    ? state.observableOutputs
    : defaultOutputIds(type);
}

function uniqueHandleIds(ids: string[], fallback: string) {
  const seen = new Set<string>();
  const next = ids
    .map(id => String(id || '').trim())
    .filter(Boolean)
    .filter(id => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  return next.length > 0 ? next : [fallback];
}

function handleTop(index: number, total: number) {
  if (total <= 1) return '50%';
  const start = 30;
  const end = 70;
  return `${start + ((end - start) * index) / (total - 1)}%`;
}

export default function WorkflowComponentNode({ data, selected }: NodeProps<WorkflowComponentFlowNode>) {
  const state = data.componentState;
  const type = (state.type || data.workflowNode.componentType || 'markdown') as WorkflowComponentType;
  const zoom = Math.max(0.05, Number(data.viewportZoom || 1));
  const handleScale = 1 / zoom;
  const inputs = uniqueHandleIds(inputIds(state, type), 'input');
  const outputs = uniqueHandleIds(outputIds(state, type), 'output');
  const handleBaseStyle = {
    width: 12,
    height: 12,
    zIndex: 30,
    pointerEvents: 'all' as const,
    transformOrigin: 'center',
  };

  return (
    <section
      data-testid="workflow-component-node"
      data-node-id={state.nodeId}
      data-react-flow-node="true"
      data-source-of-truth="backend"
      data-selected={selected ? 'true' : 'false'}
      data-component-type={type}
      className="workflow-component-node"
    >
      {inputs.map((inputId, index) => (
        <Handle
          key={`input-${inputId}`}
          id={inputId}
          type="target"
          position={Position.Left}
          data-testid="workflow-component-node-input"
          data-input-id={inputId}
          data-handle-index={index}
          data-handle-role="input"
          className="wf-flow-handle workflow-component-node-handle workflow-component-node-handle-input"
          style={{
            ...handleBaseStyle,
            top: handleTop(index, inputs.length),
            transform: `translate(-50%, -50%) scale(${handleScale})`,
          }}
        />
      ))}
      {outputs.map((outputId, index) => (
        <Handle
          key={`output-${outputId}`}
          id={outputId}
          type="source"
          position={Position.Right}
          data-testid="workflow-component-node-output"
          data-output-id={outputId}
          data-handle-index={index}
          data-handle-role="output"
          className="wf-flow-handle workflow-component-node-handle workflow-component-node-handle-output"
          style={{
            ...handleBaseStyle,
            top: handleTop(index, outputs.length),
            transform: `translate(50%, -50%) scale(${handleScale})`,
          }}
        />
      ))}

      <header className="workflow-component-node-header">
        <div>
          <ComponentBrandIcon type={type} size={15} />
          <span>{state.title || data.workflowNode.label || type}</span>
        </div>
        <span>{type}</span>
      </header>

      {type === 'excalidraw' ? (
        <ExcalidrawComponentNode
          state={state}
          onSave={patch => data.onSaveComponentNode(state.nodeId, patch)}
        />
      ) : type === 'file' ? (
        <FileComponentNode state={state} />
      ) : (
        <MarkdownComponentNode
          state={state}
          onSave={patch => data.onSaveComponentNode(state.nodeId, patch)}
        />
      )}
    </section>
  );
}
