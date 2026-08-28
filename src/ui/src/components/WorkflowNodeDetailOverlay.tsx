// WorkflowNodeDetailOverlay.tsx
//
// ONE shared fullscreen container for all non-agent node detail views
// (timer / goal / file / display / …). Unified design language:
//   - enter: fade + translateY(12px) + scale(0.985), spring 0.3s bounce 0
//   - exit:  softer (translateY(8px), ease-out) — exits softer than enters
//   - backdrop click + Esc close, 40×40 close hit area
//   - concentric radii (shell 12px, inner content 8px), layered shadow
// Consumers mount their own body content; this component owns the chrome.

import { useEffect, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
  dataNodeId?: string;
  maxWidth?: number;
};

export default function WorkflowNodeDetailOverlay({
  open,
  onClose,
  title,
  icon,
  actions,
  footer,
  children,
  className = '',
  testId,
  dataNodeId,
  maxWidth,
}: Props) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <motion.div
      data-canvas-control="true"
      data-testid={testId}
      {...(dataNodeId ? { 'data-node-id': dataNodeId } : {})}
      className="workflow-runtime-expanded-backdrop nodrag nopan nowheel"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.section
        className={`workflow-runtime-expanded-shell ${className}`.trim()}
        style={maxWidth ? { maxWidth } : undefined}
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.99 }}
        transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
      >
        <header className="workflow-runtime-expanded-header">
          <div className="workflow-runtime-expanded-title">
            {icon ? <span className="workflow-runtime-expanded-icon">{icon}</span> : null}
            {title}
          </div>
          <div className="workflow-runtime-expanded-actions">
            {actions}
            <button type="button" data-testid="workflow-runtime-expanded-close" onClick={onClose} title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="workflow-runtime-expanded-body">{children}</div>
        {footer ? <footer className="workflow-runtime-expanded-footer">{footer}</footer> : null}
      </motion.section>
    </motion.div>
  );
}
