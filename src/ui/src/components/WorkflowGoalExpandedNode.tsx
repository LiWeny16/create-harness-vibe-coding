import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bot, CheckCircle2, Circle, Clock3, ListChecks, Loader2, Plus, Save, Target, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useT } from '../i18n';
import { useSaveShortcut } from '../hooks/useSaveShortcut';
import type { WorkflowGoalNodeState, WorkflowNode } from '../types';
import { goalStateFromActionBody, runWorkflowNodeAction, showGoalActionErrorToast } from '../workflowToast';

type WorkbenchEdge = {
  source?: string;
  target?: string;
  from?: string;
  to?: string;
  relation?: string;
  direction?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

type Props = {
  node: WorkflowNode;
  state: WorkflowGoalNodeState;
  nodes?: WorkflowNode[];
  edges?: WorkbenchEdge[];
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
};

type LinkedNode = {
  nodeId: string;
  title: string;
  relation: string;
  direction: string;
  role: 'source' | 'target';
};

function statusLabel(value: string | undefined) {
  return String(value || 'active').replace(/-/g, ' ');
}

function graphIdFor(node: WorkflowNode | null | undefined) {
  return node?.graphNodeId || node?.id || '';
}

function isTimer(node: WorkflowNode | null | undefined) {
  return String(node?.type || node?.kind || '').toLowerCase() === 'timer';
}

function isAgent(node: WorkflowNode | null | undefined) {
  if (!node) return false;
  if (node.kind === 'terminal-session') return true;
  if (node.agentKind) return true;
  const role = String(node.role || '').toLowerCase();
  return role.includes('agent') || role.includes('main') || role.includes('subagent') || role.includes('ceo');
}

function acceptanceToText(state: WorkflowGoalNodeState) {
  return (state.acceptance || [])
    .map((item, index) => `${item.id || `AC-${String(index + 1).padStart(3, '0')}`} | ${item.text || ''} | ${item.status || 'tracked'}`)
    .join('\n');
}

function planItemsToText(items: NonNullable<WorkflowGoalNodeState['planItems']>) {
  return items
    .map((item, index) => `${item.id || `P-${String(index + 1).padStart(3, '0')}`} | ${item.text || ''} | ${item.status || 'todo'}`)
    .join('\n');
}

function planTextFromState(state: WorkflowGoalNodeState) {
  return planItemsToText(state.planItems || []);
}

function textToAcceptance(value: string) {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((line, index) => {
      const parts = line.split('|').map(part => part.trim());
      if (parts.length >= 3) return { id: parts[0], text: parts.slice(1, -1).join(' | '), status: parts[parts.length - 1] };
      if (parts.length === 2) return { id: parts[0], text: parts[1], status: 'tracked' };
      return { id: `AC-${String(index + 1).padStart(3, '0')}`, text: line, status: 'tracked' };
    });
}

function textToPlanItems(value: string) {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((line, index) => {
      const parts = line.split('|').map(part => part.trim());
      if (parts.length >= 3) return { id: parts[0], text: parts.slice(1, -1).join(' | '), status: parts[parts.length - 1] };
      if (parts.length === 2) return { id: parts[0], text: parts[1], status: 'todo' };
      return { id: `P-${String(index + 1).padStart(3, '0')}`, text: line, status: 'todo' };
    });
}

function verifiedCount(value: ReturnType<typeof textToAcceptance>) {
  return value.filter(item => /done|pass|passed|verified|complete|completed/i.test(item.status || '')).length;
}

function doneCount(value: ReturnType<typeof textToPlanItems>) {
  return value.filter(item => /done|pass|passed|verified|complete|completed/i.test(item.status || '')).length;
}

function isDoneStatus(value: string | undefined) {
  return /done|pass|passed|verified|complete|completed/i.test(String(value || ''));
}

function linkedNodesForGoal(goalIds: Set<string>, nodes: WorkflowNode[], edges: WorkbenchEdge[]) {
  const byId = new Map(nodes.flatMap(item => {
    const ids = [item.id, item.graphNodeId].filter(Boolean) as string[];
    return ids.map(id => [id, item] as const);
  }));
  const linked: LinkedNode[] = [];
  for (const edge of edges) {
    const source = edge.source || edge.from || '';
    const target = edge.target || edge.to || '';
    if (!goalIds.has(source) && !goalIds.has(target)) continue;
    const role = goalIds.has(source) ? 'source' : 'target';
    const peerId = role === 'source' ? target : source;
    const peer = byId.get(peerId);
    linked.push({
      nodeId: graphIdFor(peer) || peerId,
      title: peer?.label || peerId,
      relation: edge.relation || 'wf-bridge',
      direction: edge.direction || 'bidirectional',
      role,
    });
  }
  return {
    timers: linked.filter(item => isTimer(byId.get(item.nodeId))),
    agents: linked.filter(item => isAgent(byId.get(item.nodeId))),
  };
}

function SmallStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="workflow-node-workbench-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LinkedList({ title, icon, items }: { title: string; icon: ReactNode; items: LinkedNode[] }) {
  return (
    <section className="workflow-node-workbench-section">
      <header>
        {icon}
        <span>{title}</span>
      </header>
      <div className="workflow-node-workbench-linked-list">
        {items.length === 0 ? (
          <span className="workflow-node-workbench-empty">None</span>
        ) : items.map(item => (
          <div key={`${item.nodeId}-${item.relation}-${item.role}`} className="workflow-node-workbench-linked-row">
            <strong>{item.title}</strong>
            <span>{item.relation} / {item.direction}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function WorkflowGoalExpandedNode({ node, state, nodes = [], edges = [], onClose, onSave }: Props) {
  const t = useT();
  const [title, setTitle] = useState(state.title || node.label || 'Goal');
  const [objective, setObjective] = useState(String(state.objective || ''));
  const [nextAction, setNextAction] = useState(String(state.nextAction || ''));
  const [planText, setPlanText] = useState(() => planTextFromState(state));
  const [acceptanceText, setAcceptanceText] = useState(() => acceptanceToText(state));
  const [newItemText, setNewItemText] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTitle(state.title || node.label || 'Goal');
    setObjective(String(state.objective || ''));
    setNextAction(String(state.nextAction || ''));
    setPlanText(planTextFromState(state));
    setAcceptanceText(acceptanceToText(state));
  }, [node.label, state]);

  const graphId = state.nodeId || node.graphNodeId || node.id;
  const graphIds = useMemo(() => new Set([state.nodeId, node.graphNodeId, node.id].filter(Boolean) as string[]), [node.graphNodeId, node.id, state.nodeId]);
  const planItems = useMemo(() => textToPlanItems(planText), [planText]);
  const acceptance = useMemo(() => textToAcceptance(acceptanceText), [acceptanceText]);
  const done = doneCount(planItems);
  const verified = verifiedCount(acceptance);
  const total = acceptance.length;
  const planTotal = planItems.length;
  const trackedTotal = planTotal || total;
  const trackedDone = planTotal ? done : verified;
  const trackedLabel = planTotal ? 'Plan' : 'Acceptance';
  const percent = trackedTotal > 0 ? Math.max(0, Math.min(100, Math.round((trackedDone / trackedTotal) * 100))) : 0;
  const linked = useMemo(() => linkedNodesForGoal(graphIds, nodes, edges), [edges, graphIds, nodes]);

  const setAllPlanItems = (nextStatus: string) => {
    setPlanText(planItemsToText(planItems.map(item => ({ ...item, status: nextStatus }))));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave({
        title,
        objective,
        nextAction,
        planItems,
        acceptance,
      });
    } catch (e: any) {
      setError(e?.message || t('Save failed'));
    } finally {
      setSaving(false);
    }
  };

  // Component mounts only while the goal expanded view is open.
  useSaveShortcut(save, true);

  // Item-level goal actions (spec §7: goal.add/delete/check/uncheck/complete).
  // The editor text is refreshed from the action response after-snapshot so the
  // list reflects the change immediately; the workflow poll catches up later.
  const runGoalAction = async (action: string, payload: Record<string, unknown>) => {
    if (actionPending) return false;
    setActionPending(true);
    try {
      const body = await runWorkflowNodeAction(graphId, action, payload);
      const snapshot = goalStateFromActionBody(body);
      if (snapshot) {
        if (Array.isArray(snapshot.planItems)) setPlanText(planItemsToText(snapshot.planItems));
        if (Array.isArray(snapshot.acceptance)) setAcceptanceText(acceptanceToText(snapshot));
      }
      return true;
    } catch (e: any) {
      showGoalActionErrorToast(e, t('Goal action failed'), action);
      return false;
    } finally {
      setActionPending(false);
    }
  };

  const togglePlanItem = (item: { id?: string; status?: string }) => {
    if (!item.id || actionPending) return;
    void runGoalAction(isDoneStatus(item.status) ? 'goal.uncheck' : 'goal.check', {
      planItemIds: [item.id],
      actorNodeId: 'browser',
    });
  };

  const deletePlanItem = (item: { id?: string }) => {
    if (!item.id || actionPending) return;
    void runGoalAction('goal.delete', { planItemIds: [item.id] });
  };

  const addPlanItem = async () => {
    const text = newItemText.trim();
    if (!text || actionPending) return;
    const ok = await runGoalAction('goal.add', { planItems: [{ text, status: 'todo' }] });
    if (ok) setNewItemText('');
  };

  const completeGoal = () => {
    void runGoalAction('goal.complete', {});
  };

  return (
    <motion.div
      data-canvas-control="true"
      data-testid="workflow-goal-expanded-node"
      data-node-id={graphId}
      className="workflow-runtime-expanded-backdrop nodrag nopan nowheel"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <motion.section
        className="workflow-runtime-expanded-shell workflow-goal-expanded-shell workflow-node-workbench-shell"
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.99 }}
        transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
      >
        <header className="workflow-runtime-expanded-header">
          <div>
            <Target size={16} />
            <input
              data-testid="workflow-goal-expanded-title"
              value={title}
              onChange={event => setTitle(event.target.value)}
              aria-label={t('Goal title')}
            />
          </div>
          <button type="button" data-testid="workflow-runtime-expanded-close" onClick={onClose} title={t('Close')}>
            <X size={14} />
          </button>
        </header>

        <div className="workflow-runtime-expanded-body workflow-node-workbench-body">
          <main className="workflow-node-workbench-preview">
            <section
              className="workflow-goal-node workflow-node-workbench-preview-node workflow-goal-workbench-node"
              data-goal-status={state.status || 'active'}
            >
              <span className="workflow-node-workbench-port workflow-node-workbench-port-left" />
              <span className="workflow-node-workbench-port workflow-node-workbench-port-right" />
              <header className="workflow-node-workbench-node-header">
                <span className="workflow-goal-workbench-icon"><Target size={22} /></span>
                <div>
                  <strong>{title || 'Goal'}</strong>
                  <span>{state.taskId || node.taskId || 'active task'}</span>
                </div>
                <em>{statusLabel(state.status || node.status)}</em>
              </header>
              <div className="workflow-goal-workbench-progress">
                <div>
                  <span>{t(trackedLabel)}</span>
                  <strong>{trackedDone}/{trackedTotal}</strong>
                </div>
                <span><i style={{ width: `${percent}%` }} /></span>
              </div>
              <div className="workflow-goal-workbench-acceptance">
                {(planItems.length ? planItems : (acceptance.length ? acceptance : [{ id: 'goal', text: title || 'Goal', status: state.status || 'active' }])).slice(0, 5).map((item, index) => (
                  <div key={`${item.id || index}`}>
                    {isDoneStatus(item.status) ? <CheckCircle2 size={15} color="#059669" /> : <Circle size={15} color="#94a3b8" />}
                    <span>{item.text || item.id || trackedLabel}</span>
                    <em>{item.status || 'tracked'}</em>
                  </div>
                ))}
              </div>
              <footer>
                <span>{trackedLabel} {trackedDone}/{trackedTotal}</span>
                <span>rev {state.revision || 0}</span>
              </footer>
            </section>
          </main>

          <aside className="workflow-node-workbench-config">
            <div className="workflow-node-workbench-stats">
              <SmallStat label={t('Status')} value={statusLabel(state.status)} />
              <SmallStat label={t('Plan')} value={`${done}/${planTotal}`} />
              <SmallStat label={t('Acceptance')} value={`${verified}/${total}`} />
            </div>
            <label className="workflow-node-workbench-field workflow-node-workbench-field-wide">
              <span>{t('Objective')}</span>
              <textarea data-testid="workflow-goal-objective" value={objective} onChange={event => setObjective(event.target.value)} rows={4} />
            </label>
            <section className="workflow-node-workbench-section">
              <header>
                <ListChecks size={14} />
                <span>{t('Plan list')}</span>
              </header>
              <div className="workflow-goal-plan-toolbar">
                <button type="button" onClick={() => setAllPlanItems('done')} disabled={planItems.length === 0}>{t('Check all')}</button>
                <button type="button" onClick={() => setAllPlanItems('todo')} disabled={planItems.length === 0}>{t('Clear checks')}</button>
                <button type="button" data-testid="workflow-goal-complete" onClick={completeGoal} disabled={actionPending} title={t('Complete goal (requires all items checked)')}>
                  <CheckCircle2 size={12} /> {t('Complete')}
                </button>
              </div>
              <div className="workflow-goal-plan-add-row" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  data-testid="workflow-goal-plan-add-input"
                  value={newItemText}
                  onChange={event => setNewItemText(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void addPlanItem(); } }}
                  placeholder={t('New plan item...')}
                  disabled={actionPending}
                  style={{ flex: 1, minWidth: 0, padding: '5px 7px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 11, background: 'transparent', color: 'inherit' }}
                />
                <button type="button" data-testid="workflow-goal-plan-add" onClick={() => void addPlanItem()} disabled={actionPending || !newItemText.trim()} title={t('Add plan item')}>
                  <Plus size={12} /> {t('Add')}
                </button>
              </div>
              <div className="workflow-goal-plan-list">
                {planItems.length === 0 ? (
                  <span className="workflow-node-workbench-empty">{t('No plan items')}</span>
                ) : planItems.slice(0, 16).map((item, index) => {
                  const checked = isDoneStatus(item.status);
                  return (
                    <div
                      key={`${item.id || index}`}
                      className="workflow-goal-plan-row"
                      data-state={checked ? 'done' : 'todo'}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}
                    >
                      <button
                        type="button"
                        data-testid="workflow-goal-item-check"
                        data-item-id={item.id || ''}
                        data-state={checked ? 'done' : 'todo'}
                        onClick={() => togglePlanItem(item)}
                        disabled={actionPending || !item.id}
                        title={checked ? t('Uncheck item') : t('Check item')}
                        style={{ display: 'grid', placeItems: 'center', width: 20, height: 20, padding: 0, border: 'none', background: 'transparent', cursor: actionPending ? 'wait' : 'pointer', flexShrink: 0 }}
                      >
                        {checked ? <CheckCircle2 size={15} color="#059669" /> : <Circle size={15} color="#94a3b8" />}
                      </button>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text || item.id || `Plan ${index + 1}`}</span>
                      <em style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>{item.status || 'todo'}</em>
                      <button
                        type="button"
                        data-testid="workflow-goal-item-delete"
                        data-item-id={item.id || ''}
                        onClick={() => deletePlanItem(item)}
                        disabled={actionPending || !item.id}
                        title={t('Delete item')}
                        style={{ display: 'grid', placeItems: 'center', width: 20, height: 20, padding: 0, border: 'none', background: 'transparent', color: '#b91c1c', cursor: actionPending ? 'wait' : 'pointer', flexShrink: 0 }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <label className="workflow-node-workbench-field workflow-node-workbench-field-wide">
                <textarea data-testid="workflow-goal-plan-editor" value={planText} onChange={event => setPlanText(event.target.value)} rows={5} placeholder="P-001 | Inspect current nodes | todo" />
              </label>
            </section>
            <label className="workflow-node-workbench-field">
              <span>{t('Next step')}</span>
              <input data-testid="workflow-goal-next-action" value={nextAction} onChange={event => setNextAction(event.target.value)} />
            </label>
            <label className="workflow-node-workbench-field workflow-node-workbench-field-wide">
              <span>{t('Acceptance criteria')}</span>
              <textarea data-testid="workflow-goal-acceptance-editor" value={acceptanceText} onChange={event => setAcceptanceText(event.target.value)} rows={8} />
            </label>
            <LinkedList title={t('Connected timers')} icon={<Clock3 size={14} />} items={linked.timers} />
            <LinkedList title={t('Goal agents')} icon={<Bot size={14} />} items={linked.agents} />
          </aside>
        </div>

        <footer className="workflow-runtime-expanded-footer">
          <span>Plan {done}/{planTotal} - Acceptance {verified}/{total} - rev {state.revision || 0}</span>
          {error && <strong>{error}</strong>}
          <button type="button" data-testid="workflow-goal-expanded-save" onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {saving ? <Loader2 size={13} style={{ animation: 'loading-spin 0.8s linear infinite', flexShrink: 0 }} /> : <Save size={13} />} {saving ? t('Saving...') : t('Save')}
          </button>
        </footer>
      </motion.section>
    </motion.div>
  );
}
