import crypto from 'node:crypto';
import { RUNTIME_IDS } from './runtime-detector.mjs';

/**
 * Set of allowed agent runtimes for PTY sessions.
 * No fake agents in product code.
 */
export const ALLOWED_RUNTIMES = RUNTIME_IDS;

/**
 * Generate a short peer ID from a runtime name.
 * @param {string} runtime
 * @returns {string}
 */
function generatePeerId(runtime) {
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${runtime}-${suffix}`;
}

/**
 * Generate a session ID (UUID v4).
 * @returns {string}
 */
export function generateSessionId() {
  return crypto.randomUUID();
}

/**
 * SessionRegistry manages PTY sessions for peer agents.
 *
 * Each session tracks: agent runtime, terminal dimensions, lifecycle status,
 * process info, and optional WebSocket attach state.
 */
export class SessionRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this._sessions = new Map();
    /** @type {Map<string, Promise<void>>} */
    this._locks = new Map();
  }

  async withLock(sessionId, fn) {
    const key = String(sessionId || '__global__');
    const previous = this._locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const chain = previous.then(() => current, () => current);
    this._locks.set(key, chain);

    await previous.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
      if (this._locks.get(key) === chain) {
        this._locks.delete(key);
      }
    }
  }

  /**
   * Create a new session.
   * @param {object} opts
   * @param {string} opts.taskId
   * @param {string} opts.runtime - Must be in ALLOWED_RUNTIMES
   * @param {number} [opts.cols=120]
   * @param {number} [opts.rows=32]
   * @param {string} [opts.projectRoot]
   * @returns {object} The created session object
   * @throws {Error} If runtime is not in ALLOWED_RUNTIMES
   */
  create({
    taskId = null,
    runtime,
    role = 'terminal-agent',
    objective = '',
    cols = 120,
    rows = 32,
    projectRoot = '',
    subagentMode = 'wf-subagents',
    workflowMode = null,
    model = '',
    provider = '',
    ceoPrompt = '',
  }) {
    if (!ALLOWED_RUNTIMES.has(runtime)) {
      throw new Error(`Invalid runtime '${runtime}'. Must be one of: ${[...ALLOWED_RUNTIMES].join(', ')}`);
    }

    const now = new Date().toISOString();
    const sessionId = generateSessionId();
    const peerId = generatePeerId(runtime);

    const session = {
      sessionId,
      taskId: taskId || null,
      peerId,
      runtime,
      role,
      objective,
      subagentMode,
      workflowMode,
      model,
      provider,
      ceoPrompt,
      status: 'starting',
      cols,
      rows,
      attachMode: false,
      startedAt: now,
      updatedAt: now,
      lastActivityAt: now,
      pid: null,
      exitCode: null,
      blockedReason: null,
      blockedHint: null,
      ptyProvider: null,
      agentSessionId: null,
      resumeCommand: null,
      terminalSeq: 0,
      transcriptRing: '',
      wsClientCount: 0,
    };

    this._sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get a session by ID.
   * @param {string} sessionId
   * @returns {object|undefined}
   */
  get(sessionId) {
    return this._sessions.get(sessionId);
  }

  /**
   * Get all sessions as an array.
   * @returns {object[]}
   */
  getAll() {
    return [...this._sessions.values()];
  }

  /**
   * Get all sessions for a given task ID.
   * @param {string} taskId
   * @returns {object[]}
   */
  getAllForTask(taskId) {
    return [...this._sessions.values()].filter(s => s.taskId === taskId);
  }

  /**
   * Update session fields. Merges the patch into the session and sets updatedAt.
   * @param {string} sessionId
   * @param {object} patch - Fields to merge (status, cols, rows, pid, exitCode, attachMode, wsClientCount, transcriptRing)
   */
  update(sessionId, patch) {
    const session = this._sessions.get(sessionId);
    if (!session) return;

    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && key in session) {
        session[key] = value;
      }
    }
    session.updatedAt = new Date().toISOString();
  }

  /**
   * Remove a session from the registry.
   * @param {string} sessionId
   */
  remove(sessionId) {
    this._sessions.delete(sessionId);
  }

  /**
   * Stop and remove a web-owned session. Persisted recovery metadata lives on disk.
   * @param {string} sessionId
   * @returns {object|null} The removed session when found
   */
  stop(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    this._sessions.delete(sessionId);
    return {
      ...session,
      status: 'saved',
      stoppedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Number of active sessions.
   * @returns {number}
   */
  count() {
    return this._sessions.size;
  }
}
