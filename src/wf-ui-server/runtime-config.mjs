import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeDefinition } from './runtime-detector.mjs';

function resolveConfigPath(projectRoot, configFile) {
  const rawPath = configFile.resolvedPath || configFile.path;
  return path.isAbsolute(rawPath) ? rawPath : path.join(projectRoot, rawPath);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function backupIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const backupPath = `${filePath}.${Date.now()}.bak`;
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function getPathValue(object, dottedPath) {
  const parts = String(dottedPath || '').split('.').filter(Boolean);
  let current = object;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function setPathValue(object, dottedPath, value) {
  const parts = String(dottedPath || '').split('.').filter(Boolean);
  if (parts.length === 0) return;
  let current = object;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readTomlFields(filePath, fields) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, 'utf8');
  const values = {};
  for (const [alias, field] of Object.entries(fields || {})) {
    if (String(field).includes('.')) continue;
    const match = text.match(new RegExp(`^\\s*${escapeRegExp(field)}\\s*=\\s*(.*?)\\s*(?:#.*)?$`, 'm'));
    if (!match) continue;
    const raw = match[1].trim();
    values[alias] = raw.replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function updateTomlField(text, field, value) {
  if (String(field).includes('.')) return text;
  const nextLine = `${field} = ${JSON.stringify(String(value))}`;
  const regex = new RegExp(`^\\s*${escapeRegExp(field)}\\s*=\\s*.*$`, 'm');
  if (regex.test(text)) return text.replace(regex, nextLine);
  return `${text.replace(/\s*$/, '')}\n${nextLine}\n`;
}

function configFilesForRuntime(projectRoot, runtimeId) {
  const definition = getRuntimeDefinition(runtimeId);
  if (!definition) throw new Error(`Unknown runtime: ${runtimeId}`);
  return (definition.configFiles || []).map((configFile) => {
    const absolutePath = resolveConfigPath(projectRoot, configFile);
    const fields = configFile.fields || {};
    let values = {};
    if (configFile.format === 'json') {
      try {
        const json = readJson(absolutePath);
        values = Object.fromEntries(
          Object.entries(fields)
            .map(([alias, dottedPath]) => [alias, getPathValue(json, dottedPath)])
            .filter(([, value]) => value !== undefined),
        );
      } catch {
        values = {};
      }
    } else if (configFile.format === 'toml') {
      values = readTomlFields(absolutePath, fields);
    }

    return {
      scope: configFile.scope,
      path: configFile.path,
      absolutePath,
      format: configFile.format,
      fields,
      values,
      exists: fs.existsSync(absolutePath),
      writable: Object.keys(fields).length > 0,
    };
  });
}

export function readRuntimeConfig(projectRoot, runtimeId) {
  return {
    runtime: runtimeId,
    files: configFilesForRuntime(projectRoot, runtimeId),
  };
}

export function writeRuntimeConfig(projectRoot, runtimeId, payload = {}) {
  const scope = String(payload.scope || 'user');
  const values = payload.values || {};
  const configFile = configFilesForRuntime(projectRoot, runtimeId)
    .find((candidate) => candidate.scope === scope && candidate.writable);

  if (!configFile) throw new Error(`No writable ${scope} config is known for ${runtimeId}`);

  const backupPath = backupIfExists(configFile.absolutePath);
  if (configFile.format === 'json') {
    const data = readJson(configFile.absolutePath);
    for (const [alias, dottedPath] of Object.entries(configFile.fields)) {
      if (values[alias] !== undefined) setPathValue(data, dottedPath, String(values[alias]));
    }
    atomicWrite(configFile.absolutePath, `${JSON.stringify(data, null, 2)}\n`);
  } else if (configFile.format === 'toml') {
    let text = fs.existsSync(configFile.absolutePath) ? fs.readFileSync(configFile.absolutePath, 'utf8') : '';
    for (const [alias, field] of Object.entries(configFile.fields)) {
      if (values[alias] !== undefined) text = updateTomlField(text, field, values[alias]);
    }
    atomicWrite(configFile.absolutePath, text);
  } else {
    throw new Error(`Unsupported config format: ${configFile.format}`);
  }

  return {
    runtime: runtimeId,
    scope,
    path: configFile.path,
    absolutePath: configFile.absolutePath,
    backupPath,
    values,
  };
}
