import { Boxes, Network, PackagePlus } from 'lucide-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { WorkflowAgentControl, WorkflowCapabilityNodeState, WorkflowNode } from '../types';

export type WorkflowCapabilityNodeData = Record<string, unknown> & {
  workflowNode: WorkflowNode;
  capabilityState?: WorkflowCapabilityNodeState;
  viewportZoom: number;
  agentControl?: WorkflowAgentControl;
};

export type WorkflowCapabilityFlowNode = import('@xyflow/react').Node<WorkflowCapabilityNodeData, 'workflowCapabilityNode'>;

export default function WorkflowCapabilityNode({ data, selected }: NodeProps<WorkflowCapabilityFlowNode>) {
  const state = data.capabilityState;
  const zoom = Math.max(0.05, Number(data.viewportZoom) || 1);
  const handleScale = 1 / zoom;
  const capabilityType = state?.type || data.workflowNode.type || 'skill-group';
  const skillCount = Number(state?.skillCount ?? state?.skills?.length ?? 0);
  const skillNames = state?.skillNames?.length
    ? state.skillNames
    : (state?.skills || []).map(skill => skill.name).filter(Boolean);
  const serverCount = Number(state?.serverCount ?? state?.servers?.length ?? 0);
  const serverNames = state?.serverNames?.length
    ? state.serverNames
    : (state?.servers || []).map(server => server.name).filter(Boolean);
  const isMcp = capabilityType === 'mcp-connector';
  const itemCount = isMcp ? serverCount : skillCount;
  const itemNames = isMcp ? serverNames : skillNames;
  const itemLabel = isMcp ? 'servers' : 'skills';
  const title = state?.title || data.workflowNode.label || (isMcp ? 'MCP Connector' : 'Skill Group');
  const subtitle = isMcp
    ? ((state?.transports || []).join(', ') || state?.nodeSemantics?.safety || state?.sourceGroup?.label || 'MCP metadata')
    : (state?.sourceGroup?.label || state?.category || state?.description || 'Capability pack');
  const handleBaseStyle = {
    width: 16,
    height: 16,
    zIndex: 30,
    pointerEvents: 'all' as const,
    transformOrigin: 'center',
  };

  return (
    <article
      data-testid="workflow-capability-node"
      data-node-id={data.workflowNode.id}
      data-capability-type={capabilityType}
      data-skill-count={skillCount}
      data-server-count={serverCount}
      data-group-id={!isMcp ? (state?.sourceGroup?.id || '') : ''}
      data-pack-slug={!isMcp ? (state?.installSource?.packSlug || '') : ''}
      data-lock-ref={!isMcp ? (state?.lockRef || '') : ''}
      data-connected-agent-count={(((data.workflowNode as any).connections || []) as any[]).filter(connection => connection?.peerKind === 'terminal-session' || String(connection?.peerNodeId || '').startsWith('session-')).length || 0}
      data-mcp-safety={isMcp ? (state?.nodeSemantics?.safety || 'metadata-only-no-spawn-no-secret') : ''}
      data-agent-controlled={data.agentControl?.active ? 'true' : undefined}
      data-agent-control-operation-id={data.agentControl?.active ? data.agentControl.operationId : undefined}
      className={`workflow-capability-node ${selected ? 'workflow-capability-node-selected' : ''}`}
      style={{ '--agent-control-color': data.agentControl?.color || '#22c55e' } as CSSProperties}
    >
      {(['left', 'right', 'top', 'bottom'] as const).map(side => (
        <Handle
          key={side}
          type="source"
          id={`capability:${side}`}
          position={side === 'left' ? Position.Left : side === 'right' ? Position.Right : side === 'top' ? Position.Top : Position.Bottom}
          data-testid="workflow-capability-node-port"
          data-handle-side={side}
          data-handle-mode="bidirectional"
          data-handle-role="bidirectional"
          className={`wf-flow-handle nodrag nopan workflow-capability-node-handle workflow-capability-node-handle-${side}`}
          isConnectableStart
          isConnectableEnd
          style={{
            ...handleBaseStyle,
            ...(side === 'left' || side === 'right' ? { top: '50%' } : { left: '50%' }),
            transform: side === 'left'
              ? `translate(-50%, -50%) scale(${handleScale})`
              : side === 'right'
                ? `translate(50%, -50%) scale(${handleScale})`
                : side === 'top'
                  ? `translate(-50%, -50%) scale(${handleScale})`
                  : `translate(-50%, 50%) scale(${handleScale})`,
          }}
        />
      ))}
      <header className="workflow-capability-node-header">
        <div className="workflow-capability-node-icon">
          {isMcp ? <Network size={16} /> : <PackagePlus size={16} />}
        </div>
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
      </header>
      <div className="workflow-capability-node-body">
        <div className="workflow-capability-node-count">
          <Boxes size={14} />
          <strong>{itemCount}</strong>
          <span>{itemLabel}</span>
        </div>
        <div className="workflow-capability-node-skills">
          {itemNames.slice(0, 5).map(name => <span key={name}>{name}</span>)}
          {itemNames.length > 5 && <span>+{itemNames.length - 5}</span>}
        </div>
      </div>
    </article>
  );
}
