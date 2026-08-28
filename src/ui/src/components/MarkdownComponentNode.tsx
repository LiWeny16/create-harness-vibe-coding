import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { WorkflowComponentNodeState } from '../types';
import { useT } from '../i18n';
import { useSaveShortcut } from '../hooks/useSaveShortcut';
import ComponentBrandIcon from './ComponentBrandIcon';
import { MarkdownPreview } from './markdown/MarkdownPreview';
import { fetchNode } from './workflow/nodeRuntimeClient';

// Catch-all code-block editor for the fullscreen MDXEditor. Without a
// codeBlockPlugin, MDXEditor cannot load ANY document containing a ``` fence
// (mermaid included) — the contentEditable renders but stays hidden. This
// descriptor matches every language/meta and edits the fence body in a plain
// textarea, round-tripping the source through the code-block context so
// mermaid/code documents stay editable in the rich editor.
function buildCodeBlockDescriptor(useCodeBlockEditorContext: any) {
  function PlainCodeBlockEditor({ code, language }: { code: string; language: string; meta: string; nodeKey: string }) {
    const { setCode } = useCodeBlockEditorContext();
    return (
      <div className="workflow-markdown-code-block" data-language={language || 'text'}>
        <textarea
          className="workflow-markdown-code-block-textarea nodrag nopan nowheel"
          defaultValue={code}
          spellCheck={false}
          onChange={event => setCode(event.target.value)}
          onKeyDown={event => event.stopPropagation()}
        />
      </div>
    );
  }
  return {
    priority: -10,
    match: () => true,
    Editor: PlainCodeBlockEditor,
  };
}

type Props = {
  state: WorkflowComponentNodeState;
  onSave: (patch: Partial<WorkflowComponentNodeState>) => Promise<WorkflowComponentNodeState | null>;
  openRequest?: number;
};

