import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, DragEvent, SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Boxes, GripVertical, X } from 'lucide-react';
import { useT } from '../i18n/index';
import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * WorkflowSkillsHubOverlay
 *
 * Big WYSIWYG fullscreen overlay for the Skills Hub / Skill Group config surface.
 * Pure presentational component: all data and callbacks flow in via props. The
 * integrator (WorkflowRoute) is responsible for wiring nodeRuntimeClient data
 * and for mounting this overlay; it is intentionally not rendered by any route
 * yet so it stays typecheck-only until integration.
 *
 * Styling: INLINE only (no index.css edits). Uses the same CSS custom
 * properties as the rest of the workflow chrome (--bg, --fg, --muted,
 * --border, --radius, --accent, --surface, --danger, --success, --warn).
 */

export type WorkflowSkillsOverlayTab = 'installed' | 'groups';

/**
 * Transfer type + payload contract for dragging a composed skill set onto the
 * node map. The chip (and each Installed-tab skill row) puts a payload of
 * {@link SkillGroupDragPayload} under this type; the integrator's canvas drop
 * handler reads it to create a skill-group node.
 */
export const SKILL_GROUP_TRANSFER_TYPE = 'application/x-harness-skill-group';

export interface SkillGroupDragPayload {
  skillIds: string[];
  label: string;
}

export interface WorkflowSkillsOverlaySkill {
  id: string;
  name: string;
  title?: string;
  enabled?: boolean;
}

export interface WorkflowSkillsOverlayGroup {
  nodeId: string;
  groupId: string;
  label: string;
  category?: string;
  tags?: string[];
  skillCount?: number;
  loadStrategy?: string;
  lockRef?: string;
  skills: WorkflowSkillsOverlaySkill[];
}

export interface WorkflowSkillsOverlayHub {
  tabs?: WorkflowSkillsOverlayTab[];
  activeTab?: WorkflowSkillsOverlayTab;
  installTargets?: string[];
}

export interface WorkflowSkillsOverlayAgent {
  nodeId: string;
  label: string;
}

export interface WorkflowSkillsOverlayPack {
  packSlug: string;
  name?: string;
  description?: string;
  category?: string;
  skillCount?: number;
  installed?: boolean;
  installable?: boolean;
}

export interface WorkflowSkillsOverlayGroupRow {
  id: string;
  label: string;
  category?: string;
  skillCount?: number;
}

/**
 * Name-family grouping descriptor for the hub Installed list. `group.kind ===
 * 'name-family'` (server id `family:<prefix>`); the hub lists its members as
 * collapsible sections, collapsed by default.
 */
export interface WorkflowSkillsOverlayFamily {
  id: string;
  label: string;
  skillIds: string[];
}

export interface WorkflowSkillsHubOverlayProps {
  open: boolean;
  mode: 'hub' | 'group';
  group?: WorkflowSkillsOverlayGroup;
  hub?: WorkflowSkillsOverlayHub;
  agents?: WorkflowSkillsOverlayAgent[];
  /**
   * Skills shown on the Installed tab in hub mode.
   * (In group mode, group.skills is used instead.)
   */
  skills?: WorkflowSkillsOverlaySkill[];
  /** Pack rows (legacy prop; the Market tab was removed from this overlay). */
  packs?: WorkflowSkillsOverlayPack[];
  /** Group rows shown on the Groups tab. */
  groups?: WorkflowSkillsOverlayGroupRow[];
  /** Name-family groups (`kind: 'name-family'`) for collapsible hub sections. */
  families?: WorkflowSkillsOverlayFamily[];
  onClose: () => void;
  onSetSkillEnabled?: (skillId: string, enabled: boolean) => void;
  onAttachToAgent?: (agentNodeId: string) => void;
  onUngroupSkill?: (skillId: string) => void;
  /** Optional: user picked a group row (hub mode, Groups tab). */
  onPickGroup?: (groupId: string) => void;
  /**
   * Optional: called when a composition drag starts (the draft chip or a
   * single skill row), so the integrator can hide the overlay and let the
   * drop land on the node map.
   */
  onDraftDragStart?: () => void;
  /**
   * While true the overlay stays mounted but is hidden from view and ignores
   * pointer events, so a composition drag can land on the node map without
   * discarding the internal draft. Only an explicit close (or unmount) clears
   * the draft.
   */
  hidden?: boolean;
}

