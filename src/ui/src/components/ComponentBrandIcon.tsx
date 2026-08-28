import type { CSSProperties } from 'react';
import { File as FileIcon, FileText as FileTextIcon } from 'lucide-react';
import type { WorkflowComponentType } from '../types';
import excalidrawIconUrl from '../assets/icons/excalidraw-default.svg';
import markdownIconUrl from '../assets/icons/markdown-light.svg';

type Props = {
  type: WorkflowComponentType;
  size?: number;
};

const iconSrc: Partial<Record<WorkflowComponentType, string>> = {
  excalidraw: excalidrawIconUrl,
  markdown: markdownIconUrl,
};

export default function ComponentBrandIcon({ type, size = 15 }: Props) {
  if (type === 'file') return <FileIcon size={size} />;
  if (type === 'display') return <FileTextIcon size={size} />;

  return (
    <span
      className={`workflow-component-brand-icon workflow-component-brand-icon-${type}`}
      style={{ '--workflow-component-icon-size': `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <img src={iconSrc[type]} alt="" draggable={false} />
    </span>
  );
}
