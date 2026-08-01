import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown } from 'lucide-react';
import { RuntimeBrandMark } from '../runtimeBrand';

export type RuntimeChoice = {
  id: string;
  label: string;
  command?: string | null;
  status?: string | null;
};

type Props = {
  runtimes: RuntimeChoice[];
  value: string;
  onChange: (runtimeId: string) => void;
  testId?: string;
  disabled?: boolean;
  style?: CSSProperties;
};

function containsTarget(container: HTMLDivElement, target: EventTarget | null) {
  return target instanceof Node && container.contains(target);
}

export default function RuntimePicker({ runtimes, value, onChange, testId, disabled = false, style }: Props) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => runtimes.find(runtime => runtime.id === value) || runtimes[0] || null,
    [runtimes, value],
  );

  const chooseRuntime = (runtimeId: string) => {
    onChange(runtimeId);
    setOpen(false);
  };

  return (
    <div
      data-testid={testId}
      onBlur={event => {
        if (!containsTarget(event.currentTarget, event.relatedTarget)) setOpen(false);
      }}
      style={{ position: 'relative', minWidth: 0, ...style }}
    >
      <button
        type="button"
        disabled={disabled || runtimes.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        style={{
          width: '100%',
          height: 34,
          padding: '0 8px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg)',
          color: 'var(--fg)',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          opacity: disabled || runtimes.length === 0 ? 0.55 : 1,
        }}
      >
        {selected ? <RuntimeBrandMark runtime={selected.id} size={17} /> : null}
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', fontSize: 11, fontWeight: 700 }}>
          {selected?.label || 'No runtime'}
        </span>
        <ChevronDown size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
      </button>

      {open && runtimes.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 30,
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: 224,
            overflow: 'auto',
            padding: 4,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg)',
            boxShadow: '0 12px 28px rgba(15,23,42,0.12)',
          }}
        >
          {runtimes.map(runtime => (
            <button
              key={runtime.id}
              type="button"
              role="option"
              aria-selected={runtime.id === selected?.id}
              onMouseDown={event => event.preventDefault()}
              onClick={() => chooseRuntime(runtime.id)}
              style={{
                width: '100%',
                minHeight: 32,
                padding: '5px 7px',
                borderRadius: 'var(--radius)',
                color: 'var(--fg)',
                background: runtime.id === selected?.id ? 'var(--surface)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                textAlign: 'left',
              }}
            >
              <RuntimeBrandMark runtime={runtime.id} size={17} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{runtime.label}</span>
                {runtime.command ? <span style={{ display: 'block', fontSize: 9, color: 'var(--muted)' }}>{runtime.command}</span> : null}
              </span>
              {runtime.status ? <span style={{ fontSize: 9, color: 'var(--muted)' }}>{runtime.status}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
