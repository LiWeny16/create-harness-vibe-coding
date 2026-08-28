// ToolCard.tsx — tool call presentation for the chat stream. A registry keyed
// by tool name picks a specialized card (bash/command/edit/read/glob/grep);
// everything else falls back to RawToolCard showing name + input JSON and a
// collapsible output. Styling follows the existing panel conventions
// (var(--border)/var(--radius), 11-12px, mono for command text).
import type { ComponentType, CSSProperties } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import type { ChatTool } from '../../hooks/useChatStream';

type ToolCardProps = { tool: ChatTool };

function truncate(value: string, max = 220) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Best-effort primary argument extraction for compact one-line summaries.
function primaryArg(tool: ChatTool): string {
  const input = (tool.input && typeof tool.input === 'object' ? tool.input : {}) as Record<string, unknown>;
  const candidate = input.command ?? input.cmd ?? input.path ?? input.file_path ?? input.pattern ?? input.query ?? input.name;
  return candidate === undefined ? truncate(stringify(tool.input), 120) : truncate(String(candidate), 120);
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'rgba(249,250,251,0.86)',
  padding: '6px 8px',
  fontSize: 11,
  minWidth: 0,
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  fontWeight: 800,
  color: 'var(--muted)',
  minWidth: 0,
};

const monoStyle: CSSProperties = {
  fontFamily: '"Cascadia Mono", Consolas, monospace',
  fontSize: 11,
  wordBreak: 'break-all',
  whiteSpace: 'pre-wrap',
  color: 'var(--fg)',
  minWidth: 0,
};

function StatusIcon({ tool }: ToolCardProps) {
  if (tool.status === 'running') return <Loader2 size={11} className="chat-tool-spin" />;
  if (tool.status === 'error') return <AlertTriangle size={11} color="var(--danger)" />;
  return <CheckCircle2 size={11} color="var(--success)" />;
}

function OutputDetails({ label, output }: { label: string; output: unknown }) {
  const text = stringify(output);
  if (!text) return null;
  return (
    <details className="chat-tool-output" data-testid="chat-tool-output">
      <summary>{label}</summary>
      <pre style={{ ...monoStyle, margin: '4px 0 0' }}>{truncate(text, 8000)}</pre>
    </details>
  );
}

function CommandToolCard({ tool }: ToolCardProps) {
  return (
    <div style={cardStyle} data-testid={`chat-tool-${tool.name}`}>
      <div style={headerStyle}>
        <StatusIcon tool={tool} />
        <span>{tool.name}</span>
      </div>
      <pre style={{ ...monoStyle, margin: '4px 0 0' }}>{primaryArg(tool)}</pre>
      <OutputDetails label="output" output={tool.output} />
    </div>
  );
}

function FileToolCard({ tool }: ToolCardProps) {
  return (
    <div style={cardStyle} data-testid={`chat-tool-${tool.name}`}>
      <div style={headerStyle}>
        <StatusIcon tool={tool} />
        <span>{tool.name}</span>
        <span style={{ ...monoStyle, marginLeft: 'auto', color: 'var(--muted)' }}>{primaryArg(tool)}</span>
      </div>
      <OutputDetails label="output" output={tool.output} />
    </div>
  );
}

export function RawToolCard({ tool }: ToolCardProps) {
  return (
    <div style={cardStyle} data-testid="chat-tool-raw">
      <div style={headerStyle}>
        <StatusIcon tool={tool} />
        <span>{tool.name}</span>
      </div>
      <pre style={{ ...monoStyle, margin: '4px 0 0', color: 'var(--muted)' }}>{truncate(stringify(tool.input))}</pre>
      <OutputDetails label="output" output={tool.output} />
    </div>
  );
}

// Registry: add specialized presentations per tool name; unknown tools fall
// through to RawToolCard so no capability is ever hidden.
const TOOL_REGISTRY: Record<string, ComponentType<ToolCardProps>> = {
  bash: CommandToolCard,
  shell: CommandToolCard,
  command: CommandToolCard,
  edit: FileToolCard,
  write: FileToolCard,
  read: FileToolCard,
  glob: FileToolCard,
  grep: FileToolCard,
  search: FileToolCard,
};

export default function ToolCard({ tool }: ToolCardProps) {
  const key = String(tool.name || '').toLowerCase();
  const Card = TOOL_REGISTRY[key] || RawToolCard;
  return (
    <div className="chat-tool-card" data-call-id={tool.callId}>
      <Card tool={tool} />
    </div>
  );
}
