#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import process from 'node:process';

const require = createRequire(import.meta.url);
const platformPackages = {
  'darwin-arm64': '@zingspark/wf-cli-darwin-arm64',
  'darwin-x64': '@zingspark/wf-cli-darwin-x64',
  'linux-arm64': '@zingspark/wf-cli-linux-arm64-gnu',
  'linux-x64': '@zingspark/wf-cli-linux-x64-gnu',
  'win32-arm64': '@zingspark/wf-cli-win32-arm64-msvc',
  'win32-x64': '@zingspark/wf-cli-win32-x64-msvc',
};

function resolveBinary() {
  if (process.env.WF_CLI_BINARY) return process.env.WF_CLI_BINARY;
  const packageName = platformPackages[process.platform + '-' + process.arch];
  if (!packageName) throw new Error('unsupported wf CLI platform: ' + process.platform + '/' + process.arch);
  try {
    const manifestPath = require.resolve(packageName + '/package.json');
    const manifest = require(manifestPath);
    return require.resolve(packageName + '/' + manifest.binary);
  } catch {
    throw new Error('native wf binary is not installed for ' + process.platform + '/' + process.arch + '; reinstall @zingspark/wf-cli with pnpm');
  }
}

const child = spawn(resolveBinary(), process.argv.slice(2), {
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
});

child.on('error', (error) => {
  process.stderr.write('wf: ' + error.message + '\n');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

