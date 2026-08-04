import type { CSSProperties, ReactNode } from 'react';
import { X, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useT } from '../../i18n';
import type { WorkflowRuntimeNode } from './nodeRuntimeClient';

type Props = {
  node: WorkflowRuntimeNode;
  onClose: () => void;
  onDelete: () => void;
  children: ReactNode;
};

export default function NodeSettingsShell({ node, onClose, onDelete, children }: Props) {
  const t = useT();
  const kind = node.kind;

  const panelStyle: CSSProperties = {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'rgba(255,255,255,0.96)',
    boxShadow: '0 18px 46px rgba(15,23,42,0.14)',
    backdropFilter: 'blur(16px)',
  };

  return (
    <motion.aside
      data-canvas-control="true"
      data-testid="workflow-component-settings"
      data-node-id={node.nodeId}
      data-node-kind={kind}
      className="workflow-node-settings workflow-component-settings wf-floating-panel nodrag nopan nowheel"
      style={panelStyle}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 230, damping: 30, mass: 0.86 }}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
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
    </motion.aside>
  );
}
