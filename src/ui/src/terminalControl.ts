import type { IDisposable, Terminal as XTerm } from '@xterm/xterm';
import { apiJson } from './api';

type TerminalWithSelection = Pick<XTerm, 'clearSelection' | 'getSelection' | 'hasSelection'>;
type TerminalWithParser = Pick<XTerm, 'parser'>;

export const MAX_TERMINAL_DROP_FILE_BYTES = 10 * 1024 * 1024;

const SPECIAL_COLOR_QUERY_IDS = [10, 11, 12];
const OSC_SPECIAL_COLOR_REPORT_RE = /\x1b\](?:10|11|12);rgb:[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}(?:\x07|\x1b\\)?/g;
const VISIBLE_SPECIAL_COLOR_REPORT_RE = /\]?(?:10|11|12);rgb:[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}\/[0-9a-fA-F]{1,4}\\?/g;
const WORKSPACE_ITEM_TRANSFER_TYPE = 'application/x-harness-workspace-item';

export type TerminalDropResponse = {
  files: {
    name: string;
    path: string;
    size: number;
    terminalText: string;
  }[];
  terminalInput: string;
};

export type TerminalSurface = 'drawer' | 'embedded';

export type TerminalContextInputItem = {
  kind: 'workspace-file' | 'workspace-folder';
  path: string;
  format: 'tag' | 'absolute-path';
  source?: 'workspace' | 'user-file';
  name?: string;
  mime?: string;
  size?: number;
};

export type TerminalContextInputResponse = {
  ok?: boolean;
  terminalInput?: string;
  inputOwnerId?: string;
};

type TerminalInputOwnerDetail = {
  sessionId: string;
  surface: TerminalSurface;
  inputOwnerId?: string;
};

export function stripTerminalResponseInput(data: string) {
  return String(data || '')
    .replace(OSC_SPECIAL_COLOR_REPORT_RE, '')
    .replace(VISIBLE_SPECIAL_COLOR_REPORT_RE, '');
}

export function installTerminalResponseGuards(term: TerminalWithParser): IDisposable[] {
  const swallowQuery = (data: string) => data.split(';').some(slot => slot.trim() === '?');
  const disposables = SPECIAL_COLOR_QUERY_IDS.map(id => term.parser.registerOscHandler(id, swallowQuery));
  disposables.push(term.parser.registerOscHandler(4, data => data.split(';').some(slot => slot.trim() === '?')));
  return disposables;
}

export function terminalShouldHandleKey(event: KeyboardEvent, live: boolean, term?: TerminalWithSelection | null) {
  if (event.key === 'F12') return false;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'c') {
    event.preventDefault();
    event.stopPropagation();
    void copyTerminalSelection(term);
    return false;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && ['i', 'j'].includes(key)) return false;
  if (!live) return false;
  return true;
}

export async function copyTerminalSelection(term?: TerminalWithSelection | null) {
  if (!term?.hasSelection()) return false;
  const selection = term.getSelection();
  if (!selection) return false;
  await writeClipboardText(selection);
  term.clearSelection();
  return true;
}

export async function pasteClipboardToTerminal(writeInput: (data: string) => void) {
  const text = await navigator.clipboard?.readText?.();
  const data = normalizeTerminalPaste(text || '');
  if (!data) return false;
  writeInput(data);
  return true;
}

export function normalizeTerminalPaste(text: string) {
  return String(text || '').replace(/\r?\n/g, '\r');
}

export async function uploadDroppedTerminalFiles(sessionId: string, files: FileList | File[]) {
  const payloadFiles = await Promise.all(Array.from(files || []).map(async (file) => {
    if (file.size > MAX_TERMINAL_DROP_FILE_BYTES) {
      throw new Error(`File is too large for terminal drop: ${file.name}`);
    }
    return {
      name: file.name || 'dropped-file',
      contentBase64: arrayBufferToBase64(await file.arrayBuffer()),
    };
  }));
  if (payloadFiles.length === 0) return { files: [], terminalInput: '' } satisfies TerminalDropResponse;
  return apiJson<TerminalDropResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/drop-files`, {
    method: 'POST',
    body: JSON.stringify({ files: payloadFiles }),
  });
}

export function announceTerminalInputOwner(detail: TerminalInputOwnerDetail) {
  window.dispatchEvent(new CustomEvent('harness:terminal-input-owner', { detail }));
}

export function readWorkspaceItem(dataTransfer: DataTransfer | null): TerminalContextInputItem | null {
  if (!dataTransfer) return null;
  const raw = dataTransfer.getData(WORKSPACE_ITEM_TRANSFER_TYPE);
  if (!raw) {
    const hasWorkspaceType = Array.from(dataTransfer.types || [])
      .some(type => String(type).toLowerCase() === WORKSPACE_ITEM_TRANSFER_TYPE);
    if (!hasWorkspaceType) return null;
    const path = normalizeWorkspacePath(dataTransfer.getData('text/plain'));
    return path ? { kind: 'workspace-file', path, format: 'tag', source: 'workspace' } : null;
  }
  try {
    const parsed = JSON.parse(raw) as {
      kind?: string;
      path?: string;
      format?: string;
      source?: string;
      name?: string;
      mime?: string;
      size?: unknown;
    };
    const path = normalizeWorkspacePath(parsed.path || dataTransfer.getData('text/plain'));
    if (!path) return null;
    const kind = parsed.kind === 'workspace-folder' ? 'workspace-folder' : 'workspace-file';
    const item: TerminalContextInputItem = {
      kind,
      path,
      format: parsed.format === 'absolute-path' ? 'absolute-path' : 'tag',
      source: parsed.source === 'user-file' ? 'user-file' : 'workspace',
    };
    if (parsed.name) item.name = parsed.name;
    if (parsed.mime) item.mime = parsed.mime;
    if (Number.isFinite(Number(parsed.size))) item.size = Number(parsed.size);
    return item;
  } catch {
    const path = normalizeWorkspacePath(dataTransfer.getData('text/plain'));
    return path ? { kind: 'workspace-file', path, format: 'tag', source: 'workspace' } : null;
  }
}

export async function sendTerminalContextInput(
  sessionId: string,
  items: TerminalContextInputItem[],
  options: {
    surface: TerminalSurface;
    inputOwnerId?: string;
    writeInput?: (data: string) => void;
  },
) {
  if (!sessionId || items.length === 0) return null;
  const payload = {
    inputOwnerId: options.inputOwnerId || `${sessionId}:${options.surface}`,
    surface: options.surface,
    items,
  };
  const response = await apiJson<TerminalContextInputResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/context-input`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  announceTerminalInputOwner({
    sessionId,
    surface: options.surface,
    inputOwnerId: response.inputOwnerId || payload.inputOwnerId,
  });
  if (response.terminalInput && options.writeInput) {
    options.writeInput(`${response.terminalInput} `);
  }
  return response;
}

