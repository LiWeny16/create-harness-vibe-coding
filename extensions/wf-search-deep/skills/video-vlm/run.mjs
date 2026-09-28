#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HELP = `video-vlm skill runner

Usage:
  node run.mjs --input <video> --endpoint <chat-completions-url> --model <id> [options]

Options:
  --question <text> --source-url <url> --config <backend-config.json>
  --max-global-frames <n> --local-seconds <a,b,c> --output <json-file>
  --ffmpeg <path> --ffprobe <path> --max-tokens <n> --json

The endpoint, model, and API key are host-provided. The key is read from
WF_SEARCH_VLM_API_KEY (or OPENAI_API_KEY) and is never written to output.
The runner performs a global video pass followed by a bounded local pass.`;

function fail(message) {
  process.stdout.write(`${JSON.stringify({ ok: false, errors: [{ code: 'WFV-CLI001', path: '$', message }] }, null, 2)}\n`);
  process.exitCode = 1;
}

function parse(argv) {
  const args = { _: [] };
  const values = new Set(['input', 'endpoint', 'model', 'question', 'source-url', 'config', 'max-global-frames', 'local-seconds', 'output', 'ffmpeg', 'ffprobe', 'max-tokens']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') { args.help = true; continue; }
    if (token === '--json') { args.json = true; continue; }
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2);
    if (!values.has(key)) throw new Error(`unknown option: --${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function run(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-20000); });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-20000); });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function readConfig(file) {
  if (!file || !fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function endpointFrom(args, config) {
  const base = args.endpoint || config?.backends?.vlm?.baseUrl;
  if (!base) throw new Error('VLM endpoint is required via --endpoint or backend config');
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('VLM endpoint must be HTTP(S)');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  return url.toString();
}

function modelFrom(args, config) {
  const model = args.model || config?.backends?.vlm?.model;
  if (!model) throw new Error('VLM model is required via --model or backend config');
  return model;
}

async function probeDuration(input, ffprobe) {
  const result = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input]);
  const duration = Number(result.stdout.trim());
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function uniformTimestamps(duration, count) {
  const total = Math.max(1, Number.parseInt(count, 10) || 6);
  if (!duration || total === 1) return [0];
  const safeEnd = Math.max(0, duration - 0.1);
  return Array.from({ length: total }, (_, index) => Number((safeEnd * index / (total - 1)).toFixed(3)));
}

async function extractFrame(input, output, timestamp, ffmpeg) {
  const result = await run(ffmpeg, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(timestamp),
    '-i', input, '-frames:v', '1', '-vf', 'scale=640:-2', '-pix_fmt', 'yuvj420p', '-q:v', '5', output,
  ]);
  if (result.status !== 0 || !fs.existsSync(output)) throw new Error(`ffmpeg failed at ${timestamp}s: ${result.stderr.trim().slice(-1000)}`);
}

function dataUrl(file) {
  return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
}

function parseJsonContent(content) {
  const fenced = String(content || '').match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced || String(content || '')).trim();
  try { return JSON.parse(candidate); } catch { return null; }
}

function localSecondsFrom(globalContent, timestamps) {
  const parsed = parseJsonContent(globalContent);
  const values = parsed?.localPassSeconds || parsed?.local_pass_seconds;
  if (Array.isArray(values)) {
    const selected = values.map(Number).filter(value => Number.isFinite(value) && value >= 0);
    if (selected.length > 0) return [...new Set(selected)].slice(0, 4);
  }
  if (timestamps.length <= 3) return timestamps;
  return [timestamps[1], timestamps[Math.floor(timestamps.length / 2)], timestamps[timestamps.length - 2]];
}

async function callVlm(endpoint, model, images, prompt, maxTokens, apiKey) {
  const content = [{ type: 'text', text: prompt }];
  for (const image of images) {
    content.push({ type: 'text', text: `Frame timestamp: ${image.timestamp}s` });
    content.push({ type: 'image_url', image_url: { url: dataUrl(image.file) } });
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }], temperature: 0.1, max_tokens: maxTokens, stream: false }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`VLM endpoint returned ${response.status}: ${text.slice(0, 1000)}`);
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('VLM endpoint returned invalid JSON'); }
  const choice = body.choices?.[0];
  if (!choice?.message) throw new Error('VLM response has no choices[0].message');
  return { finishReason: choice.finish_reason || null, content: choice.message.content || '', hasReasoning: Boolean(choice.message.reasoning_content) };
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) { process.stdout.write(`${HELP}\n`); return; }
  const input = path.resolve(args.input || args._[0] || '');
  if (!input || !fs.existsSync(input)) throw new Error('--input must point to a video file');
  const configPath = path.resolve(args.config || path.join(process.cwd(), 'Harness', 'extensions', 'config.json'));
  const config = readConfig(configPath);
  const endpoint = endpointFrom(args, config);
  const model = modelFrom(args, config);
  const ffmpeg = args.ffmpeg || 'ffmpeg';
  const ffprobe = args.ffprobe || 'ffprobe';
  const duration = await probeDuration(input, ffprobe);
  const timestamps = uniformTimestamps(duration, args['max-global-frames']);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-search-vlm-'));
  const globalFrames = [];
  for (const timestamp of timestamps) {
    const file = path.join(work, `global-${String(timestamp).replace('.', '_')}.jpg`);
    await extractFrame(input, file, timestamp, ffmpeg);
    globalFrames.push({ timestamp, file });
  }
  const apiKey = process.env.WF_SEARCH_VLM_API_KEY || process.env.OPENAI_API_KEY || '';
  const question = args.question || 'Describe visible facts, scene changes, objects, actions, and uncertainty. Return compact JSON with summary, anchors, and localPassSeconds.';
  const maxTokens = Number(args['max-tokens']) || 700;
  const globalPass = await callVlm(endpoint, model, globalFrames, `Global video pass. Sample timestamps are provided with each frame. Answer the question: ${question} Do not infer unseen frames. Keep the response concise and put the answer in the normal content field.`, maxTokens, apiKey);
  const requestedLocal = args['local-seconds'] ? args['local-seconds'].split(',').map(Number).filter(Number.isFinite) : localSecondsFrom(globalPass.content, timestamps);
  const localFrames = [];
  for (const timestamp of [...new Set(requestedLocal)].slice(0, 4)) {
    const file = path.join(work, `local-${String(timestamp).replace('.', '_')}.jpg`);
    await extractFrame(input, file, timestamp, ffmpeg);
    localFrames.push({ timestamp, file });
  }
  const localPass = await callVlm(endpoint, model, localFrames, `Local video pass. Re-check only these timestamped frames against the global observations below. Return compact JSON with verifiedFacts, changes, and uncertainty. Keep the response concise and put the answer in the normal content field. Global observations: ${globalPass.content}`, maxTokens, apiKey);
  const result = {
    schemaVersion: 'wf-search/video-vlm.v1',
    ok: true,
    model,
    endpoint: endpoint.replace(/\/chat\/completions$/, ''),
    input,
    sourceUrl: args['source-url'] || null,
    durationSeconds: duration,
    globalFrames: globalFrames.map(frame => ({ timestampSeconds: frame.timestamp })),
    globalPass,
    localFrames: localFrames.map(frame => ({ timestampSeconds: frame.timestamp })),
    localPass,
    artifactPolicy: 'frames are temporary; only compact model observations are returned',
  };
  if (args.output) fs.writeFileSync(path.resolve(args.output), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { await main(); } catch (error) { fail(error.message || String(error)); }
}
