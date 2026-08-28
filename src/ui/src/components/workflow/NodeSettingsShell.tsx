import { useEffect, type ReactNode } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import type { WorkflowRuntimeNode } from './nodeRuntimeClient';
import WorkflowFloatingPanel from './WorkflowFloatingPanel';

type Props = {
  node: WorkflowRuntimeNode;
  onClose: () => void;
  onDelete: () => void;
  children: ReactNode;
};

export default function NodeSettingsShell({ node, onClose, onDelete, children }: Props) {
  const t = useT();
  const kind = node.kind;

  // Unified interaction: Esc closes every node settings page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <WorkflowFloatingPanel
      dataTestId="workflow-component-settings"
      nodeId={node.nodeId}
      nodeKind={kind}
      className="workflow-node-settings workflow-component-settings"
      layer="settings"
      bare
    >
      {/* Header */}
      <div className="workflow-node-settings-header">
        <div className="workflow-node-settings-title">
          <span>{node.ui?.labels?.title || kind}</span>
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{node.nodeId}</span>
        </div>
        <div className="workflow-node-settings-header-actions">
          <button type="button" title={t('Close')} onClick={onClose} className="workflow-node-settings-icon">
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Body: per-type fields */}
      <div className="workflow-node-settings-body">
        {children}
      </div>

      {/* Footer */}
      <div className="workflow-node-settings-footer">
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>rev {node.version}</span>
        <button
          type="button"
          onClick={onDelete}
          title={t('Delete node')}
          className="workflow-node-settings-button danger"
        >
          <Trash2 size={12} /> {t('Delete')}
        </button>
      </div>
    </WorkflowFloatingPanel>
  );
}
