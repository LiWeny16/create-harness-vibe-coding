import { useEffect, useRef } from 'react';

// Shared Ctrl/Cmd+S save shortcut for wf-ui node surfaces. Registers a
// capture-phase window keydown listener so it fires before the canvas
// bubble-phase handler (WorkflowRoute) and stopPropagation() prevents the
// graph-level save from double-firing while a node overlay is open.
export function useSaveShortcut(onSave: () => void, active: boolean): void {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      // Only lowercase 's'; Shift produces 'S' and must not trigger save.
      if (event.key !== 's') return;
      // Never steal Ctrl+S from the terminal (XOFF flow control there).
      const target = event.target as HTMLElement | null;
      if (target && typeof target.closest === 'function' && target.closest('.xterm')) return;
      event.preventDefault();
      event.stopPropagation();
      onSaveRef.current();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [active]);
}
