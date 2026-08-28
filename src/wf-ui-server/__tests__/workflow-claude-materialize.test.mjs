import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeHarnessTempRoot } from '../../../tests/support/temp-root.js';
import {
  encodeClaudeProjectDir,
  extractConversationTurns,
  buildClaudeTranscript,
  materializeClaudeTranscript,
} from '../claude-transcript-materializer.mjs';

// Fixtures mirror the real terminal.jsonl shapes captured from a live claude
// harness session (RESUME-E2E-EVIDENCE.md PASS 3, session dae0424d): char-by-char
// stdin, "❯ " prompt echo, spinner/progress stdout, "●answer✻Verb for Xs❯ " reply.

let seq = 0;
function entry(stream, data) {
  return { seq: ++seq, ts: new Date().toISOString(), stream, data };
}
function typePrompt(text) {
  const entries = [];
  for (const ch of text) entries.push(entry('stdin', ch));
  entries.push(entry('stdin', '\r'));
  return entries;
}
function ansi(text) {
  return `\x1b[38;2;87;105;247m${text}\x1b[39m`;
}

const PROMPT_A = 'Reply with exactly one word: plum';
const REPLY_A = ansi('✢thinking with max effort Thought for 9s ●plum✻Baked for 9s❯ ');
const PROMPT_B = 'What was the one word I asked you to reply?';
const ECHO_B = `❯ ${PROMPT_B}`;
const REPLY_B = ansi('Thought for 5s ●plum✻Worked for 5s❯ ');

function singleTurnEntries() {
  return [...typePrompt(PROMPT_A), entry('stdout', REPLY_A)];
}

test('U1 single turn: prompt from stdin chars, answer from ● bullet', () => {
  const turns = extractConversationTurns(singleTurnEntries());
  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0], { user: PROMPT_A, assistant: 'plum' });
});

test('U2 multi-turn: next prompt echo does not leak into previous answer', () => {
  const entries = [
    ...typePrompt(PROMPT_A),
    entry('stdout', REPLY_A),
    entry('stdout', ECHO_B), // echo of turn 2 leaks into turn 1 stdout segment
    ...typePrompt(PROMPT_B),
    entry('stdout', REPLY_B),
  ];
  const turns = extractConversationTurns(entries);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].assistant, 'plum');
  assert.deepEqual(turns[1], { user: PROMPT_B, assistant: 'plum' });
});

test('U3 slash commands are control input, not conversation turns', () => {
  const entries = [
    ...typePrompt('/model'),
    entry('stdout', 'model picker'),
    ...singleTurnEntries(),
  ];
  const turns = extractConversationTurns(entries);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].user, PROMPT_A);
});

test('U4 boot-only session (no submitted prompt) yields no turns', () => {
  const turns = extractConversationTurns([
    entry('stdin', 'R'),
    entry('stdout', 'Claude Code v2.1.215'),
    entry('stdin', 'e'),
  ]);
  assert.deepEqual(turns, []);
});

test('U10 promptSubmit shape: one full-prompt stdin entry, no CR in the ring', () => {
  // The promptSubmit path types char-by-char at the PTY level and sends the enter
  // as a raw write, so the ring holds ONE stdin entry with the whole prompt and
  // the turn bracket is the only delimiter (real E2E shape, session d9245593).
  const entries = [
    entry('stdin', PROMPT_A),
    entry('stdout', ansi(`❯ ${PROMPT_A}`)), // composer echo
    entry('stdout', ansi('✢thinking with max effort')),
    entry('stdout', ansi('●mango✻Crunched for 5s❯ ')),
  ];
  const turns = extractConversationTurns(entries);
  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0], { user: PROMPT_A, assistant: 'mango' });
});

test('U8 answer cleanup: verb tail, spinner glyphs, thinking preview, multi-bullet', () => {
  const entries = [
    ...typePrompt(PROMPT_A),
    entry('stdout', ansi('Thought for 3s\n⎿ thinking preview line\n● item one\n● item two✻Baked for 3s❯ ')),
  ];
  const turns = extractConversationTurns(entries);
  assert.equal(turns.length, 1);
  // the second ● is a list marker inside the answer — kept as rendered
  assert.equal(turns[0].assistant, 'item one\n● item two');
});

