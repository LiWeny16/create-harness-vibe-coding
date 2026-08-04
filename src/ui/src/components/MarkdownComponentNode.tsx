import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { WorkflowComponentNodeState } from '../types';
import { useT } from '../i18n';
import ComponentBrandIcon from './ComponentBrandIcon';

type Props = {
  state: WorkflowComponentNodeState;
  onSave: (patch: Partial<WorkflowComponentNodeState>) => Promise<WorkflowComponentNodeState | null>;
};

export default function MarkdownComponentNode({ state, onSave }: Props) {
  const t = useT();
  const [markdown, setMarkdown] = useState(state.markdown || '');
  const [fullscreenMarkdown, setFullscreenMarkdown] = useState(state.markdown || '');
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [mdxModule, setMdxModule] = useState<any>(null);
  const [editorLoadError, setEditorLoadError] = useState('');
  const [sourceMode, setSourceMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMarkdown(state.markdown || '');
    setFullscreenMarkdown(state.markdown || '');
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
  }, [markdown, sourceMode]);

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
      diffSourcePlugin,
      headingsPlugin,
      linkPlugin,
      listsPlugin,
      markdownShortcutPlugin,
      quotePlugin,
      tablePlugin,
      thematicBreakPlugin,
      toolbarPlugin,
    } = mdxModule;
    return [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      linkPlugin(),
      thematicBreakPlugin(),
      tablePlugin(),
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

  const stopCanvasKeys = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape' && fullscreenOpen) setFullscreenOpen(false);
  };

  const stopCanvasEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const openFullscreen = () => {
    setFullscreenMarkdown(markdown);
    setFullscreenOpen(true);
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
            data-testid="workflow-component-node-expand"
            title={t('Open fullscreen editor')}
            aria-label={t('Open fullscreen editor')}
            onClick={openFullscreen}
          >
            <Maximize2 size={12} />
          </button>
        </div>
      </div>

      {sourceMode ? (
        <textarea
          data-testid="workflow-markdown-source-editor"
          className="workflow-markdown-source-editor nodrag nopan nowheel"
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
                  onClick={() => setFullscreenOpen(false)}
                >
                  <X size={15} />
                </button>
              </div>
            </header>

                <div className="workflow-markdown-fullscreen-body">
                  {editorLoadError ? (
                    <textarea
                      data-testid="workflow-markdown-fullscreen-source-editor"
                      className="workflow-markdown-source-editor workflow-markdown-fullscreen-fallback nodrag nopan nowheel"
                      value={fullscreenMarkdown}
                      onChange={event => setFullscreenMarkdown(event.target.value)}
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
                        onChange={(value: string) => setFullscreenMarkdown(value)}
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
