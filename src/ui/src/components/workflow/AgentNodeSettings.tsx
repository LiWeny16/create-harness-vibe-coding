import { useEffect, useState } from 'react';
import { Play, RefreshCw, Send, Square, Terminal } from 'lucide-react';
import { apiJsonCached } from '../../api';
import { useT } from '../../i18n';
import type { SubagentMode, WorkflowSnapshot } from '../../types';
import type { WorkflowRuntimeNode } from './nodeRuntimeClient';
import NodeSettingsShell from './NodeSettingsShell';
import { executeNodeActionResponse, patchNodeSettings } from './nodeRuntimeClient';

type Props = { node: WorkflowRuntimeNode; onClose: () => void; onDelete: () => void; loading?: boolean };

// Role profile identity fields (agent-team-cooperation-spec §3.1): canonical
// roleTitle vocabulary plus free-form roles preserved as-is.
const ROLE_TITLE_PRESETS = ['ceo', 'manager', 'implementer', 'reviewer', 'verifier', 'planner', 'terminal-controller'];
const CUSTOM_ROLE_TITLE = '__custom__';

// Subagent orchestration modes. The dropdown is driven by the snapshot's
// `subagentModes` catalog when available; this constant mirrors the backend
// catalog (a2a-store.mjs) as a fallback.
const DEFAULT_SUBAGENT_MODES: { id: SubagentMode; label: string }[] = [
  { id: 'built-in-subagents', label: 'Built-in Subagents' },
  { id: 'wf-node-subagents', label: 'WF Node Subagents' },
];

function capabilitiesToText(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => String(item)).join(', ');
  if (value === undefined || value === null) return '';
  return String(value);
}

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

