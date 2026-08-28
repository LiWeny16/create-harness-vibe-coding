// claude-transcript-materializer.mjs
//
// Rebuilds a claude-code conversation transcript (jsonl) from the harness terminal
// ring, so `claude --resume <agentSessionId>` can restore PTY-spawned sessions that
// claude-code 2.x itself never persists (proven in RESUME-E2E-EVIDENCE.md PASS 2-6:
// no conversation jsonl is ever written for node-pty sessions, with or without
// --session-id, graceful or hard stop).
//
// Pure hard-coded extraction: stdin entries give the exact typed prompts; the
// assistant reply is the TUI-rendered "●" answer bullet from stdout. No LLM call,
// no summarization, millisecond cost.
//
// Schema mirrors a real 2.1.215 transcript (per-turn group: last-prompt, mode,
// permission-mode, user, assistant; final last-prompt with lastPrompt text).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ESC = '\x1b';

export function stripAnsi(text) {
  return String(text ?? '')
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, 'g'), '')
    .replace(new RegExp(`${ESC}\\][^${ESC}\\x07]*(${ESC}\\\\|\\x07)`, 'g'), '')
    .replace(new RegExp(`${ESC}[()][0-9A-Z]`, 'g'), '')
    .replace(new RegExp(`${ESC}[=>#78]`, 'g'), '')
    .replace(/\r/g, '');
}

// Spinner/progress glyphs the claude TUI renders while a turn runs.
const SPINNER_GLYPHS = /[✶✢✻✽·…]/g;
// "✻Baked for 9s"-style verb tail that follows the answer bullet.
const VERB_TAIL = /✻\s*[A-Za-z]+ for \d+s/g;
// The turn-over signature: verb tail immediately followed by the prompt-ready
// "❯". A lone "❯" elsewhere is ANSWER content (e.g. a quoted shell prompt) and
// must not close the turn.
const TURN_OVER = /✻\s*[A-Za-z]+ for \d+s\s*❯/;

function cleanAnswer(segment) {
  let text = segment;
  // Strip only a TRAILING prompt-ready marker ("❯" + optional whitespace at the
  // buffer end). "❯" elsewhere is answer content (quoted shell prompt etc.) and
  // must survive. The turn-over detection already ended the capture at the ready
  // marker, so mid-buffer ready markers do not occur here.
  text = text.replace(/❯\s*$/, '').replace(VERB_TAIL, '').replace(SPINNER_GLYPHS, '');
  // Drop claude's thinking preview lines ("⎿ …") — they are not the answer.
  text = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('⎿'))
    .join('\n');
  return text.replace(/[ \t]+\n/g, '\n').trim();
}

// State machine over seq-ordered terminal.jsonl entries. Turn boundaries are the
// TUI's answer bracket (first "●" opens capture, the following "❯" ready marker
// closes the turn), NOT the CR: in the promptSubmit path the enter key is a raw
// PTY write and never appears in the ring (stdin holds one full-prompt entry),
// while CLI char-by-char typing records per-char stdin plus a literal "\r".
// Both shapes resolve to the same bracket-delimited turn extraction.
export function extractConversationTurns(entries) {
  const turns = [];
  let promptBuf = '';
  let openPrompt = null;
  let capturing = false;
  let answerBuf = '';
  let sawReady = false;

  const closeTurn = () => {
    if (openPrompt) {
      const user = stripAnsi(openPrompt)
        .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
        .trim();
      // Slash commands (/model, /exit, …) are control input, not conversation turns.
      if (user && !user.startsWith('/')) turns.push({ user, assistant: cleanAnswer(answerBuf) });
    }
    openPrompt = null;
    promptBuf = '';
    capturing = false;
    answerBuf = '';
    sawReady = false;
  };

  for (const entry of entries) {
    if (entry.stream === 'stdin') {
      // New prompt input while a turn is still open: the previous turn is over
      // (covers ready markers that arrive without the verb tail). Close BEFORE
      // accumulating so the new prompt survives.
      if (capturing && sawReady && String(entry.data ?? '').trim()) closeTurn();
      const parts = String(entry.data ?? '').split('\r');
      for (let i = 0; i < parts.length; i++) {
        promptBuf += parts[i];
        // A CR finalizes the current prompt text; the turn itself closes on the
        // turn-over signature below.
        if (i < parts.length - 1) {
          openPrompt = promptBuf;
          promptBuf = '';
        }
      }
      continue;
    }
    const clean = stripAnsi(entry.data);
    if (!capturing) {
      const bullet = clean.indexOf('●');
      if (bullet !== -1) {
        capturing = true;
        openPrompt = openPrompt || promptBuf;
        answerBuf = clean.slice(bullet + 1);
      }
    } else {
      answerBuf += clean;
    }
    // Test AFTER every buffer mutation, including the capture-start entry: a
    // single chunk can hold the complete "●answer✻Verb for Xs❯ " sequence.
    if (capturing && TURN_OVER.test(answerBuf)) {
      closeTurn();
    } else if (capturing && answerBuf.includes('❯')) {
      sawReady = true;
    }
  }
  closeTurn();
  return turns;
}

