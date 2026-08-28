import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { FileText, Image as ImageIcon, Table2, Video } from 'lucide-react';
import { apiFetch, apiJson } from '../api';
import { filePreview } from './workflow/nodeRuntimeClient';
import type { WorkflowComponentNodeState } from '../types';

type Props = {
  state: WorkflowComponentNodeState;
};

type TextPreviewResponse = {
  text?: string;
  bytesRead?: number;
  truncated?: boolean;
  encoding?: string;
};

type FilePresence = 'checking' | 'missing' | 'present';

// Existence check for the bound file, bounded and cached per node id. The
// component-node snapshot does not carry an exists/stale flag (the backend
// file.refresh action persists only source/kind/path/name/mime/size), so the
// card derives existence from the file.preview action: for a path missing on
// disk the backend returns previewKind 'missing' / available:false cleanly,
// while byte reads (GET /api/workspace/file) would 404. Existing files must
// keep their current preview behavior, so a failed check falls back to
// 'present' and the normal preview fetch surfaces any real read error.
const filePresenceCache = new Map<string, {
  path: string;
  present: boolean | null; // null while the check is in flight
  at: number;
  promise?: Promise<boolean>;
}>();

const FILE_PRESENCE_CACHE_TTL_MS = 30_000;

function checkFilePresence(nodeId: string, path: string): Promise<boolean> {
  const cached = filePresenceCache.get(nodeId);
  if (cached && cached.path === path) {
    if (cached.promise) return cached.promise;
    if (cached.present !== null && Date.now() - cached.at < FILE_PRESENCE_CACHE_TTL_MS) {
      return Promise.resolve(cached.present);
    }
  }
  const promise = filePreview(nodeId)
    .then(preview => preview.previewKind !== 'missing' && preview.available !== false)
    .catch(() => true)
    .then(present => {
      filePresenceCache.set(nodeId, { path, present, at: Date.now() });
      return present;
    });
  filePresenceCache.set(nodeId, { path, present: null, at: Date.now(), promise });
  return promise;
}

