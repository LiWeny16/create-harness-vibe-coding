import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from '../../wf-ui-server/server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.WF_UI_E2E_PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const port = Number(process.env.WF_UI_E2E_PORT || 43173);
const token = process.env.WF_UI_E2E_TOKEN || 'playwright-m1-red';

const started = await startServer({ projectRoot, port, token });

console.log(`[wf-ui-e2e] ${started.url}`);

async function shutdown() {
  await stopServer(started.server);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await new Promise(() => {});
