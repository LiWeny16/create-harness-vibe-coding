import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createCapabilityNode, getCapabilityNode, updateCapabilityNode } from './workflow-capability-node-store.mjs';
import { resolveSkillInstallTarget, skillInstallTargets } from './workflow-skills-hub.mjs';

const SKILLSTORE_BASE_URL = 'https://skillstore.io';
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
const MAX_SKILLS_PER_PACK = 64;
const MAX_FILES_PER_PACK = 256;
const LOCK_REL_PATH = 'Harness/a2a/skills-market-lock.json';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function slugPart(value, fallback = 'skill') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return slug || fallback;
}

function normalizeProvider(value) {
  const provider = String(value || 'skillstore').trim().toLowerCase();
  if (provider !== 'skillstore') {
    throw skillsMarketError('Unsupported skills market provider', {
      statusCode: 400,
      code: 'UNSUPPORTED_PROVIDER',
      details: { provider },
    });
  }
  return provider;
}

function normalizeQuery(value) {
  return String(value || '').trim().toLowerCase();
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function base64UrlBuffer(value) {
  return Buffer.from(String(value || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function verifySignedPayload(payload, signature, label) {
  if (!isPlainObject(signature)) return { present: false, verified: false };
  try {
    const algorithm = boundedString(signature.algorithm || signature.alg || 'Ed25519', 40);
    if (algorithm.toLowerCase() !== 'ed25519') {
      throw new Error(`unsupported signature algorithm ${algorithm}`);
    }
    const key = crypto.createPublicKey({
      key: { ...signature.publicKeyJwk, ext: true },
      format: 'jwk',
    });
    const ok = crypto.verify(null, Buffer.from(canonicalJson(payload), 'utf8'), key, base64UrlBuffer(signature.value));
    if (!ok) throw new Error('signature mismatch');
    return {
      present: true,
      verified: true,
      algorithm,
      keyId: boundedString(signature.keyId || '', 80),
      signedAt: boundedString(signature.signedAt || '', 80),
    };
  } catch (error) {
    throw skillsMarketError(`Skills market ${label} signature verification failed`, {
      statusCode: 422,
      code: 'BAD_SIGNATURE',
      details: { label, reason: error?.message || 'signature verification failed' },
    });
  }
}

function lockPath(projectRoot) {
  return path.join(projectRoot, LOCK_REL_PATH);
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function startsInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeRelativePath(value, code = 'INVALID_FILE_PATH') {
  const raw = String(value || '').replace(/\\/g, '/').trim();
  if (
    !raw
    || raw.includes('\0')
    || raw.startsWith('/')
    || raw.startsWith('~')
    || /^[a-zA-Z]:\//.test(raw)
    || raw.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    throw skillsMarketError('Invalid skill artifact path; only bounded relative paths are allowed', {
      statusCode: 400,
      code,
      details: { path: raw },
    });
  }
  const normalized = path.posix.normalize(raw);
  if (normalized.startsWith('../') || normalized === '..' || path.posix.isAbsolute(normalized)) {
    throw skillsMarketError('Invalid skill artifact path; path escapes install root', {
      statusCode: 400,
      code,
      details: { path: raw },
    });
  }
  return normalized;
}

function assertHttpsDownloadUrl(value) {
  const raw = String(value || '').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw skillsMarketError('Invalid skill artifact URL', {
      statusCode: 400,
      code: 'INVALID_FILE_URL',
    });
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw skillsMarketError('Skill artifact URL must be HTTPS without embedded credentials', {
      statusCode: 400,
      code: 'INVALID_FILE_URL',
    });
  }
  if (url.hostname !== 'raw.githubusercontent.com') {
    throw skillsMarketError('Skill artifact URL host is not allowed', {
      statusCode: 400,
      code: 'UNTRUSTED_FILE_URL',
      details: { host: url.hostname },
    });
  }
  return url.toString();
}

function assertWritableDestination(rootPath, destination) {
  const root = path.resolve(rootPath);
  const absolute = path.resolve(destination);
  if (!startsInside(absolute, root)) {
    throw skillsMarketError('Skill artifact destination escapes install target', {
      statusCode: 400,
      code: 'PATH_ESCAPE',
    });
  }
  const relativeParts = path.relative(root, absolute).split(path.sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < relativeParts.length; index += 1) {
    current = path.join(current, relativeParts[index]);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw skillsMarketError('Skill install refused a symlinked path segment', {
        statusCode: 400,
        code: 'SYMLINK_ESCAPE',
      });
    }
  }
}

async function readResponseBuffer(response, maxBytes, url) {
  if (!response || !response.ok) {
    throw skillsMarketError('Skills market request failed', {
      statusCode: 502,
      code: 'MARKET_FETCH_FAILED',
      details: { url, status: response?.status || 0 },
    });
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > maxBytes) {
    throw skillsMarketError('Skills market response exceeded byte limit', {
      statusCode: 413,
      code: 'MARKET_RESPONSE_TOO_LARGE',
      details: { url, bytes: buffer.length, limit: maxBytes },
    });
  }
  return buffer;
}

async function fetchJson(fetchImpl, url, maxBytes = MAX_FILE_BYTES) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, redirect: 'manual' });
  const buffer = await readResponseBuffer(response, maxBytes, url);
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw skillsMarketError('Skills market returned invalid JSON', {
      statusCode: 502,
      code: 'INVALID_MARKET_JSON',
      details: { url },
    });
  }
}

