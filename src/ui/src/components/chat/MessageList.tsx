// MessageList.tsx — transcript timeline for the chat panel. Merges messages,
// tool cards, permission approvals and agent asks into one seq-ordered stream,
// with stick-to-bottom behavior (>48px scroll-up threshold releases the pin
// and shows a "↓" jump pill).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown } from 'lucide-react';
import { useT } from '../../i18n';
import type {
  ChatAskRequest,
  ChatMessage,
  ChatPermissionRequest,
  ChatTool,
} from '../../hooks/useChatStream';
import type { ChatPermissionResult } from '../../hooks/useChatStream';
import DeltaText from './DeltaText';
import ToolCard from './ToolCard';
import ApprovalCard from './ApprovalCard';
import AskUserCard from './AskUserCard';

type TimelineItem =
  | { kind: 'message'; seq: number; key: string; message: ChatMessage }
  | { kind: 'tool'; seq: number; key: string; tool: ChatTool }
  | { kind: 'approval'; seq: number; key: string; request: ChatPermissionRequest };

type Props = {
  messages: ChatMessage[];
  tools: Record<string, ChatTool>;
  toolOrder: string[];
  pendingPermissions: ChatPermissionRequest[];
  asks: ChatAskRequest[];
  onApprove: (requestId: string, result: ChatPermissionResult) => void;
  onAnswer: (requestId: string, messageText: string) => void;
  scrollAnchor: number;
};

const STICK_THRESHOLD_PX = 48;

function userBubbleStyle(pending: boolean): CSSProperties {
  return {
    justifySelf: 'end',
    maxWidth: '86%',
    background: pending ? 'rgba(220,252,231,0.55)' : '#dcfce7',
    border: '1px solid #bbf7d0',
    borderRadius: 'var(--radius)',
    padding: '5px 9px',
    fontSize: 12,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    opacity: pending ? 0.75 : 1,
  };
}

const assistantBlockStyle: CSSProperties = {
  justifySelf: 'start',
  maxWidth: '94%',
  minWidth: 0,
  display: 'grid',
  gap: 6,
  fontSize: 12,
};

export default function MessageList({
  messages,
  tools,
  toolOrder,
  pendingPermissions,
  asks,
  onApprove,
  onAnswer,
  scrollAnchor,
}: Props) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJumpPill, setShowJumpPill] = useState(false);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    for (const message of messages) {
      items.push({ kind: 'message', seq: message.seq, key: message.id, message });
    }
    for (const callId of toolOrder) {
      const tool = tools[callId];
      if (tool) items.push({ kind: 'tool', seq: tool.seq, key: `tool-${callId}`, tool });
    }
    for (const request of pendingPermissions) {
      items.push({ kind: 'approval', seq: request.seq, key: `perm-${request.requestId}`, request });
    }
    return items.sort((a, b) => a.seq - b.seq || a.key.localeCompare(b.key));
  }, [messages, pendingPermissions, toolOrder, tools]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    const stuck = distance <= STICK_THRESHOLD_PX;
    stickRef.current = stuck;
    setShowJumpPill(!stuck);
  }, []);

  // Follow the tail only while pinned; new content while scrolled up raises
  // the jump pill instead of yanking the viewport.
  useEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [scrollAnchor, scrollToBottom]);

  const jumpToLatest = () => {
    stickRef.current = true;
    setShowJumpPill(false);
    scrollToBottom('smooth');
  };

  return (
    <div style={{ position: 'relative', minHeight: 0, flex: 1 }}>
      <div
        ref={containerRef}
        className="chat-message-list"
        data-testid="chat-message-list"
        onScroll={handleScroll}
        style={{
          position: 'absolute',
          inset: 0,
          overflowY: 'auto',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
        }}
      >
        {timeline.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'center', marginTop: 14 }}>
            {t('No messages yet')}
          </div>
        )}
        {timeline.map(item => {
          if (item.kind === 'message') {
            const { message } = item;
            if (message.role === 'user') {
              return (
                <div key={item.key} data-testid="chat-user-message" style={userBubbleStyle(Boolean(message.pending))}>
                  {message.text}
                </div>
              );
            }
            if (message.role === 'system') {
              return (
                <div
                  key={item.key}
                  data-testid="chat-system-message"
                  style={{ color: 'var(--danger)', fontSize: 11, textAlign: 'center' }}
                >
                  {message.text}
                </div>
              );
            }
            const hasBody = message.text.length > 0 || message.thinking.length > 0;
            return (
              <div key={item.key} data-testid="chat-assistant-message" style={assistantBlockStyle}>
                {hasBody ? (
                  <DeltaText text={message.text} thinking={message.thinking} />
                ) : item === timeline[timeline.length - 1] ? (
                  <span className="chat-typing" aria-label="typing">…</span>
                ) : null}
              </div>
            );
          }
          if (item.kind === 'tool') {
            return (
              <div key={item.key} style={{ justifySelf: 'stretch', minWidth: 0 }}>
                <ToolCard tool={item.tool} />
              </div>
            );
          }
          return (
            <div key={item.key} style={{ justifySelf: 'stretch', minWidth: 0 }}>
              <ApprovalCard request={item.request} onApprove={onApprove} />
            </div>
          );
        })}
        {asks.map(request => (
          <div key={`ask-${request.requestId}`} style={{ justifySelf: 'stretch', minWidth: 0 }}>
            <AskUserCard request={request} onAnswer={onAnswer} />
          </div>
        ))}
      </div>
      {showJumpPill && (
        <button
          type="button"
          data-testid="chat-jump-latest"
          onClick={jumpToLatest}
          title={t('Jump to latest')}
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            border: '1px solid var(--border)',
            borderRadius: 999,
            background: '#fff',
            color: 'var(--fg)',
            fontSize: 11,
            fontWeight: 800,
            boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
            zIndex: 2,
          }}
        >
          <ArrowDown size={11} /> {t('Jump to latest')}
        </button>
      )}
    </div>
  );
}