export default function AgentNodeSettings({ node, onClose, onDelete, loading = false }: Props) {
  const t = useT();
  const settingsValues = node.settings?.values || {};
  // Legacy sessions without identity fields fall back to the spec §3.2
  // defaults: main → ceo, subagent → implementer.
  const defaultRoleTitle = settingsValues.agentKind === 'main' ? 'ceo' : 'implementer';
  const [displayName, setDisplayName] = useState(String(settingsValues.displayName || ''));
  const [roleTitle, setRoleTitle] = useState(String(settingsValues.roleTitle || defaultRoleTitle));
  const [responsibility, setResponsibility] = useState(String(settingsValues.responsibility || ''));
  const [capabilitiesText, setCapabilitiesText] = useState(capabilitiesToText(settingsValues.capabilities));
  const [subagentMode, setSubagentMode] = useState<SubagentMode>(
    settingsValues.subagentMode === 'wf-node-subagents' ? 'wf-node-subagents' : 'built-in-subagents',
  );
  const [subagentModes, setSubagentModes] = useState<{ id: SubagentMode; label: string }[]>(DEFAULT_SUBAGENT_MODES);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [identityError, setIdentityError] = useState('');
  const roleProfileRef = settingsValues.roleProfileRef ? String(settingsValues.roleProfileRef) : '';
  const isCustomRoleTitle = !ROLE_TITLE_PRESETS.includes(roleTitle);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // The snapshot's subagentModes catalog drives the dropdown options.
  useEffect(() => {
    let alive = true;
    apiJsonCached<WorkflowSnapshot>('/api/a2a/snapshot', { ttlMs: 2000 })
      .then(snapshot => {
        if (alive && Array.isArray(snapshot?.subagentModes) && snapshot.subagentModes.length > 0) {
          setSubagentModes(snapshot.subagentModes);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const saveIdentity = async () => {
    setSavingIdentity(true);
    setIdentityError('');
    try {
      const capabilities = capabilitiesText.split(',').map(item => item.trim()).filter(Boolean);
      const patch: Record<string, unknown> = {
        displayName: displayName.trim(),
        responsibility: responsibility.trim(),
        capabilities,
        subagentMode,
      };
      if (roleTitle.trim()) patch.roleTitle = roleTitle.trim();
      await patchNodeSettings(node.nodeId, patch);
    } catch (e: any) {
      setIdentityError(e?.message || t('Save failed'));
    } finally {
      setSavingIdentity(false);
    }
  };

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
      {loading && (
        <div data-testid="workflow-agent-settings-loading" style={{ padding: 6, display: 'grid', gap: 10, color: 'var(--muted)', minHeight: 640 }}>
          <div className="workflow-node-settings-skeleton" style={{ height: 16, borderRadius: 6, width: '45%' }} />
          <div className="workflow-node-settings-skeleton" style={{ height: 14, borderRadius: 6 }} />
          <div className="workflow-node-settings-skeleton" style={{ height: 14, borderRadius: 6, width: '80%' }} />
          <div className="workflow-node-settings-skeleton" style={{ height: 14, borderRadius: 6, width: '65%' }} />
          <div className="workflow-node-settings-skeleton" style={{ height: 42, borderRadius: 6, width: '100%' }} />
          <div className="workflow-node-settings-skeleton" style={{ height: 14, borderRadius: 6, width: '70%' }} />
          <div className="workflow-node-settings-skeleton" style={{ height: 14, borderRadius: 6, width: '55%' }} />
          <div className="workflow-node-settings-skeleton" style={{ height: 32, borderRadius: 6, width: '40%' }} />
          <div className="workflow-node-settings-skeleton" style={{ height: 14, borderRadius: 6, width: '75%' }} />
          <div className="workflow-node-settings-skeleton" style={{ height: 32, borderRadius: 6, width: '60%' }} />
          <div className="workflow-node-settings-skeleton" style={{ height: 14, borderRadius: 6, width: '85%' }} />
          <div className="workflow-node-settings-skeleton" style={{ height: 90, borderRadius: 6, width: '100%' }} />
        </div>
      )}
      {!loading && (
      <>
      <div className="workflow-node-settings-section">
        <div className="workflow-node-settings-grid">
          <div>
            <div className="workflow-node-settings-label">{t('Display name')}</div>
            <input
              data-testid="workflow-agent-settings-display-name"
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              placeholder={t('Agent display name')}
            />
          </div>
          <div>
            <div className="workflow-node-settings-label">{t('Role title')}</div>
            <select
              data-testid="workflow-agent-settings-role-title"
              value={isCustomRoleTitle ? CUSTOM_ROLE_TITLE : roleTitle}
              onChange={event => setRoleTitle(event.target.value === CUSTOM_ROLE_TITLE ? '' : event.target.value)}
            >
              {ROLE_TITLE_PRESETS.map(role => <option key={role} value={role}>{role}</option>)}
              <option value={CUSTOM_ROLE_TITLE}>{t('Custom...')}</option>
            </select>
          </div>
        </div>
        {isCustomRoleTitle && (
          <div style={{ marginTop: 8 }}>
            <div className="workflow-node-settings-label">{t('Custom role')}</div>
            <input
              data-testid="workflow-agent-settings-role-title-custom"
              value={roleTitle}
              onChange={event => setRoleTitle(event.target.value)}
              placeholder={t('Free-form role (e.g. architect)')}
            />
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <div className="workflow-node-settings-label">{t('Responsibility')}</div>
          <textarea
            data-testid="workflow-agent-settings-responsibility"
            value={responsibility}
            onChange={event => setResponsibility(event.target.value)}
            rows={3}
            placeholder={t('One-paragraph mandate, plain language')}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="workflow-node-settings-label">{t('Capabilities')}</div>
          <input
            data-testid="workflow-agent-settings-capabilities"
            value={capabilitiesText}
            onChange={event => setCapabilitiesText(event.target.value)}
            placeholder={t('Comma-separated, e.g. typescript, playwright')}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="workflow-node-settings-label">{t('Subagent mode')}</div>
          <select
            data-testid="workflow-agent-settings-subagent-mode"
            value={subagentMode}
            onChange={event => setSubagentMode(event.target.value as SubagentMode)}
          >
            {subagentModes.map(option => <option key={option.id} value={option.id}>{t(option.label)}</option>)}
          </select>
        </div>
        {roleProfileRef && (
          <div style={{ marginTop: 8 }}>
            <div className="workflow-node-settings-label">{t('Role profile')}</div>
            <input data-testid="workflow-agent-settings-role-profile-ref" value={roleProfileRef} readOnly />
          </div>
        )}
        {identityError && <div className="workflow-node-settings-error">{identityError}</div>}
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            data-testid="workflow-agent-settings-save"
            className="workflow-node-settings-primary"
            onClick={saveIdentity}
            disabled={savingIdentity}
          >
            {savingIdentity ? t('Saving...') : t('Save role')}
          </button>
        </div>
      </div>

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
      </>
      )}
    </NodeSettingsShell>
  );
}
