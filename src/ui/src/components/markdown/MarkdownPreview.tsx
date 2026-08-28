// MarkdownPreview.tsx — shared markdown preview component (W2-W5 consumers).
//
// Renders `markdown` through the shared pipeline (renderMarkdown + mermaid
// async pass). The container is always a div; `className` is merged onto the
// `markdown-preview` base class, `containerTestId` lands on the container
// element for e2e targeting.
import { useEffect, useRef } from 'react';
import { renderMarkdown } from './renderMarkdown';
import { renderMermaidDiagrams } from './mermaidLoader';
import './styles.css';

export type MarkdownPreviewProps = {
  markdown: string;
  className?: string;
  containerTestId?: string;
};

export function MarkdownPreview({ markdown, className, containerTestId }: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = renderMarkdown(markdown);
    // renderMermaidDiagrams never rejects; failures degrade in place.
    void renderMermaidDiagrams(container);
  }, [markdown]);

  return (
    <div
      ref={containerRef}
      className={className ? `markdown-preview ${className}` : 'markdown-preview'}
      data-testid={containerTestId}
    />
  );
}
