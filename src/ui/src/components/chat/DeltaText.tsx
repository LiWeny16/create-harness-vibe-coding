// DeltaText.tsx — memoized markdown render of an accumulated chat buffer.
// Uses the shared markdown-it + DOMPurify pipeline (renderMarkdown) so chat
// output matches the markdown node rendering exactly (html escaped, linkify,
// KaTeX, task lists). Thinking deltas render collapsed inside <details>.
import { memo, useMemo } from 'react';
import { BrainCircuit } from 'lucide-react';
import { renderMarkdown } from '../markdown/renderMarkdown';
import { useT } from '../../i18n';

type Props = {
  text: string;
  thinking?: string;
};

function DeltaTextInner({ text, thinking }: Props) {
  const t = useT();
  const html = useMemo(() => (text ? renderMarkdown(text) : ''), [text]);
  return (
    <div className="chat-delta-text" data-testid="chat-delta-text">
      {thinking ? (
        <details className="chat-thinking" data-testid="chat-thinking">
          <summary>
            <BrainCircuit size={11} /> {t('Thinking')}
          </summary>
          <div className="markdown-body chat-thinking-body">{thinking}</div>
        </details>
      ) : null}
      {text ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} /> : null}
    </div>
  );
}

const DeltaText = memo(DeltaTextInner);
export default DeltaText;
