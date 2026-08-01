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

function inputIds(state: WorkflowComponentNodeState) {
  return state.observableInputs && state.observableInputs.length > 0
    ? state.observableInputs
    : ['selection'];
}

function outputIds(state: WorkflowComponentNodeState) {
  return state.observableOutputs && state.observableOutputs.length > 0
    ? state.observableOutputs
    : ['content'];
}

function primaryHandleId(ids: string[], fallback: string) {
  return ids.find(id => String(id || '').trim()) || fallback;
}

export default function WorkflowComponentNode({ data, selected }: NodeProps<WorkflowComponentFlowNode>) {
  const state = data.componentState;
  const type = (state.type || data.workflowNode.componentType || 'markdown') as WorkflowComponentType;
  const zoom = Math.max(0.05, Number(data.viewportZoom || 1));
  const handleScale = 1 / zoom;
  const inputId = primaryHandleId(inputIds(state), 'input');
  const outputId = primaryHandleId(outputIds(state), 'output');
  const handleBaseStyle = {
    width: 12,
    height: 12,
    top: '50%',
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
      <Handle
        id={inputId}
        type="target"
        position={Position.Left}
        data-testid="workflow-component-node-input"
        data-input-id={inputId}
        data-handle-role="input"
        className="wf-flow-handle workflow-component-node-handle workflow-component-node-handle-input"
        style={{ ...handleBaseStyle, transform: `translate(-50%, -50%) scale(${handleScale})` }}
      />
      <Handle
        id={outputId}
        type="source"
        position={Position.Right}
        data-testid="workflow-component-node-output"
        data-output-id={outputId}
        data-handle-role="output"
        className="wf-flow-handle workflow-component-node-handle workflow-component-node-handle-output"
        style={{ ...handleBaseStyle, transform: `translate(50%, -50%) scale(${handleScale})` }}
      />

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
