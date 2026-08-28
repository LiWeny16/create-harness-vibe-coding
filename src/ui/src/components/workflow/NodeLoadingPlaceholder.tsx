import { motion } from 'motion/react';
import type { CSSProperties } from 'react';

export interface NodeLoadingPlaceholderProps {
  /** Node kind label, e.g. 'markdown' | 'agent' | 'skill-group'. */
  kind: string;
  /** Node shell width in px. */
  width: number;
  /** Node shell height in px. */
  height: number;
  /** Optional title; defaults to kind. */
  label?: string;
}

const ENTER_SPRING = { type: 'spring', duration: 0.3, bounce: 0 } as const;

/**
 * Plain same-size node shell shown while a workflow node initializes.
 * Reuses the thinking-orb pulse (.workflow-toast-orb + its keyframes).
 */
export default function NodeLoadingPlaceholder({
  kind,
  width,
  height,
  label = kind,
}: NodeLoadingPlaceholderProps) {
  const shellStyle: CSSProperties = { width, height };
  return (
    <motion.div
      className="workflow-node-loading"
      style={shellStyle}
      role="status"
      data-testid="workflow-node-loading-placeholder"
      data-kind={kind}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={ENTER_SPRING}
    >
      <span className="workflow-node-loading-orb workflow-toast-orb" aria-hidden="true" />
      <span className="workflow-node-loading-label">{label}</span>
      <span className="workflow-node-loading-sr">Loading {label}</span>
    </motion.div>
  );
}
