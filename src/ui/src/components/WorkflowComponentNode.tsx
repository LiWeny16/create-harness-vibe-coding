import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { RefreshCw } from 'lucide-react';
import type { WorkflowAgentControl, WorkflowComponentNodeState, WorkflowComponentType, WorkflowNode } from '../types';
import { useT } from '../i18n/index';
import { fileRefresh } from './workflow/nodeRuntimeClient';
import MarkdownComponentNode from './MarkdownComponentNode';
import ExcalidrawComponentNode from './ExcalidrawComponentNode';
import FileComponentNode from './FileComponentNode';
import ComponentBrandIcon from './ComponentBrandIcon';

export type WorkflowComponentNodeData = Record<string, unknown> & {
  workflowNode: WorkflowNode;
  componentState: WorkflowComponentNodeState;
  viewportZoom: number;
  agentControl?: WorkflowAgentControl;
  fullscreenRequest?: number;
  onSaveComponentNode: (
    nodeId: string,
    patch: Partial<WorkflowComponentNodeState>,
  ) => Promise<WorkflowComponentNodeState | null>;
  // AC-3/AC-9: set when a WS file.changed event matched this node (badge +
  // manual refresh). onFileNodeRefreshed clears the badge after refresh.
  fileChanged?: boolean;
  onFileNodeRefreshed?: (nodeId: string) => void;
};

export type WorkflowComponentFlowNode = import('@xyflow/react').Node<WorkflowComponentNodeData, 'workflowComponentNode'>;
type ResourceSide = 'top' | 'right' | 'bottom' | 'left';
const RESOURCE_PORT_SIDES: ResourceSide[] = ['top', 'right', 'bottom', 'left'];
const RESOURCE_POSITION_BY_SIDE: Record<ResourceSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

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

function resourcePrimaryPort(type: WorkflowComponentType) {
  if (type === 'excalidraw') return 'scene';
  if (type === 'markdown') return 'markdown';
  return 'file';
}

function isBidirectionalResourceNode(type: WorkflowComponentType) {
  return type === 'markdown' || type === 'excalidraw' || type === 'file';
}

function handleTop(index: number, total: number) {
  if (total <= 1) return '50%';
  const start = 30;
  const end = 70;
  return `${start + ((end - start) * index) / (total - 1)}%`;
}