test('U5 buildClaudeTranscript: every line valid JSON, schema-faithful type sequence', () => {
  const sessionId = '11111111-2222-3333-4444-555555555555';
  const content = buildClaudeTranscript({
    sessionId,
    cwd: 'D:\\MyFile\\sample',
    turns: [{ user: PROMPT_A, assistant: 'plum' }],
  });
  const lines = content.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(
    lines.map((line) => line.type),
    ['last-prompt', 'mode', 'permission-mode', 'user', 'assistant', 'last-prompt', 'mode', 'permission-mode', 'last-prompt'],
  );
  for (const line of lines) {
    if (line.sessionId !== undefined) assert.equal(line.sessionId, sessionId);
    if (line.session_id !== undefined) assert.equal(line.session_id, sessionId);
    assert.notEqual(JSON.stringify(line).includes('undefined'), true);
  }
  const userLine = lines.find((line) => line.type === 'user');
  const assistantLine = lines.find((line) => line.type === 'assistant');
  assert.equal(userLine.message.content, PROMPT_A);
  assert.equal(assistantLine.message.content[0].text, 'plum');
  const finalLine = lines[lines.length - 1];
  assert.equal(finalLine.lastPrompt, PROMPT_A);
});

test('U6 materializeClaudeTranscript writes into the encoded project dir', () => {
  const home = makeHarnessTempRoot('claude-mat-');
  const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  try {
    const result = materializeClaudeTranscript({
      home,
      cwd: 'D:\\MyFile\\sample',
      sessionId,
      entries: singleTurnEntries(),
    });
    assert.ok(result);
    assert.equal(result.turns, 1);
    const expectedPath = path.join(home, '.claude', 'projects', 'D--MyFile-sample', `${sessionId}.jsonl`);
    assert.equal(result.path, expectedPath);
    assert.equal(result.bytes, fs.statSync(expectedPath).size);
    // uuids/timestamps are per-build, so compare structure + content, not bytes
    const onDisk = fs.readFileSync(expectedPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(
      onDisk.map((line) => line.type),
      ['last-prompt', 'mode', 'permission-mode', 'user', 'assistant', 'last-prompt', 'mode', 'permission-mode', 'last-prompt'],
    );
    for (const line of onDisk) {
      if (line.sessionId !== undefined) assert.equal(line.sessionId, sessionId);
      if (line.session_id !== undefined) assert.equal(line.session_id, sessionId);
    }
    assert.equal(onDisk.find((line) => line.type === 'user').message.content, PROMPT_A);
    assert.equal(onDisk.find((line) => line.type === 'assistant').message.content[0].text, 'plum');
    assert.equal(onDisk[onDisk.length - 1].lastPrompt, PROMPT_A);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('U7 no turns: materialize returns null and writes nothing', () => {
  const home = makeHarnessTempRoot('claude-mat-');
  try {
    const result = materializeClaudeTranscript({
      home,
      cwd: 'D:\\MyFile\\sample',
      sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      entries: [entry('stdin', 'R'), entry('stdout', 'boot banner')],
    });
    assert.equal(result, null);
    assert.equal(fs.existsSync(path.join(home, '.claude')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('U12 a "❯" inside the answer (quoted shell prompt) is preserved, not a turn-over', () => {
  const entries = [
    ...typePrompt(PROMPT_A),
    entry('stdout', ansi('●Try: ❯ npm run dev, or check the docs✻Baked for 4s❯ ')),
  ];
  const turns = extractConversationTurns(entries);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].assistant, 'Try: ❯ npm run dev, or check the docs');
});

test('U13 ready marker without verb tail: next prompt input closes the turn', () => {
  const entries = [
    ...typePrompt(PROMPT_A),
    entry('stdout', ansi('●done❯ ')), // ready "❯" but no "✻Verb for Xs" tail
    ...typePrompt(PROMPT_B),
    entry('stdout', REPLY_B),
  ];
  const turns = extractConversationTurns(entries);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0], { user: PROMPT_A, assistant: 'done' });
  assert.deepEqual(turns[1], { user: PROMPT_B, assistant: 'plum' });
});

test('U9 encodeClaudeProjectDir matches the real claude encoding', () => {
  assert.equal(
    encodeClaudeProjectDir('D:\\MyFile\\sample\\synchronous-github\\zingspark\\create-harness-vibe-coding'),
    'D--MyFile-sample-synchronous-github-zingspark-create-harness-vibe-coding',
  );
});
