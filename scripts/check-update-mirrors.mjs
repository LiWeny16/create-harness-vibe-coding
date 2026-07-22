#!/usr/bin/env node
/**
 * Release-time update mirror gate.
 *
 * Run after publishing/pushing a Harness release. Low-version installs may still
 * have updater scripts hardcoded to the legacy zingspark mirror, so a release is
 * incomplete until that mirror exposes the same generated template manifest.
 */

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const TEMPLATE_MANIFEST = 'templates/common/.harness-version';
const TAG = `v${pkg.version}`;
const SOURCES = [
  {
    key: 'canonical-main',
    label: 'canonical LiWeny16 main',
    url: `https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/main/${TEMPLATE_MANIFEST}`,
  },
  {
    key: 'legacy-main',
    label: 'legacy zingspark main',
    url: `https://raw.githubusercontent.com/zingspark/create-harness-vibe-coding/main/${TEMPLATE_MANIFEST}`,
  },
  {
    key: 'canonical-tag',
    label: `canonical LiWeny16 ${TAG}`,
    url: `https://raw.githubusercontent.com/LiWeny16/create-harness-vibe-coding/${TAG}/${TEMPLATE_MANIFEST}`,
  },
  {
    key: 'legacy-tag',
    label: `legacy zingspark ${TAG}`,
    url: `https://raw.githubusercontent.com/zingspark/create-harness-vibe-coding/${TAG}/${TEMPLATE_MANIFEST}`,
  },
];

async function fetchJson(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'harness-update-mirror-check' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (/\{\{[a-zA-Z]+\}\}/.test(body)) throw new Error('manifest still contains template placeholders');
    return JSON.parse(body);
  } finally {
    clearTimeout(timer);
  }
}

function comparable(manifest) {
  return {
    generator: manifest.generator,
    checksums: manifest.checksums || {},
    sources: manifest.sources || {},
    source: manifest.source || '',
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

let failed = 0;

async function main() {
  const manifests = new Map();

  for (const source of SOURCES) {
    process.stdout.write(`${source.label}... `);
    try {
      const manifest = await fetchJson(source);
      if (manifest.generator !== pkg.version) {
        throw new Error(`generator ${manifest.generator || 'missing'} != package ${pkg.version}`);
      }
      console.log('PASS');
      manifests.set(source.key, manifest);
    } catch (e) {
      console.log(`FAIL (${e.message})`);
      failed++;
    }
  }

  const canonicalMain = manifests.get('canonical-main');
  if (canonicalMain && manifests.size === SOURCES.length) {
    process.stdout.write('main/tag mirror manifest parity... ');
    const expected = stableJson(comparable(canonicalMain));
    const allMatch = SOURCES.every(source => stableJson(comparable(manifests.get(source.key))) === expected);
    if (allMatch) {
      console.log('PASS');
    } else {
      console.log('FAIL');
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} mirror check(s) failed. Sync https://github.com/zingspark/create-harness-vibe-coding before marking the release done.`);
    process.exit(1);
  }

  console.log('\nUpdate mirrors are synced.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
