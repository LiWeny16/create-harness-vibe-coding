// VSCode-like File big-view: a fullscreen shell rendered via portal to
// document.body. All media uses browser-native elements (no pdfjs, no new deps):
//   - text/md/json/yaml -> editable <textarea> (Save via file.writeText)
//   - md                 -> GitHub-style editor (@uiw/react-md-editor, MIT) in
//                           edit-only mode + live preview via the shared
//                           markdown pipeline (MarkdownPreview, mermaid-capable)
//   - json               -> Format + Validate buttons
//   - image              -> <img> with zoom + fit-to-window toggle
//   - audio              -> <audio controls>
//   - video              -> <video controls>
//   - pdf                -> <iframe> (browser-native viewer) + text tab (per-page
//                           extraction via file.readPdf/file.readPdfPage)
//   - xlsx               -> sheet dropdown + paginated table (file.readXlsx*)
//   - zip                -> entry list + text preview + controlled extract
//                           (file.readZip* / file.extractZipEntry)
//   - other/binary       -> metadata only
// Header refresh button re-stats via file.refresh then reloads; a WS
// file.changed notice bar offers manual reload (no auto hot reload, AC-3 D2).
// All file IO goes through backend file.* node actions (nodeRuntimeClient);
// the UI never writes backend-owned state files directly.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { Check, Copy, Download, ExternalLink, FileText, Folder, Loader2, RefreshCw, X } from 'lucide-react';
// GitHub-style markdown editor (MIT): toolbar + edit-only textarea; the live
// preview pane is the shared MarkdownPreview pipeline (mermaid-capable).
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import { MarkdownPreview } from './markdown/MarkdownPreview';
import { apiJson, wsUrl } from '../api';
import { useT } from '../i18n/index';
import { useSaveShortcut } from '../hooks/useSaveShortcut';
import {
  fileExtractZipEntry,
  fileMeta,
  filePreview,
  fileReadPdf,
  fileReadPdfPage,
  fileReadText,
  fileReadXlsx,
  fileReadXlsxSheet,
  fileReadZipEntries,
  fileReadZipEntry,
  fileRefresh,
  fileWriteText,
  type FileExtractZipEntryResult,
  type FileMetaResult,
  type FilePreviewResult,
  type FileReadPdfResult,
  type FileZipEntry,
} from './workflow/nodeRuntimeClient';

type Props = {
  nodeId: string;
  onClose: () => void;
};

type FileKind =
  | 'text'
  | 'md'
  | 'json'
  | 'yaml'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'xlsx'
  | 'zip'
  | 'missing'
  | 'binary';

const TEXT_KINDS: FileKind[] = ['text', 'md', 'json', 'yaml'];
const TEXT_LOAD_LIMIT = 4_000_000; // generous; backend still caps at WORKSPACE_TEXT_PREVIEW_MAX_BYTES
const XLSX_PAGE_SIZE = 100; // backend default page size
const ZIP_ENTRY_MAX_BYTES = 64 * 1024; // backend default readZipEntry cap
const ZIP_ENTRY_LIST_CAP = 200; // simple truncation, no virtualization
// Minimum time the reveal button stays in its pending state so the click has
// visible feedback while the OS file-manager window comes up.
const REVEAL_FEEDBACK_MS = 900;


