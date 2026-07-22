#!/usr/bin/env node
/**
 * Local script mirror parity gate.
 *
 * Asserts that the dogfood copy and the template copy of the framework scripts
 * are byte-identical (after CRLF normalization). This complements the network
 * manifest parity gate (check-update-mirrors.mjs) by enforcing local parity of
 * the updater/validator scripts themselves, so a pre-push cannot ship a dogfood
 * script that drifts from what installed projects will receive.
 *
 *   node scripts/check-script-mirrors.mjs
 *
 * Exit 0 = all mirrored pairs identical. Exit 1 = one or more pairs differ.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Each entry is a framework script that must stay in sync between the dogfood
// runtime (Harness/scripts/) and the published template tree
// (templates/common/Harness/scripts/).
const MIRROR_PAIRS = [
  'wf-update-check.mjs',
  'scan-clean.mjs',
  'validate-harness.mjs',
];

function readNormalized(rel) {
  const raw = readFileSync(join(ROOT, ...rel.split('/')), 'utf8');
  return raw.replace(/\r\n/g, '\n');
}

const diffs = [];

for (const file of MIRROR_PAIRS) {
  const dogfoodRel = `Harness/scripts/${file}`;
  const templateRel = `templates/common/Harness/scripts/${file}`;
  let dogfood;
  let template;
  try {
    dogfood = readNormalized(dogfoodRel);
  } catch (err) {
    diffs.push({ file, message: `missing dogfood copy: ${dogfoodRel} (${err.code || err.message})` });
    continue;
  }
  try {
    template = readNormalized(templateRel);
  } catch (err) {
    diffs.push({ file, message: `missing template copy: ${templateRel} (${err.code || err.message})` });
    continue;
  }
  if (dogfood !== template) {
    diffs.push({
      file,
      message: `dogfood ${dogfoodRel} (${dogfood.length} bytes) != template ${templateRel} (${template.length} bytes)`,
    });
  }
}

if (diffs.length > 0) {
  console.error(`[check-script-mirrors] ${diffs.length} local script mirror drift(s) detected:`);
  for (const d of diffs) console.error(`  ${d.file}: ${d.message}`);
  console.error('  Sync the dogfood and template copies before pushing.');
  process.exit(1);
}

console.log(`[check-script-mirrors] all ${MIRROR_PAIRS.length} local script mirror pair(s) identical.`);
process.exit(0);
