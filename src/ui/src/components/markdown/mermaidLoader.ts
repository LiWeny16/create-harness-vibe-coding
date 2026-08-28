// mermaidLoader.ts — lazy singleton loader for mermaid (CDN + SRI).
//
// Locked build: mermaid@11.16.0 (>= 11.15.0 carries the CVE-2026-41148/41149
// fixes) served from jsDelivr:
//   https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js
//
// SRI: sha384-T/0lMUdJpd2S1ZHtRiofG3htU3xPCrFVeAQ1UUE2TJwlEJSV5NUwn30kP28n238E
// Regenerate with: node src/components/markdown/sri-regenerate.mjs
// (Hash computed from the mermaid@11.16.0 npm tarball bytes — the exact
// content jsDelivr serves. jsDelivr was unreachable from the build machine;
// the hash was cross-checked across two independent downloads of the tarball.
// W6 e2e verifies the browser path with a real SRI-protected load.)
//
// Behavior contract:
// - The script is injected at most once per page; a load failure or 10s
//   timeout settles the singleton promise permanently (no retry loop).
// - No CDN request is ever made unless renderMermaidDiagrams finds a
//   `.markdown-mermaid[data-testid="markdown-mermaid-pending"]` placeholder.
// - Each placeholder is rendered via mermaid.render(); the SVG output is
//   sanitized with DOMPurify (svg profile strips <script>/event attributes).
// - Any failure (script load, timeout, parse, sanitize) degrades the
//   placeholder to the raw diagram source + an error badge. This module
//   never throws — renderMermaidDiagrams always resolves.
import DOMPurify from 'dompurify';

export const MERMAID_CDN_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js';
export const MERMAID_SRI =
  'sha384-T/0lMUdJpd2S1ZHtRiofG3htU3xPCrFVeAQ1UUE2TJwlEJSV5NUwn30kP28n238E';
const SCRIPT_LOAD_TIMEOUT_MS = 10_000;

type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string; bindFunctions?: (element: Element) => void }>;
};

let scriptPromise: Promise<MermaidApi> | null = null;
let initialized = false;
let renderIdCounter = 0;
// Guards against double-processing the same placeholders (e.g. a component
// remounting or an effect re-run before the async pass finishes).
const claimed = new WeakSet<HTMLElement>();

function loadMermaidScript(): Promise<MermaidApi> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<MermaidApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MERMAID_CDN_URL;
    script.integrity = MERMAID_SRI;
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.dataset.markdownMermaid = 'true';

    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      script.onload = null;
      script.onerror = null;
      script.remove();
      reject(new Error('mermaid CDN 加载超时'));
    }, SCRIPT_LOAD_TIMEOUT_MS);

    script.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      const api = (window as { mermaid?: unknown }).mermaid;
      if (api && typeof (api as MermaidApi).render === 'function') {
        resolve(api as MermaidApi);
      } else {
        reject(new Error('mermaid CDN 加载成功但全局 mermaid 不可用'));
      }
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error('mermaid CDN 脚本加载失败'));
    };

    document.head.appendChild(script);
  });

  return scriptPromise;
}

async function getMermaid(): Promise<MermaidApi> {
  const api = await loadMermaidScript();
  if (!initialized) {
    api.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // Lock these keys so a `%%{init:{"securityLevel":"loose"}}%%` directive
      // in diagram source cannot downgrade the sandbox (Docmost GHSA lesson).
      secure: ['securityLevel', 'maxTextSize'],
      suppressErrorRendering: true,
      theme: 'default',
      // Render labels as <text>/<tspan> instead of foreignObject HTML: the
      // DOMPurify svg profile below strips foreignObject content, which would
      // blank out every node label. Also shrinks the HTML attack surface.
      // Note: in mermaid 11 htmlLabels is a TOP-LEVEL config key; the old
      // flowchart.htmlLabels form is deprecated and ignored by flowchart-v2.
      htmlLabels: false,
    });
    initialized = true;
  }
  return api;
}

function decodeBase64(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function setFallback(container: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const code = decodeBase64(container.getAttribute('data-code') ?? '');
  console.warn('[markdown] mermaid render failed:', error);
  container.removeAttribute('data-testid');
  container.replaceChildren();
  const badge = document.createElement('span');
  badge.className = 'markdown-mermaid-error';
  badge.dataset.testid = 'markdown-mermaid-error';
  badge.textContent = `mermaid 渲染失败：${message}`;
  const pre = document.createElement('pre');
  const codeBlock = document.createElement('code');
  codeBlock.className = 'markdown-mermaid-fallback';
  codeBlock.dataset.testid = 'markdown-mermaid-fallback';
  codeBlock.textContent = code;
  pre.appendChild(codeBlock);
  container.appendChild(badge);
  container.appendChild(pre);
}

/**
 * Renders every pending mermaid placeholder inside `root` (second, async
 * pass after renderMarkdown inserted the placeholders). Resolves always;
 * failures degrade placeholders to raw source + error badge.
 */
export async function renderMermaidDiagrams(root: HTMLElement): Promise<void> {
  const placeholders = Array.from(
    root.querySelectorAll<HTMLElement>(
      `.markdown-mermaid[data-testid="markdown-mermaid-pending"]`,
    ),
  ).filter((element) => !claimed.has(element));
  if (placeholders.length === 0) return;
  for (const element of placeholders) claimed.add(element);

  let api: MermaidApi;
  try {
    api = await getMermaid();
  } catch (error) {
    for (const container of placeholders) setFallback(container, error);
    return;
  }

  for (const container of placeholders) {
    try {
      const code = decodeBase64(container.getAttribute('data-code') ?? '');
      const { svg } = await api.render(`markdown-mermaid-${++renderIdCounter}`, code);
      const cleanSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      container.innerHTML = cleanSvg;
      container.dataset.testid = 'markdown-mermaid-svg';
    } catch (error) {
      setFallback(container, error);
    }
  }
}
