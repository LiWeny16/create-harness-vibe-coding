import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_SKILL_FILE_BYTES = 64 * 1024;
const DEFAULT_LIMIT = 250;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function startsInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function displayPath(projectRoot, filePath) {
  const absolute = path.resolve(filePath);
  const root = path.resolve(projectRoot);
  if (startsInside(absolute, root)) return toPosix(path.relative(root, absolute));
  const home = path.resolve(os.homedir());
  if (startsInside(absolute, home)) return `~/${toPosix(path.relative(home, absolute))}`;
  return path.basename(absolute);
}

function parseFrontmatter(text) {
  const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {};
  const data = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    if (key) data[key] = value;
  }
  return data;
}

function firstHeading(text) {
  const body = String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function readSkillFile(filePath) {
  const stat = fs.statSync(filePath);
  const bytes = Math.min(stat.size, MAX_SKILL_FILE_BYTES);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function stableSkillId(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return `skill:${slug || crypto.createHash('sha1').update(String(name || 'skill')).digest('hex').slice(0, 10)}`;
}

function rootDefinitions(projectRoot, { includeUser = true } = {}) {
  const roots = [
    {
      id: 'project-agents',
      label: 'Project Codex skills',
      scope: 'project',
      runtime: 'codex',
      rootPath: path.join(projectRoot, '.agents', 'skills'),
    },
    {
      id: 'project-claude',
      label: 'Project Claude skills',
      scope: 'project',
      runtime: 'claude',
      rootPath: path.join(projectRoot, '.claude', 'skills'),
    },
    {
      id: 'project-opencode',
      label: 'Project OpenCode skills',
      scope: 'project',
      runtime: 'opencode',
      rootPath: path.join(projectRoot, '.opencode', 'skills'),
    },
    {
      id: 'project-pi',
      label: 'Project Pi skills',
      scope: 'project',
      runtime: 'pi',
      rootPath: path.join(projectRoot, '.pi', 'skills'),
    },
    {
      id: 'project-copilot',
      label: 'Project Copilot skills',
      scope: 'project',
      runtime: 'copilot',
      rootPath: path.join(projectRoot, '.copilot', 'skills'),
    },
  ];
  if (includeUser) {
    const home = os.homedir();
    roots.push(
      {
        id: 'user-codex',
        label: 'User Codex skills',
        scope: 'user',
        runtime: 'codex',
        rootPath: path.join(home, '.codex', 'skills'),
      },
      {
        id: 'user-agents',
        label: 'User agent skills',
        scope: 'user',
        runtime: 'codex',
        rootPath: path.join(home, '.agents', 'skills'),
      },
      {
        id: 'user-claude',
        label: 'User Claude skills',
        scope: 'user',
        runtime: 'claude',
        rootPath: path.join(home, '.claude', 'skills'),
      },
      {
        id: 'user-opencode',
        label: 'User OpenCode skills',
        scope: 'user',
        runtime: 'opencode',
        rootPath: path.join(home, '.config', 'opencode', 'skills'),
      },
      {
        id: 'user-pi',
        label: 'User Pi skills',
        scope: 'user',
        runtime: 'pi',
        rootPath: path.join(home, '.pi', 'skills'),
      },
      {
        id: 'user-copilot',
        label: 'User Copilot skills',
        scope: 'user',
        runtime: 'copilot',
        rootPath: path.join(home, '.copilot', 'skills'),
      },
    );
  }
  return roots;
}

export function skillInstallTargets(projectRoot, { includeUser = true } = {}) {
  return rootDefinitions(projectRoot, { includeUser }).map(root => ({
    id: root.id,
    label: root.label,
    scope: root.scope,
    runtime: root.runtime,
    default: root.id === 'project-agents',
    path: displayPath(projectRoot, root.rootPath),
  }));
}

export function resolveSkillInstallTarget(projectRoot, targetScope = 'project-agents') {
  const id = String(targetScope || 'project-agents').trim() || 'project-agents';
  const root = rootDefinitions(projectRoot, { includeUser: true }).find(item => item.id === id);
  if (!root) {
    throw skillsHubError('Invalid skills install target', {
      statusCode: 400,
      code: 'INVALID_INSTALL_TARGET',
      details: { targetScope: id },
    });
  }
  return {
    ...root,
    default: root.id === 'project-agents',
    path: displayPath(projectRoot, root.rootPath),
  };
}

function listSkillFiles(rootPath, maxFiles) {
  const root = path.resolve(rootPath);
  const results = [];
  if (!fs.existsSync(root)) return results;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length > 0 && results.length < maxFiles) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const absolute = path.join(current.dir, entry.name);
      if (!startsInside(path.resolve(absolute), root)) continue;
      if (entry.isFile() && entry.name === 'SKILL.md') {
        results.push(absolute);
      } else if (entry.isDirectory() && current.depth < 4 && !entry.name.startsWith('.')) {
        stack.push({ dir: absolute, depth: current.depth + 1 });
      }
    }
  }
  return results;
}

