import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Home,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { apiJson, invalidateApiCache } from '../api';
import type { WorkflowNode, WorkflowNodeConfig, WorkflowNodeSkillPolicy } from '../types';
import { useT } from '../i18n/index';

type NodeConfigPatchResponse = {
  ok?: boolean;
  node?: {
    id?: string;
    config?: Partial<WorkflowNodeConfig>;
    restartRequired?: boolean;
    restartRequiredFields?: string[];
  };
  restartRequired?: boolean;
  restartRequiredFields?: string[];
  revision?: number;
};

type NodeRestartResponse = {
  ok?: boolean;
  nodeId?: string;
  sessionId?: string;
  restartRequired?: boolean;
  revision?: number;
};

type MarkdownTarget = {
  nodeId: string;
  title: string;
};

type WorkspaceFolderEntry = {
  name: string;
  path: string;
  type: 'directory' | 'file' | string;
  hasChildren?: boolean;
};

type WorkspaceTreeResponse = {
  root?: string;
  path?: string;
  entries?: WorkspaceFolderEntry[];
};

type Props = {
  node: WorkflowNode;
  projectRoot?: string;
  markdownTargets?: MarkdownTarget[];
  canStart: boolean;
  canStop: boolean;
  canDelete: boolean;
  canOpenTerminal: boolean;
  starting: boolean;
  stopping: boolean;
  deleting: boolean;
  onClose: () => void;
  onOpenTerminal: () => void;
  onOpenDrawer: () => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onConfigSaved: (
    nodeId: string,
    config: Partial<WorkflowNodeConfig>,
    meta?: { responseNodeId?: string; restartRequired?: boolean; restartRequiredFields?: string[] },
  ) => void;
  onRestarted: (nodeId: string, response: NodeRestartResponse) => void;
};

type PermissionMode = 'full-access' | 'workspace-write' | 'read-only';
type SettingsCategory = 'core' | 'runtime' | 'routing' | 'skills' | 'context' | 'advanced';
type ActiveSettingsCategory = SettingsCategory | 'all';

const panelStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'rgba(255,255,255,0.96)',
  boxShadow: '0 18px 46px rgba(15,23,42,0.14)',
  backdropFilter: 'blur(16px)',
};

const defaultRecommendedSkills = ['wf-max', 'tdd', 'wf-browser'];
const defaultContextSources = ['workflow-map', 'task-capsule', 'terminal-transcript'];
const defaultCapabilities = ['terminal', 'file-ops', 'browser', 'review'];
const launchAffectingKeys = new Set<keyof WorkflowNodeConfig>(['model', 'provider', 'cwd', 'env', 'permissions', 'launchPolicy']);
const workspaceRootPath = '';

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (Array.isArray(value)) return Object.fromEntries(value.map(item => [String(item), true]));
  return {};
}

function asStringArray(value: unknown, fallback: string[] = []) {
  return Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : fallback;
}

