// Runs `npm publish --access public` in a real PTY so npm prints the
// unmasked web-auth URL. Streams the URL out to url.txt as soon as it
// appears, then keeps the publish process alive until auth completes.
import pty from '@homebridge/node-pty-prebuilt-multiarch';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..', process.argv[2] || 'extensions/wf-ui');
const outFile = path.join(here, 'pub-url.txt');
const doneFile = path.join(here, 'pub-done.txt');

fs.rmSync(outFile, { force: true });
fs.rmSync(doneFile, { force: true });

const proc = pty.spawn('npm.cmd', ['publish', '--access', 'public'], {
  name: 'xterm',
  cwd: pkgDir,
  env: process.env,
  cols: 200,
  rows: 30,
});

let buf = '';
let urlWritten = false;

proc.onData((data) => {
  buf += data;
  if (!urlWritten) {
    const m = buf.match(/https:\/\/www\.npmjs\.com\/auth\/cli\/[a-zA-Z0-9-]+/);
    if (m) {
      fs.writeFileSync(outFile, m[0], 'utf8');
      urlWritten = true;
    }
  }
  process.stdout.write(data);
});

proc.onExit(({ exitCode }) => {
  fs.writeFileSync(doneFile, String(exitCode), 'utf8');
  process.exit(exitCode || 0);
});
