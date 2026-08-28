import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_LIMIT = 250;
const MAX_CONFIG_BYTES = 256 * 1024;

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

function stableMcpId(sourceId, name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const base = slug || crypto.createHash('sha1').update(String(name || 'mcp')).digest('hex').slice(0, 10);
  return `mcp:${sourceId}:${base}`;
}

function rootDefinitions(projectRoot) {
  return [
    {
      id: 'project-mcp',
      label: 'Project MCP config',
      scope: 'project',
      runtime: 'mcp',
      filePath: path.join(projectRoot, '.mcp.json'),
    },
    {
      id: 'project-mcp-json',
      label: 'Project mcp.json',
      scope: 'project',
      runtime: 'mcp',
      filePath: path.join(projectRoot, 'mcp.json'),
    },
    {
      id: 'project-cursor',
      label: 'Cursor MCP config',
      scope: 'project',
      runtime: 'cursor',
      filePath: path.join(projectRoot, '.cursor', 'mcp.json'),
    },
    {
      id: 'project-vscode',
      label: 'VS Code MCP config',
      scope: 'project',
      runtime: 'vscode',
      filePath: path.join(projectRoot, '.vscode', 'mcp.json'),
    },
    {
      id: 'project-claude',
      label: 'Claude MCP config',
      scope: 'project',
      runtime: 'claude',
      filePath: path.join(projectRoot, '.claude', 'mcp.json'),
    },
  ];
}

function readJsonConfig(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_CONFIG_BYTES) {
    throw mcpHubError('MCP config is too large to index safely', {
      statusCode: 413,
      code: 'CONFIG_TOO_LARGE',
      details: { file: path.basename(filePath), maxBytes: MAX_CONFIG_BYTES },
    });
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function serverMapFromConfig(config) {
  if (!isPlainObject(config)) return {};
  if (isPlainObject(config.mcpServers)) return config.mcpServers;
  if (isPlainObject(config.servers)) return config.servers;
  if (isPlainObject(config.mcp) && isPlainObject(config.mcp.servers)) return config.mcp.servers;
  if (isPlainObject(config.mcp) && isPlainObject(config.mcp.mcpServers)) return config.mcp.mcpServers;
  return {};
}

function basenameCommand(value) {
  const command = String(value || '').trim();
  if (!command) return '';
  return path.basename(command.replace(/^['"]|['"]$/g, ''));
}

function redactUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    const segments = url.pathname.split('/');
    url.pathname = segments.map((segment, index) => {
      const previous = String(segments[index - 1] || '').toLowerCase();
      if (/^(token|secret|key|auth|bearer|password|credential|credentials)$/.test(previous)) {
        return 'redacted';
      }
      if (/(token|secret|password|credential)=/i.test(segment)) return 'redacted';
      return segment;
    }).join('/');
    return url.toString();
  } catch {
    return '';
  }
}

function transportFor(server) {
  const explicit = String(server.transport || server.type || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (server.url || server.endpoint) return 'http';
  if (server.command) return 'stdio';
  return 'unknown';
}

function envKeys(server) {
  if (!isPlainObject(server.env)) return [];
  return Object.keys(server.env).map(String).filter(Boolean).sort();
}

function configServerToRecord(projectRoot, root, name, server) {
  const source = {
    rootId: root.id,
    label: root.label,
    scope: root.scope,
    runtime: root.runtime,
    relativePath: path.basename(root.filePath),
    path: displayPath(projectRoot, root.filePath),
  };
  const transport = transportFor(server);
  const url = redactUrl(server.url || server.endpoint || '');
  const env = envKeys(server);
  const commandName = basenameCommand(server.command);
  const argCount = Array.isArray(server.args) ? server.args.length : 0;
  const hasSecrets = env.length > 0 || Boolean(String(server.url || server.endpoint || '').includes('?'));
  const searchText = [
    name,
    transport,
    commandName,
    url,
    env.join(' '),
    source.path,
  ].join(' ');
  return {
    id: stableMcpId(root.id, name),
    name,
    title: name,
    kind: 'mcp-server',
    nodeSemantics: 'agent-attached-mcp-provider',
    attachable: false,
    creatable: true,
    state: 'indexed',
    transport,
    commandName,
    argCount,
    url,
    envKeys: env,
    risk: {
      metadataOnly: true,
      commandNotExecuted: true,
      credentialsNotProbed: true,
      secretsRedacted: hasSecrets,
    },
    searchText,
    sources: [source],
  };
}

function filterServers(servers, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return servers;
  return servers.filter(server => String(server.searchText || '').toLowerCase().includes(q));
}

function groupServers(servers) {
  const groups = new Map();
  const ensure = (id, label, kind) => {
    if (!groups.has(id)) groups.set(id, { id, label, kind, serverIds: [] });
    return groups.get(id);
  };
  for (const server of servers) {
    const primary = server.sources?.[0];
    if (primary) ensure(`source:${primary.rootId}`, primary.label, 'source-config').serverIds.push(server.id);
    ensure(`transport:${server.transport || 'unknown'}`, `${server.transport || 'unknown'} transport`, 'transport').serverIds.push(server.id);
  }
  return [...groups.values()]
    .filter(group => group.serverIds.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function listMcpHub(projectRoot, options = {}) {
  const scope = String(options.scope || 'project').toLowerCase();
  if (scope !== 'project') {
    throw mcpHubError('Invalid MCP hub scope; only project is supported for safe metadata discovery', {
      statusCode: 400,
      code: 'INVALID_SCOPE',
      details: { scope },
    });
  }
  const q = String(options.q || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(Number(options.limit || DEFAULT_LIMIT) || DEFAULT_LIMIT, DEFAULT_LIMIT));
  const roots = rootDefinitions(projectRoot).map(root => ({
    ...root,
    exists: fs.existsSync(root.filePath),
    path: displayPath(projectRoot, root.filePath),
  }));

  const servers = [];
  for (const root of roots) {
    if (!root.exists) continue;
    try {
      const config = readJsonConfig(root.filePath);
      for (const [name, server] of Object.entries(serverMapFromConfig(config))) {
        if (!isPlainObject(server)) continue;
        servers.push(configServerToRecord(projectRoot, root, String(name), server));
        if (servers.length >= limit) break;
      }
    } catch {
      // Invalid MCP config files are skipped so the Hub remains a stable metadata index.
    }
  }

  const filtered = filterServers(servers, q)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ searchText, ...server }) => server);
  const groups = groupServers(filtered);
  const envKeyCount = filtered.reduce((count, server) => count + (server.envKeys?.length || 0), 0);
  const redactedFieldCount = filtered.reduce((count, server) => count + (server.risk?.secretsRedacted ? 1 : 0), 0);
  return {
    ok: true,
    schemaVersion: 1,
    kind: 'mcp-hub',
    generatedAt: new Date().toISOString(),
    query: { scope, q, limit },
    roots: roots.map(({ filePath, ...root }) => root),
    summary: {
      serverCount: filtered.length,
      groupCount: groups.length,
      sourceCount: roots.filter(root => root.exists).length,
      envKeyCount,
      redactedFieldCount,
    },
    nodeSemantics: {
      role: 'agent-attached-tool-resource-provider',
      defaultConnection: 'bidirectional capability/status port to Agent nodes',
      executor: 'agent',
      safety: 'metadata-only-no-spawn-no-secret',
    },
    servers: filtered,
    groups,
  };
}

export function mcpHubError(message, { statusCode = 400, code = 'BAD_REQUEST', details } = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (isPlainObject(details)) err.details = details;
  return err;
}