function extFromPath(path: string): string {
  const match = String(path || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

function isXlsxMimeOrExt(mime: string, ext: string): boolean {
  return mime.includes('spreadsheet') || mime.includes('excel') || ext === 'xlsx' || ext === 'xls';
}

function isZipMimeOrExt(mime: string, ext: string): boolean {
  return mime === 'application/zip'
    || mime === 'application/x-zip-compressed'
    || mime === 'multipart/x-zip'
    || ext === 'zip';
}

function deriveKind(preview: FilePreviewResult | null, meta: FileMetaResult | null): FileKind {
  if (!preview) return 'binary';
  if (preview.previewKind === 'missing') return 'missing';
  const mime = String(preview.mime || meta?.file?.mime || '').toLowerCase();
  const ext = extFromPath(String(preview.path || meta?.file?.path || ''));
  if (preview.previewKind === 'image') return 'image';
  if (preview.previewKind === 'pdf') return 'pdf';
  if (preview.previewKind === 'video') return 'video';
  // Audio is not a backend previewKind (falls to 'none'); detect via mime/extension.
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
  // xlsx/zip are binary-ish previews ('none'); detect via mime/extension.
  if (isXlsxMimeOrExt(mime, ext)) return 'xlsx';
  if (isZipMimeOrExt(mime, ext)) return 'zip';
  if (preview.previewKind === 'text') {
    if (mime.includes('json') || ext === 'json') return 'json';
    if (mime.includes('yaml') || ext === 'yaml' || ext === 'yml') return 'yaml';
    if (mime.includes('markdown') || ext === 'md' || ext === 'markdown') return 'md';
    return 'text';
  }
  return 'binary';
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleDateString();
  return String(value);
}

function workspaceFileUrl(path: string): string {
  return `/api/workspace/file?path=${encodeURIComponent(path)}`;
}

function formatSize(value: unknown): string {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function WorkflowFileBigView({ nodeId, onClose }: Props) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [meta, setMeta] = useState<FileMetaResult | null>(null);
  const [preview, setPreview] = useState<FilePreviewResult | null>(null);
  const [draftText, setDraftText] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');
  const [saveOk, setSaveOk] = useState(false);
  const [jsonStatus, setJsonStatus] = useState('');
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const clearSaveOkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every full reload so kind-specific data effects re-fetch after a
  // refresh even when the derived kind (and thus their other deps) is unchanged.
  const [dataEpoch, setDataEpoch] = useState(0);
  // Monotonic token guarding async loads; stale responses are dropped.
  const loadTokenRef = useRef(0);

  // ── xlsx state ──
  const [xlsxSheets, setXlsxSheets] = useState<string[]>([]);
  const [xlsxSheet, setXlsxSheet] = useState<string | number | null>(null);
  const [xlsxHeaders, setXlsxHeaders] = useState<unknown[][]>([]);
  const [xlsxRows, setXlsxRows] = useState<unknown[][]>([]);
  const [xlsxPage, setXlsxPage] = useState(1);
  const [xlsxTotalPages, setXlsxTotalPages] = useState<number | null>(null);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [xlsxError, setXlsxError] = useState('');

  // ── pdf text-tab state ──
  const [pdfTab, setPdfTab] = useState<'view' | 'text'>('view');
  const [pdfInfo, setPdfInfo] = useState<FileReadPdfResult | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfText, setPdfText] = useState('');
  const [pdfTextBusy, setPdfTextBusy] = useState(false);
  const [pdfTextError, setPdfTextError] = useState('');

  // ── zip state ──
  const [zipEntries, setZipEntries] = useState<FileZipEntry[]>([]);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipError, setZipError] = useState('');
  const [zipSelected, setZipSelected] = useState('');
  const [zipEntryText, setZipEntryText] = useState('');
  const [zipEntryTruncated, setZipEntryTruncated] = useState(false);
  const [zipEntryBusy, setZipEntryBusy] = useState(false);
  const [zipEntryError, setZipEntryError] = useState('');
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractResult, setExtractResult] = useState<FileExtractZipEntryResult | null>(null);
  const [extractError, setExtractError] = useState('');
  const [copiedPath, setCopiedPath] = useState(false);

  // ── file.changed notice (AC-3/AC-9 D2: badge + manual reload, no hot reload) ──
  const [fileChangedNotice, setFileChangedNotice] = useState(false);

  const kind = useMemo(() => deriveKind(preview, meta), [preview, meta]);
  const isTextKind = TEXT_KINDS.includes(kind);
  const dirty = isTextKind && draftText !== originalText;
  const filePath = String(preview?.path || meta?.file?.path || '');

  // Full reload: meta + preview (+ readText for text kinds) and a reset of all
  // kind-specific panels. Runs on nodeId change and on manual refresh.
  const loadAll = useCallback(async () => {
    const token = ++loadTokenRef.current;
    setLoading(true);
    setLoadError('');
    setDraftText('');
    setOriginalText('');
    setTruncated(false);
    setJsonStatus('');
    setXlsxSheets([]);
    setXlsxSheet(null);
    setXlsxHeaders([]);
    setXlsxRows([]);
    setXlsxPage(1);
    setXlsxTotalPages(null);
    setXlsxError('');
    setPdfTab('view');
    setPdfInfo(null);
    setPdfPage(1);
    setPdfText('');
    setPdfTextError('');
    setZipEntries([]);
    setZipSelected('');
    setZipEntryText('');
    setZipEntryTruncated(false);
    setZipEntryError('');
    setExtractResult(null);
    setExtractError('');
    setDataEpoch(epoch => epoch + 1);
    try {
      const [metaRes, previewRes] = await Promise.all([
        fileMeta(nodeId).catch(() => null),
        filePreview(nodeId).catch(() => null),
      ]);
      if (token !== loadTokenRef.current) return;
      setMeta(metaRes);
      setPreview(previewRes);
      if (TEXT_KINDS.includes(deriveKind(previewRes, metaRes))) {
        try {
          const text = await fileReadText(nodeId, { offset: 0, limit: TEXT_LOAD_LIMIT });
          if (token !== loadTokenRef.current) return;
          setDraftText(text.text || '');
          setOriginalText(text.text || '');
          setTruncated(Boolean(text.truncated));
        } catch (e: any) {
          if (token === loadTokenRef.current) setLoadError(String(e?.message || 'file.readText failed'));
        }
      }
    } catch (e: any) {
      if (token === loadTokenRef.current) setLoadError(String(e?.message || 'load failed'));
    } finally {
      if (token === loadTokenRef.current) setLoading(false);
    }
  }, [nodeId]);

  // Initial load on nodeId change; also re-runs after every handleRefresh.
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Cancel any in-flight load on unmount.
  useEffect(() => {
    return () => {
      loadTokenRef.current++;
    };
  }, []);

  // ── xlsx: sheet list + current sheet page ──
  useEffect(() => {
    if (kind !== 'xlsx' || loading) return;
    let cancelled = false;
    setXlsxBusy(true);
    setXlsxError('');
    (async () => {
      try {
        const res = await fileReadXlsx(nodeId);
        if (cancelled) return;
        const sheets = Array.isArray(res.sheets) ? res.sheets : [];
        setXlsxSheets(sheets);
        if (sheets.length > 0) setXlsxSheet(current => current ?? sheets[0]);
      } catch (e: any) {
        if (!cancelled) setXlsxError(String(e?.message || 'file.readXlsx failed'));
      } finally {
        if (!cancelled) setXlsxBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, loading, nodeId, dataEpoch]);

  useEffect(() => {
    if (kind !== 'xlsx' || loading || xlsxSheet === null || xlsxSheet === '') return;
    let cancelled = false;
    setXlsxBusy(true);
    setXlsxError('');
    (async () => {
      try {
        const res = await fileReadXlsxSheet(nodeId, { sheet: xlsxSheet, page: xlsxPage, pageSize: XLSX_PAGE_SIZE });
        if (cancelled) return;
        setXlsxHeaders(Array.isArray(res.headers) ? res.headers : []);
        setXlsxRows(Array.isArray(res.rows) ? res.rows : []);
        setXlsxTotalPages(res.totalPages ?? null);
      } catch (e: any) {
        if (!cancelled) setXlsxError(String(e?.message || 'file.readXlsxSheet failed'));
      } finally {
        if (!cancelled) setXlsxBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, loading, nodeId, dataEpoch, xlsxSheet, xlsxPage]);

  // ── pdf: text tab (info + per-page extraction) ──
  useEffect(() => {
    if (kind !== 'pdf' || pdfTab !== 'text' || loading) return;
    let cancelled = false;
    setPdfTextBusy(true);
    setPdfTextError('');
    (async () => {
      try {
        const [info, pageText] = await Promise.all([
          fileReadPdf(nodeId).catch(() => null),
          fileReadPdfPage(nodeId, { page: pdfPage, pageCount: 1 }),
        ]);
        if (cancelled) return;
        if (info) setPdfInfo(info);
        setPdfText(pageText.text || '');
      } catch (e: any) {
        if (!cancelled) setPdfTextError(String(e?.message || 'file.readPdf failed'));
      } finally {
        if (!cancelled) setPdfTextBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, loading, nodeId, dataEpoch, pdfTab, pdfPage]);

  // ── zip: central-directory entry list ──
  useEffect(() => {
    if (kind !== 'zip' || loading) return;
    let cancelled = false;
    setZipBusy(true);
    setZipError('');
    (async () => {
      try {
        const res = await fileReadZipEntries(nodeId);
        if (cancelled) return;
        setZipEntries(Array.isArray(res.entries) ? res.entries : []);
      } catch (e: any) {
        if (!cancelled) setZipError(String(e?.message || 'file.readZipEntries failed'));
      } finally {
        if (!cancelled) setZipBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, loading, nodeId, dataEpoch]);

  // ── file.changed subscription: show a notice bar, never auto-reload (D2) ──
  useEffect(() => {
    let ws: WebSocket | null = null;
    let disposed = false;
    try {
      ws = new WebSocket(wsUrl('/ws/events'));
      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const data = JSON.parse(String(event.data));
          if (data && data.type === 'file.changed' && String(data.nodeId) === nodeId) {
            setFileChangedNotice(true);
          }
        } catch {
          // ignore malformed frames
        }
      };
    } catch {
      // WS unavailable — the notice degrades silently
    }
    return () => {
      disposed = true;
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, [nodeId]);

  // Cleanup transient save-ok timer on unmount.
  useEffect(() => {
    return () => {
      if (clearSaveOkTimer.current) clearTimeout(clearSaveOkTimer.current);
    };
  }, []);

  const stopCanvasEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const scheduleClearSaveOk = () => {
    if (clearSaveOkTimer.current) clearTimeout(clearSaveOkTimer.current);
    clearSaveOkTimer.current = setTimeout(() => {
      setSaveOk(false);
      clearSaveOkTimer.current = null;
    }, 2500);
  };

  const handleSave = async () => {
    if (!isTextKind || !dirty || saving) return;
    setSaving(true);
    setSaveError('');
    setSaveOk(false);
    try {
      await fileWriteText(nodeId, { content: draftText });
      setOriginalText(draftText);
      setSaveOk(true);
      scheduleClearSaveOk();
      try {
        setMeta(await fileMeta(nodeId));
      } catch {
        // metadata refresh is best-effort
      }
    } catch (e: any) {
      setSaveError(String(e?.message || 'save failed'));
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd+S mirrors the Save button; handleSave is a no-op when !dirty/saving.
  useSaveShortcut(handleSave, dirty && !saving);

  const handleFormatJson = () => {
    if (kind !== 'json') return;
    try {
      const parsed = JSON.parse(draftText);
      setDraftText(JSON.stringify(parsed, null, 2));
      setJsonStatus('Formatted: valid JSON');
    } catch (e: any) {
      setJsonStatus(`Invalid JSON: ${String(e?.message || 'parse error')}`);
    }
  };

  const handleValidateJson = () => {
    if (kind !== 'json') return;
    try {
      JSON.parse(draftText);
      setJsonStatus('Valid JSON');
    } catch (e: any) {
      setJsonStatus(`Invalid JSON: ${String(e?.message || 'parse error')}`);
    }
  };

  // Manual refresh: re-stat the bound file on the backend, then full reload.
  // Disabled for text kinds with unsaved edits so a refresh cannot wipe a draft.
  const handleRefresh = async () => {
    if (saving || loading || (isTextKind && dirty)) return;
    setFileChangedNotice(false);
    try {
      await fileRefresh(nodeId);
    } catch {
      // refresh persistence is best-effort; the reload below still re-reads
    }
    await loadAll();
  };

  // 在用户系统资源管理器中揭示绑定的文件路径（task-wf-ui-terminal-explorer-ux AC-008）。
  // 服务端毫秒级返回，但资源管理器窗口约 1s 后才弹出；pending 态保底展示
  // REVEAL_FEEDBACK_MS，让点击有可感知的加载反馈。
  const handleReveal = async () => {
    const pathValue = String(preview?.path || meta?.file?.path || '');
    if (!pathValue || revealing) {
      if (!pathValue) setRevealError(t('No file path'));
      return;
    }
    setRevealing(true);
    setRevealError('');
    const startedAt = Date.now();
    try {
      await apiJson('/api/workspace/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathValue }),
      });
    } catch (e: any) {
      setRevealError(String(e?.message || 'reveal failed'));
    } finally {
      const remaining = REVEAL_FEEDBACK_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      setRevealing(false);
    }
  };

  const handleZipEntryClick = async (entry: FileZipEntry) => {
    if (entry.directory || zipEntryBusy) return;
    setZipSelected(entry.name);
    setZipEntryBusy(true);
    setZipEntryError('');
    setExtractResult(null);
    setExtractError('');
    try {
      const res = await fileReadZipEntry(nodeId, { entryName: entry.name, maxBytes: ZIP_ENTRY_MAX_BYTES });
      setZipEntryText(res.text || '');
      setZipEntryTruncated(Boolean(res.truncated));
    } catch (e: any) {
      setZipEntryError(String(e?.message || 'file.readZipEntry failed'));
    } finally {
      setZipEntryBusy(false);
    }
  };

  const handleExtractEntry = async () => {
    if (!zipSelected || extractBusy) return;
    setExtractBusy(true);
    setExtractError('');
    setExtractResult(null);
    try {
      const res = await fileExtractZipEntry(nodeId, { entryName: zipSelected });
      setExtractResult(res);
    } catch (e: any) {
      setExtractError(String(e?.message || 'file.extractZipEntry failed'));
    } finally {
      setExtractBusy(false);
    }
  };

  const handleCopyExtractPath = async () => {
    if (!extractResult?.path) return;
    try {
      await navigator.clipboard.writeText(extractResult.path);
      setCopiedPath(true);
      window.setTimeout(() => setCopiedPath(false), 2000);
    } catch {
      // clipboard unavailable — path stays visible to copy manually
    }
  };

  if (typeof document === 'undefined') return null;

  const titleText = meta?.file?.name || meta?.file?.path || filePath || 'File';

  return createPortal(
    <motion.div
      data-testid="workflow-file-big-view"
      data-component-type="file"
      data-node-id={nodeId}
      data-file-kind={kind}
      className="nodrag nopan nowheel"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(15,23,42,0.38)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
      onPointerDown={stopCanvasEvent}
      onMouseDown={stopCanvasEvent}
      onWheel={stopCanvasEvent}
      onKeyDown={stopCanvasEvent}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label="File viewer"
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.99 }}
        transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
        style={{
          background: '#ffffff',
          borderRadius: 12,
          width: '92vw',
          height: '92vh',
          maxWidth: 1500,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid rgba(15,23,42,0.14)',
          boxShadow: '0 24px 70px rgba(15,23,42,0.28)',
        }}
        onPointerDown={stopCanvasEvent}
        onMouseDown={stopCanvasEvent}
        onWheel={stopCanvasEvent}
        onKeyDown={stopCanvasEvent}
      >
        {/* Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            borderBottom: '1px solid #e5e7eb',
            background: '#f9fafb',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={titleText}>
              {titleText}
            </span>
            <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {kind === 'binary' ? 'file' : kind}
              {filePath ? ` · ${filePath}` : ''}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {isTextKind && (
              <>
                <span
                  data-testid="workflow-file-big-view-dirty"
                  style={{ fontSize: 11, color: dirty ? '#b45309' : '#16a34a', fontWeight: 600 }}
                >
                  {saving ? 'Saving…' : dirty ? 'Unsaved' : saveOk ? 'Saved' : 'Saved'}
                </span>
                {kind === 'json' && (
                  <>
                    <button
                      type="button"
                      data-testid="workflow-file-big-view-format"
                      onClick={handleFormatJson}
                      style={btnStyle}
                    >
                      Format
                    </button>
                    <button
                      type="button"
                      data-testid="workflow-file-big-view-validate"
                      onClick={handleValidateJson}
                      style={btnStyle}
                    >
                      Validate
                    </button>
                  </>
                )}
                <button
                  type="button"
                  data-testid="workflow-file-big-view-save"
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 5, background: !dirty || saving ? '#e5e7eb' : '#2563eb', color: !dirty || saving ? '#9ca3af' : '#ffffff', cursor: !dirty || saving ? 'not-allowed' : 'pointer' }}
                >
                  {saving && <Loader2 size={12} style={spinIconStyle} />}
                  {saving ? t('Saving...') : t('Save')}
                </button>
              </>
            )}
            {kind === 'image' && (
              <button
                type="button"
                data-testid="workflow-file-big-view-preview"
                onClick={() => setFit(prev => !prev)}
                style={btnStyle}
              >
                {fit ? 'Actual size' : 'Fit to window'}
              </button>
            )}
            <button
              type="button"
              data-testid="workflow-file-big-view-refresh"
              onClick={handleRefresh}
              disabled={loading || saving || (isTextKind && dirty)}
              title={t('Refresh')}
              style={{
                ...btnStyle,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: loading || saving || (isTextKind && dirty) ? '#e5e7eb' : '#ffffff',
                color: loading || saving || (isTextKind && dirty) ? '#9ca3af' : '#111827',
                cursor: loading || saving || (isTextKind && dirty) ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? <Loader2 size={13} style={spinIconStyle} /> : <RefreshCw size={13} />}
              {t('Refresh')}
            </button>
            <button
              type="button"
              data-testid="workflow-file-big-view-reveal"
              onClick={handleReveal}
              disabled={kind === 'missing' || revealing}
              title={t('Open in Explorer')}
              style={{
                ...btnStyle,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: kind === 'missing' || revealing ? '#e5e7eb' : '#ffffff',
                color: kind === 'missing' ? '#9ca3af' : '#111827',
                cursor: kind === 'missing' || revealing ? 'wait' : 'pointer',
              }}
            >
              {revealing ? <Loader2 size={13} style={spinIconStyle} /> : <ExternalLink size={13} />}
              {revealing ? t('Opening') : t('Open in Explorer')}
            </button>
            <button
              type="button"
              data-testid="workflow-file-big-view-close"
              onClick={onClose}
              title="Close"
              aria-label="Close"
              style={{ ...btnStyle, padding: '4px 8px', display: 'inline-flex', alignItems: 'center' }}
            >
              <X size={15} />
            </button>
          </div>
        </header>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {revealError && (
            <div
              data-testid="workflow-file-big-view-reveal-error"
              style={{ padding: '6px 14px', fontSize: 12, background: '#fef2f2', color: '#b91c1c', borderBottom: '1px solid #fecaca', flexShrink: 0 }}
            >
              {revealError}
            </div>
          )}
          {fileChangedNotice && (
            <div
              data-testid="workflow-file-big-view-changed"
              style={{
                padding: '6px 14px',
                fontSize: 12,
                background: '#fffbeb',
                color: '#92400e',
                borderBottom: '1px solid #fde68a',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexShrink: 0,
              }}
            >
              <span style={{ flex: 1 }}>{t('File changed on disk')}</span>
              <button
                type="button"
                data-testid="workflow-file-big-view-reload"
                onClick={handleRefresh}
                disabled={loading}
                style={btnStyle}
              >
                {t('Reload')}
              </button>
            </div>
          )}
          {loading ? (
            <div style={{ padding: 24, color: '#6b7280' }}>Loading…</div>
          ) : loadError && !preview ? (
            <div data-testid="workflow-file-big-view-error" style={{ padding: 24, color: '#b91c1c' }}>{loadError}</div>
          ) : isTextKind ? (
            <>
              {(truncated || loadError || saveError || jsonStatus) && (
                <div style={{ padding: '6px 14px', fontSize: 12, background: '#fffbeb', color: '#92400e', borderBottom: '1px solid #fde68a', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {truncated && <span>File truncated — showing first {formatSize(meta?.file?.size)} (backend text preview cap).</span>}
                  {loadError && <span style={{ color: '#b91c1c' }}>{loadError}</span>}
                  {saveError && <span style={{ color: '#b91c1c' }}>{saveError}</span>}
                  {jsonStatus && <span>{jsonStatus}</span>}
                </div>
              )}
              {kind === 'md' ? (
                <div
                  data-testid="workflow-file-big-view-md-editor"
                  style={{ flex: 1, minHeight: 0, display: 'flex' }}
                  onPointerDown={stopCanvasEvent}
                  onMouseDown={stopCanvasEvent}
                  onWheel={stopCanvasEvent}
                  onKeyDown={stopCanvasEvent}
                >
                  <MDEditor
                    value={draftText}
                    onChange={value => setDraftText(value || '')}
                    height="100%"
                    style={{ width: '50%', flexShrink: 0 }}
                    preview="edit"
                    data-color-mode="light"
                    textareaProps={{ placeholder: 'Write markdown…' }}
                  />
                  <div
                    style={{
                      width: '50%',
                      minHeight: 0,
                      overflow: 'auto',
                      padding: 14,
                      borderLeft: '1px solid #e5e7eb',
                      background: '#ffffff',
                    }}
                    onPointerDown={stopCanvasEvent}
                    onMouseDown={stopCanvasEvent}
                    onWheel={stopCanvasEvent}
                    onKeyDown={stopCanvasEvent}
                  >
                    <MarkdownPreview
                      markdown={draftText}
                      containerTestId="workflow-file-big-view-md-preview"
                    />
                  </div>
                </div>
              ) : (
                <textarea
                  data-testid="workflow-file-big-view-text-editor"
                  value={draftText}
                  onChange={event => setDraftText(event.target.value)}
                  spellCheck={false}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    width: '100%',
                    border: 'none',
                    outline: 'none',
                    resize: 'none',
                    padding: 12,
                    fontFamily: kind === 'json' || kind === 'yaml' ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' : 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: '#111827',
                    background: '#ffffff',
                  }}
                  onPointerDown={stopCanvasEvent}
                  onMouseDown={stopCanvasEvent}
                  onWheel={stopCanvasEvent}
                  onKeyDown={stopCanvasEvent}
                />
              )}
            </>
          ) : kind === 'image' ? (
            <>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 12, color: '#374151' }}>Zoom</label>
                <input
                  type="range"
                  min={0.1}
                  max={4}
                  step={0.1}
                  value={zoom}
                  onChange={event => {
                    setZoom(Number(event.target.value));
                    if (fit) setFit(false);
                  }}
                  style={{ width: 220 }}
                />
                <span style={{ fontSize: 12, color: '#6b7280', minWidth: 40 }}>{Math.round(zoom * 100)}%</span>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}>
                {filePath ? (
                  <img
                    src={workspaceFileUrl(filePath)}
                    alt={titleText}
                    draggable={false}
                    style={{
                      maxWidth: fit ? '100%' : 'none',
                      maxHeight: fit ? '100%' : 'none',
                      width: fit ? 'auto' : `${Math.round(zoom * 100)}%`,
                      height: 'auto',
                      objectFit: 'contain',
                      display: 'block',
                    }}
                    onPointerDown={stopCanvasEvent}
                    onMouseDown={stopCanvasEvent}
                    onWheel={stopCanvasEvent}
                  />
                ) : (
                  <span style={{ color: '#6b7280' }}>No file path</span>
                )}
              </div>
            </>
          ) : kind === 'audio' ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
              <span style={{ fontSize: 13, color: '#374151' }}>{titleText}</span>
              {filePath ? (
                <audio controls src={workspaceFileUrl(filePath)} style={{ width: '100%', maxWidth: 600 }} />
              ) : (
                <span style={{ color: '#6b7280' }}>No file path</span>
              )}
            </div>
          ) : kind === 'video' ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#000' }}>
              {filePath ? (
                <video controls src={workspaceFileUrl(filePath)} style={{ maxWidth: '100%', maxHeight: '100%' }} />
              ) : (
                <span style={{ color: '#9ca3af' }}>No file path</span>
              )}
            </div>
          ) : kind === 'pdf' ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '6px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <button
                  type="button"
                  data-testid="workflow-file-big-view-pdf-tab-view"
                  onClick={() => setPdfTab('view')}
                  style={tabBtnStyle(pdfTab === 'view')}
                >
                  {t('View')}
                </button>
                <button
                  type="button"
                  data-testid="workflow-file-big-view-pdf-tab-text"
                  onClick={() => setPdfTab('text')}
                  style={tabBtnStyle(pdfTab === 'text')}
                >
                  {t('Text')}
                </button>
                {pdfTextError && <span style={{ color: '#b91c1c', fontSize: 12 }}>{pdfTextError}</span>}
              </div>
              {pdfTab === 'view' ? (
                filePath ? (
                  <iframe
                    data-testid="workflow-file-big-view-preview"
                    src={workspaceFileUrl(filePath)}
                    title={titleText}
                    style={{ flex: 1, minHeight: 0, width: '100%', border: 'none', background: '#f3f4f6' }}
                    onPointerDown={stopCanvasEvent}
                    onMouseDown={stopCanvasEvent}
                    onWheel={stopCanvasEvent}
                  />
                ) : (
                  <div style={{ padding: 24, color: '#6b7280' }}>No file path</div>
                )
              ) : (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '6px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#374151', flexShrink: 0, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{t('Page {n}', String(pdfPage))} / {pdfInfo?.totalPages || '–'}</span>
                    <button
                      type="button"
                      disabled={pdfTextBusy || pdfPage <= 1}
                      onClick={() => setPdfPage(page => Math.max(1, page - 1))}
                      style={btnStyle}
                    >
                      {t('Previous page')}
                    </button>
                    <button
                      type="button"
                      disabled={pdfTextBusy || (pdfInfo?.totalPages ? pdfPage >= pdfInfo.totalPages : false)}
                      onClick={() => setPdfPage(page => page + 1)}
                      style={btnStyle}
                    >
                      {t('Next page')}
                    </button>
                    {pdfInfo?.metadata && Object.keys(pdfInfo.metadata).length > 0 && (
                      <span style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                        {Object.entries(pdfInfo.metadata).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}
                      </span>
                    )}
                  </div>
                  <div
                    data-testid="workflow-file-big-view-pdf-text"
                    style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 14, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, lineHeight: 1.6, color: '#111827', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  >
                    {pdfTextBusy ? t('Loading...') : pdfText || '—'}
                  </div>
                </div>
              )}
            </div>
          ) : kind === 'xlsx' ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '6px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexShrink: 0, flexWrap: 'wrap' }}>
                <label style={{ color: '#374151', fontWeight: 600 }}>{t('Sheet')}</label>
                <select
                  data-testid="workflow-file-big-view-xlsx-sheet"
                  value={xlsxSheet === null ? '' : String(xlsxSheet)}
                  onChange={event => {
                    setXlsxSheet(event.target.value);
                    setXlsxPage(1);
                  }}
                  disabled={xlsxBusy}
                  style={{ fontSize: 12, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 6, background: '#ffffff', color: '#111827', maxWidth: 260 }}
                >
                  {xlsxSheets.length === 0 && <option value="">—</option>}
                  {xlsxSheets.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <span style={{ color: '#6b7280' }}>
                  {t('Page {n}', String(xlsxPage))} / {xlsxTotalPages !== null && xlsxTotalPages > 0 ? xlsxTotalPages : '–'}
                </span>
                <button
                  type="button"
                  disabled={xlsxBusy || xlsxPage <= 1}
                  onClick={() => setXlsxPage(page => Math.max(1, page - 1))}
                  style={btnStyle}
                >
                  {t('Previous page')}
                </button>
                <button
                  type="button"
                  disabled={xlsxBusy || (xlsxTotalPages !== null && xlsxTotalPages > 0 && xlsxPage >= xlsxTotalPages)}
                  onClick={() => setXlsxPage(page => page + 1)}
                  style={btnStyle}
                >
                  {t('Next page')}
                </button>
                {xlsxError && <span style={{ color: '#b91c1c' }}>{xlsxError}</span>}
                {!xlsxBusy && !xlsxError && xlsxSheets.length === 0 && (
                  <span style={{ color: '#92400e' }}>{t('No sheets found')}</span>
                )}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {xlsxBusy ? (
                  <div style={{ padding: 24, color: '#6b7280' }}>{t('Loading...')}</div>
                ) : (
                  <table
                    data-testid="workflow-file-big-view-xlsx-table"
                    style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}
                  >
                    <thead>
                      <tr>
                        {(xlsxHeaders || []).map((cell, index) => (
                          <th
                            key={index}
                            style={{ border: '1px solid #e5e7eb', padding: '6px 10px', textAlign: 'left', background: '#f9fafb', color: '#374151', fontWeight: 600, position: 'sticky', top: 0, whiteSpace: 'nowrap', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}
                          >
                            {formatCell(cell)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(xlsxRows || []).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              style={{ border: '1px solid #e5e7eb', padding: '5px 10px', color: '#111827', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            >
                              {formatCell(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : kind === 'zip' ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '6px 14px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#374151', flexShrink: 0 }}>
                <span style={{ fontWeight: 600 }}>{t('Zip entries')}</span>
                <span style={{ color: '#6b7280' }}>{zipEntries.length}</span>
                {zipError && <span style={{ color: '#b91c1c' }}>{zipError}</span>}
              </div>
              {zipEntries.length > ZIP_ENTRY_LIST_CAP && (
                <div style={{ padding: '4px 14px', fontSize: 12, background: '#fffbeb', color: '#92400e', borderBottom: '1px solid #fde68a', flexShrink: 0 }}>
                  {t('Only showing first {n} entries', String(ZIP_ENTRY_LIST_CAP))}
                </div>
              )}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', minWidth: 0 }}>
                <div style={{ width: '45%', maxWidth: 420, minWidth: 220, overflow: 'auto', borderRight: '1px solid #e5e7eb', padding: 6 }}>
                  {zipBusy ? (
                    <div style={{ padding: 12, color: '#6b7280', fontSize: 12 }}>{t('Loading...')}</div>
                  ) : zipEntries.length === 0 ? (
                    <div style={{ padding: 12, color: '#6b7280', fontSize: 12 }}>{t('No zip entries')}</div>
                  ) : (
                    zipEntries.slice(0, ZIP_ENTRY_LIST_CAP).map(entry => (
                      <button
                        key={entry.name}
                        type="button"
                        data-testid="workflow-file-big-view-zip-entry"
                        onClick={() => handleZipEntryClick(entry)}
                        disabled={entry.directory}
                        title={entry.name}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          padding: '5px 8px',
                          border: 'none',
                          borderRadius: 6,
                          background: zipSelected === entry.name ? '#e0e7ff' : 'transparent',
                          color: entry.directory ? '#6b7280' : '#111827',
                          fontSize: 12,
                          textAlign: 'left',
                          cursor: entry.directory ? 'default' : 'pointer',
                          marginBottom: 2,
                        }}
                      >
                        {entry.directory
                          ? <Folder size={14} style={{ flexShrink: 0 }} />
                          : <FileText size={14} style={{ flexShrink: 0 }} />}
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                        <span style={{ flexShrink: 0, color: '#6b7280', fontSize: 11 }}>
                          {entry.directory ? t('Directory') : formatSize(entry.size)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  {zipEntryBusy ? (
                    <div style={{ padding: 16, color: '#6b7280', fontSize: 12 }}>{t('Loading...')}</div>
                  ) : !zipSelected ? (
                    <div style={{ padding: 16, color: '#9ca3af', fontSize: 12 }}>{t('Click an entry to preview its text')}</div>
                  ) : (
                    <>
                      {zipEntryError && <div style={{ padding: '8px 14px', fontSize: 12, color: '#b91c1c' }}>{zipEntryError}</div>}
                      {zipEntryTruncated && (
                        <div style={{ padding: '6px 14px', fontSize: 12, background: '#fffbeb', color: '#92400e', borderBottom: '1px solid #fde68a' }}>
                          {t('Entry text truncated (first 64 KB shown)')}
                        </div>
                      )}
                      <pre
                        data-testid="workflow-file-big-view-zip-entry-text"
                        style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: 0, padding: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12, lineHeight: 1.5, color: '#111827', whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' }}
                      >
                        {zipEntryText}
                      </pre>
                      <div style={{ padding: '8px 14px', borderTop: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          data-testid="workflow-file-big-view-zip-extract"
                          onClick={handleExtractEntry}
                          disabled={extractBusy}
                          style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <Download size={13} />
                          {extractBusy ? t('Extracting…') : t('Extract to controlled directory')}
                        </button>
                        {extractError && <span style={{ color: '#b91c1c', fontSize: 12 }}>{extractError}</span>}
                        {extractResult?.path && (
                          <span data-testid="workflow-file-big-view-zip-extract-path" style={{ fontSize: 12, color: '#065f46', display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            <span style={{ flexShrink: 0 }}>{t('Extracted to')}:</span>
                            <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420 }}>
                              {extractResult.path}
                            </code>
                            <button
                              type="button"
                              onClick={handleCopyExtractPath}
                              style={{ ...btnStyle, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              {copiedPath ? <Check size={12} /> : <Copy size={12} />}
                              {copiedPath ? t('Copied') : t('Copy path')}
                            </button>
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : kind === 'missing' ? (
            <div style={{ padding: 24, color: '#b91c1c' }}>File not found on disk. The bound path may have been moved or deleted.</div>
          ) : (
            <div style={{ padding: 24, color: '#374151' }}>
              <p style={{ marginTop: 0 }}>Binary or unsupported file type — preview is metadata-only.</p>
              <FileMetadata meta={meta} preview={preview} />
            </div>
          )}
        </div>
      </motion.section>
    </motion.div>,
    document.body,
  );
}

const btnStyle: CSSProperties = {
  border: '1px solid #d1d5db',
  background: '#ffffff',
  color: '#111827',
  padding: '5px 10px',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};

// Pending-state spinner for header buttons; reuses the global loading-spin
// keyframes (index.css) so motion stays uniform across the app.
const spinIconStyle: CSSProperties = {
  animation: 'loading-spin 0.8s linear infinite',
  flexShrink: 0,
};

function tabBtnStyle(active: boolean): CSSProperties {
  return {
    border: active ? '1px solid #2563eb' : '1px solid transparent',
    background: active ? '#eff6ff' : 'transparent',
    color: active ? '#1d4ed8' : '#6b7280',
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}

function FileMetadata({ meta, preview }: { meta: FileMetaResult | null; preview: FilePreviewResult | null }) {
  const rows: Array<[string, string]> = [];
  if (preview?.path || meta?.file?.path) rows.push(['Path', String(preview?.path || meta?.file?.path || '')]);
  if (meta?.file?.name) rows.push(['Name', String(meta.file.name)]);
  if (preview?.mime || meta?.file?.mime) rows.push(['Type', String(preview?.mime || meta?.file?.mime || '')]);
  if (preview?.previewKind) rows.push(['Preview kind', String(preview.previewKind)]);
  const size = preview?.size ?? meta?.file?.size;
  if (typeof size === 'number') rows.push(['Size', formatSize(size)]);
  if (typeof meta?.file?.exists === 'boolean') rows.push(['Exists', String(meta.file.exists)]);
  if (meta?.file?.source) rows.push(['Source', String(meta.file.source)]);
  if (!rows.length) return <p style={{ color: '#6b7280' }}>No metadata available.</p>;
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px', fontSize: 13, margin: 0 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ color: '#6b7280', fontWeight: 600 }}>{k}</dt>
          <dd style={{ margin: 0, color: '#111827', wordBreak: 'break-all' }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