export async function uploadUserFiles(files: FileList | File[]) {
  const payloadFiles = await Promise.all(Array.from(files || []).map(async (file) => {
    if (file.size > MAX_TERMINAL_DROP_FILE_BYTES) {
      throw new Error(`File is too large for terminal context: ${file.name}`);
    }
    return {
      name: file.name || 'user-file',
      mime: file.type || '',
      size: file.size,
      contentBase64: arrayBufferToBase64(await file.arrayBuffer()),
    };
  }));
  if (payloadFiles.length === 0) return [];
  const response = await apiJson<{ files?: { name?: string; path?: string; mime?: string; size?: number; terminalTag?: string; absolutePath?: string }[] }>('/api/user-files', {
    method: 'POST',
    body: JSON.stringify({ files: payloadFiles }),
  });
  return (response.files || [])
    .filter(file => file.path)
    .map(file => ({
      kind: 'workspace-file' as const,
      path: normalizeWorkspacePath(file.path || ''),
      format: 'tag' as const,
      source: 'user-file' as const,
      name: file.name,
      mime: file.mime,
      size: file.size,
    }));
}

export async function handleTerminalDrop(
  event: DragEvent,
  options: {
    sessionId: string;
    surface: TerminalSurface;
    writeInput?: (data: string) => void;
  },
) {
  event.preventDefault();
  event.stopPropagation();
  announceTerminalInputOwner({ sessionId: options.sessionId, surface: options.surface });
  const workspaceItem = readWorkspaceItem(event.dataTransfer);
  if (workspaceItem) {
    workspaceItem.format = event.shiftKey ? 'absolute-path' : 'tag';
    await sendTerminalContextInput(options.sessionId, [workspaceItem], options);
    return true;
  }
  const files = filesFromDataTransfer(event.dataTransfer);
  if (files.length > 0) {
    const items = await uploadUserFiles(files).catch(error => {
      console.warn('user file upload failed', error);
      return [];
    });
    if (items.length === 0) return false;
    await sendTerminalContextInput(options.sessionId, items, options);
    return true;
  }
  return false;
}

export async function handleTerminalPaste(
  event: ClipboardEvent,
  options: {
    sessionId: string;
    surface: TerminalSurface;
    writeInput?: (data: string) => void;
  },
) {
  let files = filesFromDataTransfer(event.clipboardData);
  const text = event.clipboardData?.getData?.('text/plain') || '';
  if (files.length === 0 && text) return false;
  if (files.length === 0) {
    files = await filesFromNavigatorClipboard();
  }
  if (files.length === 0) return false;
  event.preventDefault();
  event.stopPropagation();
  announceTerminalInputOwner({ sessionId: options.sessionId, surface: options.surface });
  const items = await uploadUserFiles(files).catch(error => {
    console.warn('user file upload failed', error);
    return [];
  });
  if (items.length === 0) return false;
  await sendTerminalContextInput(options.sessionId, items, options);
  return true;
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function normalizeWorkspacePath(value: string) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function filesFromDataTransfer(dataTransfer: DataTransfer | null) {
  const files = Array.from(dataTransfer?.files || []);
  for (const item of Array.from(dataTransfer?.items || [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && !files.some(existing => existing.name === file.name && existing.size === file.size)) files.push(file);
  }
  return files;
}

async function filesFromNavigatorClipboard() {
  const clipboard = navigator.clipboard as (Clipboard & { read?: () => Promise<ClipboardItem[]> }) | undefined;
  if (!clipboard?.read) return [];
  try {
    const items = await clipboard.read();
    const files: File[] = [];
    for (const item of items) {
      const mime = item.types.find(type => type.startsWith('image/'));
      if (!mime) continue;
      const blob = await item.getType(mime);
      const extension = mime.split('/')[1]?.split('+')[0] || 'png';
      files.push(new File([blob], `clipboard-shot.${extension}`, { type: mime }));
    }
    return files;
  } catch {
    return [];
  }
}
