// WorkflowDisplayView.tsx
//
// Fullscreen view for Display nodes: renders the agent-authored HTML report in
// an iframe. Per user decision the report content is FULLY-OPEN JS (agent
// output carries the same trust as the agent's own terminal) — the iframe
// keeps its DOM/CSS isolated from the app shell.
// Rides the shared WorkflowNodeDetailOverlay chrome (same animation, layout,
// and interactions as timer/goal/file detail views).

import { useCallback, useState } from 'react';
import { RotateCw, ExternalLink, FileText } from 'lucide-react';
import WorkflowNodeDetailOverlay from './WorkflowNodeDetailOverlay';

type Props = {
  open: boolean;
  nodeId: string;
  title?: string;
  onClose: () => void;
};

export default function WorkflowDisplayView({ open, nodeId, title, onClose }: Props) {
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    setNonce(current => current + 1);
  }, []);

  const src = `/api/a2a/component-nodes/${encodeURIComponent(nodeId)}/html?n=${nonce}`;

  const actions = (
    <>
      <button
        type="button"
        data-testid="workflow-display-refresh"
        onClick={refresh}
        title="Refresh"
        className="workflow-node-detail-action"
      >
        <RotateCw size={13} /> Refresh
      </button>
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        title="Open in a new tab"
        className="workflow-node-detail-action"
      >
        <ExternalLink size={13} /> Open
      </a>
    </>
  );

  return (
    <WorkflowNodeDetailOverlay
      open={open}
      onClose={onClose}
      title={title || 'Report'}
      icon={<FileText size={16} />}
      actions={actions}
      testId="workflow-display-view"
      dataNodeId={nodeId}
      className="workflow-display-expanded-shell"
    >
      {error ? (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#991b1b', fontSize: 13 }}>
          {error}
        </div>
      ) : (
        <iframe
          title="display-report"
          src={src}
          onError={() => setError('Failed to load the report HTML')}
          style={{ width: '100%', height: '100%', border: 'none', background: '#ffffff' }}
        />
      )}
    </WorkflowNodeDetailOverlay>
  );
}
