// ApprovalCard.tsx — permission_request presentation. Three actions
// 允许一次/总是允许/拒绝 map to approve(requestId, 'allow'|'always'|'deny');
// buttons disable after the first click so a slow server round-trip can never
// double-submit (the hook also removes the request optimistically).
import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useT } from '../../i18n';
import type { ChatPermissionRequest, ChatPermissionResult } from '../../hooks/useChatStream';

type Props = {
  request: ChatPermissionRequest;
  onApprove: (requestId: string, result: ChatPermissionResult) => void;
};

function summarizeInput(input: unknown, max = 160): string {
  if (input === undefined || input === null) return '';
  let text: string;
  if (typeof input === 'string') text = input;
  else {
    try {
      text = JSON.stringify(input);
    } catch {
      text = String(input);
    }
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function ApprovalCard({ request, onApprove }: Props) {
  const t = useT();
  const [resolved, setResolved] = useState<ChatPermissionResult | null>(null);
  const disabled = resolved !== null;
  const summary = summarizeInput(request.input);

  const act = (result: ChatPermissionResult) => () => {
    if (resolved) return;
    setResolved(result);
    onApprove(request.requestId, result);
  };

  return (
    <div
      className="chat-approval-card"
      data-testid="chat-approval-card"
      data-request-id={request.requestId}
      style={{
        border: '1px solid #fde68a',
        borderRadius: 'var(--radius)',
        background: '#fffbeb',
        padding: '7px 9px',
        display: 'grid',
        gap: 6,
        fontSize: 12,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 800, color: '#92400e' }}>
        <ShieldAlert size={12} />
        <span>{t('Permission required')}</span>
        <span style={{ fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize: 11 }}>{request.tool}</span>
      </div>
      {summary && (
        <pre
          data-testid="chat-approval-input"
          style={{
            margin: 0,
            fontFamily: '"Cascadia Mono", Consolas, monospace',
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: 'var(--fg)',
          }}
        >
          {summary}
        </pre>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
        <button
          type="button"
          data-testid="chat-approval-allow"
          onClick={act('allow')}
          disabled={disabled}
          style={{
            minHeight: 26,
            border: '1px solid #86efac',
            borderRadius: 'var(--radius)',
            background: resolved === 'allow' ? '#dcfce7' : '#fff',
            color: '#166534',
            fontSize: 11,
            fontWeight: 800,
            opacity: disabled ? 0.55 : 1,
          }}
        >
          {t('Allow once')}
        </button>
        <button
          type="button"
          data-testid="chat-approval-always"
          onClick={act('always')}
          disabled={disabled}
          style={{
            minHeight: 26,
            border: '1px solid #86efac',
            borderRadius: 'var(--radius)',
            background: resolved === 'always' ? '#dcfce7' : '#fff',
            color: '#166534',
            fontSize: 11,
            fontWeight: 800,
            opacity: disabled ? 0.55 : 1,
          }}
        >
          {t('Always allow')}
        </button>
        <button
          type="button"
          data-testid="chat-approval-deny"
          onClick={act('deny')}
          disabled={disabled}
          style={{
            minHeight: 26,
            border: '1px solid #fecaca',
            borderRadius: 'var(--radius)',
            background: resolved === 'deny' ? '#fee2e2' : '#fff',
            color: '#991b1b',
            fontSize: 11,
            fontWeight: 800,
            opacity: disabled ? 0.55 : 1,
          }}
        >
          {resolved === 'deny' ? t('Denied') : t('Deny')}
        </button>
      </div>
    </div>
  );
}
