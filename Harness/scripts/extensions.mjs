#!/usr/bin/env node
/**
 * Global lazy extension runtime for Harness.
 *
 * Downloaded payloads always live below <globalDir>/Harness/extensions.
 * A project only receives Harness/extensions/lock.json; it never receives
 * extension payloads or absolute runtime paths.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const SCHEMA_VERSION = 1;
export const EXTENSIONS_RELATIVE_ROOT = path.join('Harness', 'extensions');
export const PROJECT_LOCK_RELATIVE_PATH = path.join(EXTENSIONS_RELATIVE_ROOT, 'lock.json');

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HASH_RE = /^[a-f0-9]{64}$/i;
const MANIFEST_FILE = 'extension.json';

function fail(message, code = 'EXTENSION_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function asAbsolute(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty path`);
  return path.resolve(value);
}

export function getGlobalExtensionsRoot(globalDir) {
  return path.join(asAbsolute(globalDir, 'globalDir'), EXTENSIONS_RELATIVE_ROOT);
}

export function getProjectExtensionsRoot(projectRoot) {
  return path.join(asAbsolute(projectRoot, 'projectRoot'), EXTENSIONS_RELATIVE_ROOT);
}

export function getProjectLockPath(projectRoot) {
  return path.join(getProjectExtensionsRoot(projectRoot), 'lock.json');
}

function assertSafeRelativePath(value, label = 'path') {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a relative path`);
  if (value.includes('\0') || value.includes('\\')) fail(`${label} must use safe POSIX separators`);
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) fail(`${label} must be relative`);
  const pieces = value.split('/');
  if (pieces.some(piece => piece === '' || piece === '.' || piece === '..')) {
    fail(`${label} contains an unsafe path segment`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized.startsWith('../') || normalized === '..') {
    fail(`${label} normalizes outside its extension root`);
  }
  return value;
}

function assertId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) fail(`invalid extension id: ${id}`);
  return id;
}

function assertVersion(version) {
  if (typeof version !== 'string' || !VERSION_RE.test(version)) fail(`invalid extension version: ${version}`);
  return version;
}

function assertHash(hash, label) {
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) fail(`${label} must be a SHA-256 hex digest`);
  return hash.toLowerCase();
}

export function validateExtensionManifest(manifest, expected = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('extension manifest must be an object');
  if (manifest.schemaVersion !== SCHEMA_VERSION) fail(`unsupported extension manifest schema: ${manifest.schemaVersion}`);
  assertId(manifest.id);
  assertVersion(manifest.version);
  if (expected.id && manifest.id !== expected.id) fail(`manifest id ${manifest.id} does not match registry id ${expected.id}`);
  if (expected.version && manifest.version !== expected.version) fail(`manifest version ${manifest.version} does not match registry version ${expected.version}`);
  assertSafeRelativePath(manifest.entry || MANIFEST_FILE, 'manifest entry');
  if (manifest.capabilities !== undefined && (!Array.isArray(manifest.capabilities) || manifest.capabilities.some(value => typeof value !== 'string'))) {
    fail('manifest capabilities must be an array of strings');
  }
  return manifest;
}

export function readRegistry(registryPath) {
  const absolute = asAbsolute(registryPath, 'registryPath');
  let registry;
  try {
    registry = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    fail(`cannot read extension registry ${absolute}: ${error.message}`, 'EXTENSION_REGISTRY_READ');
  }
  if (!registry || registry.schemaVersion !== SCHEMA_VERSION || !Array.isArray(registry.extensions)) {
    fail('extension registry has an unsupported schema', 'EXTENSION_REGISTRY_INVALID');
  }
  const ids = new Set();
  for (const extension of registry.extensions) {
    assertId(extension?.id);
    assertVersion(extension?.version);
    if (ids.has(extension.id)) fail(`duplicate extension id: ${extension.id}`);
    ids.add(extension.id);
    if (extension.kind === 'builtin') continue;
    if (extension.kind === 'package') {
      if (extension.defaultInstall !== false) fail(`package extension ${extension.id} must opt out of default installation`);
      if (!extension.package || extension.package.manager !== 'pnpm') fail(`package extension ${extension.id} must declare pnpm metadata`);
      if (typeof extension.package.scope !== 'string' || !/^@[a-z0-9-]+$/.test(extension.package.scope)) fail(`invalid package scope for ${extension.id}`);
      if (typeof extension.package.name !== 'string' || !extension.package.name.startsWith(`${extension.package.scope}/`)) fail(`invalid package name for ${extension.id}`);
      assertVersion(extension.package.version);
      if (extension.package.capabilities !== undefined && (!Array.isArray(extension.package.capabilities) || extension.package.capabilities.some(value => typeof value !== 'string'))) {
        fail(`package capabilities must be an array of strings for ${extension.id}`);
      }
      continue;
    }
    if (extension.kind !== 'downloaded') fail(`unsupported extension kind for ${extension.id}`);
    if (!extension.source || extension.source.type !== 'files' || !Array.isArray(extension.source.files) || extension.source.files.length === 0) {
      fail(`downloaded extension ${extension.id} must declare a files source`);
    }
    for (const file of extension.source.files) {
      assertSafeRelativePath(file?.path, `source file for ${extension.id}`);
      assertHash(file?.sha256, `source file ${file.path}`);
    }
    if (extension.source.baseUrl) {
      let sourceUrl;
      try { sourceUrl = new URL(extension.source.baseUrl); } catch { fail(`invalid source URL for ${extension.id}`); }
      if (sourceUrl.protocol !== 'https:') fail(`extension source must use HTTPS: ${extension.id}`);
    }
    if (!extension.source.files.some(file => file.path === MANIFEST_FILE)) {
      fail(`downloaded extension ${extension.id} must include ${MANIFEST_FILE}`);
    }
  }
  return registry;
}

function findExtension(registry, id) {
  const extension = registry.extensions.find(candidate => candidate.id === id);
  if (!extension) fail(`extension is not registered: ${id}`, 'EXTENSION_NOT_FOUND');
  return extension;
}

function resolveSourceDirectory(source, registryPath) {
  if (typeof source.directory !== 'string' || source.directory.trim() === '') return null;
  return path.resolve(path.dirname(registryPath), source.directory);
}

async function fetchRemote(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) fail(`extension download failed (${response.status}): ${url}`, 'EXTENSION_DOWNLOAD_FAILED');
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (error.code?.startsWith('EXTENSION_')) throw error;
    fail(`extension download failed: ${url}: ${error.message}`, 'EXTENSION_DOWNLOAD_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

async function readSourceFile(source, registryPath, relativeFile) {
  const directory = resolveSourceDirectory(source, registryPath);
  if (directory) {
    const sourceFile = path.resolve(directory, ...relativeFile.split('/'));
    if (!sourceFile.startsWith(directory + path.sep)) fail(`source file escapes source directory: ${relativeFile}`);
    if (!existsSync(sourceFile)) fail(`source file does not exist: ${sourceFile}`, 'EXTENSION_SOURCE_MISSING');
    if (lstatSync(sourceFile).isSymbolicLink()) fail(`source file must not be a symlink: ${relativeFile}`);
    return readFileSync(sourceFile);
  }
  if (typeof source.baseUrl !== 'string' || source.baseUrl.trim() === '') {
    fail('files source must declare either directory or baseUrl');
  }
  const base = source.baseUrl.replace(/\/+$/, '');
  return fetchRemote(`${base}/${relativeFile.split('/').map(encodeURIComponent).join('/')}`);
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJsonIfPresent(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`invalid JSON at ${file}: ${error.message}`, 'EXTENSION_STATE_INVALID');
  }
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function assertInside(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (!resolvedCandidate.startsWith(resolvedRoot + path.sep)) fail(`${label} escapes ${resolvedRoot}`);
  return resolvedCandidate;
}

function assertNoSymlinkSegments(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (existsSync(resolvedRoot) && lstatSync(resolvedRoot).isSymbolicLink()) fail(`${label} root must not be a symlink`, 'EXTENSION_UNSAFE_DESTINATION');
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail(`${label} escapes ${resolvedRoot}`, 'EXTENSION_UNSAFE_DESTINATION');
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) fail(`${label} contains a symlink: ${current}`, 'EXTENSION_UNSAFE_DESTINATION');
  }
  return resolvedCandidate;
}

function installedManifest(finalRoot, extension) {
  const manifestPath = path.join(finalRoot, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  try {
    return validateExtensionManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), extension);
  } catch (error) {
    fail(`installed extension is invalid at ${finalRoot}: ${error.message}`, 'EXTENSION_INSTALLED_INVALID');
  }
}

function verifyInstalledFiles(finalRoot, extension) {
  const manifest = installedManifest(finalRoot, extension);
  if (!manifest) fail(`installed extension is missing ${MANIFEST_FILE}: ${finalRoot}`, 'EXTENSION_INSTALLED_INVALID');
  for (const file of extension.source.files) {
    const candidate = assertInside(finalRoot, path.join(finalRoot, ...file.path.split('/')), 'installed extension file');
    if (!existsSync(candidate) || lstatSync(candidate).isSymbolicLink()) fail(`installed extension file is missing or unsafe: ${file.path}`, 'EXTENSION_INSTALLED_INVALID');
    if (hashBytes(readFileSync(candidate)) !== file.sha256.toLowerCase()) fail(`installed extension hash mismatch: ${file.path}`, 'EXTENSION_INSTALLED_INVALID');
  }
  return manifest;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireInstallLock(globalExtensionsRoot) {
  mkdirSync(globalExtensionsRoot, { recursive: true });
  const lockPath = path.join(globalExtensionsRoot, '.install.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, 'utf8');
      closeSync(fd);
      return lockPath;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const lock = readInstallLock(lockPath);
      if (lock && isProcessAlive(lock.pid)) fail(`another extension install is running (pid ${lock.pid})`, 'EXTENSION_INSTALL_LOCKED');
      try { unlinkSync(lockPath); } catch {}
    }
  }
  fail(`could not acquire extension install lock: ${lockPath}`, 'EXTENSION_INSTALL_LOCKED');
}

function releaseInstallLock(lockPath) {
  if (lockPath && existsSync(lockPath)) {
    try { unlinkSync(lockPath); } catch {}
  }
}

function readInstallLock(lockPath) {
  try { return JSON.parse(readFileSync(lockPath, 'utf8')); } catch { return null; }
}

function lockEntry(lock, extension) {
  return lock?.extensions?.[extension.id];
}

export async function ensureExtension({ id, globalDir, projectRoot, registryPath, registry } = {}) {
  assertId(id);
  const resolvedGlobalDir = asAbsolute(globalDir, 'globalDir');
  const resolvedProjectRoot = asAbsolute(projectRoot || process.cwd(), 'projectRoot');
  const resolvedRegistryPath = asAbsolute(registryPath || path.join(resolvedGlobalDir, 'Harness', 'extensions', 'registry.json'), 'registryPath');
  const sourceRegistry = registry || readRegistry(resolvedRegistryPath);
  const extension = findExtension(sourceRegistry, id);
  if (extension.kind === 'builtin') {
    fail(`${id} is a built-in global-runtime capability and is not downloaded`, 'EXTENSION_BUILTIN');
  }
  if (extension.kind === 'package') {
    fail(`${id} is a pnpm package extension; use the wf extension install command`, 'EXTENSION_PACKAGE_RUNTIME_REQUIRED');
  }

  const globalExtensionsRoot = getGlobalExtensionsRoot(resolvedGlobalDir);
  const finalRoot = assertInside(globalExtensionsRoot, path.join(globalExtensionsRoot, extension.id, extension.version), 'extension payload');
  const installLock = acquireInstallLock(globalExtensionsRoot);
  try {
    assertNoSymlinkSegments(globalExtensionsRoot, finalRoot, 'extension payload');
    const projectLockPath = getProjectLockPath(resolvedProjectRoot);
    assertNoSymlinkSegments(resolvedProjectRoot, path.dirname(projectLockPath), 'project extension metadata');
    const lock = readJsonIfPresent(projectLockPath, { schemaVersion: SCHEMA_VERSION, extensions: {} });
    if (lock.schemaVersion !== SCHEMA_VERSION || !lock.extensions || typeof lock.extensions !== 'object') {
      fail(`invalid extension lock at ${projectLockPath}`, 'EXTENSION_STATE_INVALID');
    }
    const existing = lockEntry(lock, extension);
    if (existing?.version === extension.version && existsSync(finalRoot)) {
      verifyInstalledFiles(finalRoot, extension);
      return { status: 'already-installed', id: extension.id, version: extension.version, path: finalRoot };
    }

    const stagingRoot = path.join(globalExtensionsRoot, '.staging');
    mkdirSync(stagingRoot, { recursive: true });
    const staging = mkdtempSync(path.join(stagingRoot, `${extension.id}-`));
    try {
      const source = extension.source;
      for (const file of source.files) {
        const relativeFile = assertSafeRelativePath(file.path, `source file for ${extension.id}`);
        const bytes = await readSourceFile(source, resolvedRegistryPath, relativeFile);
        const actualHash = hashBytes(bytes);
        if (actualHash !== file.sha256.toLowerCase()) fail(`SHA-256 mismatch for ${extension.id}/${relativeFile}`, 'EXTENSION_HASH_MISMATCH');
        const stagedFile = assertInside(staging, path.join(staging, ...relativeFile.split('/')), 'staged extension file');
        mkdirSync(path.dirname(stagedFile), { recursive: true });
        writeFileSync(stagedFile, bytes);
      }
      const manifest = validateExtensionManifest(JSON.parse(readFileSync(path.join(staging, MANIFEST_FILE), 'utf8')), extension);
      if (existsSync(finalRoot)) {
        verifyInstalledFiles(finalRoot, extension);
        rmSync(staging, { recursive: true, force: true });
      } else {
        mkdirSync(path.dirname(finalRoot), { recursive: true });
        renameSync(staging, finalRoot);
      }
      writeJsonAtomic(projectLockPath, {
        schemaVersion: SCHEMA_VERSION,
        extensions: {
          ...lock.extensions,
          [extension.id]: {
            version: extension.version,
            manifestSha256: hashBytes(Buffer.from(JSON.stringify(manifest))),
            installedAt: new Date().toISOString(),
          },
        },
      });
      return { status: 'installed', id: extension.id, version: extension.version, path: finalRoot };
    } finally {
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    }
  } finally {
    releaseInstallLock(installLock);
  }
}

function parseArgs(argv) {
  const [command = 'list', ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) fail(`unknown argument: ${token}`, 'EXTENSION_USAGE');
    const key = token.slice(2);
    if (key === 'json') { args.json = true; continue; }
    const value = rest[++index];
    if (!value || value.startsWith('--')) fail(`missing value for --${key}`, 'EXTENSION_USAGE');
    args[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return args;
}

function defaultRegistryPath(globalDir) {
  if (globalDir) return path.join(asAbsolute(globalDir, 'globalDir'), 'Harness', 'extensions', 'registry.json');
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extensions', 'registry.json');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const registryPath = args.registry || defaultRegistryPath(args.globalDir);
  const registry = readRegistry(registryPath);
  if (args.command === 'list') {
    return { schemaVersion: SCHEMA_VERSION, extensions: registry.extensions };
  }
  if (args.command === 'status') {
    const extension = findExtension(registry, args.id);
    if (extension.kind === 'builtin') return { status: 'builtin', id: extension.id, runtime: extension.runtime };
    if (extension.kind === 'package') return {
      status: 'package',
      id: extension.id,
      version: extension.version,
      defaultInstall: extension.defaultInstall === true,
      package: extension.package,
    };
    const finalRoot = path.join(getGlobalExtensionsRoot(args.globalDir), extension.id, extension.version);
    return { status: existsSync(finalRoot) ? 'installed' : 'missing', id: extension.id, version: extension.version, path: finalRoot };
  }
  if (args.command === 'ensure') {
    if (!args.id || !args.globalDir) fail('ensure requires --id and --global-dir', 'EXTENSION_USAGE');
    return ensureExtension({
      id: args.id,
      globalDir: args.globalDir,
      projectRoot: args.project || process.cwd(),
      registryPath,
      registry,
    });
  }
  fail(`unknown extension command: ${args.command}`, 'EXTENSION_USAGE');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    process.stderr.write(`[extensions] ${error.message}\n`);
    process.exitCode = 1;
  });
}
// End of extension runtime.
