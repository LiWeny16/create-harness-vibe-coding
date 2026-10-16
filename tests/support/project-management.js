import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { makeHarnessTempRoot } from './temp-root.js';
import { generate } from '../../src/generator.js';

export function makeProjectWorkspace(prefix = 'project-management-') {
  return makeHarnessTempRoot(prefix);
}

export function generateProject(workspaceRoot, folder, projectName = folder) {
  const projectRoot = path.join(workspaceRoot, folder);
  const result = generate({ projectName, targetDir: projectRoot });
  if (!result.success) throw new Error(`Project generation failed: ${result.errors.join('; ')}`);
  return projectRoot;
}

export function runProjectCli(projectRoot, args) {
  const script = path.join(projectRoot, 'Harness', 'scripts', 'project-state.mjs');
  return spawnSync(process.execPath, [script, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
}

export function runTaskCli(projectRoot, args) {
  const script = path.join(projectRoot, 'Harness', 'scripts', 'task-state.mjs');
  return spawnSync(process.execPath, [script, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
}

export function readProjectManifest(projectRoot) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, 'Harness', 'project', 'PROJECT.json'), 'utf8'));
}

export function successfulJson(result, message = 'command should succeed') {
  if (result.status !== 0) {
    throw new Error(`${message}\nexit=${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

export function snapshotTree(root) {
  const result = new Map();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) {
        result.set(rel, `symlink:${fs.readlinkSync(abs)}`);
      } else if (entry.isDirectory()) {
        visit(abs);
      } else {
        const hash = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
        result.set(rel, hash);
      }
    }
  };
  visit(root);
  return [...result.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function registerProject(projectRoot, workspaceRoot) {
  return runProjectCli(projectRoot, [
    'register', '--workspace', workspaceRoot, '--project-root', projectRoot, '--apply', '--json',
  ]);
}
