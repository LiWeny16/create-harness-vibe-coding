// Composer.tsx — chat input for the chat panel. Textarea autosizes (capped),
// Enter sends / Shift+Enter inserts a newline (IME-composition safe). While a
// turn is active the send action becomes 插入(steer) routing through
// chat:steer, and an interrupt button is shown.
import { useCallback, useEffect, useRef, useState } from 'react';
import { SendHorizonal, Square } from 'lucide-react';
import { useT } from '../../i18n';

type Props = {
  canSendInput: boolean;
  turnActive: boolean;
  onSend: (text: string) => void;
  onSteer: (text: string) => void;
  onInterrupt: () => void;
};

const MAX_ROWS = 6;

export default function Composer({ canSendInput, turnActive, onSend, onSteer, onInterrupt }: Props) {
  const t = useT();
  const [value, setValue] = useState('');
  const [composing, setComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autosize up to MAX_ROWS; reset height first so shrink works too.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    const lineHeight = 18;
    const maxHeight = lineHeight * MAX_ROWS + 12;
    node.style.height = `${Math.min(node.scrollHeight, maxHeight)}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [value]);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || !canSendInput) return;
    if (turnActive) onSteer(trimmed);
    else onSend(trimmed);
    setValue('');
  }, [canSendInput, onSend, onSteer, turnActive, value]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // Do not swallow Enter while an IME composition is in flight (zh input).
    if (composing || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <div
      className="chat-composer"
      data-testid="chat-composer"
      style={{
        borderTop: '1px solid var(--border)',
        padding: '7px 9px',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto auto',
        gap: 7,
        alignItems: 'end',
        background: 'rgba(255,255,255,0.96)',
        flexShrink: 0,
      }}
    >
      <textarea
        ref={textareaRef}
        data-testid="chat-input"
        value={value}
        onChange={event => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        rows={1}
        disabled={!canSendInput}
        placeholder={turnActive ? t('Insert into running turn (steer)') : t('Message the agent…')}
        style={{
          resize: 'none',
          minHeight: 30,
          maxHeight: 120,
          padding: '6px 8px',
          fontSize: 12,
          lineHeight: '18px',
          fontFamily: 'inherit',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          outline: 'none',
          minWidth: 0,
        }}
      />
      {turnActive && (
        <button
          type="button"
          data-testid="chat-interrupt"
          title={t('Interrupt')}
          onClick={onInterrupt}
          disabled={!canSendInput}
          style={{
            width: 30,
            height: 30,
            display: 'grid',
            placeItems: 'center',
            border: '1px solid #fecaca',
            borderRadius: 'var(--radius)',
            color: '#991b1b',
            background: '#fff',
          }}
        >
          <Square size={11} />
        </button>
      )}
      <button
        type="button"
        data-testid="chat-send"
        onClick={submit}
        disabled={!value.trim() || !canSendInput}
        style={{
          height: 30,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '0 10px',
          border: '1px solid #86efac',
          borderRadius: 'var(--radius)',
          color: WORKFLOW_SEND_COLOR,
          background: '#fff',
          fontSize: 11,
          fontWeight: 800,
        }}
      >
        <SendHorizonal size={11} />
        {turnActive ? t('Steer') : t('Send')}
      </button>
    </div>
  );
}

const WORKFLOW_SEND_COLOR = '#166534';
