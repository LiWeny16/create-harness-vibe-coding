import { motion } from 'motion/react';

type Props = {
  connState: string;
  eventSeq: number;
  lastSync: string | null;
  lastError: string | null;
};

export default function Footer({ connState, eventSeq, lastSync, lastError }: Props) {
  const statusColor =
    connState === 'connected' ? 'var(--success)' :
    connState === 'degraded' || connState === 'reconnecting' ? 'var(--warn)' :
    'var(--danger)';

  return (
    <footer
      data-testid="footer"
      style={{
        height: 'var(--footer-h)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        fontSize: 10,
        color: 'var(--muted)',
        gap: 16,
        flexShrink: 0,
      }}
    >
      {/* Connection state */}
      <span data-testid="footer-connection" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: statusColor,
            display: 'inline-block',
          }}
        />
        <span>{connState || 'disconnected'}</span>
      </span>

      {/* Event seq */}
      <span data-testid="footer-event-seq">seq:{eventSeq}</span>

      {/* Last sync */}
      <span data-testid="footer-last-sync">
        {lastSync ? `last sync:${lastSync}` : 'no sync'}
      </span>

      {/* Last error */}
      {lastError && (
        <span data-testid="footer-last-error" style={{ color: 'var(--danger)' }}>
          error:{lastError}
        </span>
      )}

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* Brand */}
      <span data-testid="footer-brand">@bigonion</span>
      <span data-testid="footer-license">MIT</span>
    </footer>
  );
}
