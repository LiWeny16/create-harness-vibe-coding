import type { CSSProperties } from 'react';
import claudeIcon from './assets/icons/claude.svg';
import deepseekIcon from './assets/icons/deepseek.svg';
import geminiIcon from './assets/icons/gemini.svg';
import openaiIcon from './assets/icons/openai-chatgpt.svg';
import opencodeIcon from './assets/icons/opencode.svg';
import qwenIcon from './assets/icons/qwen.svg';

type RuntimeBrand = {
  accent: string;
  icon?: string;
  label: string;
};

function normalizedRuntime(runtime: string | undefined | null) {
  return String(runtime || '').trim().toLowerCase();
}

export function runtimeBrand(runtime: string | undefined | null): RuntimeBrand {
  const key = normalizedRuntime(runtime);
  if (key === 'claude' || key === 'cc' || key === 'claude-code') {
    return { label: 'Claude Code', icon: claudeIcon, accent: '#c47738' };
  }
  if (key === 'codex') {
    return { label: 'Codex', icon: openaiIcon, accent: '#111827' };
  }
  if (key === 'opencode' || key === 'open-code') {
    return { label: 'OpenCode', icon: opencodeIcon, accent: '#6b7280' };
  }
  if (key === 'gemini' || key === 'gemini-cli') {
    return { label: 'Gemini', icon: geminiIcon, accent: '#6366f1' };
  }
  if (key === 'deepseek' || key === 'deepseek-tui') {
    return { label: 'DeepSeek', icon: deepseekIcon, accent: '#2563eb' };
  }
  if (key === 'qwen' || key === 'qwen-code') {
    return { label: 'Qwen', icon: qwenIcon, accent: '#1d4ed8' };
  }
  return { label: runtime || 'Terminal', accent: '#64748b' };
}

export function runtimeDisplayName(runtime: string | undefined | null) {
  return runtimeBrand(runtime).label;
}

export function runtimeAccentColor(runtime: string | undefined | null) {
  return runtimeBrand(runtime).accent;
}

export function RuntimeBrandMark({
  runtime,
  size = 14,
  style,
}: {
  runtime: string | undefined | null;
  size?: number;
  style?: CSSProperties;
}) {
  const brand = runtimeBrand(runtime);
  const letter = (brand.label || '?').slice(0, 1).toUpperCase();
  return (
    <span
      className="runtime-brand-mark"
      data-runtime={normalizedRuntime(runtime) || undefined}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(4, Math.round(size * 0.28)),
        display: 'inline-grid',
        placeItems: 'center',
        flexShrink: 0,
        color: brand.accent,
        background: 'rgba(255,255,255,0.72)',
        boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.08)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {brand.icon ? (
        <img src={brand.icon} alt="" style={{ width: Math.round(size * 0.78), height: Math.round(size * 0.78), display: 'block', objectFit: 'contain' }} />
      ) : (
        <span style={{ fontSize: Math.max(9, Math.round(size * 0.62)), fontWeight: 800, lineHeight: 1 }}>{letter}</span>
      )}
    </span>
  );
}

export function RuntimeBrandLabel({
  runtime,
  model,
  size = 12,
  style,
}: {
  runtime: string | undefined | null;
  model?: string | null;
  size?: number;
  style?: CSSProperties;
}) {
  const brand = runtimeBrand(runtime);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        minWidth: 0,
        color: 'var(--muted)',
        ...style,
      }}
    >
      <RuntimeBrandMark runtime={runtime} size={size} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--fg)', fontWeight: 700 }}>{brand.label}</span>
        {model ? ` / ${model}` : ''}
      </span>
    </span>
  );
}