function extFromPath(path: string) {
  const match = String(path || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

function mimeFromState(state: WorkflowComponentNodeState) {
  const file = state.file;
  const mime = String(file?.mime || '').toLowerCase();
  const ext = extFromPath(file?.path || file?.name || '');
  if (mime) return mime;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  if (ext === 'pdf') return 'application/pdf';
  if (['mp4', 'webm', 'mov'].includes(ext)) return `video/${ext === 'mov' ? 'quicktime' : ext}`;
  if (['txt', 'md', 'markdown', 'json', 'csv', 'log', 'yaml', 'yml'].includes(ext)) return 'text/plain';
  if (['xls', 'xlsx'].includes(ext)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/octet-stream';
}

function formatSize(value: unknown) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function filePreviewPath(path: string) {
  return `/api/workspace/file?path=${encodeURIComponent(path)}`;
}

function textPreviewPath(path: string) {
  return `/api/workspace/text?path=${encodeURIComponent(path)}&offset=0&limit=8192`;
}

export default function FileComponentNode({ state }: Props) {
  const file = state.file;
  const mime = mimeFromState(state);
  const path = file?.path || '';
  const source = file?.source || 'workspace';
  const nodeId = state.nodeId;
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [filePresence, setFilePresence] = useState<FilePresence>('checking');
  const [previewReadyPath, setPreviewReadyPath] = useState('');
  const [nativePreviewUrl, setNativePreviewUrl] = useState('');
  const [nativePreviewError, setNativePreviewError] = useState('');
  const [textPreview, setTextPreview] = useState('');
  const [textError, setTextError] = useState('');
  const isImage = mime.startsWith('image/');
  const isVideo = mime.startsWith('video/');
  const isPdf = mime === 'application/pdf';
  const isText = mime.startsWith('text/') || ['application/json', 'application/xml'].includes(mime);
  const isNativePreview = isImage || isVideo || isPdf;
  const isSpreadsheet = /spreadsheet|excel|csv/.test(mime) || /\.(xls|xlsx|csv)$/i.test(path);
  const PreviewIcon = isImage ? ImageIcon : isVideo ? Video : isSpreadsheet ? Table2 : FileText;
  const shouldLoadPreview = previewReadyPath === path;
  const stopInteractiveEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };
  // Native <img> drag (HTML5 DnD) is not fully suppressed by draggable={false}
  // inside React Flow nodes; block dragstart so the preview image can never be
  // dragged out of its node on its own.
  const blockImageDrag = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  // One bounded existence check per node id (cached). While 'checking' or
  // 'missing', the preview URL / text endpoint is never requested, so a node
  // bound to a deleted file renders the missing badge instead of 404-spamming
  // the console.
  useEffect(() => {
    let cancelled = false;
    if (!path || !nodeId) {
      setFilePresence('present');
      return;
    }
    setFilePresence('checking');
    checkFilePresence(nodeId, path).then(present => {
      if (!cancelled) setFilePresence(present ? 'present' : 'missing');
    });
    return () => {
      cancelled = true;
    };
  }, [nodeId, path]);

  useEffect(() => {
    setPreviewReadyPath('');
    if (!path || (!isNativePreview && !isText)) return;
    const previewElement = previewRef.current;
    if (!previewElement || typeof IntersectionObserver === 'undefined') {
      setPreviewReadyPath(path);
      return;
    }
    let settled = false;
    const observer = new IntersectionObserver((entries) => {
      if (settled || !entries.some(entry => entry.isIntersecting || entry.intersectionRatio > 0)) return;
      settled = true;
      setPreviewReadyPath(path);
      observer.disconnect();
    }, { threshold: 0.01 });
    observer.observe(previewElement);
    return () => {
      settled = true;
      observer.disconnect();
    };
  }, [isNativePreview, isText, path]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setNativePreviewUrl('');
    setNativePreviewError('');
    if (!path || !isNativePreview || !shouldLoadPreview || filePresence !== 'present') return;
    apiFetch(filePreviewPath(path), { headers: { Accept: mime || '*/*' } })
      .then(async response => {
        if (!response.ok) throw new Error(`${path}: ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        const nextObjectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }
        objectUrl = nextObjectUrl;
        setNativePreviewUrl(nextObjectUrl);
      })
      .catch(error => {
        if (!cancelled) setNativePreviewError(String(error?.message || 'preview failed'));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filePresence, isNativePreview, mime, path, shouldLoadPreview]);

  useEffect(() => {
    let cancelled = false;
    setTextPreview('');
    setTextError('');
    if (!path || !isText || !shouldLoadPreview || filePresence !== 'present') return;
    apiJson<TextPreviewResponse>(textPreviewPath(path))
      .then(data => {
        if (!cancelled) setTextPreview(String(data.text || ''));
      })
      .catch(error => {
        if (!cancelled) setTextError(String(error?.message || 'preview failed'));
      });
    return () => {
      cancelled = true;
    };
  }, [filePresence, isText, path, shouldLoadPreview]);

  return (
    <div
      data-testid="workflow-file-node"
      data-node-id={state.nodeId}
      data-file-path={path}
      data-file-source={source}
      data-file-missing={filePresence === 'missing' ? 'true' : undefined}
      className="workflow-file-component"
    >
      <div
        ref={previewRef}
        data-testid="workflow-file-preview"
        className="workflow-file-preview nodrag nopan nowheel"
        onPointerDown={stopInteractiveEvent}
        onMouseDown={stopInteractiveEvent}
        onWheel={stopInteractiveEvent}
      >
        {filePresence === 'missing' ? (
          <div
            data-testid="workflow-file-missing"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 6,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              fontSize: 12,
            }}
          >
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>文件缺失</span>
            <span style={{ color: '#991b1b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {file?.name || path}
            </span>
          </div>
        ) : (
          <>
            {isImage && nativePreviewUrl && (
              <img
                src={nativePreviewUrl}
                alt={file?.name || path}
                draggable={false}
                onDragStart={blockImageDrag}
                onPointerDown={stopInteractiveEvent}
                onMouseDown={stopInteractiveEvent}
              />
            )}
            {isVideo && nativePreviewUrl && <video src={nativePreviewUrl} controls />}
            {isPdf && nativePreviewUrl && <iframe src={nativePreviewUrl} title={file?.name || path} />}
            {nativePreviewError && (
              <div className="workflow-file-preview-empty">
                <PreviewIcon size={28} />
                <span>Preview unavailable</span>
              </div>
            )}
            {isText && (
              <pre data-testid="workflow-file-text-preview">
                {textError || textPreview || 'Loading preview...'}
              </pre>
            )}
            {!isImage && !isVideo && !isPdf && !isText && (
              <div className="workflow-file-preview-empty">
                <PreviewIcon size={28} />
                <span>{isSpreadsheet ? 'Spreadsheet file' : 'File preview'}</span>
              </div>
            )}
          </>
        )}
      </div>
      <dl className="workflow-file-meta">
        <dt>Path</dt>
        <dd>{path || 'No file selected'}</dd>
        <dt>Source</dt>
        <dd>{file?.source || 'workspace'}</dd>
        <dt>Type</dt>
        <dd>{mime}</dd>
        {formatSize(file?.size) && (
          <>
            <dt>Size</dt>
            <dd>{formatSize(file?.size)}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