const TAB_LABELS: Record<WorkflowSkillsOverlayTab, (t: (k: string) => string) => string> = {
  installed: t => t('Installed'),
  groups: t => t('Groups'),
};

export default function WorkflowSkillsHubOverlay(props: WorkflowSkillsHubOverlayProps) {
  const {
    open,
    mode,
    group,
    hub,
    agents,
    skills,
    packs,
    groups,
    families,
    onClose,
    onSetSkillEnabled,
    onAttachToAgent,
    onUngroupSkill,
    onPickGroup,
    onDraftDragStart,
    hidden = false,
  } = props;
  const t = useT();

  const availableTabs = (hub?.tabs ?? (['installed', 'groups'] as WorkflowSkillsOverlayTab[]))
    .filter(tab => tab === 'installed' || tab === 'groups');
  const initialTab = hub?.activeTab && availableTabs.includes(hub.activeTab)
    ? hub.activeTab
    : availableTabs[0] ?? 'installed';

  const [activeTab, setActiveTab] = useState<WorkflowSkillsOverlayTab>(initialTab);
  const [installTarget, setInstallTarget] = useState<string>('');
  const [pickedAgentNodeId, setPickedAgentNodeId] = useState<string>('');
  // Composition draft (hub mode only): skill ids staged by the Installed-tab
  // checkboxes and Add buttons before being dragged onto the node map.
  const [draftSkillIds, setDraftSkillIds] = useState<Set<string>>(new Set());
  // Row currently being dragged, for grab/grabbing cursor feedback.
  const [draggingSkillId, setDraggingSkillId] = useState<string | null>(null);
  // Expanded name-family sections (hub mode). Collapsed by default (D6).
  const [expandedFamilyIds, setExpandedFamilyIds] = useState<Set<string>>(new Set());
  const reducedMotion = useReducedMotion();

  const installTargets = hub?.installTargets ?? [];
  const agentList = agents ?? [];

  // Sync local active tab when the integrator-supplied activeTab changes.
  // Guarded by value equality to avoid update loops.
  useEffect(() => {
    if (hub?.activeTab && availableTabs.includes(hub.activeTab) && hub.activeTab !== activeTab) {
      setActiveTab(hub.activeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub?.activeTab, availableTabs.join('|')]);

  // Keep install target valid as the target list changes.
  useEffect(() => {
    if (installTargets.length === 0) return;
    if (!installTarget || !installTargets.includes(installTarget)) {
      setInstallTarget(installTargets[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installTargets.join('|'), installTarget]);

  // Keep picked agent valid as the agent list changes.
  useEffect(() => {
    if (agentList.length === 0) {
      if (pickedAgentNodeId !== '') setPickedAgentNodeId('');
      return;
    }
    if (!agentList.some(a => a.nodeId === pickedAgentNodeId)) {
      setPickedAgentNodeId(agentList[0].nodeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentList.map(a => a.nodeId).join('|'), pickedAgentNodeId]);

  // The draft set is a per-session staging area; clear it when the overlay is
  // explicitly closed. A hidden-but-mounted overlay (composition drag in
  // flight) keeps its draft so a cancelled drag can restore it.
  useEffect(() => {
    if (!open && !hidden && draftSkillIds.size > 0) setDraftSkillIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hidden]);

  // Escape closes the overlay; while hidden (drag in flight) it is ignored so
  // the pending drag still restores the overlay with its draft intact.
  useEffect(() => {
    if (!open || hidden) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hidden, onClose]);

  const title = mode === 'group'
    ? (group?.label || t('Skill Group'))
    : t('Skills Hub');

  const skillsToShow: WorkflowSkillsOverlaySkill[] = useMemo(
    () => (mode === 'group' ? (group?.skills ?? []) : (skills ?? [])),
    [mode, group, skills],
  );
  const allEnabled = skillsToShow.length > 0 && skillsToShow.every(s => s.enabled !== false);
  const anyEnabled = skillsToShow.some(s => s.enabled !== false);

  // Draft composition (hub mode only): skills staged by row checkboxes,
  // then dragged onto the node map via the draft chip.
  const draftSkills: WorkflowSkillsOverlaySkill[] = useMemo(
    () => (mode === 'hub' ? skillsToShow.filter(skill => draftSkillIds.has(skill.id)) : []),
    [mode, skillsToShow, draftSkillIds],
  );
  const draftLabel = draftSkills.length === 0
    ? ''
    : draftSkills.length <= 2
      ? draftSkills.map(skill => skill.title || skill.name).join(' + ')
      : `${draftSkills[0].title || draftSkills[0].name} +${draftSkills.length - 1}`;

  // Name-family grouping for the hub Installed list: families (server
  // `kind: 'name-family'`) become collapsible sections; skills outside any
  // family stay in a flat list.
  const hubSkillSections = useMemo(() => {
    if (mode !== 'hub') return null;
    const familyList = (families ?? []).filter(family => family.skillIds.length > 0);
    if (familyList.length === 0) return null;
    const byId = new Map(skillsToShow.map(skill => [skill.id, skill]));
    const sections: Array<{ type: 'family'; family: WorkflowSkillsOverlayFamily; skills: WorkflowSkillsOverlaySkill[] }
      | { type: 'flat'; skills: WorkflowSkillsOverlaySkill[] }> = familyList
      .map(family => ({
        type: 'family' as const,
        family,
        skills: family.skillIds.map(id => byId.get(id)).filter((skill): skill is WorkflowSkillsOverlaySkill => Boolean(skill)),
      }))
      .filter(section => section.skills.length > 0);
    const familyMembers = new Set(familyList.flatMap(family => family.skillIds));
    const ungrouped = skillsToShow.filter(skill => !familyMembers.has(skill.id));
    if (ungrouped.length > 0) sections.push({ type: 'flat', skills: ungrouped });
    return sections;
  }, [mode, families, skillsToShow]);

  const toggleFamilyExpanded = (familyId: string) => {
    setExpandedFamilyIds(prev => {
      const next = new Set(prev);
      if (next.has(familyId)) next.delete(familyId);
      else next.add(familyId);
      return next;
    });
  };

  if ((!open && !hidden) || typeof document === 'undefined' || !document.body) return null;

  const stop = (e: SyntheticEvent) => e.stopPropagation();

  const handleToggleAll = () => {
    if (!onSetSkillEnabled) return;
    const next = !allEnabled;
    for (const skill of skillsToShow) {
      if ((skill.enabled !== false) !== next) {
        onSetSkillEnabled(skill.id, next);
      }
    }
  };

  const toggleDraftSkill = (skillId: string) => {
    setDraftSkillIds(prev => {
      const next = new Set(prev);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  const startDraftDrag = (e: DragEvent<HTMLElement>) => {
    if (draftSkills.length === 0) return;
    e.dataTransfer.setData(
      SKILL_GROUP_TRANSFER_TYPE,
      JSON.stringify({ skillIds: draftSkills.map(skill => skill.id), label: draftLabel } satisfies SkillGroupDragPayload),
    );
    e.dataTransfer.effectAllowed = 'copy';
    onDraftDragStart?.();
  };

  const startSkillDrag = (e: DragEvent<HTMLElement>, skill: WorkflowSkillsOverlaySkill) => {
    e.dataTransfer.setData(
      SKILL_GROUP_TRANSFER_TYPE,
      JSON.stringify({ skillIds: [skill.id], label: skill.title || skill.name } satisfies SkillGroupDragPayload),
    );
    e.dataTransfer.effectAllowed = 'copy';
    setDraggingSkillId(skill.id);
    onDraftDragStart?.();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="workflow-skills-overlay"
      data-mode={mode}
      data-active-tab={mode === 'hub' ? activeTab : ''}
      data-group-id={group?.groupId || ''}
      data-node-id={group?.nodeId || ''}
      className="nodrag nopan nowheel"
      onPointerDown={stop}
      onMouseDown={stop}
      onWheel={stop}
      onKeyDown={stop}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      style={hidden ? { ...overlayBackdropStyle, visibility: 'hidden', pointerEvents: 'none' } : overlayBackdropStyle}
    >
      <section style={dialogStyle} className="nodrag nopan nowheel">
        {/* Header */}
        <header style={headerStyle}>
          <div style={headerTitleWrapStyle}>
            <Boxes size={18} />
            <div>
              <div style={headerTitleStyle}>{title}</div>
              <div style={headerSubtitleStyle}>
                {mode === 'group'
                  ? [
                      group?.category || t('skills'),
                      group?.skillCount != null ? `${group.skillCount} ${t('skills')}` : '',
                      group?.loadStrategy || '',
                    ].filter(Boolean).join(' · ')
                  : t('Agent-attached capability providers')}
              </div>
            </div>
            {group?.tags && group.tags.length > 0 && (
              <div style={tagRowStyle}>
                {group.tags.slice(0, 6).map(tag => (
                  <span key={tag} style={tagStyle}>{tag}</span>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            data-testid="workflow-skills-overlay-close"
            onClick={onClose}
            title={t('Close')}
            aria-label={t('Close')}
            style={closeBtnStyle}
          >
            <X size={16} />
          </button>
        </header>

        {/* Tabs row (hub mode only) */}
        {mode === 'hub' && availableTabs.length > 1 && (
          <div role="tablist" aria-label={t('Skills Hub sections')} style={tabsStyle}>
            {availableTabs.map(tab => (
              <button
                key={tab}
                type="button"
                role="tab"
                data-testid="workflow-skills-overlay-tab"
                data-tab={tab}
                aria-selected={activeTab === tab ? 'true' : 'false'}
                onClick={() => setActiveTab(tab)}
                style={tab === activeTab ? tabActiveStyle : tabStyle}
              >
                {TAB_LABELS[tab](t)}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={bodyStyle}>
          {/* Two-column layout: skills (left) + side panel (right) */}
          <div style={bodyGridStyle}>
            {/* Skills column */}
            <section style={columnSectionStyle} aria-label={t('Skills')}>
              <div style={columnHeaderStyle}>
                <strong>{mode === 'group' ? t('Group skills') : t('Skills')}</strong>
                <span style={countPillStyle}>{skillsToShow.length}</span>
                {onSetSkillEnabled && skillsToShow.length > 0 && (
                  <button
                    type="button"
                    data-testid="workflow-skills-overlay-toggle-all"
                    data-enabled={allEnabled ? 'true' : 'false'}
                    onClick={handleToggleAll}
                    style={ghostBtnStyle}
                  >
                    {allEnabled ? t('Disable all') : t('Enable all')}
                  </button>
                )}
              </div>

              {skillsToShow.length === 0 ? (
                <div style={emptyStyle}>{t('No skills found')}</div>
              ) : (() => {
                const renderSkillRow = (skill: WorkflowSkillsOverlaySkill) => {
                  const enabled = skill.enabled !== false;
                  return (
                    <li
                      key={skill.id}
                      data-skill-id={skill.id}
                      draggable={mode === 'hub'}
                      onDragStart={mode === 'hub' ? (e: DragEvent<HTMLElement>) => startSkillDrag(e, skill) : undefined}
                      onDragEnd={mode === 'hub' ? () => setDraggingSkillId(null) : undefined}
                      style={mode === 'hub' ? { ...skillRowStyle, cursor: draggingSkillId === skill.id ? 'grabbing' : 'grab' } : skillRowStyle}
                    >
                      <label style={skillMainStyle}>
                        <input
                          type="checkbox"
                          data-testid="workflow-skills-overlay-skill-toggle"
                          data-skill-id={skill.id}
                          data-enabled={mode === 'hub' ? undefined : (enabled ? 'true' : 'false')}
                          data-selected={mode === 'hub' ? (draftSkillIds.has(skill.id) ? 'true' : 'false') : undefined}
                          checked={mode === 'hub' ? draftSkillIds.has(skill.id) : enabled}
                          onChange={() => (mode === 'hub' ? toggleDraftSkill(skill.id) : onSetSkillEnabled?.(skill.id, !enabled))}
                          disabled={mode !== 'hub' && !onSetSkillEnabled}
                          style={toggleInputStyle}
                        />
                        <div>
                          <strong style={skillTitleStyle}>{skill.title || skill.name}</strong>
                          <span style={skillSubStyle}>{skill.name}</span>
                        </div>
                      </label>
                      <div style={skillActionsStyle}>
                        {mode === 'group' && onUngroupSkill && (
                          <button
                            type="button"
                            data-testid="workflow-skills-overlay-skill-remove"
                            data-skill-id={skill.id}
                            onClick={() => onUngroupSkill(skill.id)}
                            title={t('Remove from group')}
                            style={ghostBtnStyle}
                          >
                            {t('Remove')}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                };
                if (mode === 'hub' && hubSkillSections) {
                  return (
                    <div style={familyListStyle}>
                      {hubSkillSections.map(section => section.type === 'family' ? (
                        <section key={section.family.id} data-family-id={section.family.id} style={familySectionStyle}>
                          <button
                            type="button"
                            data-testid="workflow-skills-overlay-family-toggle"
                            data-family-id={section.family.id}
                            data-expanded={expandedFamilyIds.has(section.family.id) ? 'true' : 'false'}
                            onClick={() => toggleFamilyExpanded(section.family.id)}
                            style={familyHeaderStyle}
                          >
                            <span aria-hidden>{expandedFamilyIds.has(section.family.id) ? '▾' : '▸'}</span>
                            <strong>{section.family.label}</strong>
                            <span style={countPillStyle}>{section.skills.length}</span>
                          </button>
                          {expandedFamilyIds.has(section.family.id) && (
                            <ul style={listStyle}>
                              {section.skills.map(renderSkillRow)}
                            </ul>
                          )}
                        </section>
                      ) : (
                        <ul key="flat" style={listStyle}>
                          {section.skills.map(renderSkillRow)}
                        </ul>
                      ))}
                    </div>
                  );
                }
                return (
                  <ul style={listStyle}>
                    {skillsToShow.map(renderSkillRow)}
                  </ul>
                );
              })()}
            </section>

            {/* Side panel */}
            <aside style={sideColStyle} aria-label={t('Agents and policy')}>
              {/* Agents section */}
              <section style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <strong>{t('Agents')}</strong>
                  <span style={countPillStyle}>{agentList.length}</span>
                </div>
                {agentList.length === 0 ? (
                  <div style={emptyStyle}>{t('No connected agents')}</div>
                ) : (
                  <ul style={listStyle}>
                    {agentList.map(agent => (
                      <li key={agent.nodeId} style={agentRowStyle}>
                        <span style={agentLabelStyle}>{agent.label}</span>
                        <button
                          type="button"
                          data-testid="workflow-skills-overlay-mount"
                          data-agent-node-id={agent.nodeId}
                          onClick={() => onAttachToAgent?.(agent.nodeId)}
                          disabled={!onAttachToAgent}
                          style={mountBtnStyle}
                        >
                          {t('Mount')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {mode === 'group' && onAttachToAgent && agentList.length > 0 && (
                  <div style={pickerRowStyle}>
                    <label style={pickerLabelStyle}>
                      <span>{t('Mount whole group to')}</span>
                      <select
                        data-testid="workflow-skills-overlay-agent-picker"
                        value={pickedAgentNodeId}
                        onChange={e => setPickedAgentNodeId(e.target.value)}
                        style={selectStyle}
                      >
                        {agentList.map(agent => (
                          <option key={agent.nodeId} value={agent.nodeId}>{agent.label}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      data-testid="workflow-skills-overlay-mount-group"
                      data-agent-node-id={pickedAgentNodeId}
                      onClick={() => { if (pickedAgentNodeId) onAttachToAgent?.(pickedAgentNodeId); }}
                      disabled={!pickedAgentNodeId}
                      style={primaryBtnStyle}
                    >
                      {t('Mount group')}
                    </button>
                  </div>
                )}
              </section>

              {/* Policy section (group mode shows load strategy / lock ref) */}
              <section style={cardStyle} aria-label={t('Policy')}>
                <div style={cardHeaderStyle}><strong>{t('Policy')}</strong></div>
                <dl style={defListStyle}>
                  <div style={defRowStyle}>
                    <dt style={defKeyStyle}>{t('Load strategy')}</dt>
                    <dd style={defValStyle}>{group?.loadStrategy || (anyEnabled ? 'auto' : 'manual')}</dd>
                  </div>
                  <div style={defRowStyle}>
                    <dt style={defKeyStyle}>{t('Lock ref')}</dt>
                    <dd style={defValStyle}>{group?.lockRef || t('local')}</dd>
                  </div>
                  <div style={defRowStyle}>
                    <dt style={defKeyStyle}>{t('Enabled')}</dt>
                    <dd style={defValStyle}>{allEnabled ? t('all') : anyEnabled ? t('some') : t('none')}</dd>
                  </div>
                </dl>
              </section>

              {/* Install target (always visible so user can set default scope) */}
              {installTargets.length > 0 && (
                <section style={cardStyle} aria-label={t('Install target')}>
                  <div style={cardHeaderStyle}><strong>{t('Install target')}</strong></div>
                  <label style={pickerLabelStyle}>
                    <span>{t('Target')}</span>
                    <select
                      data-testid="workflow-skills-overlay-install-target"
                      value={installTarget}
                      onChange={e => setInstallTarget(e.target.value)}
                      style={selectStyle}
                    >
                      {installTargets.map(target => (
                        <option key={target} value={target}>{target}</option>
                      ))}
                    </select>
                  </label>
                </section>
              )}

            </aside>
          </div>

          {/* Groups tab body — pick a group row. */}
          {mode === 'hub' && activeTab === 'groups' && (
            <section style={marketSectionStyle} aria-label={t('Skill groups')}>
              <div style={cardHeaderStyle}><strong>{t('Groups')}</strong></div>
              {(groups ?? []).length === 0 ? (
                <div style={emptyStyle}>{t('No groups found')}</div>
              ) : (
                <ul style={listStyle}>
                  {(groups ?? []).map(grp => (
                    <li key={grp.id} data-group-id={grp.id} style={packRowStyle}>
                      <div style={skillMainStyle}>
                        <strong style={skillTitleStyle}>{grp.label}</strong>
                        <span style={skillSubStyle}>
                          {[grp.category, grp.skillCount != null ? `${grp.skillCount} ${t('skills')}` : '']
                            .filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <button
                        type="button"
                        data-testid="workflow-skills-overlay-pick-group"
                        data-group-id={grp.id}
                        onClick={() => onPickGroup?.(grp.id)}
                        disabled={!onPickGroup}
                        style={ghostBtnStyle}
                      >
                        {t('Open')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {/* Draft composition bar — staged skills, drag the chip onto the node map. */}
        <AnimatePresence initial={false}>
          {mode === 'hub' && draftSkills.length > 0 && (
            <motion.div
              data-testid="workflow-skills-overlay-draft-bar"
              data-draft-count={draftSkills.length}
              initial={reducedMotion ? undefined : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: 10 }}
              transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
              style={draftBarStyle}
            >
              <span style={draftCountStyle}>
                {t('Selected skills')}
                <strong style={draftCountNumStyle}>{draftSkills.length}</strong>
              </span>
              <motion.div
                whileTap={reducedMotion ? undefined : { scale: 0.96 }}
                transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
                style={draftChipPressStyle}
              >
                <button
                  type="button"
                  draggable
                  data-testid="workflow-skills-overlay-draft-chip"
                  data-draft-count={draftSkills.length}
                  onDragStart={startDraftDrag}
                  onDragEnd={() => setDraggingSkillId(null)}
                  style={draftChipStyle}
                >
                  <GripVertical size={14} />
                  {t('Drag to canvas to create skill pack')}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>,
    document.body,
  );
}

/* ---------- inline styles ---------- */

const overlayBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'rgba(15, 23, 42, 0.45)',
  zIndex: 9999,
  boxSizing: 'border-box',
};

const dialogStyle: CSSProperties = {
  width: 'min(1200px, 92vw)',
  height: 'min(820px, 88vh)',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'calc(var(--radius) * 2)',
  boxShadow: '0 32px 80px rgba(15, 23, 42, 0.32)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxSizing: 'border-box',
  maxWidth: '100%',
  maxHeight: '100%',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  padding: '14px 18px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--surface)',
};

const headerTitleWrapStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
  flexWrap: 'wrap',
};

const headerTitleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  color: 'var(--fg)',
  lineHeight: 1.2,
};

const headerSubtitleStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--muted)',
  marginTop: 2,
};

const tagRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  marginLeft: 8,
};

const tagStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--muted)',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '2px 6px',
};

const closeBtnStyle: CSSProperties = {
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  cursor: 'pointer',
};

const tabsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 4,
  padding: 4,
  margin: '12px 18px 0',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--surface)',
};

const tabStyle: CSSProperties = {
  minHeight: 30,
  border: '1px solid transparent',
  borderRadius: 'calc(var(--radius) - 1px)',
  background: 'transparent',
  color: 'var(--muted)',
  fontSize: 11,
  fontWeight: 800,
  cursor: 'pointer',
};

const tabActiveStyle: CSSProperties = {
  ...tabStyle,
  borderColor: 'rgba(15,23,42,0.12)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  boxShadow: '0 1px 4px rgba(15,23,42,0.08)',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  boxSizing: 'border-box',
};

const bodyGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)',
  gap: 16,
  alignItems: 'start',
};

const columnSectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: 12,
  minHeight: 0,
};

const columnHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: 'var(--fg)',
};

const countPillStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: 'var(--muted)',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 999,
  padding: '2px 8px',
};

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const skillRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
};

const skillMainStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
};

const toggleInputStyle: CSSProperties = {
  width: 16,
  height: 16,
  cursor: 'pointer',
  accentColor: 'var(--accent)',
};

const skillTitleStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--fg)',
};

const skillSubStyle: CSSProperties = {
  display: 'block',
  fontSize: 10,
  color: 'var(--muted)',
};

const skillActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: '0 0 auto',
};

const sideColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
};

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
};

const cardHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  justifyContent: 'space-between',
  fontSize: 12,
  color: 'var(--fg)',
};

const agentRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--surface)',
};

const agentLabelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--fg)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const pickerRowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingTop: 6,
  borderTop: '1px solid var(--border)',
  marginTop: 2,
};

const pickerLabelStyle: CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 10,
  color: 'var(--muted)',
};

const inlinePickerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 10,
  color: 'var(--muted)',
};

const selectStyle: CSSProperties = {
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontSize: 11,
  width: '100%',
  boxSizing: 'border-box',
};

const defListStyle: CSSProperties = {
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const defRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 8,
  fontSize: 11,
};

const defKeyStyle: CSSProperties = {
  color: 'var(--muted)',
};

const defValStyle: CSSProperties = {
  margin: 0,
  color: 'var(--fg)',
  fontWeight: 700,
  textAlign: 'right',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '60%',
};

const marketSectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
};

const packRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--surface)',
};

const familyListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const familySectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg)',
};

const familyHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 800,
  color: 'var(--fg)',
  background: 'var(--surface)',
  border: 'none',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  textAlign: 'left',
};

const emptyStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--muted)',
  padding: '12px 8px',
  textAlign: 'center',
};

const ghostBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 8px',
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--fg)',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
};

const primaryBtnStyle: CSSProperties = {
  padding: '7px 10px',
  fontSize: 11,
  fontWeight: 800,
  color: '#fff',
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
};

const mountBtnStyle: CSSProperties = {
  padding: '4px 8px',
  fontSize: 10,
  fontWeight: 800,
  color: 'var(--fg)',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
};

const draftBarStyle: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  margin: '0 18px 14px',
  padding: '10px 14px',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'calc(var(--radius) * 2)',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)',
  boxSizing: 'border-box',
};

const draftCountStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--fg)',
};

const draftCountNumStyle: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontSize: 13,
  fontWeight: 800,
  color: 'var(--accent)',
};

const draftChipPressStyle: CSSProperties = {
  display: 'inline-flex',
};

const draftChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 40,
  padding: '0 16px',
  fontSize: 12,
  fontWeight: 800,
  color: '#fff',
  background: 'var(--accent)',
  border: '1px solid var(--accent)',
  borderRadius: 999,
  cursor: 'grab',
  boxSizing: 'border-box',
};