async function fetchBuffer(fetchImpl, url, maxBytes) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/octet-stream,text/plain,*/*' }, redirect: 'manual' });
  return readResponseBuffer(response, maxBytes, url);
}

function providerPackUrl(provider, suffix) {
  normalizeProvider(provider);
  return `${SKILLSTORE_BASE_URL}${suffix}`;
}

function installedPackByKey(projectRoot) {
  const lock = readJson(lockPath(projectRoot), { schemaVersion: 1, installs: [] });
  const byKey = new Map();
  for (const install of Array.isArray(lock.installs) ? lock.installs : []) {
    const key = `${install.provider || ''}:${install.packSlug || ''}:${install.targetScope || ''}`;
    if (install.provider && install.packSlug) byKey.set(key, install);
  }
  return byKey;
}

function normalizePack(raw, installedByKey) {
  const slug = boundedString(raw?.slug || raw?.id, 120);
  if (!slug) return null;
  const provider = 'skillstore';
  const firstInstall = [...installedByKey.values()].find(item => item.provider === provider && item.packSlug === slug);
  const tags = Array.isArray(raw?.scenarioTags) ? raw.scenarioTags.map(tag => boundedString(tag, 48)).filter(Boolean).slice(0, 12) : [];
  return {
    id: `${provider}:${slug}`,
    provider,
    providerLabel: 'Skillstore',
    slug,
    packSlug: slug,
    name: boundedString(raw?.name || slug, 160),
    description: boundedString(raw?.description || '', 360),
    category: boundedString(raw?.type || tags[0] || 'skills', 80),
    tags,
    skillCount: Math.max(0, Math.min(Number(raw?.skillCount || 0) || 0, MAX_SKILLS_PER_PACK)),
    installCount: Math.max(0, Number(raw?.installCount || 0) || 0),
    updatedAt: boundedString(raw?.updatedAt || raw?.publishedAt || raw?.createdAt || '', 80),
    detailUrl: `${SKILLSTORE_BASE_URL}/packs/${encodeURIComponent(slug)}`,
    manifestUrl: `${SKILLSTORE_BASE_URL}/api/packs/${encodeURIComponent(slug)}/manifest`,
    lockfileUrl: `${SKILLSTORE_BASE_URL}/api/packs/${encodeURIComponent(slug)}/lockfile`,
    installable: true,
    installed: Boolean(firstInstall),
    lockRef: firstInstall?.lockRef || '',
    installedTarget: firstInstall?.targetScope || '',
  };
}

function filterPacks(packs, query) {
  const q = normalizeQuery(query);
  if (!q) return packs;
  return packs.filter(pack => `${pack.name} ${pack.description} ${pack.slug} ${(pack.tags || []).join(' ')}`.toLowerCase().includes(q));
}

export async function listSkillsMarket(projectRoot, options = {}) {
  const provider = normalizeProvider(options.provider || 'skillstore');
  const query = normalizeQuery(options.q);
  const limit = Math.max(1, Math.min(Number(options.limit || DEFAULT_LIMIT) || DEFAULT_LIMIT, MAX_LIMIT));
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw skillsMarketError('Fetch API is unavailable for Skills Market', {
      statusCode: 503,
      code: 'FETCH_UNAVAILABLE',
    });
  }

  const url = new URL(providerPackUrl(provider, '/api/packs'));
  url.searchParams.set('limit', String(limit));
  const raw = await fetchJson(fetchImpl, url.toString(), MAX_FILE_BYTES);
  const installed = installedPackByKey(projectRoot);
  const packs = filterPacks((Array.isArray(raw?.data) ? raw.data : [])
    .map(item => normalizePack(item, installed))
    .filter(Boolean), query)
    .slice(0, limit);

  return {
    ok: true,
    schemaVersion: 1,
    kind: 'skills-market',
    generatedAt: new Date().toISOString(),
    provider,
    providers: [{ id: 'skillstore', label: 'Skillstore', hosted: true }],
    query: { provider, q: query, limit },
    installTargets: skillInstallTargets(projectRoot, { includeUser: true }),
    summary: {
      packCount: packs.length,
      totalPackCount: Number(raw?.pagination?.total || packs.length) || packs.length,
      installedPackCount: [...installed.values()].filter(item => item.provider === provider).length,
    },
    packs,
  };
}

function normalizeManifestSkill(raw) {
  const slug = boundedString(raw?.slug || raw?.name, 120);
  const name = boundedString(raw?.name || slug, 120);
  if (!slug && !name) return null;
  const files = (Array.isArray(raw?.artifact?.files) ? raw.artifact.files : [])
    .slice(0, MAX_FILES_PER_PACK)
    .map(file => ({
      path: safeRelativePath(file?.path),
      url: assertHttpsDownloadUrl(file?.url || raw?.downloadUrl),
      sha256: boundedString(file?.sha256 || file?.contentHash || '', 128).toLowerCase(),
      bytes: Number(file?.bytes || 0) || 0,
    }));
  if (files.length === 0 && raw?.downloadUrl && raw?.contentHash) {
    files.push({
      path: 'SKILL.md',
      url: assertHttpsDownloadUrl(raw.downloadUrl),
      sha256: boundedString(raw.contentHash, 128).toLowerCase(),
      bytes: Number(raw?.bytes || 0) || 0,
    });
  }
  return {
    slug: slug || slugPart(name, 'skill'),
    name: name || slug,
    title: boundedString(raw?.title || name || slug, 160),
    version: boundedString(raw?.version || raw?.authorVersion || '', 80),
    contentHash: boundedString(raw?.contentHash || '', 128).toLowerCase(),
    files,
  };
}

function normalizeManifest(raw, packSlug) {
  const source = isPlainObject(raw?.signed) ? raw.signed : raw;
  const pack = isPlainObject(source?.pack) ? source.pack : {};
  const skills = (Array.isArray(source?.skills) ? source.skills : [])
    .map(normalizeManifestSkill)
    .filter(Boolean)
    .slice(0, MAX_SKILLS_PER_PACK);
  if (skills.length === 0) {
    throw skillsMarketError('Skills market manifest does not include installable skills', {
      statusCode: 422,
      code: 'EMPTY_MANIFEST',
    });
  }
  const fileCount = skills.reduce((sum, skill) => sum + skill.files.length, 0);
  if (fileCount > MAX_FILES_PER_PACK) {
    throw skillsMarketError('Skills market manifest includes too many files', {
      statusCode: 413,
      code: 'PACK_TOO_LARGE',
      details: { fileCount, limit: MAX_FILES_PER_PACK },
    });
  }
  return {
    schemaVersion: boundedString(raw?.schemaVersion || raw?.version || '', 40),
    kind: boundedString(source?.kind || raw?.kind || 'pack', 40),
    pack: {
      slug: boundedString(pack.slug || packSlug, 120),
      name: boundedString(pack.name || packSlug, 160),
      version: boundedString(pack.version || source?.version || raw?.version || '', 80),
      description: boundedString(pack.description || source?.description || raw?.description || '', 360),
      tags: Array.isArray(pack.tags) ? pack.tags.map(tag => boundedString(tag, 48)).filter(Boolean).slice(0, 12) : [],
      category: boundedString(pack.category || pack.type || 'skills', 80),
    },
    signed: isPlainObject(raw?.signed) ? raw.signed : null,
    signature: isPlainObject(raw?.signature) ? raw.signature : null,
    skills,
  };
}

function validateManifestSize(manifest) {
  let totalBytes = 0;
  const normalizedPaths = new Set();
  for (const skill of manifest.skills) {
    const skillPaths = new Set();
    if (!skill.files.some(file => file.path === 'SKILL.md')) {
      throw skillsMarketError('Each installed skill must include SKILL.md', {
        statusCode: 422,
        code: 'SKILL_MD_REQUIRED',
        details: { skill: skill.slug },
      });
    }
    for (const file of skill.files) {
      const globalPathKey = `${skill.slug}/${file.path}`;
      if (normalizedPaths.has(globalPathKey) || skillPaths.has(file.path)) {
        throw skillsMarketError('Skill artifact manifest contains duplicate normalized paths', {
          statusCode: 422,
          code: 'DUPLICATE_FILE_PATH',
          details: { skill: skill.slug, path: file.path },
        });
      }
      normalizedPaths.add(globalPathKey);
      skillPaths.add(file.path);
      if (!file.sha256 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
        throw skillsMarketError('Skill artifact is missing a SHA-256 hash', {
          statusCode: 422,
          code: 'MISSING_HASH',
          details: { skill: skill.slug, path: file.path },
        });
      }
      if (file.bytes > MAX_FILE_BYTES) {
        throw skillsMarketError('Skill artifact exceeds per-file byte limit', {
          statusCode: 413,
          code: 'FILE_TOO_LARGE',
          details: { skill: skill.slug, path: file.path, bytes: file.bytes, limit: MAX_FILE_BYTES },
        });
      }
      totalBytes += Math.max(0, file.bytes);
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw skillsMarketError('Skill pack exceeds total byte limit', {
          statusCode: 413,
          code: 'PACK_TOO_LARGE',
          details: { bytes: totalBytes, limit: MAX_TOTAL_BYTES },
        });
      }
    }
  }
}

async function downloadSkillFiles(fetchImpl, manifest) {
  const downloaded = [];
  let totalBytes = 0;
  for (const skill of manifest.skills) {
    for (const file of skill.files) {
      const buffer = await fetchBuffer(fetchImpl, file.url, MAX_FILE_BYTES);
      if (file.bytes && buffer.length !== file.bytes) {
        throw skillsMarketError('Downloaded skill artifact byte count does not match manifest', {
          statusCode: 422,
          code: 'BYTE_COUNT_MISMATCH',
          details: { skill: skill.slug, path: file.path },
        });
      }
      totalBytes += buffer.length;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw skillsMarketError('Downloaded skill pack exceeds total byte limit', {
          statusCode: 413,
          code: 'PACK_TOO_LARGE',
          details: { bytes: totalBytes, limit: MAX_TOTAL_BYTES },
        });
      }
      const actual = sha256(buffer);
      if (actual !== file.sha256) {
        throw skillsMarketError('Downloaded skill artifact failed SHA-256 verification', {
          statusCode: 422,
          code: 'HASH_MISMATCH',
          details: { skill: skill.slug, path: file.path },
        });
      }
      downloaded.push({ skill, file, buffer, sha256: actual, bytes: buffer.length });
    }
  }
  return downloaded;
}

function writeDownloadedFiles(target, downloaded, provider, packSlug) {
  fs.mkdirSync(target.rootPath, { recursive: true });
  const installedFiles = [];
  for (const item of downloaded) {
    const skillDir = slugPart(`${provider}-${packSlug}-${item.skill.slug || item.skill.name}`, 'skill');
    const relativeInstallPath = toPosix(path.posix.join(skillDir, item.file.path));
    const destination = path.join(target.rootPath, ...relativeInstallPath.split('/'));
    assertWritableDestination(target.rootPath, destination);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) {
      throw skillsMarketError('Skill install refused to overwrite a symlink', {
        statusCode: 400,
        code: 'SYMLINK_ESCAPE',
      });
    }
    fs.writeFileSync(destination, item.buffer);
    installedFiles.push({
      skillSlug: item.skill.slug,
      skillName: item.skill.name,
      path: item.file.path,
      installedPath: relativeInstallPath,
      sha256: item.sha256,
      bytes: item.bytes,
    });
  }
  return installedFiles;
}

function installedSkillRefs(manifest, provider, targetScope) {
  return manifest.skills.map(skill => ({
    id: `skill:${skill.name || skill.slug}`,
    name: skill.name || skill.slug,
    title: skill.title || skill.name || skill.slug,
    source: `${provider}:${manifest.pack.slug}:${targetScope}`,
    state: 'installed',
  }));
}

function mergeSkills(existing = [], next = []) {
  const byName = new Map();
  for (const skill of [...existing, ...next]) {
    const name = boundedString(skill?.name || skill?.id, 120);
    if (!name) continue;
    byName.set(name, {
      id: boundedString(skill?.id || `skill:${name}`, 160),
      name,
      title: boundedString(skill?.title || name, 160),
      source: boundedString(skill?.source || 'skills-market', 160),
      state: boundedString(skill?.state || 'installed', 80),
    });
  }
  return [...byName.values()].slice(0, 64);
}

function lockRefFor(provider, packSlug, targetScope, manifestHash) {
  return `skills-market-lock:${provider}:${packSlug}:${targetScope}:${manifestHash.slice(0, 12)}`;
}

function readLock(projectRoot) {
  const lock = readJson(lockPath(projectRoot), { schemaVersion: 1, installs: [] });
  return {
    schemaVersion: 1,
    installs: Array.isArray(lock.installs) ? lock.installs : [],
  };
}

function writeInstallLock(projectRoot, install) {
  const current = readLock(projectRoot);
  const key = `${install.provider}:${install.packSlug}:${install.targetScope}`;
  const installs = [
    ...current.installs.filter(item => `${item.provider}:${item.packSlug}:${item.targetScope}` !== key),
    install,
  ].sort((a, b) => `${a.provider}:${a.packSlug}:${a.targetScope}`.localeCompare(`${b.provider}:${b.packSlug}:${b.targetScope}`));
  writeJson(lockPath(projectRoot), {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    installs,
  });
}

function groupPayloadForInstall({ manifest, provider, targetScope, lockRef, installedSkills, installSource, payload }) {
  return {
    type: 'skill-group',
    title: boundedString(payload.groupTitle || manifest.pack.name || 'Skill Group', 160),
    description: boundedString(payload.groupDescription || manifest.pack.description || `${installedSkills.length} installed skills`, 280),
    position: isPlainObject(payload.position) ? payload.position : undefined,
    sourceGroup: {
      id: `${provider}:${manifest.pack.slug}`,
      label: manifest.pack.name || manifest.pack.slug,
      kind: 'skills-market-pack',
    },
    skills: installedSkills,
    category: payload.category || manifest.pack.category || 'skills',
    tags: Array.isArray(payload.tags) && payload.tags.length > 0 ? payload.tags : manifest.pack.tags,
    installSource,
    lockRef,
    loadStrategy: 'group-summary',
  };
}

function createOrUpdateSkillGroup(projectRoot, groupPayload, groupNodeId) {
  const nodeId = boundedString(groupNodeId || '', 160);
  if (!nodeId) {
    return createCapabilityNode(projectRoot, groupPayload);
  }
  const current = getCapabilityNode(projectRoot, nodeId);
  const skills = mergeSkills(current.state.skills, groupPayload.skills);
  return updateCapabilityNode(projectRoot, nodeId, {
    ...groupPayload,
    revision: current.node.revision,
    skills,
  });
}

export async function installSkillsMarketPack(projectRoot, payload = {}, options = {}) {
  const provider = normalizeProvider(payload.provider || 'skillstore');
  const packSlug = boundedString(payload.packSlug || payload.slug || '', 120);
  if (!packSlug) {
    throw skillsMarketError('Skills market install requires a packSlug', {
      statusCode: 400,
      code: 'PACK_SLUG_REQUIRED',
    });
  }
  const targetScope = boundedString(payload.targetScope || payload.target || 'project-agents', 80);
  const target = resolveSkillInstallTarget(projectRoot, targetScope);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw skillsMarketError('Fetch API is unavailable for Skills Market', {
      statusCode: 503,
      code: 'FETCH_UNAVAILABLE',
    });
  }

  const manifestUrl = providerPackUrl(provider, `/api/packs/${encodeURIComponent(packSlug)}/manifest`);
  const lockfileUrl = providerPackUrl(provider, `/api/packs/${encodeURIComponent(packSlug)}/lockfile`);
  const rawManifest = await fetchJson(fetchImpl, manifestUrl, MAX_TOTAL_BYTES);
  let rawLockfile = null;
  try {
    rawLockfile = await fetchJson(fetchImpl, lockfileUrl, MAX_TOTAL_BYTES);
  } catch {
      rawLockfile = null;
  }
  const manifestSignature = verifySignedPayload(
    isPlainObject(rawManifest?.signed) ? rawManifest.signed : rawManifest,
    rawManifest?.signature,
    'manifest',
  );
  const lockfileSignature = rawLockfile
    ? verifySignedPayload(
        Object.fromEntries(Object.entries(rawLockfile).filter(([key]) => key !== 'signature')),
        rawLockfile.signature,
        'lockfile',
      )
    : { present: false, verified: false };
  const manifest = normalizeManifest(rawManifest, packSlug);
  if (manifest.pack.slug !== packSlug) {
    throw skillsMarketError('Skills market manifest slug does not match install request', {
      statusCode: 422,
      code: 'MANIFEST_SLUG_MISMATCH',
      details: { expected: packSlug, actual: manifest.pack.slug },
    });
  }
  validateManifestSize(manifest);
  const downloaded = await downloadSkillFiles(fetchImpl, manifest);
  const installedFiles = writeDownloadedFiles(target, downloaded, provider, manifest.pack.slug || packSlug);
  const manifestHash = sha256(Buffer.from(JSON.stringify(rawLockfile || rawManifest), 'utf8'));
  const lockRef = lockRefFor(provider, manifest.pack.slug || packSlug, targetScope, manifestHash);
  const installedSkills = installedSkillRefs(manifest, provider, targetScope);
  const installedAt = new Date().toISOString();
  const installSource = {
    provider,
    providerLabel: 'Skillstore',
    packSlug: manifest.pack.slug || packSlug,
    packName: manifest.pack.name || packSlug,
    version: manifest.pack.version || '',
    targetScope,
    targetRuntime: target.runtime,
    installedAt,
    detailUrl: `${SKILLSTORE_BASE_URL}/packs/${encodeURIComponent(manifest.pack.slug || packSlug)}`,
    manifestUrl,
    lockfileUrl,
    signature: manifestSignature,
    lockfileSignature,
  };
  const install = {
    provider,
    packSlug: manifest.pack.slug || packSlug,
    packName: manifest.pack.name || packSlug,
    version: manifest.pack.version || '',
    targetScope,
    targetRuntime: target.runtime,
    targetPath: target.path,
    installedAt,
    lockRef,
    manifestHash,
    skillCount: installedSkills.length,
    fileCount: installedFiles.length,
    skills: installedSkills.map(skill => ({ id: skill.id, name: skill.name, title: skill.title })),
    files: installedFiles,
  };
  writeInstallLock(projectRoot, install);

  let group = null;
  if (payload.createGroup !== false || payload.groupNodeId) {
    const groupPayload = groupPayloadForInstall({
      manifest,
      provider,
      targetScope,
      lockRef,
      installedSkills,
      installSource,
      payload,
    });
    group = createOrUpdateSkillGroup(projectRoot, groupPayload, payload.groupNodeId);
  }

  return {
    ok: true,
    schemaVersion: 1,
    kind: 'skills-market-install',
    provider,
    packSlug: manifest.pack.slug || packSlug,
    target: {
      id: target.id,
      label: target.label,
      scope: target.scope,
      runtime: target.runtime,
      path: target.path,
      default: target.default,
    },
    install,
    lockRef,
    installedSkills,
    installedFiles,
    group,
  };
}

export function skillsMarketError(message, { statusCode = 400, code = 'BAD_REQUEST', details } = {}) {
  const err = new Error(message);
  err.name = 'SkillsMarketError';
  err.statusCode = statusCode;
  err.code = code;
  if (isPlainObject(details)) err.details = details;
  return err;
}
