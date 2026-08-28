import { useT } from '../../i18n';
import type { WorkflowRuntimeNode } from './nodeRuntimeClient';
import NodeSettingsShell from './NodeSettingsShell';

type Props = { node: WorkflowRuntimeNode; onClose: () => void; onDelete: () => void };

export default function TimerNodeSettings({ node, onClose, onDelete }: Props) {
  const t = useT();

  return (
    <NodeSettingsShell node={node} onClose={onClose} onDelete={onDelete}>
      <dl className="workflow-runtime-settings-list">
        <dt>{t('Kind')}</dt>
        <dd>{t('Timer')}</dd>
        <dt>{t('Mode')}</dt>
        <dd>{String(node.ui?.previewKind || 'timer')}</dd>
        <dt>{t('State')}</dt>
        <dd>{node.status?.state || 'ready'}</dd>
        <dt>{t('Connections')}</dt>
        <dd>{node.graph.connections.length}</dd>
      </dl>
    </NodeSettingsShell>
  );
}
