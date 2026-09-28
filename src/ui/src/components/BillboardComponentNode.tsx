import type { WorkflowComponentNodeState } from '../types';

export default function BillboardComponentNode({ state }: { state: WorkflowComponentNodeState }) {
  const entries = String(state.markdown || '')
    .split(/\r?\n/)
    .map(entry => entry.trim())
    .filter(Boolean)
    .slice(-20);

  return (
    <div
      data-testid="workflow-billboard-node"
      data-node-id={state.nodeId}
      data-revision={state.revision}
      aria-label={`${state.title || 'Billboard'}, revision ${state.revision}`}
      className="workflow-billboard"
      role="list"
    >
      {entries.length > 0 ? entries.map((entry, index) => (
        <div
          key={`${index}-${entry}`}
          data-testid="workflow-billboard-entry"
          title={entry}
          aria-label={entry}
          className="workflow-billboard-entry"
          role="listitem"
        >
          {entry}
        </div>
      )) : (
        <div className="workflow-billboard-empty" role="listitem">No updates yet</div>
      )}
    </div>
  );
}
