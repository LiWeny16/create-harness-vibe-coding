import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from '../../wf-ui-server/server.mjs';
import { SessionRegistry } from '../../wf-ui-server/session-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.WF_UI_E2E_PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const port = Number(process.env.WF_UI_E2E_PORT || 43173);

// Match the real CLI runtime: config/start actions require a live session
// registry even when the Playwright fixture does not open a terminal socket.
const started = await startServer({ projectRoot, port, sessionRegistry: new SessionRegistry() });

console.log(`[wf-ui-e2e] ${started.url}`);

async function shutdown() {
  await stopServer(started.server);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await new Promise(() => {});
