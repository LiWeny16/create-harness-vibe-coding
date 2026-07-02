// setup.mjs — Install harness on a test project
import { execFileSync } from 'child_process';
import { cpSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..', '..');
const BIN = join(ROOT, 'bin', 'create-harness-vibe-coding.js');
const FIXTURES = join(ROOT, 'tests', 'batch', 'fixtures');

export function createProject(name, fixture = 'empty') {
  const tmp = join(ROOT, 'tests', 'batch', '.tmp', name);
  const src = join(FIXTURES, fixture);
  if (existsSync(tmp)) cpSync(tmp, tmp + '.bak', { recursive: true, force: true });
  cpSync(src, tmp, { recursive: true });
  return tmp;
}

export function installHarness(targetDir) {
  return execFileSync(process.execPath, [BIN, targetDir, '-y', '--on-conflict', 'skip'], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: ROOT,
  });
}

export function simulateHook(eventJSON) {
  const hookScript = join(ROOT, 'Harness', 'scripts', 'wf-mode-hook.mjs');
  const workDir = process.env.BATCH_TMP || ROOT;
  // Ensure CLAUDE.md exists so hook's getProjectRoot() resolves correctly
  const claudeMd = join(workDir, 'CLAUDE.md');
  if (!existsSync(claudeMd)) writeFileSync(claudeMd, '# test project\\n');
  try {
    const result = execFileSync(process.execPath, [hookScript], {
      input: JSON.stringify(eventJSON),
      encoding: 'utf8',
      timeout: 5000,
      cwd: workDir,
    });
    return { stdout: result, stderr: '', exit: 0 };
  } catch (e) {
    return { stdout: e.stdout || '', stderr: e.stderr || '', exit: e.status || 1 };
  }
}

export function readModeFile(projectDir) {
  const modeFile = join(projectDir, 'Harness', '.runtime', 'current-mode.json');
  if (!existsSync(modeFile)) return null;
  try { return JSON.parse(readFileSync(modeFile, 'utf8')); } catch { return null; }
}

export function cleanup(targetDir) {
  try { cpSync(targetDir, targetDir + '.last', { recursive: true, force: true }); } catch {}
}
