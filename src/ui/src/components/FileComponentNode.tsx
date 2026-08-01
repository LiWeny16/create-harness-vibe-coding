import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { FileText, Image as ImageIcon, Table2, Video } from 'lucide-react';
import { apiFetch, apiJson } from '../api';
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
  const previewRef = useRef<HTMLDivElement | null>(null);
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
    if (!path || !isNativePreview || !shouldLoadPreview) return;
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
  }, [isNativePreview, mime, path, shouldLoadPreview]);

  useEffect(() => {
    let cancelled = false;
    setTextPreview('');
    setTextError('');
    if (!path || !isText || !shouldLoadPreview) return;
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
  }, [isText, path, shouldLoadPreview]);

  return (
    <div
      data-testid="workflow-file-node"
      data-node-id={state.nodeId}
      data-file-path={path}
      data-file-source={source}
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
        {isImage && nativePreviewUrl && <img src={nativePreviewUrl} alt={file?.name || path} />}
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
