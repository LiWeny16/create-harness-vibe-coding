import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { motion } from 'motion/react';

type FloatingLayer = 'panel' | 'menu' | 'settings' | 'fullscreen';

type Props = {
  dataTestId?: string;
  'data-testid'?: string;
  className?: string;
  layer?: FloatingLayer;
  nodeId?: string;
  nodeKind?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  bodyClassName?: string;
  bare?: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
};

const layerZIndex: Record<FloatingLayer, string> = {
  panel: 'var(--wf-z-panel)',
  menu: 'var(--wf-z-menu)',
  settings: 'var(--wf-z-settings)',
  fullscreen: 'var(--wf-z-fullscreen)',
};

export default function WorkflowFloatingPanel({
  dataTestId,
  'data-testid': dataTestIdAttr,
  className = '',
  layer = 'panel',
  nodeId,
  nodeKind,
  title,
  subtitle,
  icon,
  actions,
  footer,
  children,
  style,
  bodyClassName = '',
  bare = false,
  onPointerDown,
}: Props) {
  const hasHeader = Boolean(title || subtitle || icon || actions);
  const resolvedDataTestId = dataTestIdAttr || dataTestId;
  const panelStyle: CSSProperties = {
    ...style,
    zIndex: style?.zIndex ?? layerZIndex[layer],
  };

  return (
    <motion.aside
      data-canvas-control="true"
      data-testid={resolvedDataTestId}
      data-node-id={nodeId}
      data-node-kind={nodeKind}
      data-floating-layer={layer}
      className={`workflow-floating-panel wf-floating-panel nodrag nopan nowheel ${className}`.trim()}
      style={panelStyle}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      onPointerDown={event => {
        event.stopPropagation();
        onPointerDown?.(event);
      }}
      onMouseDown={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
    >
      {hasHeader && (
        <div className="workflow-floating-panel-header">
          <div className="workflow-floating-panel-title">
            {icon && <span className="workflow-floating-panel-title-icon">{icon}</span>}
            <div>
              {title && <strong>{title}</strong>}
              {subtitle && <span>{subtitle}</span>}
            </div>
          </div>
          {actions && <div className="workflow-floating-panel-actions">{actions}</div>}
        </div>
      )}
      {bare ? children : (
        <div className={`workflow-floating-panel-body ${bodyClassName}`.trim()}>
          {children}
        </div>
      )}
      {footer && <div className="workflow-floating-panel-footer">{footer}</div>}
    </motion.aside>
  );
}
