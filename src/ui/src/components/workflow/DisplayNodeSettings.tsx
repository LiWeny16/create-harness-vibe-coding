// DisplayNodeSettings.tsx — settings page for Display (report) nodes.
// Shares the NodeSettingsShell frame with every other node settings page.

import { useT } from '../../i18n';
import type { WorkflowRuntimeNode } from './nodeRuntimeClient';
import NodeSettingsShell from './NodeSettingsShell';

type Props = { node: WorkflowRuntimeNode; onClose: () => void; onDelete: () => void };

export default function DisplayNodeSettings({ node, onClose, onDelete }: Props) {
  const t = useT();

  return (
    <NodeSettingsShell node={node} onClose={onClose} onDelete={onDelete}>
      <dl className="workflow-runtime-settings-list">
        <dt>{t('Kind')}</dt>
        <dd>{t('Display')}</dd>
        <dt>{t('Content')}</dt>
        <dd>{t('HTML report (report.html)')}</dd>
        <dt>{t('State')}</dt>
        <dd>{node.status?.state || 'ready'}</dd>
        <dt>{t('Revision')}</dt>
        <dd>{node.version}</dd>
      </dl>
      <div className="workflow-node-settings-tip" style={{ marginTop: 10, padding: '8px 10px', fontSize: 11, color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
        {t('Agents write the report with display.write (double-click the node to view it fullscreen).')}
      </div>
    </NodeSettingsShell>
  );
}
