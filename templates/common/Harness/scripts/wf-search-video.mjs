#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateResearchBackendConfig } from './lib/wf-research.mjs';

const TRANSCRIPT_SCHEMA = 'wf-search/video-transcript.v1';
const MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_MEDIA_BYTES = 512 * 1024 * 1024;
const COMMANDS = new Set(['validate', 'search', 'transcribe']);

const HELP = `wf-search video helper

Usage:
  node Harness/scripts/wf-search-video.mjs validate --input <transcript.json> [--json]
  node Harness/scripts/wf-search-video.mjs search --input <transcript.json> --query <text> [--limit <n>]
  node Harness/scripts/wf-search-video.mjs transcribe --input <media> [--config <backend-config.json>] [--backend whisper] [--endpoint <url>] [options]

transcribe options:
  --url <video-url> --title <title> --platform <name> --language <code>
  --output <transcript.json> --word-timestamps --max-bytes <n>

Without --endpoint, the helper reads Harness/extensions/config.json using
wf-search/backend-config.v1. Transport and credentials stay outside wf-search.`;

function output(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function fail(message, code = 'WFM-CLI001') {
  output({ ok: false, errors: [{ code, path: '$', message }] });
  process.exitCode = 1;
}

function parse(argv) {
  const args = { _: [] };
  const valueOptions = new Set(['input', 'query', 'endpoint', 'config', 'backend', 'url', 'title', 'platform', 'language', 'output', 'limit', 'max-bytes']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') { args.help = true; continue; }
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2);
    if (key === 'json' || key === 'word-timestamps') { args[key] = true; continue; }
    if (!valueOptions.has(key)) throw new Error(`unknown option: --${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function readJson(input) {
  if (!input) throw new Error('--input requires a transcript JSON file');
  const file = path.resolve(input);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`input is not a file: ${file}`);
  if (stat.size > MAX_TRANSCRIPT_BYTES) throw new Error(`transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`invalid transcript JSON: ${error.message}`); }
}

function issue(pathName, message) {
  return { code: 'WFM-SCHEMA001', path: pathName, message };
}

export function validateTranscript(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: [issue('$', 'transcript must be an object')] };
  if (value.schemaVersion !== TRANSCRIPT_SCHEMA) errors.push(issue('$.schemaVersion', `must equal ${TRANSCRIPT_SCHEMA}`));
  if (!value.video || typeof value.video !== 'object' || Array.isArray(value.video)) errors.push(issue('$.video', 'video metadata is required'));
  else if (typeof value.video.url !== 'string' || !/^https?:\/\//.test(value.video.url)) errors.push(issue('$.video.url', 'must be an http(s) URL'));
  if (!['native-caption', 'asr'].includes(value.source)) errors.push(issue('$.source', 'must be native-caption or asr'));
  if (!Array.isArray(value.segments)) errors.push(issue('$.segments', 'must be an array'));
  else {
    const seen = new Set();
    value.segments.forEach((segment, index) => {
      const base = `$.segments[${index}]`;
      if (!segment || typeof segment !== 'object') { errors.push(issue(base, 'must be an object')); return; }
      if (!Number.isInteger(segment.id) || segment.id < 0) errors.push(issue(`${base}.id`, 'must be a non-negative integer'));
      if (seen.has(segment.id)) errors.push(issue(`${base}.id`, `duplicate id: ${segment.id}`));
      seen.add(segment.id);
      if (!Number.isFinite(segment.startMs) || segment.startMs < 0) errors.push(issue(`${base}.startMs`, 'must be a non-negative number'));
      if (!Number.isFinite(segment.endMs) || segment.endMs <= segment.startMs) errors.push(issue(`${base}.endMs`, 'must be greater than startMs'));
      if (typeof segment.text !== 'string' || segment.text.trim() === '') errors.push(issue(`${base}.text`, 'must be a non-empty string'));
    });
  }
  return { ok: errors.length === 0, errors };
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toMilliseconds(value, field) {
  if (Number.isFinite(value?.[`${field}Ms`])) return Math.round(value[`${field}Ms`]);
  if (Number.isFinite(value?.[field])) return Math.round(value[field] * 1000);
  return null;
}

function normalizeWords(words) {
  if (!Array.isArray(words)) return undefined;
  return words.map((word, index) => ({
    id: index,
    text: String(word.word ?? word.text ?? '').trim(),
    startMs: toMilliseconds(word, 'start'),
    endMs: toMilliseconds(word, 'end'),
    probability: Number.isFinite(word.probability) ? word.probability : undefined,
  })).filter(word => word.text && word.startMs !== null && word.endMs !== null && word.endMs > word.startMs);
}

export function normalizeAsrResponse(response, metadata = {}) {
  if (!response || typeof response !== 'object' || !Array.isArray(response.segments)) throw new Error('ASR response must contain a segments array');
  const segments = response.segments.map((segment, index) => {
    const startMs = toMilliseconds(segment, 'start');
    const endMs = toMilliseconds(segment, 'end');
    return {
      id: Number.isInteger(segment.id) && segment.id >= 0 ? segment.id : index,
      startMs,
      endMs,
      text: String(segment.text ?? '').trim(),
      ...(normalizeWords(segment.words) ? { words: normalizeWords(segment.words) } : {}),
    };
  });
  const transcript = {
    schemaVersion: TRANSCRIPT_SCHEMA,
    video: {
      url: metadata.url || 'https://invalid.local/video',
      ...(metadata.title ? { title: metadata.title } : {}),
      ...(metadata.platform ? { platform: metadata.platform } : {}),
      retrievedAt: new Date().toISOString(),
      ...(Number.isFinite(response.duration) ? { durationMs: Math.round(response.duration * 1000) } : {}),
    },
    language: response.language || metadata.language || null,
    languageProbability: numberOr(response.language_probability, null),
    model: response.model || 'remote-whisper',
    source: 'asr',
    segments,
  };
  const checked = validateTranscript(transcript);
  if (!checked.ok) throw new Error(`ASR response did not satisfy transcript contract: ${checked.errors.map(error => `${error.path} ${error.message}`).join('; ')}`);
  return transcript;
}

export function searchTranscript(transcript, query, limit = 20) {
  const checked = validateTranscript(transcript);
  if (!checked.ok) throw new Error(`invalid transcript: ${checked.errors.map(error => `${error.path} ${error.message}`).join('; ')}`);
  if (!query || !String(query).trim()) throw new Error('--query requires non-empty text');
  const needle = String(query).toLocaleLowerCase();
  const max = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 20));
  const matches = transcript.segments.filter(segment => segment.text.toLocaleLowerCase().includes(needle)).slice(0, max);
  return { ok: true, query: String(query), total: matches.length, matches };
}