export default function MarkdownComponentNode({ state, onSave, openRequest = 0 }: Props) {
  const t = useT();
  const [markdown, setMarkdown] = useState(state.markdown || '');
  const [fullscreenMarkdown, setFullscreenMarkdown] = useState(state.markdown || '');
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [mdxModule, setMdxModule] = useState<any>(null);
  const [editorLoadError, setEditorLoadError] = useState('');
  const [sourceMode, setSourceMode] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [fullscreenTab, setFullscreenTab] = useState<'edit' | 'preview'>('edit');
  const [settings, setSettings] = useState<{ fontSize: number; wordWrap: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const fullscreenOpenRef = useRef(false);
  const fullscreenDirtyRef = useRef(false);

  // D-004: consume fontSize/wordWrap from node settings, but only when the new
  // preview surfaces need them. The fetch is deferred until the first preview
  // render — never on card mount or fullscreen open — because legacy specs
  // (m5-performance) render markdown cards against fixtures without a
  // node-level GET route and assert zero failed API responses.
  useEffect(() => {
    if (!previewMode || settings) return;
    let cancelled = false;
    fetchNode(state.nodeId)
      .then(node => {
        if (cancelled) return;
        const values = node?.settings?.values || {};
        setSettings({
          fontSize: Number(values.fontSize) >= 10 && Number(values.fontSize) <= 32 ? Number(values.fontSize) : 14,
          wordWrap: values.wordWrap === undefined ? true : Boolean(values.wordWrap),
        });
      })
      .catch(() => {
        if (!cancelled) setSettings({ fontSize: 14, wordWrap: true });
      });
    return () => {
      cancelled = true;
    };
  }, [previewMode, settings, state.nodeId]);

  const editorFontSize = settings ? settings.fontSize : 14;
  const wordWrap = settings ? settings.wordWrap : true;
  const editorStyle = { fontSize: editorFontSize } as CSSProperties;
  if (!wordWrap) {
    editorStyle.whiteSpace = 'pre';
    editorStyle.overflowWrap = 'normal';
  }
  // The preview surface reuses the editor card chrome (border/padding/scroll)
  // but renders through MarkdownPreview, so it needs its own wrap semantics:
  // the editor class sets pre-wrap, which would distort rendered block layout.
  const previewStyle = {
    fontSize: editorFontSize,
    whiteSpace: wordWrap ? 'normal' : 'pre',
    ...(wordWrap ? {} : { overflowWrap: 'normal' }),
  } as CSSProperties;

  useEffect(() => {
    fullscreenOpenRef.current = fullscreenOpen;
  }, [fullscreenOpen]);

  useEffect(() => {
    const next = state.markdown || '';
    setMarkdown(next);
    if (!fullscreenOpenRef.current || !fullscreenDirtyRef.current) setFullscreenMarkdown(next);
    setError('');
  }, [state.markdown, state.revision]);

  useEffect(() => {
    if (!fullscreenOpen || mdxModule) return;
    let cancelled = false;
    setEditorLoadError('');
    Promise.all([
      import('@mdxeditor/editor'),
      import('@mdxeditor/editor/style.css'),
    ])
      .then(([module]) => {
        if (!cancelled) setMdxModule(module);
      })
      .catch((e: any) => {
        if (!cancelled) setEditorLoadError(e?.message || t('Failed to load Markdown editor'));
      });
    return () => {
      cancelled = true;
    };
  }, [fullscreenOpen, mdxModule, t]);

  useEffect(() => {
    if (sourceMode) return;
    const editor = editorRef.current;
    if (editor && editor.textContent !== markdown) editor.textContent = markdown;
  }, [markdown, sourceMode, previewMode]);

  // Returning from card preview remounts the editors; restore focus to the
  // contentEditable so the draft keeps its editing context. Gated on the
  // preview->edit transition only — never on mount (cards must not steal
  // focus from the terminal on workflow load).
  const wasPreviewRef = useRef(false);
  useEffect(() => {
    const wasPreview = wasPreviewRef.current;
    wasPreviewRef.current = previewMode;
    if (!wasPreview || previewMode || sourceMode) return;
    const editor = editorRef.current;
    if (editor) editor.focus();
  }, [previewMode, sourceMode]);

  const mdxPlugins = useMemo(() => {
    if (!mdxModule) return [];
    const {
      BlockTypeSelect,
      BoldItalicUnderlineToggles,
      CodeToggle,
      CreateLink,
      DiffSourceToggleWrapper,
      InsertThematicBreak,
      InsertTable,
      ListsToggle,
      Separator,
      UndoRedo,
      codeBlockPlugin,
      diffSourcePlugin,
      headingsPlugin,
      linkPlugin,
      listsPlugin,
      markdownShortcutPlugin,
      quotePlugin,
      tablePlugin,
      thematicBreakPlugin,
      toolbarPlugin,
      useCodeBlockEditorContext,
    } = mdxModule;
    return [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      linkPlugin(),
      thematicBreakPlugin(),
      tablePlugin(),
      // Catch-all code-block editor so ``` fences (incl. mermaid) load in the
      // rich editor instead of blanking the whole document.
      codeBlockPlugin({ codeBlockEditorDescriptors: [buildCodeBlockDescriptor(useCodeBlockEditorContext)] }),
      markdownShortcutPlugin(),
      diffSourcePlugin({ viewMode: 'rich-text' }),
      toolbarPlugin({
        toolbarContents: () => (
          <DiffSourceToggleWrapper options={['rich-text', 'source']}>
            <UndoRedo />
            <Separator />
            <BlockTypeSelect />
            <BoldItalicUnderlineToggles />
            <CodeToggle />
            <ListsToggle />
            <CreateLink />
            <InsertTable />
            <InsertThematicBreak />
          </DiffSourceToggleWrapper>
        ),
      }),
    ];
  }, [mdxModule]);

  const saveMarkdown = async (value: string) => {
    setSaving(true);
    setError('');
    try {
      const updated = await onSave({ revision: state.revision, markdown: value });
      if (updated) {
        setMarkdown(updated.markdown || '');
        setFullscreenMarkdown(updated.markdown || '');
        fullscreenDirtyRef.current = false;
        setSourceMode(false);
      }
    } catch (e: any) {
      setError(e?.message || t('Component save failed'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => saveMarkdown(markdown);
  const saveFullscreen = async () => saveMarkdown(fullscreenMarkdown);

  useSaveShortcut(saveFullscreen, fullscreenOpen);

  const openFullscreen = useCallback(() => {
    setFullscreenMarkdown(markdown);
    fullscreenDirtyRef.current = false;
    setFullscreenTab('edit');
    setFullscreenOpen(true);
  }, [markdown]);

  useEffect(() => {
    if (openRequest > 0) openFullscreen();
  }, [openFullscreen, openRequest]);

  const closeFullscreen = () => {
    fullscreenDirtyRef.current = false;
    setFullscreenOpen(false);
  };

  const updateFullscreenMarkdown = (value: string) => {
    fullscreenDirtyRef.current = true;
    setFullscreenMarkdown(value);
  };

  const stopCanvasKeys = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape' && fullscreenOpen) closeFullscreen();
  };

  const stopCanvasEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const MDXEditor = mdxModule?.MDXEditor;

  return (
    <div className="workflow-markdown-component nodrag nopan nowheel">
      <div className="workflow-component-node-subhead">
        <span><ComponentBrandIcon type="markdown" size={13} /> Markdown</span>
        <div className="workflow-component-node-subhead-actions">
          <button
            type="button"
            data-testid="workflow-markdown-source-toggle"
            aria-pressed={sourceMode ? 'true' : 'false'}
            title={sourceMode ? t('Use rich editor') : t('Use source editor')}
            onClick={() => setSourceMode(current => !current)}
          >
            {sourceMode ? t('Rich') : t('Source')}
          </button>
          <button
            type="button"
            data-testid="workflow-markdown-preview-toggle"
            aria-pressed={previewMode ? 'true' : 'false'}
            title={previewMode ? t('Edit') : t('Preview')}
            onClick={() => setPreviewMode(current => !current)}
          >
            {previewMode ? t('Edit') : t('Preview')}
          </button>
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

      {previewMode ? (
        <div
          className="workflow-markdown-node-editor nodrag nopan nowheel workflow-markdown-preview-surface"
          style={previewStyle}
          onPointerDown={stopCanvasEvent}
          onMouseDown={stopCanvasEvent}
          onWheel={stopCanvasEvent}
        >
          <MarkdownPreview
            markdown={markdown}
            containerTestId="workflow-markdown-preview-content"
          />
        </div>
      ) : sourceMode ? (
        <textarea
          data-testid="workflow-markdown-source-editor"
          className="workflow-markdown-source-editor nodrag nopan nowheel"
          style={editorStyle}
          value={markdown}
          onChange={event => setMarkdown(event.target.value)}
          onPointerDown={stopCanvasEvent}
          onMouseDown={stopCanvasEvent}
          onWheel={stopCanvasEvent}
          onKeyDown={stopCanvasKeys}
          spellCheck={false}
        />
      ) : (
        <div
          ref={editorRef}
          data-testid="workflow-markdown-node-editor"
          className="workflow-markdown-node-editor nodrag nopan nowheel"
          style={editorStyle}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          tabIndex={0}
          onPointerDown={stopCanvasEvent}
          onMouseDown={stopCanvasEvent}
          onWheel={stopCanvasEvent}
          onInput={event => setMarkdown(event.currentTarget.textContent || '')}
          onKeyDown={stopCanvasKeys}
        />
      )}

      {error && <div data-testid="workflow-component-node-error" className="workflow-component-node-error">{error}</div>}
      <div className="workflow-component-node-actions">
        <span>rev {state.revision}</span>
        <button
          type="button"
          data-testid="workflow-component-node-save"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {typeof document !== 'undefined' && fullscreenOpen && createPortal(
        <motion.div
              data-testid="workflow-component-fullscreen"
              data-component-type="markdown"
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
              onClick={event => { if (event.target === event.currentTarget) setFullscreenOpen(false); }}
            >
          <motion.section
            className="workflow-component-fullscreen-shell"
            role="dialog"
            aria-modal="true"
            aria-label={t('Markdown fullscreen editor')}
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.85 }}
          >
            <header className="workflow-component-fullscreen-header">
              <div>
                <ComponentBrandIcon type="markdown" size={15} />
                <span>{state.title || t('Markdown')}</span>
              </div>
              <div className="workflow-component-fullscreen-actions">
                <button
                  type="button"
                  data-testid="workflow-markdown-fullscreen-preview-tab"
                  aria-pressed={fullscreenTab === 'preview' ? 'true' : 'false'}
                  onClick={() => setFullscreenTab(current => (current === 'edit' ? 'preview' : 'edit'))}
                >
                  {fullscreenTab === 'edit' ? t('Preview') : t('Edit')}
                </button>
                <span>rev {state.revision}</span>
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
                  onClick={closeFullscreen}
                >
                  <X size={15} />
                </button>
              </div>
            </header>

                <div className="workflow-markdown-fullscreen-body">
                  {fullscreenTab === 'preview' ? (
                    <div
                      className="workflow-markdown-fullscreen-preview nodrag nopan nowheel"
                      style={{ height: '100%', minHeight: 0, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 22 }}
                      onPointerDown={stopCanvasEvent}
                      onMouseDown={stopCanvasEvent}
                      onWheel={stopCanvasEvent}
                    >
                      <MarkdownPreview
                        markdown={fullscreenMarkdown}
                        containerTestId="workflow-markdown-fullscreen-preview-content"
                      />
                    </div>
                  ) : editorLoadError ? (
                    <textarea
                      data-testid="workflow-markdown-fullscreen-source-editor"
                      className="workflow-markdown-source-editor workflow-markdown-fullscreen-fallback nodrag nopan nowheel"
                      value={fullscreenMarkdown}
                      onChange={event => updateFullscreenMarkdown(event.target.value)}
                      onPointerDown={stopCanvasEvent}
                      onMouseDown={stopCanvasEvent}
                      onWheel={stopCanvasEvent}
                      onKeyDown={stopCanvasKeys}
                      spellCheck={false}
                    />
                  ) : MDXEditor ? (
                    <div
                      data-testid="workflow-markdown-rich-editor"
                      className="workflow-markdown-rich-editor nodrag nopan nowheel"
                      onPointerDown={stopCanvasEvent}
                      onMouseDown={stopCanvasEvent}
                      onWheel={stopCanvasEvent}
                    >
                      <MDXEditor
                        key={`${state.nodeId}-${state.revision}`}
                        markdown={fullscreenMarkdown}
                        onChange={updateFullscreenMarkdown}
                        plugins={mdxPlugins}
                        autoFocus={{ defaultSelection: 'rootEnd', preventScroll: true }}
                        className="workflow-markdown-mdx-editor"
                        contentEditableClassName="workflow-markdown-rich-content"
                        placeholder={t('Write Markdown...')}
                      />
                    </div>
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
        </motion.div>,
        document.body,
      )}
    </div>
  );
}
