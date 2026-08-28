// ChatPanel.tsx — top-level "chat" presentation for an agent node. Renders in
// the same containers as EmbeddedWorkflowTerminal (node body + drawer) and is
// capability-identical: send/steer/interrupt, tool calls, permission
// approvals, user asks, history backfill, and a status pill following the
// wf-status-dot title-bar conventions.
import { useCallback } from 'react';
import { useT } from '../../i18n';
import { useChatStream } from '../../hooks/useChatStream';
import type { ChatPermissionResult } from '../../hooks/useChatStream';
import MessageList from './MessageList';
import Composer from './Composer';

type Props = {
  sessionId: string;
  live: boolean;
  canSendInput: boolean;
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

export default function ChatPanel({ sessionId, live, canSendInput }: Props) {
  const t = useT();
  const chat = useChatStream(sessionId);

  // Ask answers ride the normal chat:send channel with a structured prefix.
  const handleAnswer = useCallback((_requestId: string, messageText: string) => {
    chat.send(messageText);
  }, [chat.send]);

  const statusLabel = t(STATUS_LABEL_KEYS[chat.status] || chat.status);
  const dotColor = chat.status === 'connected'
    ? (chat.turnActive ? 'var(--success)' : 'var(--muted)')
    : 'var(--warn)';

  return (
    <div
      className="chat-panel"
      data-testid="chat-panel"
      data-chat-status={chat.status}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg)',
        color: 'var(--fg)',
      }}
    >
      <div
        className="wf-status-pill"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderBottom: '1px solid var(--border)',
          fontSize: 10,
          fontWeight: 800,
          color: 'var(--muted)',
          flexShrink: 0,
          background: 'rgba(255,255,255,0.96)',
        }}
      >
        <span className={chat.status === 'connected' ? 'wf-status-dot is-live' : 'wf-status-dot'} style={{ background: dotColor }} />
        <span data-testid="chat-connection-status">{statusLabel}</span>
        {chat.turnActive && (
          <span data-testid="chat-turn-active" style={{ color: WORKFLOW_GREEN_DARK }}>
            {t('Agent working…')}
          </span>
        )}
        {!live && (
          <span style={{ marginLeft: 'auto', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t('session stopped')}
          </span>
        )}
        {chat.error && (
          <span data-testid="chat-stream-error" style={{ marginLeft: 'auto', color: 'var(--danger)' }} title={chat.error}>
            {t('error:')}
          </span>
        )}
      </div>
      <MessageList
        messages={chat.messages}
        tools={chat.tools}
        toolOrder={chat.toolOrder}
        pendingPermissions={chat.pendingPermissionList}
        asks={chat.asks}
        onApprove={chat.approve}
        onAnswer={handleAnswer}
        scrollAnchor={chat.scrollAnchor}
      />
      <Composer
        canSendInput={canSendInput && live}
        turnActive={chat.turnActive}
        onSend={chat.send}
        onSteer={chat.steer}
        onInterrupt={chat.interrupt}
      />
    </div>
  );
}

const WORKFLOW_GREEN_DARK = '#166534';
