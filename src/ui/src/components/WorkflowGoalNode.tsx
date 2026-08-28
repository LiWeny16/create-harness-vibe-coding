import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { CheckCircle2, Circle, Target, X } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import type { WorkflowAgentControl, WorkflowGoalNodeState, WorkflowNode } from '../types';
import { goalStateFromActionBody, runWorkflowNodeAction, showGoalActionErrorToast } from '../workflowToast';

export type WorkflowGoalNodeData = Record<string, unknown> & {
  workflowNode: WorkflowNode;
  goalState?: WorkflowGoalNodeState;
  viewportZoom: number;
  agentControl?: WorkflowAgentControl;
};

export type WorkflowGoalFlowNode = import('@xyflow/react').Node<WorkflowGoalNodeData, 'workflowGoalNode'>;

function statusLabel(value: string | undefined) {
  return String(value || 'active').replace(/-/g, ' ');
}

function isDoneStatus(value: string | undefined) {
  return /done|pass|passed|verified|complete|completed/i.test(String(value || ''));
}

function isProposedComplete(value: string | undefined) {
  return /proposed-complete/i.test(String(value || ''));
}

export default function WorkflowGoalNode({ data, selected }: NodeProps<WorkflowGoalFlowNode>) {
  const node = data.workflowNode;
  const propState = data.goalState;
  const zoom = Math.max(0.05, Number(data.viewportZoom || 1));
  const handleScale = 1 / zoom;
  // Goal item actions (goal.check/uncheck/delete/complete) refresh the card
  // from the action response's after-snapshot; the prop snapshot wins again
  // once the workflow poll catches up (prop revision >= action revision).
  const [actionState, setActionState] = useState<WorkflowGoalNodeState | undefined>(undefined);
  const [actionPending, setActionPending] = useState(false);
  const state = actionState && (actionState.revision ?? 0) > (propState?.revision ?? 0) ? actionState : propState;
  const graphId = node.graphNodeId || node.id;
  const acceptance = state?.acceptance || [];
  const progress = state?.progress || { verified: 0, total: acceptance.length };
  const planItems = state?.planItems || [];
  const verified = Number(progress.verified || 0);
  const total = Number(progress.total || acceptance.length || 0);
  const planDone = planItems.filter(item => isDoneStatus(item.status)).length;
  const trackedItems = planItems.length ? planItems : acceptance;
  const trackedDone = planItems.length ? planDone : verified;
  const trackedTotal = planItems.length ? planItems.length : total;
  const trackedLabel = planItems.length ? 'Plan' : 'Acceptance';
  const percent = trackedTotal > 0 ? Math.max(0, Math.min(100, Math.round((trackedDone / trackedTotal) * 100))) : 0;
  const healthState = String(state?.wdt?.state || '').trim();
  const proposedComplete = isProposedComplete(state?.status);

  const runGoalAction = async (action: string, payload: Record<string, unknown>) => {
    if (actionPending) return;
    setActionPending(true);
    try {
      const body = await runWorkflowNodeAction(graphId, action, payload);
      const snapshot = goalStateFromActionBody(body);
      if (snapshot) setActionState(snapshot);
    } catch (error) {
      showGoalActionErrorToast(error, `Goal action ${action} failed`, action);
    } finally {
      setActionPending(false);
    }
  };

  const toggleItem = (item: { id?: string; status?: string }) => {
    if (!item.id) return;
    void runGoalAction(isDoneStatus(item.status) ? 'goal.uncheck' : 'goal.check', {
      planItemIds: [item.id],
      actorNodeId: 'browser',
    });
  };

  const deleteItem = (item: { id?: string }) => {
    if (!item.id) return;
    void runGoalAction('goal.delete', { planItemIds: [item.id] });
  };

  const completeGoal = () => {
    void runGoalAction('goal.complete', {});
  };

  const handleStyle = {
    width: 16,
    height: 16,
    zIndex: 30,
    pointerEvents: 'all' as const,
    transformOrigin: 'center',
  };
  const handles = [
    { id: 'goal:top', side: 'top', position: Position.Top, style: { left: '50%', transform: `translate(-50%, -50%) scale(${handleScale})` } },
    { id: 'goal:right', side: 'right', position: Position.Right, style: { top: '50%', transform: `translate(50%, -50%) scale(${handleScale})` } },
    { id: 'goal:bottom', side: 'bottom', position: Position.Bottom, style: { left: '50%', transform: `translate(-50%, 50%) scale(${handleScale})` } },
    { id: 'goal:left', side: 'left', position: Position.Left, style: { top: '50%', transform: `translate(-50%, -50%) scale(${handleScale})` } },
  ];

  return (
    <section
      data-testid="workflow-goal-node"
      data-node-id={node.graphNodeId || node.id}
      data-goal-status={state?.status || node.status || 'active'}
      data-selected={selected ? 'true' : 'false'}
      data-agent-controlled={data.agentControl?.active ? 'true' : undefined}
      data-agent-control-operation-id={data.agentControl?.active ? data.agentControl.operationId : undefined}
      className="workflow-goal-node"
      style={{
        '--agent-control-color': data.agentControl?.color || '#22c55e',
        width: 320,
        height: 220,
        border: `1px solid ${selected ? '#0f766e' : '#99f6e4'}`,
        borderRadius: 14,
        background: '#f8fffb',
        boxShadow: selected ? '0 14px 34px rgba(15,118,110,0.18)' : '0 10px 28px rgba(15,23,42,0.09)',
        color: 'var(--fg)',
        position: 'relative',
        display: 'grid',
        gridTemplateRows: 'auto auto minmax(0, 1fr) auto',
        padding: 12,
        gap: 8,
      } as CSSProperties}
    >
      {handles.map(handle => (
        <Handle
          key={handle.side}
          id={handle.id}
          type="source"
          position={handle.position}
          data-testid="workflow-goal-node-port"
          data-handle-side={handle.side}
          data-handle-role="bidirectional"
          isConnectableStart
          isConnectableEnd
          className={`wf-flow-handle nodrag nopan workflow-goal-node-handle workflow-goal-node-handle-${handle.side}`}
          style={{
            ...handleStyle,
            ...handle.style,
          }}
        />
      ))}

      <header style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid #99f6e4', borderRadius: 'var(--radius)', color: '#0f766e', background: '#ccfbf1' }}>
          <Target size={16} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 850, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {state?.title || node.label || 'Goal'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 800 }}>
            {state?.taskId || node.taskId || 'active task'}
          </div>
        </div>
        <span
          data-testid="workflow-goal-status"
          style={{ border: '1px solid #99f6e4', borderRadius: 999, padding: '3px 8px', background: '#ecfdf5', color: '#047857', fontSize: 10, fontWeight: 850, textTransform: 'uppercase' }}
        >
          {statusLabel(state?.status || node.status)}
        </span>
      </header>

      <div data-testid="workflow-goal-progress" style={{ display: 'grid', gap: 5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', fontWeight: 750 }}>
          <span>{trackedLabel}</span>
          <span>{trackedDone}/{trackedTotal}</span>
        </div>
        <div style={{ height: 7, borderRadius: 999, overflow: 'hidden', background: '#d1fae5' }}>
          <div style={{ width: `${percent}%`, height: '100%', background: '#10b981' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 5, minHeight: 0, overflow: 'hidden' }}>
        {(trackedItems.length ? trackedItems : [{ id: 'goal', text: state?.title || 'No plan loaded', status: state?.status || 'active' }]).slice(0, 2).map((item, index) => {
          const interactive = planItems.length > 0 && Boolean(item.id);
          return (
            <div
              key={`${item.id || index}`}
              data-testid={planItems.length ? 'workflow-goal-plan-item' : 'workflow-goal-acceptance-item'}
              data-item-id={item.id || ''}
              data-item-state={item.status || 'tracked'}
              style={{ display: 'grid', gridTemplateColumns: interactive ? '18px 1fr auto 16px' : '16px 1fr auto', gap: 6, alignItems: 'center', minWidth: 0, fontSize: 11 }}
            >
              {interactive ? (
                <button
                  type="button"
                  className="nodrag nopan"
                  data-testid="workflow-goal-item-check"
                  data-item-id={item.id}
                  data-state={isDoneStatus(item.status) ? 'done' : 'todo'}
                  onClick={event => { event.stopPropagation(); toggleItem(item); }}
                  disabled={actionPending}
                  title={isDoneStatus(item.status) ? 'Uncheck item' : 'Check item'}
                  style={{ display: 'grid', placeItems: 'center', width: 18, height: 18, padding: 0, border: 'none', background: 'transparent', cursor: actionPending ? 'wait' : 'pointer' }}
                >
                  {isDoneStatus(item.status) ? <CheckCircle2 size={13} color="#059669" /> : <Circle size={13} color="#94a3b8" />}
                </button>
              ) : (isDoneStatus(item.status) ? <CheckCircle2 size={13} color="#059669" /> : <Circle size={13} color="#94a3b8" />)}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text || item.id || trackedLabel}</span>
              <span style={{ color: 'var(--muted)', fontWeight: 750 }}>{item.status || 'tracked'}</span>
              {interactive && (
                <button
                  type="button"
                  className="nodrag nopan"
                  data-testid="workflow-goal-item-delete"
                  data-item-id={item.id}
                  onClick={event => { event.stopPropagation(); deleteItem(item); }}
                  disabled={actionPending}
                  title="Delete item"
                  style={{ display: 'grid', placeItems: 'center', width: 16, height: 16, padding: 0, border: 'none', background: 'transparent', color: '#b91c1c', cursor: actionPending ? 'wait' : 'pointer' }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <footer data-testid="workflow-goal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 11 }}>
        <span>{trackedLabel} {trackedDone}/{trackedTotal}</span>
        {healthState && <span data-testid="workflow-goal-health">Check {healthState}</span>}
        <button
          type="button"
          className="nodrag nopan"
          data-testid="workflow-goal-complete"
          onClick={event => { event.stopPropagation(); completeGoal(); }}
          disabled={actionPending || proposedComplete}
          title={proposedComplete ? 'Goal already proposed complete' : 'Complete goal (requires all items checked)'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 7px',
            border: `1px solid ${proposedComplete ? '#99f6e4' : '#a7f3d0'}`,
            borderRadius: 999,
            background: proposedComplete ? '#ecfdf5' : '#d1fae5',
            color: proposedComplete ? '#047857' : '#065f46',
            fontSize: 10,
            fontWeight: 800,
            cursor: actionPending ? 'wait' : (proposedComplete ? 'default' : 'pointer'),
            opacity: actionPending ? 0.6 : 1,
          }}
        >
          <CheckCircle2 size={11} />
          {proposedComplete ? 'Proposed' : 'Complete'}
        </button>
        <span>rev {state?.revision ?? node.revision ?? 0}</span>
      </footer>
    </section>
  );
}