function asBool(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function prettyJson(value: unknown) {
  return JSON.stringify(asRecord(value), null, 2);
}

function normalizePolicy(value: unknown): WorkflowNodeSkillPolicy {
  return value === 'manual' || value === 'locked' ? value : 'auto';
}

function permissionModeFrom(value: Record<string, unknown>): PermissionMode {
  const filesystem = String(value.filesystem || value.fs || '').toLowerCase();
  if (filesystem.includes('read')) return 'read-only';
  if (filesystem.includes('workspace')) return 'workspace-write';
  return 'full-access';
}

function permissionObject(mode: PermissionMode) {
  return {
    filesystem: mode,
    network: 'enabled',
  };
}

function launchPolicyObject(autoStart: boolean, restartOnSave: boolean, sandboxMode: string, approvalPolicy: string) {
  return {
    autoStart,
    restartOnSave,
    sandboxMode,
    approvalPolicy,
  };
}

function configFromNode(node: WorkflowNode, projectRoot?: string): WorkflowNodeConfig {
  const config = node.config || {};
  const skills = asStringArray(config.skills, asStringArray(node.skills, defaultRecommendedSkills));
  const recommendedSkills = asStringArray(config.recommendedSkills, defaultRecommendedSkills);
  const outputRouting = asRecord(config.outputRouting);
  return {
    role: String(config.role || node.role || node.agentKind || 'main'),
    customRole: String(config.customRole || ''),
    prompt: String(config.prompt || node.objective || ''),
    model: String(config.model || node.model || ''),
    provider: String(config.provider || node.provider || 'openai'),
    cwd: String(config.cwd || node.cwd || projectRoot || ''),
    env: asRecord(config.env),
    permissions: asRecord(config.permissions || node.permissions || permissionObject('full-access')),
    launchPolicy: asRecord(config.launchPolicy),
    outputRouting: {
      markdownDefaultEnabled: asBool(outputRouting.markdownDefaultEnabled, false),
      markdownTargetNodeId: String(outputRouting.markdownTargetNodeId || ''),
      fallback: String(outputRouting.fallback || 'oldest-connected-markdown'),
    },
    skills,
    skillPolicy: normalizePolicy(config.skillPolicy),
    recommendedSkills,
    contextSources: asStringArray(config.contextSources, defaultContextSources),
    capabilities: asStringArray(config.capabilities, defaultCapabilities),
  };
}

function safeJsonObject(label: string, value: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function uniqueList(items: string[]) {
  return [...new Set(items.map(item => item.trim()).filter(Boolean))];
}

function normalizeWorkspacePath(value: string | undefined | null) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function workspaceParentPath(path: string) {
  const normalized = normalizeWorkspacePath(path);
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? workspaceRootPath : normalized.slice(0, index);
}

function displayWorkspacePath(path: string) {
  const normalized = normalizeWorkspacePath(path);
  return normalized ? `/${normalized}` : '/';
}

function workspacePathFromCwd(value: string, projectRoot?: string) {
  const raw = String(value || '').trim();
  if (!raw) return workspaceRootPath;
  const absoluteLike = /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('\\');
  if (!absoluteLike) return normalizeWorkspacePath(raw);
  if (!projectRoot) return workspaceRootPath;
  const rawUnified = raw.replace(/\\/g, '/').replace(/\/+$/g, '');
  const rootUnified = projectRoot.replace(/\\/g, '/').replace(/\/+$/g, '');
  if (rawUnified.toLowerCase() === rootUnified.toLowerCase()) return workspaceRootPath;
  const prefix = `${rootUnified}/`;
  return rawUnified.toLowerCase().startsWith(prefix.toLowerCase())
    ? normalizeWorkspacePath(rawUnified.slice(prefix.length))
    : workspaceRootPath;
}

function cwdFromWorkspacePath(path: string, projectRoot?: string, fallback?: string) {
  const relPath = normalizeWorkspacePath(path);
  if (!relPath) return projectRoot || fallback || '';
  if (!projectRoot) return relPath;
  const separator = projectRoot.includes('\\') && !projectRoot.includes('/') ? '\\' : '/';
  const root = projectRoot.replace(/[\\/]+$/g, '');
  return `${root}${separator}${relPath.split('/').join(separator)}`;
}

function TipButton({ id, label, onHover }: { id: string; label: string; onHover: (label: string) => void }) {
  const t = useT();
  const translatedLabel = t(label);
  return (
    <button
      type="button"
      data-testid={`${id}-tip`}
      className="workflow-node-settings-tip"
      aria-label={t('Help')}
      title={translatedLabel}
      onMouseEnter={() => onHover(translatedLabel)}
      onFocus={() => onHover(translatedLabel)}
    >
      ?
    </button>
  );
}

function FieldLabel({
  htmlFor,
  testId,
  label,
  tip,
  onTip,
}: {
  htmlFor: string;
  testId: string;
  label: string;
  tip: string;
  onTip: (value: string) => void;
}) {
  const t = useT();
  return (
    <label className="workflow-node-settings-label" htmlFor={htmlFor}>
      <span>{t(label)}</span>
      <TipButton id={testId} label={tip} onHover={onTip} />
    </label>
  );
}

function SettingSection({
  testId,
  label,
  tip,
  onTip,
  children,
}: {
  testId: string;
  label: string;
  tip: string;
  onTip: (value: string) => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <section data-testid={testId} className="workflow-node-settings-section" role="group" aria-label={t(label)}>
      <div className="workflow-node-settings-label">
        <span>{t(label)}</span>
        <TipButton id={testId} label={tip} onHover={onTip} />
      </div>
      {children}
    </section>
  );
}

export default function WorkflowNodeSettingsPanel({
  node,
  projectRoot,
  markdownTargets = [],
  canStart,
  canStop,
  canDelete,
  canOpenTerminal,
  starting,
  stopping,
  deleting,
  onClose,
  onOpenTerminal,
  onOpenDrawer,
  onStart,
  onStop,
  onDelete,
  onConfigSaved,
  onRestarted,
}: Props) {
  const t = useT();
  const initial = useMemo(() => configFromNode(node, projectRoot), [node, projectRoot]);
  const initialLaunchPolicy = useMemo(() => asRecord(initial.launchPolicy), [initial.launchPolicy]);
  const [category, setCategory] = useState<ActiveSettingsCategory>('all');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState(initial.role);
  const [customRole, setCustomRole] = useState(initial.customRole);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [model, setModel] = useState(initial.model);
  const [provider, setProvider] = useState(initial.provider);
  const [cwd, setCwd] = useState(initial.cwd);
  const [env, setEnv] = useState(prettyJson(initial.env));
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(permissionModeFrom(initial.permissions));
  const [launchAutoStart, setLaunchAutoStart] = useState(asBool(initialLaunchPolicy.autoStart, false));
  const [launchRestartOnSave, setLaunchRestartOnSave] = useState(asBool(initialLaunchPolicy.restartOnSave, false));
  const [sandboxMode, setSandboxMode] = useState(String(initialLaunchPolicy.sandboxMode || 'danger-full-access'));
  const [approvalPolicy, setApprovalPolicy] = useState(String(initialLaunchPolicy.approvalPolicy || 'never'));
  const [markdownDefaultEnabled, setMarkdownDefaultEnabled] = useState(initial.outputRouting.markdownDefaultEnabled);
  const [markdownTargetNodeId, setMarkdownTargetNodeId] = useState(initial.outputRouting.markdownTargetNodeId || '');
  const [skills, setSkills] = useState<string[]>(initial.skills);
  const [skillPolicy, setSkillPolicy] = useState<WorkflowNodeSkillPolicy>(initial.skillPolicy);
  const [contextSources, setContextSources] = useState<string[]>(initial.contextSources);
  const [capabilities, setCapabilities] = useState<string[]>(initial.capabilities);
  const [skillInput, setSkillInput] = useState('');
  const [dirtyKeys, setDirtyKeys] = useState<Set<keyof WorkflowNodeConfig>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [savedState, setSavedState] = useState('');
  const [error, setError] = useState('');
  const setActiveTip = useCallback((_value: string) => {}, []);
  const [serverRestartRequired, setServerRestartRequired] = useState(Boolean(node.restartRequired));
  const [cwdPickerOpen, setCwdPickerOpen] = useState(false);
  const [cwdPickerPath, setCwdPickerPath] = useState(workspaceRootPath);
  const [cwdPickerFolders, setCwdPickerFolders] = useState<Record<string, WorkspaceFolderEntry[]>>({});
  const [cwdPickerLoadingPath, setCwdPickerLoadingPath] = useState('');
  const [cwdPickerError, setCwdPickerError] = useState('');

  useEffect(() => {
    const launchPolicy = asRecord(initial.launchPolicy);
    setRole(initial.role);
    setCustomRole(initial.customRole);
    setPrompt(initial.prompt);
    setModel(initial.model);
    setProvider(initial.provider);
    setCwd(initial.cwd);
    setEnv(prettyJson(initial.env));
    setPermissionMode(permissionModeFrom(initial.permissions));
    setLaunchAutoStart(asBool(launchPolicy.autoStart, false));
    setLaunchRestartOnSave(asBool(launchPolicy.restartOnSave, false));
    setSandboxMode(String(launchPolicy.sandboxMode || 'danger-full-access'));
    setApprovalPolicy(String(launchPolicy.approvalPolicy || 'never'));
    setMarkdownDefaultEnabled(initial.outputRouting.markdownDefaultEnabled);
    setMarkdownTargetNodeId(initial.outputRouting.markdownTargetNodeId || '');
    setSkills(initial.skills);
    setSkillPolicy(initial.skillPolicy);
    setContextSources(initial.contextSources);
    setCapabilities(initial.capabilities);
    setDirtyKeys(new Set());
    setError('');
    setServerRestartRequired(Boolean(node.restartRequired));
    setCwdPickerOpen(false);
    setCwdPickerPath(workspaceRootPath);
    setCwdPickerFolders({});
    setCwdPickerLoadingPath('');
    setCwdPickerError('');
  }, [initial, node.restartRequired]);

  const markDirty = (key: keyof WorkflowNodeConfig) => {
    setDirtyKeys(current => new Set(current).add(key));
    setSavedState('');
  };

  const loadCwdPickerPath = useCallback(async (path: string) => {
    const relPath = normalizeWorkspacePath(path);
    const loadingKey = relPath || '/';
    if (cwdPickerFolders[relPath] || cwdPickerLoadingPath === loadingKey) return;
    setCwdPickerError('');
    setCwdPickerLoadingPath(loadingKey);
    try {
      const data = await apiJson<WorkspaceTreeResponse>(`/api/workspace/tree?path=${encodeURIComponent(relPath)}`);
      const folders = (data.entries || [])
        .filter(entry => entry.type === 'directory')
        .map(entry => ({
          ...entry,
          path: normalizeWorkspacePath(entry.path),
        }));
      setCwdPickerFolders(current => ({ ...current, [relPath]: folders }));
    } catch (e: any) {
      setCwdPickerError(e?.message || t('Failed to load workspace folders'));
      setCwdPickerFolders(current => current[relPath] ? current : { ...current, [relPath]: [] });
    } finally {
      setCwdPickerLoadingPath(current => current === loadingKey ? '' : current);
    }
  }, [cwdPickerFolders, cwdPickerLoadingPath, t]);

  useEffect(() => {
    if (!cwdPickerOpen) return;
    loadCwdPickerPath(cwdPickerPath).catch(() => {});
  }, [cwdPickerOpen, cwdPickerPath, loadCwdPickerPath]);

  const graphNodeId = node.graphNodeId || node.id;
  const locked = skillPolicy === 'locked';
  const editableSkills = !locked;
  const launchDirty = [...dirtyKeys].some(key => launchAffectingKeys.has(key));
  const restartRequired = serverRestartRequired || launchDirty;

  const updateString = (key: keyof WorkflowNodeConfig, setter: (value: string) => void) => (value: string) => {
    setter(value);
    markDirty(key);
  };

  const openCwdPicker = () => {
    const nextOpen = !cwdPickerOpen;
    setCwdPickerOpen(nextOpen);
    if (nextOpen) {
      setCwdPickerPath(workspacePathFromCwd(cwd, projectRoot));
    }
  };

  const chooseCwdFolder = (path: string) => {
    updateString('cwd', setCwd)(cwdFromWorkspacePath(path, projectRoot, cwd));
    setCwdPickerOpen(false);
  };

  const addSkill = () => {
    if (!skillInput.trim() || locked) return;
    if (skillPolicy === 'auto') {
      setSkillPolicy('manual');
      markDirty('skillPolicy');
    }
    setSkills(current => uniqueList([...current, skillInput]));
    setSkillInput('');
    markDirty('skills');
  };

  const removeSkill = (skill: string) => {
    if (locked) return;
    setSkills(current => current.filter(item => item !== skill));
    markDirty('skills');
  };

  const changePolicy = (policy: WorkflowNodeSkillPolicy) => {
    setSkillPolicy(policy);
    markDirty('skillPolicy');
    if (policy === 'auto') {
      setSkills(uniqueList([...skills, ...initial.recommendedSkills]));
      markDirty('skills');
    }
  };

  const ensureContextSource = (source: string) => {
    if (!contextSources.includes(source)) {
      setContextSources(current => uniqueList([...current, source]));
    }
    markDirty('contextSources');
  };

  const ensureCapability = (capability: string) => {
    if (capabilities.includes(capability)) return;
    setCapabilities(current => uniqueList([...current, capability]));
    markDirty('capabilities');
  };

  const updateOutputRouting = (patch: { enabled?: boolean; target?: string }) => {
    if (patch.enabled !== undefined) setMarkdownDefaultEnabled(patch.enabled);
    if (patch.target !== undefined) setMarkdownTargetNodeId(patch.target);
    markDirty('outputRouting');
  };

  const buildPatch = () => {
    const patch: Partial<WorkflowNodeConfig> = {};
    for (const key of dirtyKeys) {
      if (key === 'role') patch.role = role;
      if (key === 'customRole') patch.customRole = customRole;
      if (key === 'prompt') patch.prompt = prompt;
      if (key === 'model') patch.model = model;
      if (key === 'provider') patch.provider = provider;
      if (key === 'cwd') patch.cwd = cwd;
      if (key === 'env') patch.env = safeJsonObject('Env', env);
      if (key === 'permissions') patch.permissions = permissionObject(permissionMode);
      if (key === 'launchPolicy') patch.launchPolicy = launchPolicyObject(launchAutoStart, launchRestartOnSave, sandboxMode, approvalPolicy);
      if (key === 'outputRouting') {
        patch.outputRouting = {
          markdownDefaultEnabled,
          markdownTargetNodeId,
          fallback: 'oldest-connected-markdown',
        };
      }
      if (key === 'skills') patch.skills = skills;
      if (key === 'skillPolicy') patch.skillPolicy = skillPolicy;
      if (key === 'contextSources') patch.contextSources = contextSources;
      if (key === 'capabilities') patch.capabilities = capabilities;
    }
    return patch;
  };

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      const patch = buildPatch();
      const result = await apiJson<NodeConfigPatchResponse>(`/api/a2a/nodes/${encodeURIComponent(graphNodeId)}/config`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      const nextConfig = result.node?.config || patch;
      const nextRestartRequired = Boolean(result.restartRequired ?? result.node?.restartRequired ?? false);
      setServerRestartRequired(nextRestartRequired);
      setDirtyKeys(new Set());
      setSavedState(t('saved'));
      onConfigSaved(node.id, nextConfig, {
        responseNodeId: result.node?.id,
        restartRequired: nextRestartRequired,
        restartRequiredFields: result.restartRequiredFields || result.node?.restartRequiredFields,
      });
      invalidateApiCache('/api/a2a/snapshot');
      invalidateApiCache('/api/sessions');
    } catch (e: any) {
      setError(e?.message || t('Failed to save node config'));
    } finally {
      setSaving(false);
    }
  };

  const restart = async () => {
    if (restarting) return;
    setError('');
    setRestarting(true);
    try {
      const result = await apiJson<NodeRestartResponse>(`/api/a2a/nodes/${encodeURIComponent(graphNodeId)}/restart`, {
        method: 'POST',
        body: JSON.stringify({ previousSessionId: node.sessionId }),
      });
      setServerRestartRequired(Boolean(result.restartRequired));
      setDirtyKeys(current => {
        const next = new Set(current);
        for (const key of launchAffectingKeys) next.delete(key);
        return next;
      });
      onRestarted(node.id, result);
      setSavedState(t('restarted'));
      invalidateApiCache('/api/a2a/snapshot');
      invalidateApiCache('/api/sessions');
    } catch (e: any) {
      setError(e?.message || t('Failed to restart node'));
    } finally {
      setRestarting(false);
    }
  };

  const categoryItems: { id: SettingsCategory; label: string; icon: typeof Settings2 }[] = [
    { id: 'core', label: 'Core', icon: ShieldCheck },
    { id: 'runtime', label: 'Runtime', icon: Cpu },
    { id: 'routing', label: 'Routing', icon: FileText },
    { id: 'skills', label: 'Skills', icon: Plus },
    { id: 'context', label: 'Context', icon: Terminal },
    { id: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
  ];
  const searchNeedle = search.trim().toLowerCase();
  const visible = (id: SettingsCategory, text: string) => (
    searchNeedle
      ? `${categoryItems.find(item => item.id === id)?.label || id} ${text}`.toLowerCase().includes(searchNeedle)
      : category === 'all' || category === id
  );
  const stopStartLabel = canStop
    ? (stopping ? t('Stopping...') : t('Stop'))
    : canStart
      ? (starting ? t('Starting...') : t('Start'))
      : t('Start');
  const stopStartTitle = canStop ? t('Stop node') : canStart ? t('Start node') : t('Node cannot be started');
  const stopStartIcon = canStop ? <Square size={12} /> : <Play size={12} />;
  const stopStartDisabled = canStop ? stopping : (!canStart || starting);
  const normalizedCwdPickerPath = normalizeWorkspacePath(cwdPickerPath);
  const currentCwdFolders = cwdPickerFolders[normalizedCwdPickerPath] || [];
  const cwdPickerLoading = cwdPickerLoadingPath === (normalizedCwdPickerPath || '/');
  const cwdPickerAtRoot = normalizedCwdPickerPath === workspaceRootPath;

  return (
    <motion.aside
      data-canvas-control="true"
      data-testid="workflow-node-settings"
      className="workflow-node-settings wf-floating-panel nodrag nopan nowheel"
      style={panelStyle}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 230, damping: 30, mass: 0.86 }}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
    >
      <div className="workflow-node-settings-header">
        <div className="workflow-node-settings-title">
          <ShieldCheck size={15} />
          <div>
            <div>{node.label || t('Agent settings')}</div>
            <span>{node.id}</span>
          </div>
        </div>
        <div className="workflow-node-settings-header-actions">
          <button type="button" data-testid="workflow-node-settings-save" title={t('Apply')} onClick={save} disabled={saving} className="workflow-node-settings-icon primary">
            <Save size={12} />
          </button>
          <button type="button" title={t('Drawer')} onClick={onOpenDrawer} className="workflow-node-settings-icon">
            <ExternalLink size={12} />
          </button>
          <button type="button" title={t('Close')} onClick={onClose} className="workflow-node-settings-icon">
            <X size={12} />
          </button>
        </div>
      </div>

      <div className="workflow-node-settings-search">
        <Search size={13} />
        <input
          data-testid="workflow-node-settings-search"
          aria-label={t('Search settings')}
          value={search}
          onChange={event => {
            setSearch(event.target.value);
            setCategory('all');
          }}
          placeholder={t('Search settings')}
        />
      </div>

      <div className="workflow-node-settings-layout">
        <nav data-testid="workflow-node-settings-nav" className="workflow-node-settings-nav" aria-label={t('Settings sections')}>
          {categoryItems.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                title={t(item.label)}
                aria-label={t(item.label)}
                aria-pressed={category === item.id ? 'true' : 'false'}
                data-testid="workflow-node-settings-nav-item"
                data-section={item.id}
                data-settings-category={item.id}
                data-tooltip={t(item.label)}
                onClick={() => setCategory(item.id)}
                onMouseEnter={() => setActiveTip(t(item.label))}
                onFocus={() => setActiveTip(t(item.label))}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </nav>

        <div className="workflow-node-settings-body">
          {visible('core', 'role custom role prompt objective') && (
            <>
              <section className="workflow-node-settings-grid">
                <div>
                  <FieldLabel htmlFor="workflow-node-setting-role-control" testId="workflow-node-setting-role" label="Role" tip="Runtime role exposed to the agent and workflow map." onTip={setActiveTip} />
                  <select id="workflow-node-setting-role-control" aria-label={t('Role')} data-testid="workflow-node-setting-role" value={role} onChange={event => updateString('role', setRole)(event.target.value)}>
                    <option value="main">{t('main')}</option>
                    <option value="subagent">{t('subagent')}</option>
                    <option value="implementer">{t('implementer')}</option>
                    <option value="reviewer">{t('reviewer')}</option>
                    <option value="browser-verifier">{t('browser-verifier')}</option>
                  </select>
                </div>
                <div>
                  <FieldLabel htmlFor="workflow-node-setting-custom-role-control" testId="workflow-node-setting-custom-role" label="Custom role" tip="Optional human role name layered on top of the base role." onTip={setActiveTip} />
                  <input id="workflow-node-setting-custom-role-control" aria-label={t('Custom role')} data-testid="workflow-node-setting-custom-role" value={customRole} onChange={event => updateString('customRole', setCustomRole)(event.target.value)} />
                </div>
              </section>

              <div>
                <FieldLabel htmlFor="workflow-node-setting-prompt-control" testId="workflow-node-setting-prompt" label="Prompt / objective" tip="Node objective injected into the agent's workflow-map context." onTip={setActiveTip} />
                <textarea id="workflow-node-setting-prompt-control" aria-label={t('Prompt / objective')} data-testid="workflow-node-setting-prompt" value={prompt} rows={3} onChange={event => updateString('prompt', setPrompt)(event.target.value)} />
              </div>
            </>
          )}

          {visible('runtime', 'model provider cwd working directory permissions launch policy') && (
            <>
              <section className="workflow-node-settings-grid">
                <div>
                  <FieldLabel htmlFor="workflow-node-setting-model-control" testId="workflow-node-setting-model" label="Model" tip="Model changes affect launch arguments and require restart." onTip={setActiveTip} />
                  <input id="workflow-node-setting-model-control" aria-label={t('Model')} data-testid="workflow-node-setting-model" value={model} onChange={event => updateString('model', setModel)(event.target.value)} />
                </div>
                <div>
                  <FieldLabel htmlFor="workflow-node-setting-provider-control" testId="workflow-node-setting-provider" label="Provider" tip="Provider is saved now; custom provider execution is wired by backend policy." onTip={setActiveTip} />
                  <select id="workflow-node-setting-provider-control" aria-label={t('Provider')} data-testid="workflow-node-setting-provider" value={provider} onChange={event => updateString('provider', setProvider)(event.target.value)}>
                    <option value="openai">{t('openai')}</option>
                    <option value="openai-compatible">{t('openai-compatible')}</option>
                    <option value="anthropic">{t('anthropic')}</option>
                    <option value="local">{t('local')}</option>
                  </select>
                </div>
              </section>

              <div>
                <FieldLabel htmlFor="workflow-node-setting-cwd-control" testId="workflow-node-setting-cwd" label="Working directory" tip="Changing cwd affects process launch and requires restart." onTip={setActiveTip} />
                <div className="workflow-node-settings-inline">
                  <input id="workflow-node-setting-cwd-control" aria-label={t('Working directory')} data-testid="workflow-node-setting-cwd" value={cwd} onChange={event => updateString('cwd', setCwd)(event.target.value)} />
                  <button
                    type="button"
                    data-testid="workflow-node-cwd-picker"
                    title={t('Browse workspace folders')}
                    aria-label={t('Browse workspace folders')}
                    aria-haspopup="dialog"
                    aria-expanded={cwdPickerOpen ? 'true' : 'false'}
                    aria-controls="workflow-node-cwd-picker-panel"
                    onClick={openCwdPicker}
                  >
                    <FolderOpen size={12} />
                  </button>
                </div>
                {cwdPickerOpen && (
                  <div
                    id="workflow-node-cwd-picker-panel"
                    data-testid="workflow-node-cwd-picker-panel"
                    className="workflow-node-cwd-picker-panel"
                    role="dialog"
                    aria-label={t('Choose working directory')}
                    onKeyDown={event => {
                      if (event.key === 'Escape') setCwdPickerOpen(false);
                    }}
                  >
                    <div className="workflow-node-cwd-picker-nav">
                      <button
                        type="button"
                        data-testid="workflow-node-cwd-picker-root"
                        title={t('Go to workspace root')}
                        aria-label={t('Go to workspace root')}
                        disabled={cwdPickerAtRoot}
                        onClick={() => setCwdPickerPath(workspaceRootPath)}
                      >
                        <Home size={12} />
                      </button>
                      <button
                        type="button"
                        data-testid="workflow-node-cwd-picker-back"
                        title={t('Go to parent folder')}
                        aria-label={t('Go to parent folder')}
                        disabled={cwdPickerAtRoot}
                        onClick={() => setCwdPickerPath(workspaceParentPath(normalizedCwdPickerPath))}
                      >
                        <ChevronLeft size={12} />
                      </button>
                      <span data-testid="workflow-node-cwd-picker-path" title={displayWorkspacePath(normalizedCwdPickerPath)}>
                        {displayWorkspacePath(normalizedCwdPickerPath)}
                      </span>
                      <button
                        type="button"
                        data-testid="workflow-node-cwd-picker-use-current"
                        title={t('Use this folder')}
                        onClick={() => chooseCwdFolder(normalizedCwdPickerPath)}
                      >
                        <Check size={11} />
                        {t('Use this folder')}
                      </button>
                    </div>

                    {cwdPickerError && (
                      <div data-testid="workflow-node-cwd-picker-error" className="workflow-node-cwd-picker-error" role="alert">
                        {cwdPickerError}
                      </div>
                    )}

                    {cwdPickerLoading && (
                      <div data-testid="workflow-node-cwd-picker-loading" className="workflow-node-cwd-picker-loading" role="status">
                        <Loader2 size={12} />
                        {t('Loading folders...')}
                      </div>
                    )}

                    <ul data-testid="workflow-node-cwd-picker-list" className="workflow-node-cwd-picker-list" role="tree" aria-label={t('Workspace folders')}>
                      {!cwdPickerLoading && !cwdPickerError && currentCwdFolders.length === 0 && (
                        <li data-testid="workflow-node-cwd-picker-empty" className="workflow-node-cwd-picker-empty">
                          {t('No folders here')}
                        </li>
                      )}
                      {currentCwdFolders.map(folder => (
                        <li
                          key={folder.path}
                          data-testid="workflow-node-cwd-picker-item"
                          data-path={folder.path}
                          className="workflow-node-cwd-picker-item"
                          role="treeitem"
                        >
                          <button
                            type="button"
                            data-testid="workflow-node-cwd-picker-open-folder"
                            data-path={folder.path}
                            title={t('Open folder')}
                            aria-label={`${t('Open folder')}: ${folder.name}`}
                            onClick={() => setCwdPickerPath(folder.path)}
                          >
                            <Folder size={12} />
                            <span>{folder.name}</span>
                            {folder.hasChildren && <ChevronRight size={11} />}
                          </button>
                          <button
                            type="button"
                            data-testid="workflow-node-cwd-picker-choose"
                            data-path={folder.path}
                            title={t('Choose folder')}
                            aria-label={`${t('Choose folder')}: ${folder.name}`}
                            onClick={() => chooseCwdFolder(folder.path)}
                          >
                            <Check size={11} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <SettingSection testId="workflow-node-setting-permissions" label="Permissions" tip="Permission mode is translated into the backend policy object." onTip={setActiveTip}>
                <select
                  id="workflow-node-permission-mode-control"
                  aria-label={t('Permission mode')}
                  data-testid="workflow-node-permission-mode"
                  value={permissionMode}
                  onChange={event => {
                    setPermissionMode(event.target.value as PermissionMode);
                    markDirty('permissions');
                  }}
                >
                  <option value="full-access">{t('Full access')}</option>
                  <option value="workspace-write">{t('Workspace write')}</option>
                  <option value="read-only">{t('Read only')}</option>
                </select>
              </SettingSection>

              <SettingSection testId="workflow-node-setting-launch-policy" label="Launch policy" tip="Launch policy controls process startup behavior without raw JSON." onTip={setActiveTip}>
                <div data-testid="workflow-node-launch-policy" className="workflow-node-settings-grid">
                  <label className="workflow-node-settings-check">
                    <input
                      data-testid="workflow-node-launch-auto-start"
                      type="checkbox"
                      checked={launchAutoStart}
                      onChange={event => {
                        setLaunchAutoStart(event.target.checked);
                        markDirty('launchPolicy');
                      }}
                    />
                    <span>{t('Auto start')}</span>
                  </label>
                  <label className="workflow-node-settings-check">
                    <input
                      data-testid="workflow-node-launch-restart-on-save"
                      type="checkbox"
                      checked={launchRestartOnSave}
                      onChange={event => {
                        setLaunchRestartOnSave(event.target.checked);
                        markDirty('launchPolicy');
                      }}
                    />
                    <span>{t('Restart on save')}</span>
                  </label>
                  <select aria-label={t('Sandbox mode')} value={sandboxMode} onChange={event => { setSandboxMode(event.target.value); markDirty('launchPolicy'); }}>
                    <option value="danger-full-access">{t('Full access sandbox')}</option>
                    <option value="workspace-write">{t('Workspace sandbox')}</option>
                    <option value="read-only">{t('Read only sandbox')}</option>
                  </select>
                  <select aria-label={t('Approval policy')} value={approvalPolicy} onChange={event => { setApprovalPolicy(event.target.value); markDirty('launchPolicy'); }}>
                    <option value="never">{t('Never ask')}</option>
                    <option value="on-request">{t('Ask on request')}</option>
                    <option value="on-failure">{t('Ask on failure')}</option>
                  </select>
                </div>
              </SettingSection>
            </>
          )}

          {visible('routing', 'markdown default output output routing') && (
            <SettingSection testId="workflow-node-setting-output-routing" label="Markdown output" tip="When enabled, agent output prefers a connected Markdown node. Without an explicit target, the oldest connected Markdown node wins." onTip={setActiveTip}>
              <label className="workflow-node-settings-check">
                <input
                  data-testid="workflow-node-markdown-output-toggle"
                  type="checkbox"
                  style={{ width: 18, height: 18, minWidth: 18 }}
                  checked={markdownDefaultEnabled}
                  onChange={event => updateOutputRouting({ enabled: event.target.checked })}
                />
                <span>{t('Default output to Markdown')}</span>
              </label>
              <select
                aria-label={t('Markdown output target')}
                data-testid="workflow-node-markdown-output-target"
                value={markdownTargetNodeId}
                onChange={event => updateOutputRouting({ target: event.target.value })}
              >
                <option value="">{t('Oldest connected Markdown')}</option>
                {markdownTargets.map(target => (
                  <option key={target.nodeId} value={target.nodeId}>{target.title || target.nodeId}</option>
                ))}
              </select>
            </SettingSection>
          )}

          {visible('skills', 'skills skill policy recommendations') && (
            <>
              <SettingSection testId="workflow-node-setting-skill-policy" label="Skill policy" tip="Auto recommends skills, manual edits chips, locked makes assignment immutable." onTip={setActiveTip}>
                <div className="workflow-node-settings-segmented">
                  {(['auto', 'manual', 'locked'] as WorkflowNodeSkillPolicy[]).map(policy => (
                    <button
                      key={policy}
                      type="button"
                      data-testid={`workflow-node-skill-policy-${policy}`}
                      aria-pressed={skillPolicy === policy ? 'true' : 'false'}
                      onClick={() => changePolicy(policy)}
                    >
                      {t(policy)}
                    </button>
                  ))}
                </div>
              </SettingSection>

              <SettingSection testId="workflow-node-setting-skills" label="Skills" tip="Skills are explicit equipment advertised to this node's agent prompt." onTip={setActiveTip}>
                <div className="workflow-node-settings-chiprow">
                  {initial.recommendedSkills.map(skill => (
                    <span key={skill} data-testid="workflow-node-recommended-skill-chip" data-skill-id={skill} className="workflow-node-settings-chip recommended">{skill}</span>
                  ))}
                </div>
                <div className="workflow-node-settings-chiprow">
                  {uniqueList(skills).map(skill => (
                    <span key={skill} data-testid="workflow-node-skill-chip" data-skill-id={skill} className="workflow-node-settings-chip">
                      {skill}
                      {!locked && (
                        <button type="button" data-testid="workflow-node-skill-remove" aria-label={`Remove ${skill}`} onClick={() => removeSkill(skill)}>
                          <X size={10} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {locked && <div data-testid="workflow-node-skills-locked" className="workflow-node-settings-locked">{t('Locked by node policy')}</div>}
                <div className="workflow-node-settings-add-row">
                  <input data-testid="workflow-node-skill-add-input" aria-label={t('Add skill')} value={skillInput} disabled={!editableSkills} onChange={event => setSkillInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addSkill(); }} />
                  <button type="button" data-testid="workflow-node-skill-add" disabled={!editableSkills || !skillInput.trim()} onClick={addSkill}>
                    <Plus size={11} /> {t('Add')}
                  </button>
                </div>
              </SettingSection>
            </>
          )}

          {visible('context', 'context sources capabilities') && (
            <>
              <SettingSection testId="workflow-node-setting-context-sources" label="Context sources" tip="Context sources decide what workflow facts this node should see." onTip={setActiveTip}>
                <div className="workflow-node-settings-chiprow">
                  {defaultContextSources.map(source => (
                    <button
                      key={source}
                      type="button"
                      data-testid={`workflow-node-context-source-${source}`}
                      data-active={contextSources.includes(source) ? 'true' : 'false'}
                      onClick={() => ensureContextSource(source)}
                      className="workflow-node-settings-pill-button"
                    >
                      {source}
                    </button>
                  ))}
                </div>
              </SettingSection>

              <SettingSection testId="workflow-node-setting-capabilities" label="Capabilities" tip="Capability chips describe what the node may be asked to perform." onTip={setActiveTip}>
                <div className="workflow-node-settings-chiprow">
                  {[...defaultCapabilities, 'review-only'].map(capability => (
                    <button
                      key={capability}
                      type="button"
                      data-testid={`workflow-node-capability-${capability}`}
                      data-active={capabilities.includes(capability) ? 'true' : 'false'}
                      onClick={() => ensureCapability(capability)}
                      className="workflow-node-settings-pill-button"
                    >
                      {capability}
                    </button>
                  ))}
                </div>
              </SettingSection>
            </>
          )}

          {visible('advanced', 'environment env') && (
            <div>
              <FieldLabel htmlFor="workflow-node-setting-env-control" testId="workflow-node-setting-env" label="Environment" tip="JSON object merged into launch environment." onTip={setActiveTip} />
              <textarea id="workflow-node-setting-env-control" aria-label={t('Environment')} data-testid="workflow-node-setting-env" value={env} rows={4} onChange={event => updateString('env', setEnv)(event.target.value)} spellCheck={false} />
            </div>
          )}
        </div>
      </div>

      {error && <div className="workflow-node-settings-error">{error}</div>}

      <div className="workflow-node-settings-footer">
        <button
          type="button"
          onClick={onDelete}
          disabled={!canDelete || deleting}
          title={canDelete ? t('Delete node') : t('Delete unavailable')}
          className="workflow-node-settings-button danger"
        >
          <Trash2 size={12} /> {deleting ? t('Deleting...') : t('Delete')}
        </button>
        <button
          type="button"
          onClick={canStop ? onStop : onStart}
          disabled={stopStartDisabled}
          title={stopStartTitle}
          className={`workflow-node-settings-button ${canStop ? 'danger' : 'success'}`}
        >
          {stopStartIcon} {stopStartLabel}
        </button>
        <button type="button" data-testid="workflow-open-terminal" onClick={onOpenTerminal} title={canOpenTerminal ? t('Open Terminal') : t('Open Transcript')} className="workflow-node-settings-primary">
          <Terminal size={12} /> {canOpenTerminal ? t('Open Terminal') : t('Open Transcript')}
        </button>
        <button type="button" data-testid="workflow-node-restart" onClick={restart} disabled={restarting} title={t('Restart node')} className="workflow-node-settings-button restart">
          <RotateCcw size={12} /> {restarting ? t('Restarting...') : t('Restart')}
        </button>
      </div>

      {(savedState || restartRequired) && (
        <div className="workflow-node-settings-statusline">
          {savedState && <span data-testid="workflow-node-saved-state">{savedState}</span>}
          <span
            data-testid="workflow-node-restart-required"
            hidden={!restartRequired}
            className="workflow-node-settings-restart-required"
          >
            {t('restart required')}
          </span>
        </div>
      )}
    </motion.aside>
  );
}
