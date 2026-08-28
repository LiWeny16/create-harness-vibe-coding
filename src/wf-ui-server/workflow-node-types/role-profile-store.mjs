// role-profile-store.mjs — backend-owned role profile store for Agent nodes
// (agent-team-cooperation-spec §3, AC-001). Agents never write these files;
// the store is written by the backend create-agent path and read for context
// injection (AC-002).
import fs from 'node:fs';
import path from 'node:path';

const ROLES_DIR_NAME = 'agent-roles';

// Canonical subagent role order for auto-assignment (spec §3.1, AC-004/F6).
const CANONICAL_SUBAGENT_ROLES = ['reviewer', 'implementer', 'verifier', 'planner', 'manager'];

function rolesDir(projectRoot) {
  return path.join(projectRoot, 'Harness', 'a2a', ROLES_DIR_NAME);
}

function profileJsonPath(projectRoot, nodeId) {
  return path.join(rolesDir(projectRoot), `${nodeId}.json`);
}

/**
 * The agent-readable profile reference (markdown file path, spec §3.3).
 * @param {string} nodeId
 * @returns {string}
 */
export function roleProfileRefFor(nodeId) {
  return `Harness/a2a/agent-roles/${nodeId}.md`;
}

function renderRoleProfileMarkdown(profile) {
  return [
    `# Role Profile — ${profile.displayName}`,
    '',
    '<!-- Role profile (agent-team-cooperation-spec §3). Backend-owned; agents never edit this file. -->',
    '',
    `- nodeId: ${profile.nodeId}`,
    `- displayName: ${profile.displayName}`,
    `- roleTitle: ${profile.roleTitle}`,
    `- agentKind: ${profile.agentKind}`,
    `- runtime: ${profile.runtime}`,
    `- provider: ${profile.provider || ''}`,
    `- model: ${profile.model || ''}`,
    `- capabilities: ${profile.capabilities.join(', ')}`,
    `- roleProfileRef: ${profile.roleProfileRef}`,
    '',
    '## Responsibility',
    '',
    profile.responsibility,
    '',
  ].join('\n');
}

/**
 * Create (or overwrite) the role profile for an agent node. Writes both the
 * markdown role profile (the agent-readable roleProfileRef, spec §3.4) and the
 * profile JSON (read back by readRoleProfile / listRoleProfiles). The JSON
 * shape follows spec §3.3 exactly.
 *
 * @param {object} profile
 * @param {string} profile.nodeId - graph node id of the agent
 * @param {string} profile.roleTitle - canonical id or free-form role (spec §3.1)
 * @param {string} [profile.displayName] - user-visible name; defaults to roleTitle
 * @param {string} [profile.responsibility=''] - one-paragraph mandate, plain language
 * @param {string} [profile.agentKind='subagent'] - lifecycle flag only (main | subagent)
 * @param {string} profile.runtime - from session-registry ALLOWED_RUNTIMES
 * @param {string} [profile.provider='']
 * @param {string} [profile.model='']
 * @param {string[]} [profile.capabilities=[]]
 * @param {string} [profile.createdBy='unknown']
 * @param {string} [profile.parentSessionId=''] - creating parent session id
 *   (backend-owned; used by nextAvailableRole for AC-004 distinct roles)
 * @param {string} [projectRoot=process.cwd()]
 * @returns {{profile: object, roleProfileRef: string}}
 */
export function createRoleProfile(profile, projectRoot = process.cwd()) {
  const nodeId = String(profile?.nodeId || '').trim();
  if (!nodeId) {
    throw new Error('createRoleProfile requires a nodeId');
  }
  const roleTitle = String(profile?.roleTitle || '').trim() || 'terminal-agent';
  const capabilities = Array.isArray(profile?.capabilities)
    ? [...new Set(profile.capabilities.map(item => String(item || '').trim()).filter(Boolean))]
    : [];
  const full = {
    nodeId,
    displayName: String(profile?.displayName || '').trim() || roleTitle,
    roleTitle,
    agentKind: String(profile?.agentKind || '').trim() || 'subagent',
    responsibility: String(profile?.responsibility || '').trim(),
    runtime: String(profile?.runtime || '').trim(),
    provider: String(profile?.provider || '').trim() || null,
    model: String(profile?.model || '').trim() || null,
    capabilities,
    roleProfileRef: roleProfileRefFor(nodeId),
    createdAt: new Date().toISOString(),
    createdBy: String(profile?.createdBy || '').trim() || 'unknown',
    parentSessionId: String(profile?.parentSessionId || '').trim() || null,
  };
  fs.mkdirSync(rolesDir(projectRoot), { recursive: true });
  fs.writeFileSync(profileJsonPath(projectRoot, nodeId), `${JSON.stringify(full, null, 2)}\n`);
  fs.writeFileSync(path.join(rolesDir(projectRoot), `${nodeId}.md`), renderRoleProfileMarkdown(full));
  return { profile: full, roleProfileRef: full.roleProfileRef };
}

/**
 * Read the role profile JSON for a node.
 * @param {string} nodeId
 * @param {string} [projectRoot=process.cwd()]
 * @returns {object|null}
 */
export function readRoleProfile(nodeId, projectRoot = process.cwd()) {
  try {
    const raw = fs.readFileSync(profileJsonPath(projectRoot, String(nodeId || '').trim()), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * List every stored role profile.
 * @param {string} [projectRoot=process.cwd()]
 * @returns {object[]}
 */
export function listRoleProfiles(projectRoot = process.cwd()) {
  try {
    const dir = rolesDir(projectRoot);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Session-record patch for a profile (spec §3.3: profile written at
 * create-agent time as both a session record field set and the markdown file).
 * @param {object} profile
 * @returns {{displayName: string, roleTitle: string, responsibility: string, capabilities: string[], roleProfileRef: string|null}}
 */
export function profileSessionFields(profile) {
  return {
    displayName: profile?.displayName || '',
    roleTitle: profile?.roleTitle || '',
    responsibility: profile?.responsibility || '',
    capabilities: Array.isArray(profile?.capabilities) ? profile.capabilities : [],
    roleProfileRef: profile?.roleProfileRef || null,
  };
}

/**
 * Next distinct subagent role for a parent (spec §3.3, AC-004/F6). Canonical
 * order: reviewer, implementer, verifier, planner, manager. Roles already used
 * by the parent's existing children (profiles recorded with the same
 * parentSessionId) are skipped; when every canonical role is taken, the order
 * cycles with a numeric suffix (reviewer-2, implementer-2, ...) so each new
 * child still gets a distinct roleTitle.
 *
 * @param {string} parentSessionId - creating parent session id
 * @param {string} [projectRoot=process.cwd()]
 * @returns {string}
 */
export function nextAvailableRole(parentSessionId, projectRoot = process.cwd()) {
  const parent = String(parentSessionId || '').trim();
  const used = new Set(
    listRoleProfiles(projectRoot)
      .filter(profile => parent && String(profile?.parentSessionId || '').trim() === parent)
      .map(profile => String(profile?.roleTitle || '').trim())
      .filter(Boolean),
  );
  for (const role of CANONICAL_SUBAGENT_ROLES) {
    if (!used.has(role)) return role;
  }
  let index = 0;
  let suffix = 2;
  for (;;) {
    const candidate = `${CANONICAL_SUBAGENT_ROLES[index % CANONICAL_SUBAGENT_ROLES.length]}-${suffix}`;
    if (!used.has(candidate)) return candidate;
    index += 1;
    if (index % CANONICAL_SUBAGENT_ROLES.length === 0) suffix += 1;
  }
}
