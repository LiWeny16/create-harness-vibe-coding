import { useT } from '../../i18n';
import type { WorkflowRuntimeNode } from './nodeRuntimeClient';
import NodeSettingsShell from './NodeSettingsShell';

type Props = { node: WorkflowRuntimeNode; onClose: () => void; onDelete: () => void };

export default function GoalNodeSettings({ node, onClose, onDelete }: Props) {
  const t = useT();
  const progress = (node.progress || {}) as { verified?: number; total?: number };

  return (
    <NodeSettingsShell node={node} onClose={onClose} onDelete={onDelete}>
      <dl className="workflow-runtime-settings-list">
        <dt>{t('Kind')}</dt>
        <dd>{t('Goal')}</dd>
        <dt>{t('Task')}</dt>
        <dd>{String(node.taskId || node.contentRef?.taskId || '')}</dd>
        <dt>{t('Status')}</dt>
        <dd>{node.status?.state || 'active'}</dd>
        <dt>{t('Progress')}</dt>
        <dd>{Number(progress.verified || 0)}/{Number(progress.total || 0)}</dd>
      </dl>
    </NodeSettingsShell>
  );
}
