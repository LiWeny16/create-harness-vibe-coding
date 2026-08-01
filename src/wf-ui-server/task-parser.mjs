import fs from 'node:fs';
import path from 'node:path';

function readState(taskDir) {
  const statePath = path.join(taskDir, 'STATE.json');
  if (!fs.existsSync(statePath)) return null;
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch (err) { throw new Error(`STATE.json at ${statePath} contains malformed JSON: ${err.message}`); }
}

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function pushRuntime(runtimes, runtime) {
  const value = String(runtime || '').trim();
  if (!value) return;
  if (!runtimes.some(item => item.toLowerCase() === value.toLowerCase())) {
    runtimes.push(value);
  }
}

function runtimeHistoryForTask(state, taskDir) {
  const runtimes = [];
  for (const key of ['defaultRuntime', 'defaultAgentRuntime', 'agentRuntime', 'cliAgent']) {
    pushRuntime(runtimes, state?.[key]);
  }
  for (const key of ['runtimeHistory', 'runtimes', 'terminalRuntimes']) {
    if (Array.isArray(state?.[key])) {
      for (const runtime of state[key]) pushRuntime(runtimes, runtime);
    }
  }

  const sessionsDir = path.join(taskDir, 'sessions');
  let entries = [];
  try { entries = fs.readdirSync(sessionsDir, { withFileTypes: true }); }
  catch { entries = []; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionState = readJson(path.join(sessionsDir, entry.name, 'STATE.json'));
    pushRuntime(runtimes, sessionState?.runtime);
  }
  return runtimes;
}

function normalizeAcceptance(acceptance) {
  if (!Array.isArray(acceptance)) return [];
  return acceptance.map((ac) => {
    if (typeof ac === 'string') return { id: ac, text: '', status: 'tracked' };
    if (ac && typeof ac === 'object') return {
      id: ac.id || '',
      text: ac.text || JSON.stringify(ac),
      status: ac.status || 'tracked',
    };
    return { id: String(ac), text: '', status: 'tracked' };
  });
}

export function parseTaskCapsule(taskDir) {
  const state = readState(taskDir);
  if (!state) return null;
  if (state.schemaVersion === undefined || state.schemaVersion === null) {
    throw new Error(`STATE.json at ${taskDir} is missing required field: schemaVersion`);
  }
  const links = state.links || { dependsOn: [], blocks: [], related: [] };
  return {
    taskId: state.taskId || path.basename(taskDir),
    status: state.status || 'unknown',
    phase: state.phase || null,
    gate: state.gate || null,
    tier: state.tier || null,
    mode: state.mode || null,
    updatedAt: state.updatedAt || null,
    activeQuestion: state.activeQuestion || null,
    nextAction: state.nextAction || null,
    defaultRuntime: state.defaultRuntime || state.defaultAgentRuntime || state.agentRuntime || state.cliAgent || null,
    runtimeHistory: runtimeHistoryForTask(state, taskDir),
    acceptance: normalizeAcceptance(state.acceptance),
    dependsOn: Array.isArray(links.dependsOn) ? links.dependsOn : [],
    blocks: Array.isArray(links.blocks) ? links.blocks : [],
    hasPlan: fs.existsSync(path.join(taskDir, 'PLAN.md')),
    hasProgress: fs.existsSync(path.join(taskDir, 'PROGRESS.md')),
  };
}

export function parseTaskList(tasksRoot) {
  let entries;
  try { entries = fs.readdirSync(tasksRoot, { withFileTypes: true }); }
  catch { return []; }
  const capsules = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    try {
      const c = parseTaskCapsule(path.join(tasksRoot, entry.name));
      if (c) capsules.push(c);
    } catch { /* skip unparseable */ }
  }
  capsules.sort((a, b) => {
    const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return db - da;
  });
  return capsules;
}

/** Parse archived tasks from _archive/YYYY/task-name/ */
export function parseArchivedTasks(tasksRoot) {
  const archiveRoot = path.join(tasksRoot, '_archive');
  if (!fs.existsSync(archiveRoot)) return [];
  const capsules = [];
  let years;
  try { years = fs.readdirSync(archiveRoot, { withFileTypes: true }); }
  catch { return []; }

  function addArchivedTask(taskDir, archivedYear, archivedPath) {
    try {
      const c = parseTaskCapsule(taskDir);
      if (c) {
        c.archivedYear = archivedYear;
        c.archivedPath = archivedPath;
        capsules.push(c);
      }
    } catch { /* skip */ }
  }

  for (const y of years) {
    if (!y.isDirectory()) continue;
    const yearDir = path.join(archiveRoot, y.name);
    let yearEntries;
    try { yearEntries = fs.readdirSync(yearDir, { withFileTypes: true }); }
    catch { continue; }
    const monthDirs = yearEntries.filter(e => e.isDirectory() && /^\d{2}$/.test(e.name));
    for (const month of monthDirs) {
      const monthDir = path.join(yearDir, month.name);
      let dayEntries;
      try { dayEntries = fs.readdirSync(monthDir, { withFileTypes: true }); }
      catch { continue; }
      for (const day of dayEntries.filter(e => e.isDirectory() && /^\d{2}$/.test(e.name))) {
        const dayDir = path.join(monthDir, day.name);
        let taskEntries;
        try { taskEntries = fs.readdirSync(dayDir, { withFileTypes: true }); }
        catch { continue; }
        for (const t of taskEntries.filter(e => e.isDirectory())) {
          addArchivedTask(path.join(dayDir, t.name), y.name, `${y.name}/${month.name}/${day.name}`);
        }
      }
    }

    for (const t of yearEntries.filter(e => e.isDirectory() && !/^\d{2}$/.test(e.name))) {
      addArchivedTask(path.join(yearDir, t.name), y.name, y.name);
    }
  }
  capsules.sort((a, b) => {
    const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return db - da;
  });
  return capsules;
}

/** Read a task file content (STATE.json, PLAN.md, PROGRESS.md) */
export function readTaskFile(taskDir, filename) {
  const safe = path.basename(filename);
  const filePath = path.join(taskDir, safe);
  if (!fs.existsSync(filePath)) return null;
  try {
    return { filename: safe, content: fs.readFileSync(filePath, 'utf8') };
  } catch { return null; }
}
