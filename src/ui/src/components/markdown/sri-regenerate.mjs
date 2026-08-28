// sri-regenerate.mjs
// Regenerates the SRI integrity hash for the locked mermaid CDN build and
// prints it in `integrity="sha384-..."` form.
//
// Usage:
//   node sri-regenerate.mjs                      # default locked URL below
//   node sri-regenerate.mjs <any-https-url>      # arbitrary URL
//
// Requires Node >= 18 (built-in fetch + node:crypto).
// Paste the printed value into mermaidLoader.ts's MERMAID_SRI constant.
import { createHash } from 'node:crypto';

const DEFAULT_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js';

const url = process.argv[2] ?? DEFAULT_URL;

const response = await fetch(url, { redirect: 'follow' });
if (!response.ok) {
  throw new Error(`GET ${url} failed: HTTP ${response.status} ${response.statusText}`);
}

const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash('sha384').update(bytes).digest('base64');

console.log(`url:    ${url}`);
console.log(`bytes:  ${bytes.length}`);
console.log(`integrity="sha384-${digest}"`);
