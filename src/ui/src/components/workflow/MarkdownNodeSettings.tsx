import { useState } from 'react';
import { useT } from '../../i18n';
import type { WorkflowRuntimeNode, NodeSettings } from './nodeRuntimeClient';
import NodeSettingsShell from './NodeSettingsShell';
import { patchNodeSettings } from './nodeRuntimeClient';

type Props = {
  node: WorkflowRuntimeNode;
  onClose: () => void;
  onDelete: () => void;
};

export default function MarkdownNodeSettings({ node, onClose, onDelete }: Props) {
  const t = useT();
  const s = node.settings.values;
  const [wordWrap, setWordWrap] = useState(Boolean(s.wordWrap ?? true));
  const [fontSize, setFontSize] = useState(Number(s.fontSize || 14));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      await patchNodeSettings(node.nodeId, { wordWrap, fontSize });
    } catch (e: any) { setError(e?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <NodeSettingsShell node={node} onClose={onClose} onDelete={onDelete}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input data-testid="workflow-markdown-settings-word-wrap" type="checkbox" checked={wordWrap}
          onChange={e => setWordWrap(e.target.checked)} />
        {t('Word wrap')}
      </label>
      <div>
        <label>{t('Font size')}</label>
        <input data-testid="workflow-markdown-settings-font-size" type="number" min={10} max={32}
          value={fontSize} onChange={e => setFontSize(Number(e.target.value))} />
      </div>
      {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
      <button data-testid="workflow-markdown-settings-save" onClick={save} disabled={saving}>
        {saving ? t('Saving...') : t('Save')}
      </button>
    </NodeSettingsShell>
  );
}