// claude's on-disk project dir encoding: "D:\a\b" -> "D--a-b".
export function encodeClaudeProjectDir(cwd) {
  return String(cwd)
    .replace(/[\\/:]/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '-');
}

// Builds a schema-faithful transcript jsonl (every line a standalone JSON object).
export function buildClaudeTranscript({
  sessionId,
  cwd,
  turns,
  version = '2.1.215',
  model = 'default',
  gitBranch = '',
  timestamp = new Date().toISOString(),
}) {
  const uuid = () => crypto.randomUUID();
  const lines = [];
  let leaf = uuid();
  const checkpoint = () => {
    lines.push({ type: 'last-prompt', leafUuid: leaf, sessionId });
    lines.push({ type: 'mode', mode: 'normal', sessionId });
    lines.push({ type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId });
  };
  checkpoint();
  for (const turn of turns) {
    const userUuid = uuid();
    lines.push({
      parentUuid: leaf,
      isSidechain: false,
      promptId: uuid(),
      type: 'user',
      message: { role: 'user', content: turn.user },
      uuid: userUuid,
      timestamp,
      permissionMode: 'bypassPermissions',
      origin: { kind: 'human' },
      promptSource: 'typed',
      userType: 'external',
      entrypoint: 'cli',
      cwd,
      sessionId,
      version,
      gitBranch,
    });
    const assistantUuid = uuid();
    lines.push({
      parentUuid: userUuid,
      isSidechain: false,
      message: {
        id: uuid(),
        type: 'message',
        role: 'assistant',
        model,
        content: [{ type: 'text', text: turn.assistant }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
        stop_details: null,
      },
      type: 'assistant',
      uuid: assistantUuid,
      timestamp,
      effort: 'max',
      session_id: sessionId,
      userType: 'external',
      entrypoint: 'cli',
      cwd,
      sessionId,
      version,
      gitBranch,
    });
    leaf = assistantUuid;
    checkpoint();
  }
  lines.push({
    type: 'last-prompt',
    lastPrompt: turns.length ? turns[turns.length - 1].user : '',
    leafUuid: leaf,
    sessionId,
  });
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

// Materializes the transcript for sessionId into claude's project transcript dir.
// Returns null (and writes nothing) when the session has no conversation turns.
export function materializeClaudeTranscript({
  home,
  cwd,
  sessionId,
  entries,
  version,
  model,
  gitBranch,
}) {
  const turns = extractConversationTurns(entries);
  if (!turns.length) return null;
  const content = buildClaudeTranscript({
    sessionId,
    cwd,
    turns,
    version,
    model: model || 'default',
    gitBranch,
  });
  const filePath = path.join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd), `${sessionId}.jsonl`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return { path: filePath, bytes: Buffer.byteLength(content), turns: turns.length };
}
