import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, PanelLeftClose, PanelLeftOpen, Pin, PinOff, Plus, X } from 'lucide-react';
import { apiFetch, apiJson } from '../api';
import { useT } from '../i18n/index';

export type WorkspaceTreeEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory' | string;
  size?: number;
  hasChildren?: boolean;
};

type TreeResponse = {
  root?: string;
  path?: string;
  entries?: WorkspaceTreeEntry[];
};

type Props = {
  root?: string;
  onInsertFile?: (entry: WorkspaceTreeEntry) => void | Promise<void>;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
};

type TextPreviewResponse = {
  text?: string;
  bytesRead?: number;
  truncated?: boolean;
  encoding?: string;
};

type ContextMenuState = {
  path: string;
  x: number;
  y: number;
};

type ExplorerActivation = {
  entry: WorkspaceTreeEntry;
  startX: number;
  startY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  cancelled: boolean;
};

const rootKey = '';
const contextMenuWidth = 180;
const contextMenuHeight = 160;
const viewportMargin = 8;
const clickMoveThreshold = 6;

function normalizedPath(value: string | undefined | null) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function parentPath(path: string) {
  const normalized = normalizedPath(path);
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? rootKey : normalized.slice(0, index);
}

function depthOf(path: string) {
  const normalized = normalizedPath(path);
  return normalized ? normalized.split('/').length - 1 : 0;
}

function filePreviewPath(path: string) {
  return `/api/workspace/file?path=${encodeURIComponent(path)}`;
}

function textPreviewPath(path: string) {
  return `/api/workspace/text?path=${encodeURIComponent(path)}&offset=0&limit=8192`;
}

function mimeHint(path: string) {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  if (ext === 'pdf') return 'application/pdf';
  if (['mp4', 'webm', 'mov'].includes(ext)) return `video/${ext === 'mov' ? 'quicktime' : ext}`;
  if (['txt', 'md', 'markdown', 'csv', 'yaml', 'yml', 'log'].includes(ext)) return 'text/plain';
  if (ext === 'json') return 'application/json';
  if (['xls', 'xlsx'].includes(ext)) return 'spreadsheet';
  return 'file';
}

function formatSize(size: unknown) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function isTextPreviewMime(mime: string) {
  return mime.startsWith('text/') || ['application/json', 'application/xml'].includes(mime);
}

function clampContextMenuPoint(clientX: number, clientY: number) {
  const viewportWidth = window.innerWidth || contextMenuWidth;
  const viewportHeight = window.innerHeight || contextMenuHeight;
  const maxX = Math.max(viewportMargin, viewportWidth - contextMenuWidth - viewportMargin);
  const maxY = Math.max(viewportMargin, viewportHeight - contextMenuHeight - viewportMargin);
  return {
    x: Math.min(Math.max(viewportMargin, clientX), maxX),
    y: Math.min(Math.max(viewportMargin, clientY), maxY),
  };
}

