import fs from 'node:fs';
import path from 'node:path';
import { validateTaskId } from './security.mjs';

/**
 * Validate a peer ID string.
 * Same rules as taskId: alphanumeric, dash, underscore only, no path traversal.
 * @param {string} peerId
 * @returns {boolean}
 */
export function validatePeerId(peerId) {
  // Peer IDs follow the same rules as task IDs
  return validateTaskId(peerId);
}

/**
 * Validate peer capsule identifiers and throw on invalid input.
 * @param {string} taskId
 * @param {string} peerId
 * @throws {Error} If taskId or peerId is invalid
 */
function validateIds(taskId, peerId) {
  if (!validateTaskId(taskId)) {
    throw new Error(`Invalid taskId: '${taskId}'. Must match [a-zA-Z0-9_-]+`);
  }
  if (!validatePeerId(peerId)) {
    throw new Error(`Invalid peerId: '${peerId}'. Must match [a-zA-Z0-9_-]+`);
  }
}

/**
 * Get the capsule directory path for a peer.
 * @param {string} projectRoot
 * @param {string} taskId
 * @param {string} peerId
 * @returns {string}
 */
function capsuleDir(projectRoot, taskId, peerId) {
  return path.join(projectRoot, 'Harness', 'tasks', taskId, 'peers', peerId);
}

/**
 * Create a peer capsule directory with REQUEST.json and STATE.json.
 *
 * @param {string} projectRoot
 * @param {string} taskId
 * @param {string} peerId
 * @param {object} request - The request payload (must include runtime, taskId, peerId)
 * @returns {{ capsuleDir: string, request: object, state: object }}
 */
export function createPeerCapsule(projectRoot, taskId, peerId, request) {
  validateIds(taskId, peerId);

  const dir = capsuleDir(projectRoot, taskId, peerId);
  fs.mkdirSync(dir, { recursive: true });

  const requestPayload = {
    ...request,
    taskId,
    peerId,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(dir, 'REQUEST.json'), JSON.stringify(requestPayload, null, 2), 'utf-8');

  const state = {
    status: 'starting',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(dir, 'STATE.json'), JSON.stringify(state, null, 2), 'utf-8');

  return { capsuleDir: dir, request: requestPayload, state };
}

/**
 * Append an event to the peer's events.jsonl file.
 *
 * @param {string} projectRoot
 * @param {string} taskId
 * @param {string} peerId
 * @param {object} event
 */
export function writePeerEvent(projectRoot, taskId, peerId, event) {
  validateIds(taskId, peerId);

  const dir = capsuleDir(projectRoot, taskId, peerId);
  if (!fs.existsSync(dir)) {
    throw new Error(`Capsule directory does not exist for ${taskId}/${peerId}`);
  }

  const eventLine = JSON.stringify({
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
  });

  fs.appendFileSync(path.join(dir, 'events.jsonl'), eventLine + '\n', 'utf-8');
}

/**
 * Write a result payload to the peer's RESULT.json file.
 *
 * @param {string} projectRoot
 * @param {string} taskId
 * @param {string} peerId
 * @param {object} result
 */
export function writePeerResult(projectRoot, taskId, peerId, result) {
  validateIds(taskId, peerId);

  const dir = capsuleDir(projectRoot, taskId, peerId);
  if (!fs.existsSync(dir)) {
    throw new Error(`Capsule directory does not exist for ${taskId}/${peerId}`);
  }

  const resultPayload = {
    ...result,
    completedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(dir, 'RESULT.json'), JSON.stringify(resultPayload, null, 2), 'utf-8');
}

/**
 * Mark a peer as blocked: update STATE.json and write PROGRESS.md with the reason.
 *
 * @param {string} projectRoot
 * @param {string} taskId
 * @param {string} peerId
 * @param {string} reason
 */
export function blockPeer(projectRoot, taskId, peerId, reason) {
  validateIds(taskId, peerId);

  const dir = capsuleDir(projectRoot, taskId, peerId);
  if (!fs.existsSync(dir)) {
    throw new Error(`Capsule directory does not exist for ${taskId}/${peerId}`);
  }

  const now = new Date().toISOString();

  // Update STATE.json
  const statePath = path.join(dir, 'STATE.json');
  let state = {};
  if (fs.existsSync(statePath)) {
    state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  }
  state.status = 'blocked';
  state.blockedReason = reason;
  state.updatedAt = now;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');

  // Write PROGRESS.md
  const progressContent = `# Peer Capsule: ${peerId}

**Status:** BLOCKED

**Block reason:** ${reason}

**Timestamp:** ${now}
`;
  fs.writeFileSync(path.join(dir, 'PROGRESS.md'), progressContent, 'utf-8');
}

/**
 * Read a peer capsule's files and return the full capsule.
 *
 * @param {string} projectRoot
 * @param {string} taskId
 * @param {string} peerId
 * @returns {{ request: object|null, state: object|null, events: object[], result: object|null, progress: string|null }|null}
 */
export function getPeerCapsule(projectRoot, taskId, peerId) {
  validateIds(taskId, peerId);

  const dir = capsuleDir(projectRoot, taskId, peerId);
  if (!fs.existsSync(dir)) {
    return null;
  }

  const readJSON = (filePath) => {
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  };

  const readText = (filePath) => {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  };

  // Read events from jsonl
  const eventsPath = path.join(dir, 'events.jsonl');
  let events = [];
  if (fs.existsSync(eventsPath)) {
    const content = fs.readFileSync(eventsPath, 'utf-8').trim();
    if (content) {
      events = content.split('\n').map(line => JSON.parse(line));
    }
  }

  return {
    request: readJSON(path.join(dir, 'REQUEST.json')),
    state: readJSON(path.join(dir, 'STATE.json')),
    events,
    result: readJSON(path.join(dir, 'RESULT.json')),
    progress: readText(path.join(dir, 'PROGRESS.md')),
  };
}