function skillFromFile(projectRoot, rootDef, filePath) {
  const text = readSkillFile(filePath);
  const frontmatter = parseFrontmatter(text);
  const name = String(frontmatter.name || path.basename(path.dirname(filePath))).trim();
  const heading = firstHeading(text);
  const description = String(frontmatter.description || '').trim();
  const relativePath = toPosix(path.relative(path.resolve(rootDef.rootPath), path.resolve(filePath)));
  const source = {
    rootId: rootDef.id,
    label: rootDef.label,
    scope: rootDef.scope,
    runtime: rootDef.runtime,
    relativePath,
    path: displayPath(projectRoot, filePath),
  };
  return {
    id: stableSkillId(name),
    name,
    title: heading || name,
    description,
    kind: 'skill',
    nodeSemantics: 'agent-attached-capability-provider',
    attachable: true,
    state: 'indexed',
    searchText: `${name} ${heading} ${description} ${relativePath}`,
    source,
  };
}

function mergeSkill(existing, next) {
  if (!existing) {
    const { source, ...rest } = next;
    return { ...rest, sources: [source] };
  }
  const sources = [...existing.sources];
  if (!sources.some(source => source.rootId === next.source.rootId && source.relativePath === next.source.relativePath)) {
    sources.push(next.source);
  }
  return {
    ...existing,
    title: existing.title || next.title,
    description: existing.description || next.description,
    searchText: `${existing.searchText} ${next.searchText}`,
    sources,
  };
}

function groupSkills(skills) {
  const groups = new Map();
  const ensure = (id, label, kind) => {
    if (!groups.has(id)) groups.set(id, { id, label, kind, skillIds: [] });
    return groups.get(id);
  };
  for (const skill of skills) {
    const primary = skill.sources?.[0];
    if (primary) ensure(`root:${primary.rootId}`, primary.label, 'source-root').skillIds.push(skill.id);
    const family = String(skill.name || '').split(/[:-]/)[0];
    if (family && family !== skill.name && family.length >= 2) {
      ensure(`family:${family}`, `${family} skills`, 'name-family').skillIds.push(skill.id);
    }
    if (String(skill.name || '').startsWith('wf')) {
      ensure('recommended:workflow', 'Workflow skills', 'recommended').skillIds.push(skill.id);
    }
  }
  return [...groups.values()]
    .filter(group => group.skillIds.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function normalizeQuery(value) {
  return String(value || '').trim().toLowerCase();
}

function filterSkills(skills, query) {
  const q = normalizeQuery(query);
  if (!q) return skills;
  return skills.filter(skill => String(skill.searchText || '').toLowerCase().includes(q));
}

export function listSkillsHub(projectRoot, options = {}) {
  const scope = String(options.scope || 'project').toLowerCase();
  if (!['project', 'user', 'all'].includes(scope)) {
    throw skillsHubError('Invalid skills hub scope; expected project, user, or all', {
      statusCode: 400,
      code: 'INVALID_SCOPE',
      details: { scope },
    });
  }
  const query = normalizeQuery(options.q);
  const includeUser = scope !== 'project' && options.includeUser !== false;
  const limit = Math.max(1, Math.min(Number(options.limit || DEFAULT_LIMIT) || DEFAULT_LIMIT, DEFAULT_LIMIT));
  const roots = rootDefinitions(projectRoot, { includeUser })
    .filter(root => scope === 'all' || root.scope === scope)
    .map(root => ({
      ...root,
      exists: fs.existsSync(root.rootPath),
      path: displayPath(projectRoot, root.rootPath),
    }));

  const byId = new Map();
  for (const root of roots) {
    for (const filePath of listSkillFiles(root.rootPath, limit)) {
      try {
        const skill = skillFromFile(projectRoot, root, filePath);
        byId.set(skill.id, mergeSkill(byId.get(skill.id), skill));
      } catch {
        // Malformed skills are skipped; callers get a stable partial index.
      }
    }
  }

  const skills = filterSkills([...byId.values()], query)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ searchText, ...skill }) => skill);
  const groups = groupSkills(skills);
  return {
    ok: true,
    schemaVersion: 1,
    kind: 'skills-hub',
    generatedAt: new Date().toISOString(),
    query: { scope, q: query, limit },
    roots: roots.map(({ rootPath, ...root }) => root),
    summary: {
      skillCount: skills.length,
      groupCount: groups.length,
      sourceCount: roots.filter(root => root.exists).length,
    },
    installTargets: skillInstallTargets(projectRoot, { includeUser: true }),
    nodeSemantics: {
      role: 'agent-attached-capability-provider',
      defaultConnection: 'bidirectional capability/status port to Agent nodes',
      executor: 'agent',
    },
    skills,
    groups,
  };
}

export function skillsHubError(message, { statusCode = 400, code = 'BAD_REQUEST', details } = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (isPlainObject(details)) err.details = details;
  return err;
}