function stopExplorerGesture(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function stopExplorerDrop(event: DragEvent<HTMLElement>) {
  event.preventDefault();
  stopExplorerGesture(event);
}

export default function WorkspaceExplorerPanel({ root, onInsertFile, onGestureStart, onGestureEnd }: Props) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [floating, setFloating] = useState(false);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, WorkspaceTreeEntry[]>>({});
  const [loadingByPath, setLoadingByPath] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [previewEntry, setPreviewEntry] = useState<WorkspaceTreeEntry | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState('');
  const [previewObjectError, setPreviewObjectError] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState('');
  const explorerShellRef = useRef<HTMLElement | null>(null);
  const explorerGestureActive = useRef(false);
  const entriesByPathRef = useRef<Map<string, WorkspaceTreeEntry>>(new Map());
  const pendingActivationRef = useRef<ExplorerActivation | null>(null);
  const suppressNextClickRef = useRef(false);
  const suppressNextClickTimerRef = useRef<number | null>(null);
  const activateEntryRef = useRef<(entry: WorkspaceTreeEntry, modifiers?: { ctrlKey?: boolean; metaKey?: boolean }) => void>(() => {});
  const previewPath = previewEntry && previewEntry.type !== 'directory' ? normalizedPath(previewEntry.path) : '';
  const previewMime = previewPath ? mimeHint(previewPath) : '';
  const previewIsImage = previewMime.startsWith('image/');
  const previewIsVideo = previewMime.startsWith('video/');
  const previewIsPdf = previewMime === 'application/pdf';
  const previewIsText = isTextPreviewMime(previewMime);
  const previewIsNative = previewIsImage || previewIsVideo || previewIsPdf;

  const isExplorerSurfaceTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Node)) return false;
    if (explorerShellRef.current?.contains(target)) return true;
    const element = target instanceof Element ? target : target.parentElement;
    return Boolean(element?.closest('[data-testid="workspace-context-menu"]'));
  }, []);

  const getEntryFromTarget = useCallback((target: EventTarget | null) => {
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    const row = element?.closest<HTMLElement>('[data-testid="workspace-tree-item"][data-path]');
    const path = normalizedPath(row?.dataset.path);
    return path ? entriesByPathRef.current.get(path) || null : null;
  }, []);

  const clearSuppressNextClickSoon = useCallback(() => {
    if (suppressNextClickTimerRef.current !== null) {
      window.clearTimeout(suppressNextClickTimerRef.current);
    }
    suppressNextClickTimerRef.current = window.setTimeout(() => {
      suppressNextClickRef.current = false;
      suppressNextClickTimerRef.current = null;
    }, 350);
  }, []);

  const beginPendingActivation = useCallback((event: Event) => {
    const mouseEvent = event as globalThis.MouseEvent;
    if (mouseEvent.button !== 0 || pendingActivationRef.current) return;
    const target = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
    if (target?.closest('input, textarea, select, button')) return;
    const entry = getEntryFromTarget(event.target);
    if (!entry || renamingPath === entry.path) return;
    pendingActivationRef.current = {
      entry,
      startX: Number(mouseEvent.clientX) || 0,
      startY: Number(mouseEvent.clientY) || 0,
      ctrlKey: Boolean(mouseEvent.ctrlKey),
      metaKey: Boolean(mouseEvent.metaKey),
      cancelled: false,
    };
  }, [getEntryFromTarget, renamingPath]);

  const cancelPendingActivation = useCallback(() => {
    if (pendingActivationRef.current) pendingActivationRef.current.cancelled = true;
  }, []);

  const finishPendingActivation = useCallback((event: Event) => {
    const pending = pendingActivationRef.current;
    if (!pending) return;
    const mouseEvent = event as globalThis.MouseEvent;
    const moved = Math.abs((Number(mouseEvent.clientX) || 0) - pending.startX) > clickMoveThreshold
      || Math.abs((Number(mouseEvent.clientY) || 0) - pending.startY) > clickMoveThreshold;
    pendingActivationRef.current = null;
    if (pending.cancelled || moved) {
      suppressNextClickRef.current = true;
      clearSuppressNextClickSoon();
      return;
    }
    activateEntryRef.current(pending.entry, { ctrlKey: pending.ctrlKey, metaKey: pending.metaKey });
    suppressNextClickRef.current = true;
    clearSuppressNextClickSoon();
  }, [clearSuppressNextClickSoon]);

  const captureExplorerPointer = useCallback((event: PointerEvent<HTMLElement>) => {
    explorerGestureActive.current = true;
    onGestureStart?.();
    beginPendingActivation(event.nativeEvent);
    if (!getEntryFromTarget(event.target)) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best effort; propagation guards still isolate the Explorer.
      }
    }
    stopExplorerGesture(event);
  }, [beginPendingActivation, getEntryFromTarget, onGestureStart]);

  const releaseExplorerPointer = useCallback((event: PointerEvent<HTMLElement>) => {
    finishPendingActivation(event.nativeEvent);
    explorerGestureActive.current = false;
    onGestureEnd?.();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may already have released capture after click/drag end.
    }
    stopExplorerGesture(event);
  }, [finishPendingActivation, onGestureEnd]);

  const captureExplorerMouse = useCallback((event: MouseEvent<HTMLElement>) => {
    explorerGestureActive.current = true;
    onGestureStart?.();
    beginPendingActivation(event.nativeEvent);
    stopExplorerGesture(event);
  }, [beginPendingActivation, onGestureStart]);

  const releaseExplorerMouse = useCallback((event: MouseEvent<HTMLElement>) => {
    finishPendingActivation(event.nativeEvent);
    explorerGestureActive.current = false;
    onGestureEnd?.();
    stopExplorerGesture(event);
  }, [finishPendingActivation, onGestureEnd]);

  useEffect(() => {
    const startExplorerGesture = (event: Event) => {
      if (!isExplorerSurfaceTarget(event.target)) return;
      if (event.type === 'pointerdown' || (event.type === 'mousedown' && !pendingActivationRef.current)) {
        beginPendingActivation(event);
      }
      explorerGestureActive.current = true;
      onGestureStart?.();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    const stopActiveExplorerGesture = (event: Event) => {
      if (!explorerGestureActive.current) return;
      if (event.type === 'pointermove' || event.type === 'mousemove') {
        const pending = pendingActivationRef.current;
        const mouseEvent = event as globalThis.MouseEvent;
        if (pending && (
          Math.abs((Number(mouseEvent.clientX) || 0) - pending.startX) > clickMoveThreshold
          || Math.abs((Number(mouseEvent.clientY) || 0) - pending.startY) > clickMoveThreshold
        )) {
          pending.cancelled = true;
        }
      }
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };
    const finishActiveExplorerGesture = (event: Event) => {
      if (event.type === 'pointerup' || (event.type === 'mouseup' && pendingActivationRef.current)) {
        finishPendingActivation(event);
      } else if (event.type === 'dragend' || event.type === 'drop') {
        cancelPendingActivation();
      }
      stopActiveExplorerGesture(event);
      explorerGestureActive.current = false;
      onGestureEnd?.();
    };
    window.addEventListener('pointerdown', startExplorerGesture, true);
    window.addEventListener('mousedown', startExplorerGesture, true);
    window.addEventListener('touchstart', startExplorerGesture, true);
    window.addEventListener('pointermove', stopActiveExplorerGesture, true);
    window.addEventListener('mousemove', stopActiveExplorerGesture, true);
    window.addEventListener('pointerup', finishActiveExplorerGesture, true);
    window.addEventListener('mouseup', finishActiveExplorerGesture, true);
    window.addEventListener('dragend', finishActiveExplorerGesture, true);
    window.addEventListener('drop', finishActiveExplorerGesture, true);
    return () => {
      window.removeEventListener('pointerdown', startExplorerGesture, true);
      window.removeEventListener('mousedown', startExplorerGesture, true);
      window.removeEventListener('touchstart', startExplorerGesture, true);
      window.removeEventListener('pointermove', stopActiveExplorerGesture, true);
      window.removeEventListener('mousemove', stopActiveExplorerGesture, true);
      window.removeEventListener('pointerup', finishActiveExplorerGesture, true);
      window.removeEventListener('mouseup', finishActiveExplorerGesture, true);
      window.removeEventListener('dragend', finishActiveExplorerGesture, true);
      window.removeEventListener('drop', finishActiveExplorerGesture, true);
    };
  }, [beginPendingActivation, cancelPendingActivation, finishPendingActivation, isExplorerSurfaceTarget, onGestureEnd, onGestureStart]);

  useEffect(() => () => {
    if (suppressNextClickTimerRef.current !== null) {
      window.clearTimeout(suppressNextClickTimerRef.current);
    }
  }, []);

  const loadPath = useCallback(async (path: string) => {
    const relPath = normalizedPath(path);
    if (childrenByPath[relPath] || loadingByPath.has(relPath)) return;
    setLoadingByPath(current => new Set(current).add(relPath));
    try {
      const data = await apiJson<TreeResponse>(`/api/workspace/tree?path=${encodeURIComponent(relPath)}`);
      setChildrenByPath(current => ({
        ...current,
        [relPath]: (data.entries || []).map(entry => ({
          ...entry,
          path: normalizedPath(entry.path),
        })),
      }));
    } finally {
      setLoadingByPath(current => {
        const next = new Set(current);
        next.delete(relPath);
        return next;
      });
    }
  }, [childrenByPath, loadingByPath]);

  useEffect(() => {
    loadPath(rootKey).catch(() => {
      setChildrenByPath(current => current[rootKey] ? current : { ...current, [rootKey]: [] });
    });
  }, [loadPath]);

  const visibleEntries = useMemo(() => {
    const rows: WorkspaceTreeEntry[] = [];
    const visit = (path: string) => {
      for (const entry of childrenByPath[path] || []) {
        rows.push(entry);
        if (entry.type === 'directory' && expanded.has(entry.path)) visit(entry.path);
      }
    };
    visit(rootKey);
    return rows;
  }, [childrenByPath, expanded]);

  useEffect(() => {
    entriesByPathRef.current = new Map(visibleEntries.map(entry => [entry.path, entry]));
  }, [visibleEntries]);

  useEffect(() => {
    let cancelled = false;
    setPreviewText('');
    setPreviewError('');
    if (!previewPath || !previewIsText) return;
    apiJson<TextPreviewResponse>(textPreviewPath(previewPath))
      .then(data => {
        if (!cancelled) setPreviewText(String(data.text || ''));
      })
      .catch(error => {
        if (!cancelled) setPreviewError(String(error?.message || 'preview failed'));
      });
    return () => {
      cancelled = true;
    };
  }, [previewIsText, previewPath]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setPreviewObjectUrl('');
    setPreviewObjectError('');
    if (!previewPath || !previewIsNative) return;
    apiFetch(filePreviewPath(previewPath), { headers: { Accept: previewMime || '*/*' } })
      .then(async response => {
        if (!response.ok) throw new Error(`${previewPath}: ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        const nextObjectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }
        objectUrl = nextObjectUrl;
        setPreviewObjectUrl(nextObjectUrl);
      })
      .catch(error => {
        if (!cancelled) setPreviewObjectError(String(error?.message || 'preview failed'));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewIsNative, previewMime, previewPath]);

  const toggleDirectory = useCallback((entry: WorkspaceTreeEntry, forceOpen?: boolean) => {
    if (entry.type !== 'directory') return;
    setExpanded(current => {
      const next = new Set(current);
      const shouldOpen = forceOpen ?? !next.has(entry.path);
      if (shouldOpen) next.add(entry.path);
      else next.delete(entry.path);
      return next;
    });
    loadPath(entry.path).catch(() => {});
  }, [loadPath]);

  const activateEntry = useCallback((entry: WorkspaceTreeEntry, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) => {
    setRenamingPath('');
    setContextMenu(null);
    setSelected(current => {
      if (modifiers.ctrlKey || modifiers.metaKey) {
        const next = new Set(current);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      }
      return new Set([entry.path]);
    });
    if (entry.type === 'directory') {
      setPreviewEntry(null);
      toggleDirectory(entry);
      return;
    }
    setPreviewEntry(entry);
  }, [toggleDirectory]);

  useEffect(() => {
    activateEntryRef.current = activateEntry;
  }, [activateEntry]);

  const selectEntry = (event: MouseEvent, entry: WorkspaceTreeEntry) => {
    stopExplorerGesture(event);
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    activateEntry(entry, { ctrlKey: event.ctrlKey, metaKey: event.metaKey });
  };

  const onEntryKeyDown = (event: KeyboardEvent, entry: WorkspaceTreeEntry) => {
    if (event.key === 'ArrowRight' && entry.type === 'directory') {
      event.preventDefault();
      toggleDirectory(entry, true);
      return;
    }
    if (event.key === 'ArrowLeft' && entry.type === 'directory') {
      event.preventDefault();
      setExpanded(current => {
        const next = new Set(current);
        next.delete(entry.path);
        return next;
      });
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      setRenamingPath(entry.path);
    }
  };

  const onContextMenu = (event: MouseEvent, entry: WorkspaceTreeEntry) => {
    event.preventDefault();
    stopExplorerGesture(event);
    setSelected(current => current.has(entry.path) ? current : new Set([entry.path]));
    setContextMenu({ path: entry.path, ...clampContextMenuPoint(event.clientX, event.clientY) });
  };

  const onDragStart = (event: DragEvent, entry: WorkspaceTreeEntry) => {
    const kind = entry.type === 'directory' ? 'workspace-folder' : 'workspace-file';
    event.dataTransfer.effectAllowed = 'copy';
    explorerGestureActive.current = false;
    cancelPendingActivation();
    stopExplorerGesture(event);
    event.dataTransfer.setData('application/x-harness-workspace-item', JSON.stringify({
      kind,
      path: entry.path,
      source: 'workspace',
      name: entry.name,
      mime: entry.type === 'directory' ? 'inode/directory' : mimeHint(entry.path),
      size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : undefined,
    }));
    event.dataTransfer.setData('text/plain', entry.path);
  };

  return (
    <aside
      ref={explorerShellRef}
      data-canvas-control="true"
      data-testid="workflow-explorer-shell"
      data-collapsed={collapsed ? 'true' : 'false'}
      data-floating={floating ? 'true' : 'false'}
      className="workflow-explorer-shell nodrag nopan nowheel"
      onPointerDownCapture={captureExplorerPointer}
      onPointerDown={stopExplorerGesture}
      onPointerMoveCapture={stopExplorerGesture}
      onPointerUpCapture={releaseExplorerPointer}
      onMouseDownCapture={captureExplorerMouse}
      onMouseDown={stopExplorerGesture}
      onMouseMoveCapture={stopExplorerGesture}
      onMouseUpCapture={releaseExplorerMouse}
      onClick={stopExplorerGesture}
      onDoubleClick={stopExplorerGesture}
      onContextMenu={stopExplorerGesture}
      onDragEnter={stopExplorerGesture}
      onDragOver={stopExplorerGesture}
      onDragLeave={stopExplorerGesture}
      onDrop={stopExplorerDrop}
      onWheel={event => event.stopPropagation()}
    >
      <div className="workflow-explorer-header">
        <div className="workflow-explorer-title">
          <Folder size={14} />
          <span>Explorer</span>
        </div>
        <div className="workflow-explorer-actions">
          <button
            type="button"
            data-testid="workflow-explorer-toggle"
            title={collapsed ? 'Expand explorer' : 'Collapse explorer'}
            onClick={() => setCollapsed(current => !current)}
          >
            {collapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
          </button>
          <button
            type="button"
            data-testid="workflow-explorer-float"
            title={floating ? 'Dock explorer' : 'Float explorer'}
            onClick={() => setFloating(current => !current)}
          >
            {floating ? <Pin size={13} /> : <PinOff size={13} />}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div className="workflow-explorer-root" title={root || ''}>{root || 'workspace'}</div>
          <div data-testid="workflow-explorer-tree" className="workflow-explorer-tree" role="tree" aria-label="Workspace files">
            {visibleEntries.map(entry => {
              const directory = entry.type === 'directory';
              const isExpanded = expanded.has(entry.path);
              const isSelected = selected.has(entry.path);
              return (
                <div
                  key={entry.path}
                  role="treeitem"
                  aria-selected={isSelected ? 'true' : 'false'}
                  aria-expanded={directory ? isExpanded : undefined}
                  tabIndex={0}
                  draggable
                  data-testid="workspace-tree-item"
                  data-path={entry.path}
                  data-kind={directory ? 'folder' : 'file'}
                  className="workspace-tree-item"
                  onClick={event => selectEntry(event, entry)}
                  onDoubleClick={event => {
                    event.preventDefault();
                    stopExplorerGesture(event);
                  }}
                  onKeyDown={event => onEntryKeyDown(event, entry)}
                  onContextMenu={event => onContextMenu(event, entry)}
                  onDragStart={event => onDragStart(event, entry)}
                  style={{ paddingLeft: 8 + depthOf(entry.path) * 14 }}
                >
                  <span className="workspace-tree-chevron">
                    {directory ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
                  </span>
                  <span className="workspace-tree-icon">{directory ? (isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />) : <File size={13} />}</span>
                  {renamingPath === entry.path ? (
                    <input
                      data-testid="workspace-rename-input"
                      defaultValue={entry.name}
                      autoFocus
                      onClick={event => event.stopPropagation()}
                      onKeyDown={event => {
                        if (event.key === 'Escape' || event.key === 'Enter') setRenamingPath('');
                      }}
                    />
                  ) : (
                    <span className="workspace-tree-name">{entry.name}</span>
                  )}
                </div>
              );
            })}
            {loadingByPath.size > 0 && <div className="workspace-tree-loading">Loading...</div>}
          </div>
        </>
      )}
      {contextMenu && createPortal(
        <div
          data-testid="workspace-context-menu"
          className="workspace-context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 60,
            width: contextMenuWidth,
            height: contextMenuHeight,
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
          onPointerDownCapture={stopExplorerGesture}
          onPointerDown={stopExplorerGesture}
          onMouseDownCapture={stopExplorerGesture}
          onMouseDown={stopExplorerGesture}
          onClick={stopExplorerGesture}
          onContextMenu={event => {
            event.preventDefault();
            stopExplorerGesture(event);
          }}
        >
          <button type="button" onClick={() => setRenamingPath(contextMenu.path)}>Rename</button>
          <button type="button">New File</button>
          <button type="button">Delete</button>
          <div title={parentPath(contextMenu.path)}>Parent: {parentPath(contextMenu.path) || '/'}</div>
        </div>,
        document.body,
      )}
      {!collapsed && previewEntry && (
        <div
          data-testid="workspace-preview-panel"
          className="workspace-preview-panel nodrag nopan nowheel"
          onPointerDown={stopExplorerGesture}
          onMouseDown={stopExplorerGesture}
          onWheel={stopExplorerGesture}
        >
          <div className="workspace-preview-header">
            <div>
              <strong>{previewEntry.name}</strong>
              <span>{previewEntry.path}</span>
            </div>
            <button type="button" title={t('Close')} onClick={() => setPreviewEntry(null)}>
              <X size={12} />
            </button>
          </div>
          <div className="workspace-preview-body nodrag nopan nowheel" onWheel={stopExplorerGesture}>
            {previewEntry.type === 'directory' ? (
              <div className="workspace-preview-empty">
                <Folder size={28} />
                <span>{t('Folder reference')}</span>
              </div>
            ) : previewIsImage ? (
              previewObjectUrl ? (
                <img src={previewObjectUrl} alt={previewEntry.name} />
              ) : (
                <div className="workspace-preview-empty">
                  <File size={28} />
                  <span>{previewObjectError || t('Loading preview...')}</span>
                </div>
              )
            ) : previewIsVideo ? (
              previewObjectUrl ? (
                <video src={previewObjectUrl} controls />
              ) : (
                <div className="workspace-preview-empty">
                  <File size={28} />
                  <span>{previewObjectError || t('Loading preview...')}</span>
                </div>
              )
            ) : previewIsPdf ? (
              previewObjectUrl ? (
                <iframe src={previewObjectUrl} title={previewEntry.name} />
              ) : (
                <div className="workspace-preview-empty">
                  <File size={28} />
                  <span>{previewObjectError || t('Loading preview...')}</span>
                </div>
              )
            ) : previewIsText ? (
              <pre className="nodrag nopan nowheel">{previewError || previewText || t('Loading preview...')}</pre>
            ) : (
              <div className="workspace-preview-empty">
                <File size={28} />
                <span>{previewMime === 'spreadsheet' ? t('Spreadsheet file') : t('File reference')}</span>
              </div>
            )}
          </div>
          <div className="workspace-preview-meta">
            <span>{previewEntry.type}</span>
            {formatSize(previewEntry.size) && <span>{formatSize(previewEntry.size)}</span>}
          </div>
          <button
            type="button"
            data-testid="workspace-insert-file"
            className="workspace-preview-insert"
            onClick={() => onInsertFile?.(previewEntry)}
          >
            <Plus size={12} />
            <span data-testid="workspace-preview-insert">{t('Insert to canvas')}</span>
          </button>
        </div>
      )}
    </aside>
  );
}
