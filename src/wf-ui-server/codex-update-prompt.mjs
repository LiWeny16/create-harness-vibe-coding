export const CODEX_UPDATE_SKIP_SESSION_KEYS = '\x1b[B\r';
export const CODEX_UPDATE_SKIP_UNTIL_NEXT_VERSION_KEYS = '\x1b[B\x1b[B\r';

const ANSI_PATTERN = /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~])/g;
const MAX_BUFFER_CHARS = 6000;

export function stripTerminalControls(value) {
  return String(value || '')
    .replace(ANSI_PATTERN, '')
    .replace(/\r/g, '\n');
}

export function isCodexUpdatePrompt(value) {
  const normalized = stripTerminalControls(value)
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return normalized.includes('update available')
    && normalized.includes('release notes:')
    && normalized.includes('skip until next version')
    && normalized.includes('press enter to continue');
}

export function codexUpdatePromptControlEnabled(env = process.env) {
  return env.HARNESS_CODEX_UPDATE_PROMPT !== 'passthrough'
    && env.HARNESS_CODEX_UPDATE_PROMPT !== 'manual';
}

export function createCodexUpdatePromptDetector({ enabled = true } = {}) {
  let buffer = '';
  let detected = false;

  return {
    observe(chunk) {
      if (!enabled || detected) return null;
      buffer = stripTerminalControls(`${buffer}${chunk || ''}`).slice(-MAX_BUFFER_CHARS);
      if (!isCodexUpdatePrompt(buffer)) return null;
      detected = true;
      return {
        reason: 'codex-update-prompt',
        type: 'codex:update-prompt',
      };
    },
    get detected() {
      return detected;
    },
  };
}

export function codexUpdatePromptInputForChoice(choice) {
  if (choice === 'skip-session') return CODEX_UPDATE_SKIP_SESSION_KEYS;
  if (choice === 'skip-until-next-version') return CODEX_UPDATE_SKIP_UNTIL_NEXT_VERSION_KEYS;
  return null;
}
