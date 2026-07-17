import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const WF_COMMANDS = new Map([
  ['wf', 'WF'],
  ['wf-max', 'WF-MAX'],
  ['wf-auto', 'WF-AUTO'],
  ['wf-auto-spark', 'WF-AUTO-SPARK'],
  ['wf-review', 'WF-REVIEW'],
  ['wf-learn', 'WF-LEARN'],
  ['wf-readme', 'WF-README'],
  ['wf-remove', 'WF-REMOVE'],
  ['wf-browser', 'WF-BROWSER'],
]);

function commandName(value) {
  return String(value || '').trim().replace(/^\/+/, '').split(/\s+/)[0];
}

function runtimeDir(root) {
  return resolve(root, 'Harness', '.runtime');
}

function modePath(root) {
  return resolve(runtimeDir(root), 'current-mode.json');
}

function writeMode(root, mode, sessionID) {
  mkdirSync(runtimeDir(root), { recursive: true });
  writeFileSync(modePath(root), JSON.stringify({
    active: true,
    mode,
    sessionID,
    startedAt: new Date().toISOString(),
    surface: 'opencode',
  }, null, 2) + '\n', 'utf-8');
}

function readMode(root) {
  try {
    return JSON.parse(readFileSync(modePath(root), 'utf-8'));
  } catch {
    return null;
  }
}

function clearMode(root) {
  try {
    rmSync(modePath(root), { force: true });
  } catch {
    // Best effort only.
  }
}

function runUpdatePrompt(root, prompt) {
  const script = resolve(root, 'Harness', 'scripts', 'wf-auto-update-prompt.mjs');
  if (!existsSync(script)) return null;
  const result = spawnSync(process.execPath, [script, '--format', 'json'], {
    cwd: root,
    input: JSON.stringify({
      cwd: root,
      hook_event_name: 'chat.message',
      prompt,
    }),
    encoding: 'utf-8',
    timeout: 35000,
  });
  if (result.error || !result.stdout?.trim()) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function textFromParts(parts) {
  return (parts || [])
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n');
}

async function showToast(client, directory, body) {
  try {
    await client.tui.showToast({
      body,
      query: { directory },
    });
  } catch {
    // TUI may not be attached, for example during non-interactive runs.
  }
}

export const HarnessWfStatusPlugin = async ({ client, directory, worktree }) => {
  const root = worktree || directory || process.cwd();

  return {
    'chat.message': async (_input, output) => {
      const update = runUpdatePrompt(root, textFromParts(output.parts));
      if (!update?.message) return;
      await showToast(client, root, {
        title: 'Harness update available',
        message: update.message,
        variant: 'warning',
        duration: 12000,
      });
    },

    'command.execute.before': async (input) => {
      const mode = WF_COMMANDS.get(commandName(input.command));
      if (!mode) return;
      writeMode(root, mode, input.sessionID);
      await showToast(client, root, {
        title: 'Harness',
        message: `${mode} mode on`,
        variant: 'info',
        duration: 8000,
      });
    },

    event: async ({ event }) => {
      if (event.type !== 'session.idle') return;
      const mode = readMode(root);
      if (!mode?.active) return;
      clearMode(root);
      await showToast(client, root, {
        title: 'Harness',
        message: `${mode.mode} mode cleared`,
        variant: 'success',
        duration: 5000,
      });
    },
  };
};
