// renderMarkdown.ts — shared markdown rendering pipeline for wf-ui.
//
// markdown-it 14 (html:false => raw HTML is escaped, linkify + typographer on)
// + markdown-it-task-lists (GFM task lists) + markdown-it-katex (KaTeX math)
// + DOMPurify output sanitization. KaTeX CSS is imported once here so every
// consumer of the shared pipeline gets math styling.
//
// mermaid fences are rendered as a placeholder container by a custom fence
// rule: markdown-it render() is synchronous, so the diagram itself is drawn
// in a second, async pass by renderMermaidDiagrams() (mermaidLoader.ts).
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
// @ts-expect-error markdown-it-katex ships no type declarations
import markdownItKatex from 'markdown-it-katex';
// @ts-expect-error markdown-it-task-lists ships no type declarations
import taskLists from 'markdown-it-task-lists';
import 'katex/dist/katex.min.css';

export const MERMAID_PLACEHOLDER_CLASS = 'markdown-mermaid';
export const MERMAID_PENDING_TESTID = 'markdown-mermaid-pending';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});
md.use(taskLists);
md.use(markdownItKatex, { throwOnError: false });

const defaultFence = md.renderer.rules.fence;

// mermaid code blocks become a placeholder the async loader can find; every
// other fence keeps markdown-it's default <pre><code> rendering.
md.renderer.rules.fence = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  if (token?.info?.trim().toLowerCase() === 'mermaid') {
    return (
      `<div class="${MERMAID_PLACEHOLDER_CLASS}" ` +
      `data-testid="${MERMAID_PENDING_TESTID}" ` +
      `data-code="${encodeBase64(token.content)}">加载占位…</div>`
    );
  }
  return defaultFence ? defaultFence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
};

// Unicode-safe base64 (btoa alone chokes on non-Latin1 diagram source).
function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(md.render(source));
}
