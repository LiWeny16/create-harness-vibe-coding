import { Bot, Clock3, Link2, Target } from 'lucide-react';
import type { WorkflowCapsuleRole, WorkflowCapsuleSummary } from '../../types';

type Props = {
  capsule?: WorkflowCapsuleSummary;
  selfRole: WorkflowCapsuleRole;
  compact?: boolean;
};

const ROLE_LABELS: Record<WorkflowCapsuleRole, string> = {
  goal: 'Goal',
  timer: 'Timer',
  agent: 'Agent',
};

const EMPTY_LABELS: Record<WorkflowCapsuleRole, string> = {
  goal: 'Goal inactive',
  timer: 'Timer offline',
  agent: 'Drop Agent',
};

const ROLE_ICONS = {
  goal: Target,
  timer: Clock3,
  agent: Bot,
} as const;

function linksForRole(capsule: WorkflowCapsuleSummary | undefined, role: WorkflowCapsuleRole) {
  if (!capsule) return [];
  if (role === 'goal') return capsule.goals;
  if (role === 'timer') return capsule.timers;
  return capsule.agents;
}

function slotRolesFor(selfRole: WorkflowCapsuleRole): WorkflowCapsuleRole[] {
  if (selfRole === 'goal') return ['timer', 'agent'];
  if (selfRole === 'timer') return ['goal', 'agent'];
  return ['goal', 'timer'];
}

function linkedRoleLabel(role: WorkflowCapsuleRole, status: string | undefined, capsule: WorkflowCapsuleSummary | undefined) {
  const normalized = String(status || '').trim().toLowerCase();
  if (role === 'goal') {
    if (normalized === 'active') return 'Goal active';
    if (normalized === 'completed' || normalized === 'done') return 'Goal done';
    if (normalized === 'blocked') return 'Goal blocked';
    return 'Goal linked';
  }
  if (role === 'timer') {
    if (capsule?.wdtState || normalized.includes('watchdog')) return 'Timer check';
    if (normalized === 'enabled') return 'Timer on';
    if (normalized === 'paused') return 'Timer paused';
    if (normalized === 'stopped') return 'Timer stopped';
    return 'Timer linked';
  }
  if (normalized === 'running') return 'Agent running';
  if (normalized === 'stopped' || normalized === 'exited' || normalized === 'complete') return 'Agent stopped';
  return 'Agent linked';
}

export default function WorkflowCapsuleStrip({ capsule, selfRole, compact = false }: Props) {
  const roles = slotRolesFor(selfRole);
  const mode = capsule?.mode || 'standalone';
  return (
    <div className="workflow-capsule-strip" data-capsule-mode={mode} data-compact={compact ? 'true' : 'false'}>
      <span className="workflow-capsule-state" title={capsule?.nextLabel || EMPTY_LABELS[roles[0]]}>
        <Link2 size={12} />
        <strong>{capsule?.stateLabel || 'Standalone'}</strong>
        {!compact && capsule?.sequenceLabel && <em>{capsule.sequenceLabel}</em>}
      </span>
      {roles.map(role => {
        const Icon = ROLE_ICONS[role];
        const links = linksForRole(capsule, role);
        const linked = links.length > 0;
        const first = links[0];
        const label = linked ? linkedRoleLabel(role, first.status, capsule) : EMPTY_LABELS[role];
        return (
          <span
            key={role}
            className="workflow-capsule-pill"
            data-role={role}
            data-state={linked ? 'linked' : 'empty'}
            title={linked ? `${ROLE_LABELS[role]}: ${first.title}` : EMPTY_LABELS[role]}
          >
            <Icon size={12} />
            <span>{label}</span>
            {links.length > 1 && <em>+{links.length - 1}</em>}
          </span>
        );
      })}
    </div>
  );
}
