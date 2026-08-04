import { useState } from 'react';
import { Play, RefreshCw, Send, Square, Terminal } from 'lucide-react';
import { useT } from '../../i18n';
import type { WorkflowRuntimeNode } from './nodeRuntimeClient';
import NodeSettingsShell from './NodeSettingsShell';
import { executeNodeActionResponse } from './nodeRuntimeClient';

type Props = { node: WorkflowRuntimeNode; onClose: () => void; onDelete: () => void };

type ActionResult = {
  entries?: Array<{ seq?: number; stream?: string; data?: string }>;
  connections?: unknown[];
  availableActions?: string[];
  [key: string]: unknown;
};

function textFromResult(result: unknown) {
  const value = result as ActionResult | undefined;
  if (Array.isArray(value?.entries)) {
    return value.entries.map(entry => String(entry.data || '')).join('').trimEnd();
  }
  if (result === undefined || result === null) return '';
  return JSON.stringify(result, null, 2);
}

export default function AgentNodeSettings({ node, onClose, onDelete }: Props) {
  const t = useT();
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const run = async (action: string, payload?: unknown) => {
    setBusy(action);
    setError('');
    try {
      const response = await executeNodeActionResponse(node.nodeId, action, payload);
      setOutput(textFromResult(response.result || response));
      return response;
    } catch (e: any) {
      setError(e?.message || t('Agent action failed'));
      return null;
    } finally {
      setBusy('');
    }
  };

  const sendInput = async () => {
    if (!input) return;
    const sent = await run('agent.sendInput', { text: input.endsWith('\n') ? input : `${input}\n` });
    if (sent) setInput('');
  };

  return (
    <NodeSettingsShell node={node} onClose={onClose} onDelete={onDelete}>
      <div className="workflow-node-settings-section">
        <div className="workflow-node-settings-grid">
          <div>
            <div className="workflow-node-settings-label">{t('Session')}</div>
            <input data-testid="workflow-agent-settings-session" value={String(node.sessionId || node.nodeId)} readOnly />
          </div>
          <div>
            <div className="workflow-node-settings-label">{t('Status')}</div>
            <input data-testid="workflow-agent-settings-status" value={String(node.status?.state || node.lifecycle)} readOnly />
          </div>
        </div>
      </div>

      <div className="workflow-node-settings-section">
        <div className="workflow-node-settings-add-row">
          <input
            data-testid="workflow-agent-settings-input"
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder={t('Send input')}
          />
          <button
            type="button"
            data-testid="workflow-agent-settings-send"
            className="workflow-node-settings-primary"
            onClick={sendInput}
            disabled={!input || busy === 'agent.sendInput'}
          >
            <Send size={12} /> {t('Send')}
          </button>
        </div>
      </div>

      <div className="workflow-node-settings-section">
        <div className="workflow-node-settings-segmented">
          <button type="button" data-testid="workflow-agent-settings-start" onClick={() => run('agent.start')} disabled={Boolean(busy)}>
            <Play size={12} /> {t('Start')}
          </button>
          <button type="button" data-testid="workflow-agent-settings-stop" onClick={() => run('agent.stop')} disabled={Boolean(busy)}>
            <Square size={12} /> {t('Stop')}
          </button>
          <button type="button" data-testid="workflow-agent-settings-restart" onClick={() => run('agent.restart')} disabled={Boolean(busy)}>
            <RefreshCw size={12} /> {t('Restart')}
          </button>
        </div>
      </div>

      <div className="workflow-node-settings-section">
        <div className="workflow-node-settings-segmented">
          <button type="button" data-testid="workflow-agent-settings-output" onClick={() => run('agent.readOutput', { tail: 80 })} disabled={Boolean(busy)}>
            <Terminal size={12} /> {t('Output')}
          </button>
          <button type="button" data-testid="workflow-agent-settings-transcript" onClick={() => run('agent.readTranscript', { tail: 200 })} disabled={Boolean(busy)}>
            <Terminal size={12} /> {t('Transcript')}
          </button>
          <button type="button" data-testid="workflow-agent-settings-context" onClick={() => run('agent.readContext')} disabled={Boolean(busy)}>
            <Terminal size={12} /> {t('Context')}
          </button>
        </div>
      </div>

      {error && <div className="workflow-node-settings-error">{error}</div>}
      <textarea
        data-testid="workflow-agent-settings-output-log"
        value={busy ? t('Loading...') : output}
        readOnly
        rows={8}
      />
    </NodeSettingsShell>
  );
}
