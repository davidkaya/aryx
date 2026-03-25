import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { ClearEditorPlugin } from '@lexical/react/LexicalClearEditorPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $isCodeNode, $createCodeNode } from '@lexical/code';
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CLEAR_EDITOR_COMMAND,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  type EditorThemeClasses,
  type LexicalEditor,
} from 'lexical';
import { Bold, Braces, Code, Italic, List, ListOrdered } from 'lucide-react';

import {
  inspectMarkdownPaste,
  markdownEditorNamespace,
  markdownEditorNodes,
  markdownEditorTransformers,
} from '@renderer/lib/markdownEditor';
import { prepareChatMessageContent } from '@shared/utils/chatMessage';

/* ── Lexical theme ────────────────────────────────────── */

const editorTheme: EditorThemeClasses = {
  paragraph: 'mc-p',
  heading: { h1: 'mc-h1', h2: 'mc-h2', h3: 'mc-h3' },
  text: {
    bold: 'mc-bold',
    italic: 'mc-italic',
    code: 'mc-inline-code',
    strikethrough: 'mc-strikethrough',
    underline: 'mc-underline',
  },
  list: {
    ul: 'mc-ul',
    ol: 'mc-ol',
    listitem: 'mc-li',
    nested: { listitem: 'mc-nested-li' },
  },
  quote: 'mc-blockquote',
  code: 'mc-code-block',
  link: 'mc-link',
};

/* ── Public API ───────────────────────────────────────── */

export interface MarkdownComposerHandle {
  submit(): void;
  focus(): void;
}

export interface MarkdownComposerProps {
  disabled: boolean;
  placeholder: string;
  onSubmit: (markdown: string) => void;
  onContentChange: (hasContent: boolean) => void;
  children?: React.ReactNode;
}

/* ── Internal plugins ─────────────────────────────────── */

/** Captures the editor instance into a ref for the imperative handle. */
function EditorRefPlugin({ editorRef }: { editorRef: React.MutableRefObject<LexicalEditor | null> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);
  return null;
}

/** Syncs the React `disabled` prop to the Lexical editable state. */
function EditablePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);
  return null;
}

/** Reports whether the editor has meaningful content. */
function ContentTrackingPlugin({ onContentChange }: { onContentChange: (hasContent: boolean) => void }) {
  const [editor] = useLexicalComposerContext();
  const lastHasContent = useRef(false);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const hasContent = $getRoot().getTextContent().trim().length > 0;
        if (hasContent !== lastHasContent.current) {
          lastHasContent.current = hasContent;
          onContentChange(hasContent);
        }
      });
    });
  }, [editor, onContentChange]);

  return null;
}

/** Enter sends, Shift+Enter inserts a newline. */
function SubmitOnEnterPlugin({
  disabled,
  submitRef,
}: {
  disabled: boolean;
  submitRef: React.RefObject<() => void>;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event && !event.shiftKey) {
          event.preventDefault();
          if (!disabled) submitRef.current();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, disabled, submitRef]);

  return null;
}

/** Auto-imports pasted markdown into rich structure when the editor is empty. */
function MarkdownPastePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent)) return false;

        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;

        const inspection = inspectMarkdownPaste(text);
        if (!inspection.shouldImportMarkdown) return false;

        // Only auto-import when the editor is empty so we never clobber existing content
        const isEmpty = editor
          .getEditorState()
          .read(() => $getRoot().getTextContent().trim().length === 0);

        if (!isEmpty) return false;

        event.preventDefault();
        editor.update(() => {
          $convertFromMarkdownString(inspection.normalizedText, [...markdownEditorTransformers]);
          $getRoot().selectEnd();
        });

        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  return null;
}

/* ── Toolbar ──────────────────────────────────────────── */

interface ToolbarState {
  isBold: boolean;
  isItalic: boolean;
  isCode: boolean;
  blockType: string;
}

function getSelectionBlockType(): string {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return 'paragraph';

  const anchorNode = selection.anchor.getNode();
  if (anchorNode.getKey() === 'root') return 'paragraph';

  const topElement = anchorNode.getTopLevelElementOrThrow();
  if ($isHeadingNode(topElement)) return topElement.getTag();
  if ($isListNode(topElement)) return topElement.getListType() === 'number' ? 'ol' : 'ul';
  if ($isCodeNode(topElement)) return 'code';
  if ($isQuoteNode(topElement)) return 'quote';
  return 'paragraph';
}

function ToolbarPlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<ToolbarState>({
    isBold: false,
    isItalic: false,
    isCode: false,
    blockType: 'paragraph',
  });

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        setState({
          isBold: selection.hasFormat('bold'),
          isItalic: selection.hasFormat('italic'),
          isCode: selection.hasFormat('code'),
          blockType: getSelectionBlockType(),
        });
      });
    });
  }, [editor]);

  const preventFocus = useCallback((e: React.MouseEvent) => e.preventDefault(), []);

  const formatBold = useCallback(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'), [editor]);
  const formatItalic = useCallback(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'), [editor]);
  const formatInlineCode = useCallback(() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code'), [editor]);

  const toggleBulletList = useCallback(() => {
    if (state.blockType === 'ul') {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    }
  }, [editor, state.blockType]);

  const toggleNumberedList = useCallback(() => {
    if (state.blockType === 'ol') {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    }
  }, [editor, state.blockType]);

  const toggleCodeBlock = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;

      const anchorNode = selection.anchor.getNode();
      if (anchorNode.getKey() === 'root') return;

      const topElement = anchorNode.getTopLevelElementOrThrow();

      if ($isCodeNode(topElement)) {
        const p = $createParagraphNode();
        const text = topElement.getTextContent();
        if (text) p.append($createTextNode(text));
        topElement.replace(p);
        p.selectEnd();
      } else {
        const code = $createCodeNode();
        const text = topElement.getTextContent();
        if (text) code.append($createTextNode(text));
        topElement.replace(code);
        code.select();
      }
    });
  }, [editor]);

  return (
    <div className="flex items-center gap-0.5 border-b border-zinc-700/50 px-2 py-1">
      <ToolbarButton active={state.isBold} disabled={disabled} icon={<Bold className="size-3.5" />} onClick={formatBold} onMouseDown={preventFocus} title="Bold (Ctrl+B)" />
      <ToolbarButton active={state.isItalic} disabled={disabled} icon={<Italic className="size-3.5" />} onClick={formatItalic} onMouseDown={preventFocus} title="Italic (Ctrl+I)" />
      <ToolbarButton active={state.isCode} disabled={disabled} icon={<Code className="size-3.5" />} onClick={formatInlineCode} onMouseDown={preventFocus} title="Inline Code" />
      <div className="mx-1 h-4 w-px bg-zinc-700/50" />
      <ToolbarButton active={state.blockType === 'ul'} disabled={disabled} icon={<List className="size-3.5" />} onClick={toggleBulletList} onMouseDown={preventFocus} title="Bullet List" />
      <ToolbarButton active={state.blockType === 'ol'} disabled={disabled} icon={<ListOrdered className="size-3.5" />} onClick={toggleNumberedList} onMouseDown={preventFocus} title="Numbered List" />
      <ToolbarButton active={state.blockType === 'code'} disabled={disabled} icon={<Braces className="size-3.5" />} onClick={toggleCodeBlock} onMouseDown={preventFocus} title="Code Block" />
    </div>
  );
}

function ToolbarButton({
  active,
  disabled,
  icon,
  onClick,
  onMouseDown,
  title,
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  title: string;
}) {
  return (
    <button
      className={`flex size-7 items-center justify-center rounded transition ${
        active
          ? 'bg-indigo-600/30 text-indigo-300'
          : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
      } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={onMouseDown}
      tabIndex={-1}
      title={title}
      type="button"
    >
      {icon}
    </button>
  );
}

/* ── MarkdownComposer ─────────────────────────────────── */

export const MarkdownComposer = forwardRef<MarkdownComposerHandle, MarkdownComposerProps>(
  function MarkdownComposer({ disabled, placeholder, onSubmit, onContentChange, children }, ref) {
    const editorRef = useRef<LexicalEditor | null>(null);
    const submitRef = useRef(() => {});

    // Keep the submit function up to date without re-registering the command
    submitRef.current = () => {
      const editor = editorRef.current;
      if (!editor) return;

      let content: string | undefined;
      editor.getEditorState().read(() => {
        const markdown = $convertToMarkdownString([...markdownEditorTransformers]);
        content = prepareChatMessageContent(markdown) ?? undefined;
      });

      if (content) {
        editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
        onSubmit(content);
      }
    };

    useImperativeHandle(ref, () => ({
      submit: () => submitRef.current(),
      focus: () => editorRef.current?.focus(),
    }));

    const initialConfig = {
      namespace: markdownEditorNamespace,
      nodes: [...markdownEditorNodes],
      onError: (error: Error) => console.error('[MarkdownComposer]', error),
      theme: editorTheme,
    };

    return (
      <LexicalComposer initialConfig={initialConfig}>
        <EditorRefPlugin editorRef={editorRef} />
        <EditablePlugin disabled={disabled} />
        <ToolbarPlugin disabled={disabled} />

        <div className="markdown-composer-content">
          <RichTextPlugin
            contentEditable={
              <ContentEditable className="markdown-composer-editable" />
            }
            placeholder={
              <div className="markdown-composer-placeholder">{placeholder}</div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          {children}
        </div>

        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <MarkdownShortcutPlugin transformers={[...markdownEditorTransformers]} />
        <ClearEditorPlugin />
        <ContentTrackingPlugin onContentChange={onContentChange} />
        <SubmitOnEnterPlugin disabled={disabled} submitRef={submitRef} />
        <MarkdownPastePlugin />
      </LexicalComposer>
    );
  },
);