async function transcribeFile(args) {
  if (!args.input) throw new Error('--input requires a media file');
  let endpointValue = args.endpoint;
  if (!endpointValue) {
    const configPath = path.resolve(args.config || path.join(process.cwd(), 'Harness', 'extensions', 'config.json'));
    if (!fs.existsSync(configPath)) throw new Error(`backend config is missing: ${configPath}`);
    let config;
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
    catch (error) { throw new Error(`invalid backend config JSON: ${error.message}`); }
    const checked = validateResearchBackendConfig(config);
    if (!checked.ok) throw new Error(`invalid backend config: ${checked.errors.map(error => `${error.path} ${error.message}`).join('; ')}`);
    const backend = args.backend || 'whisper';
    const baseUrl = checked.normalized.backends?.[backend]?.baseUrl;
    if (!baseUrl) throw new Error(`backend config has no baseUrl for ${backend}`);
    endpointValue = `${String(baseUrl).replace(/\/+$/, '')}/transcribe`;
  }
  const endpoint = new URL(endpointValue);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('--endpoint must be an http(s) URL');
  const input = path.resolve(args.input);
  const stat = fs.statSync(input);
  if (!stat.isFile()) throw new Error(`input is not a file: ${input}`);
  const maxBytes = Math.max(1, Number.parseInt(args['max-bytes'], 10) || DEFAULT_MAX_MEDIA_BYTES);
  if (stat.size > maxBytes) throw new Error(`media exceeds ${maxBytes} bytes`);
  const headers = {
    'content-type': 'application/octet-stream',
    'x-filename': path.basename(input),
    ...(args.language ? { 'x-language': args.language } : {}),
    ...(args['word-timestamps'] ? { 'x-word-timestamps': 'true' } : {}),
    'x-vad-filter': 'true',
  };
  const response = await fetch(endpoint, { method: 'POST', headers, body: fs.readFileSync(input) });
  const body = await response.text();
  if (!response.ok) throw new Error(`ASR endpoint returned ${response.status}: ${body.slice(0, 1000)}`);
  let parsed;
  try { parsed = JSON.parse(body); } catch (error) { throw new Error(`ASR endpoint returned invalid JSON: ${error.message}`); }
  return normalizeAsrResponse(parsed, { url: args.url, title: args.title, platform: args.platform, language: args.language });
}

async function main() {
  let args;
  try { args = parse(process.argv.slice(2)); }
  catch (error) { fail(error.message); return; }
  if (args.help || args._[0] === undefined) { process.stdout.write(`${HELP}\n`); return; }
  const command = args._[0];
  if (!COMMANDS.has(command)) { fail(`unknown command: ${command}`); return; }
  try {
    if (command === 'validate') {
      const checked = validateTranscript(readJson(args.input));
      output({ ok: checked.ok, errors: checked.errors });
      if (!checked.ok) process.exitCode = 1;
      return;
    }
    if (command === 'search') {
      output(searchTranscript(readJson(args.input), args.query, args.limit));
      return;
    }
    const transcript = await transcribeFile(args);
    if (args.output) fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
    output({ ok: true, transcript });
  } catch (error) {
    fail(error.message || String(error), 'WFM-CLI002');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
