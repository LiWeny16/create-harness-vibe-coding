import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { WorkflowComponentNodeState } from '../types';
import { useT } from '../i18n';
import ComponentBrandIcon from './ComponentBrandIcon';

type SceneElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  backgroundColor?: string;
};

type Scene = {
  elements?: SceneElement[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

type Props = {
  state: WorkflowComponentNodeState;
  onSave: (patch: Partial<WorkflowComponentNodeState>) => Promise<WorkflowComponentNodeState | null>;
};

function normalizeScene(value: unknown): Scene {
  if (!value || typeof value !== 'object') {
    return { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} };
  }
  const scene = value as Scene;
  return {
    elements: Array.isArray(scene.elements) ? scene.elements : [],
    appState: scene.appState || { viewBackgroundColor: '#ffffff' },
    files: scene.files || {},
  };
}

function hasExcalidrawElementShape(element: SceneElement) {
  const candidate = element as any;
  return typeof candidate.version === 'number'
    && typeof candidate.versionNonce === 'number'
    && typeof candidate.seed === 'number';
}

function sceneToExcalidrawInitialData(scene: Scene, excalidrawModule: any) {
  const rawElements = scene.elements || [];
  const elements = rawElements.every(hasExcalidrawElementShape)
    ? rawElements
    : excalidrawModule.convertToExcalidrawElements(rawElements as any, { regenerateIds: false });
  return {
    elements,
    appState: {
      viewBackgroundColor: '#ffffff',
      ...(scene.appState || {}),
    },
    files: scene.files || {},
    scrollToContent: true,
  };
}

function cleanAppState(appState: Record<string, any>) {
  return {
    viewBackgroundColor: appState.viewBackgroundColor || '#ffffff',
    theme: appState.theme,
    gridSize: appState.gridSize,
    gridStep: appState.gridStep,
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: appState.zoom,
    name: appState.name,
  };
}

function copyScene(value: Scene): Scene {
  return {
    elements: [...(value.elements || [])],
    appState: { ...(value.appState || {}) },
    files: { ...(value.files || {}) },
  };
}

export default function ExcalidrawComponentNode({ state, onSave }: Props) {
  const t = useT();
  const [scene, setScene] = useState<Scene>(() => normalizeScene(state.scene));
  const [draftScene, setDraftScene] = useState<Scene>(() => normalizeScene(state.scene));
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [fullscreenKey, setFullscreenKey] = useState(0);
  const [initialFullscreenScene, setInitialFullscreenScene] = useState<Scene>(() => normalizeScene(state.scene));
  const [excalidrawModule, setExcalidrawModule] = useState<any>(null);
  const [editorLoaded, setEditorLoaded] = useState(false);
  const [editorLoadError, setEditorLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fullscreenEditorRef = useRef<HTMLDivElement>(null);
  const draftSceneRef = useRef<Scene>(normalizeScene(state.scene));
  const draftPublishFrameRef = useRef<number | null>(null);
  const elements = useMemo(() => scene.elements || [], [scene.elements]);

  useEffect(() => {
    const next = normalizeScene(state.scene);
    setScene(next);
    setDraftScene(next);
    draftSceneRef.current = next;
    setError('');
  }, [state.scene, state.revision]);

  useEffect(() => () => {
    if (draftPublishFrameRef.current !== null) {
      window.cancelAnimationFrame(draftPublishFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!fullscreenOpen || excalidrawModule) return;
    let cancelled = false;
    setEditorLoadError('');
    Promise.all([
      import('@excalidraw/excalidraw'),
      import('@excalidraw/excalidraw/index.css'),
    ])
      .then(([module]) => {
        if (!cancelled) setExcalidrawModule(module);
      })
      .catch((e: any) => {
        if (!cancelled) setEditorLoadError(e?.message || t('Failed to load Excalidraw editor'));
      });
    return () => {
      cancelled = true;
    };
  }, [fullscreenOpen, excalidrawModule, t]);

  const ExcalidrawEditor = excalidrawModule?.Excalidraw;
  const excalidrawUIOptions = useMemo(() => ({
    canvasActions: {
      loadScene: false,
      saveAsImage: false,
    },
  }), []);
  const initialData = useMemo(() => {
    if (!fullscreenOpen || !excalidrawModule) return null;
    return sceneToExcalidrawInitialData(initialFullscreenScene, excalidrawModule);
  }, [excalidrawModule, fullscreenKey, fullscreenOpen, initialFullscreenScene]);
  const editorCanRender = Boolean(ExcalidrawEditor && initialData);
  const publishDraftScene = useCallback((next: Scene) => {
    draftSceneRef.current = next;
    if (draftPublishFrameRef.current !== null) return;
    draftPublishFrameRef.current = window.requestAnimationFrame(() => {
      draftPublishFrameRef.current = null;
      setDraftScene(draftSceneRef.current);
    });
  }, []);

  const handleEditorChange = useCallback((nextElements: any, nextAppState: any, nextFiles: any) => {
    publishDraftScene({
      elements: [...nextElements],
      appState: cleanAppState(nextAppState),
      files: nextFiles || {},
    });
  }, [publishDraftScene]);

  useEffect(() => {
    setEditorLoaded(false);
    if (!fullscreenOpen || !editorCanRender) return;
    let cancelled = false;
    const detectRealEditor = () => {
      if (cancelled) return;
      if (fullscreenEditorRef.current?.querySelector('.excalidraw')) {
        setEditorLoaded(true);
        return;
      }
      requestAnimationFrame(detectRealEditor);
    };
    requestAnimationFrame(detectRealEditor);
    return () => {
      cancelled = true;
    };
  }, [editorCanRender, fullscreenKey, fullscreenOpen]);

  const saveScene = async (value: Scene) => {
    setSaving(true);
    setError('');
    try {
      const updated = await onSave({ revision: state.revision, scene: value });
      if (updated) {
        const next = normalizeScene(updated.scene);
        setScene(next);
        setDraftScene(next);
        draftSceneRef.current = next;
      }
    } catch (e: any) {
      setError(e?.message || t('Component save failed'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => saveScene(scene);
  const saveFullscreen = async () => saveScene(draftSceneRef.current);

  const openFullscreen = () => {
    const nextScene = copyScene(scene);
    setDraftScene(nextScene);
    draftSceneRef.current = nextScene;
    setInitialFullscreenScene(nextScene);
    setFullscreenKey(current => current + 1);
    setFullscreenOpen(true);
  };

  const stopCanvasEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const stopCanvasKeys = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') setFullscreenOpen(false);
  };

  return (
    <div
      data-testid="workflow-excalidraw-node"
      data-component-type="excalidraw"
      data-node-id={state.nodeId}
      data-revision={String(state.revision)}
      className="workflow-excalidraw-component nodrag nopan nowheel"
    >
      <div className="workflow-component-node-subhead">
        <span>{t('Excalidraw scene')}</span>
        <div className="workflow-component-node-subhead-actions">
          <button
            type="button"
            data-testid="workflow-component-node-expand"
            title={t('Open fullscreen editor')}
            aria-label={t('Open fullscreen editor')}
            onClick={openFullscreen}
          >
            <Maximize2 size={12} />
          </button>
        </div>
      </div>
      <div className="workflow-excalidraw-stage" aria-label="Excalidraw scene preview">
        {elements.map(element => (
          <div
            key={element.id}
            data-testid="workflow-excalidraw-element"
            data-element-type={element.type}
            className="workflow-excalidraw-element"
            style={{
              left: element.x,
              top: element.y,
              width: element.width,
              height: element.height,
              borderColor: element.strokeColor || '#6965DB',
              background: element.backgroundColor || 'rgba(105,101,219,0.16)',
            }}
          />
        ))}
      </div>
      {error && <div data-testid="workflow-component-node-error" className="workflow-component-node-error">{error}</div>}
      <div className="workflow-component-node-actions">
        <span>{elements.length} elements - rev {state.revision}</span>
        <button
          type="button"
          data-testid="workflow-component-node-save"
          onClick={save}
          disabled={saving}
      >
        {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {fullscreenOpen && (
            <motion.div
              data-testid="workflow-component-fullscreen"
              data-component-type="excalidraw"
              data-node-id={state.nodeId}
              className="workflow-component-fullscreen-backdrop nodrag nopan nowheel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              onPointerDown={stopCanvasEvent}
              onMouseDown={stopCanvasEvent}
              onWheel={stopCanvasEvent}
              onKeyDown={stopCanvasKeys}
            >
              <motion.section
                className="workflow-component-fullscreen-shell workflow-excalidraw-fullscreen-shell"
                role="dialog"
                aria-modal="true"
                aria-label={t('Excalidraw fullscreen editor')}
                initial={{ opacity: 0, scale: 0.96, y: 18 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 12 }}
                transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.85 }}
              >
                <header className="workflow-component-fullscreen-header">
                  <div>
                    <ComponentBrandIcon type="excalidraw" size={16} />
                    <span>{state.title || t('Diagram')}</span>
                  </div>
                  <div className="workflow-component-fullscreen-actions">
                    <span>{(draftScene.elements || []).length} elements - rev {state.revision}</span>
                    <button
                      type="button"
                      data-testid="workflow-component-fullscreen-save"
                      onClick={saveFullscreen}
                      disabled={saving}
                    >
                      {saving ? t('Saving...') : t('Save')}
                    </button>
                    <button
                      type="button"
                      data-testid="workflow-component-fullscreen-close"
                      title={t('Close')}
                      aria-label={t('Close')}
                      onClick={() => setFullscreenOpen(false)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </header>

                <div
                  ref={fullscreenEditorRef}
                  data-testid="workflow-excalidraw-fullscreen-editor"
                  data-editor-loaded={editorLoaded ? 'true' : 'false'}
                  className="workflow-excalidraw-fullscreen-editor nodrag nopan nowheel"
                  onPointerDown={stopCanvasEvent}
                  onMouseDown={stopCanvasEvent}
                  onWheel={stopCanvasEvent}
                >
                  {editorLoadError ? (
                    <pre className="workflow-component-fullscreen-loading">{editorLoadError}</pre>
                  ) : ExcalidrawEditor && initialData ? (
                    <>
                      <ExcalidrawEditor
                        key={`${state.nodeId}-${state.revision}-${fullscreenKey}`}
                        initialData={initialData}
                        onChange={handleEditorChange}
                        autoFocus
                        handleKeyboardGlobally={false}
                        viewModeEnabled={false}
                        UIOptions={excalidrawUIOptions}
                      />
                      {!editorLoaded && (
                        <div data-testid="workflow-fullscreen-loading" className="workflow-component-fullscreen-loading">
                          {t('Loading editor...')}
                        </div>
                      )}
                    </>
                  ) : (
                    <div data-testid="workflow-fullscreen-loading" className="workflow-component-fullscreen-loading">
                      {t('Loading editor...')}
                    </div>
                  )}
                </div>

                {(error || editorLoadError) && (
                  <div data-testid="workflow-component-node-error" className="workflow-component-node-error">
                    {error || editorLoadError}
                  </div>
                )}
              </motion.section>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