export default function WorkflowComponentNode({ data, selected }: NodeProps<WorkflowComponentFlowNode>) {
  const t = useT();
  const state = data.componentState;
  const [localFullscreenRequest, setLocalFullscreenRequest] = useState(0);
  // Re-mount key for the file card so the refresh button forces a fresh preview.
  const [fileReloadKey, setFileReloadKey] = useState(0);
  const [fileRefreshing, setFileRefreshing] = useState(false);
  const type = (state.type || data.workflowNode.componentType || 'markdown') as WorkflowComponentType;
  const zoom = Math.max(0.05, Number(data.viewportZoom || 1));
  const handleScale = 1 / zoom;
  const inputs = uniqueHandleIds(inputIds(state, type), 'input');
  const outputs = uniqueHandleIds(outputIds(state, type), 'output');
  const bidirectionalPort = resourcePrimaryPort(type);
  const fullscreenRequest = Math.max(Number(data.fullscreenRequest || 0), localFullscreenRequest);
  const handleSize = 12;
  const handleBaseStyle = {
    width: handleSize,
    height: handleSize,
    zIndex: 30,
    pointerEvents: 'all' as const,
    transformOrigin: 'center',
  };

  // AC-3/AC-9: file.changed badge action — re-stat the bound file, re-mount the
  // card preview, then clear the badge. Failure keeps the badge for a retry.
  const handleFileRefresh = async () => {
    if (fileRefreshing) return;
    setFileRefreshing(true);
    try {
      await fileRefresh(state.nodeId);
      setFileReloadKey(key => key + 1);
      data.onFileNodeRefreshed?.(state.nodeId);
    } catch {
      // keep badge; user can retry or open the big view
    } finally {
      setFileRefreshing(false);
    }
  };

  return (
    <section
      data-testid="workflow-component-node"
      data-node-id={state.nodeId}
      data-react-flow-node="true"
      data-source-of-truth="backend"
      data-selected={selected ? 'true' : 'false'}
      data-agent-controlled={data.agentControl?.active ? 'true' : undefined}
      data-agent-control-operation-id={data.agentControl?.active ? data.agentControl.operationId : undefined}
      data-component-type={type}
      className="workflow-component-node"
      style={{ '--agent-control-color': data.agentControl?.color || '#22c55e' } as CSSProperties}
      onDoubleClick={(event) => {
        if (!isBidirectionalResourceNode(type)) return;
        event.stopPropagation();
        setLocalFullscreenRequest(Date.now());
      }}
    >
      {isBidirectionalResourceNode(type) ? (
        RESOURCE_PORT_SIDES.map(side => {
          const isVertical = side === 'top' || side === 'bottom';
          const isPositive = side === 'right' || side === 'bottom';
          const translateX = side === 'left' ? '-50%' : isVertical ? '-50%' : '50%';
          const translateY = side === 'top' ? '-50%' : isVertical ? (isPositive ? '50%' : '50%') : '-50%';
          const positionStyle: Record<string, string | number> = isVertical
            ? { left: '50%' }
            : { top: '50%' };
          return (
            <Handle
              key={`resource-${bidirectionalPort}-${side}`}
              id={`${bidirectionalPort}:${side}`}
              type="source"
              position={RESOURCE_POSITION_BY_SIDE[side]}
              isConnectableStart
              isConnectableEnd
              data-testid="workflow-component-node-port"
              data-port-id={bidirectionalPort}
              data-side={side}
              data-handle-mode="bidirectional"
              data-handle-role="bidirectional"
              className={`wf-flow-handle nodrag nopan workflow-component-node-handle workflow-component-node-handle-bidirectional workflow-component-node-handle-${side} wf-flow-handle-${side}`}
              style={{
                ...handleBaseStyle,
                ...positionStyle,
                transform: `translate(${translateX}, ${translateY}) scale(${handleScale})`,
              }}
            />
          );
        })
      ) : (
        <>
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
              className="wf-flow-handle nodrag nopan workflow-component-node-handle workflow-component-node-handle-input"
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
              className="wf-flow-handle nodrag nopan workflow-component-node-handle workflow-component-node-handle-output"
              style={{
                ...handleBaseStyle,
                top: handleTop(index, outputs.length),
                transform: `translate(50%, -50%) scale(${handleScale})`,
              }}
            />
          ))}
        </>
      )}

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
          openRequest={fullscreenRequest}
        />
      ) : type === 'file' ? (
        <div style={{ position: 'relative', minWidth: 0, minHeight: 0 }}>
          <FileComponentNode key={fileReloadKey} state={state} />
          {data.fileChanged && (
            <div
              data-testid="workflow-file-node-changed"
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                zIndex: 5,
                pointerEvents: 'auto',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: '#fef3c7',
                  border: '1px solid #f59e0b',
                  color: '#92400e',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: 0.2,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                {t('Changed')}
              </span>
              <button
                type="button"
                data-testid="workflow-file-node-refresh"
                title={t('Refresh')}
                aria-label={t('Refresh')}
                onClick={handleFileRefresh}
                disabled={fileRefreshing}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 22,
                  height: 22,
                  border: '1px solid #f59e0b',
                  borderRadius: 999,
                  background: '#ffffff',
                  color: '#92400e',
                  cursor: fileRefreshing ? 'default' : 'pointer',
                  padding: 0,
                }}
              >
                <RefreshCw size={12} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <MarkdownComponentNode
          state={state}
          onSave={patch => data.onSaveComponentNode(state.nodeId, patch)}
          openRequest={fullscreenRequest}
        />
      )}
    </section>
  );
}
