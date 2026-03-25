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
import {
  $isCodeNode,
  $createCodeNode,
  $createCodeHighlightNode,
  $isCodeHighlightNode,
  CodeNode,
  CodeHighlightNode,
} from '@lexical/code';
import hljs from 'highlight.js/lib/common';
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTabNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  CLEAR_EDITOR_COMMAND,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  TextNode,
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
  codeHighlight: {
    atrule: 'mc-tok-atrule',
    attr: 'mc-tok-attr',
    boolean: 'mc-tok-boolean',
    builtin: 'mc-tok-builtin',
    'class-name': 'mc-tok-function',
    comment: 'mc-tok-comment',
    constant: 'mc-tok-constant',
    deleted: 'mc-tok-deleted',
    function: 'mc-tok-function',
    inserted: 'mc-tok-inserted',
    keyword: 'mc-tok-keyword',
    number: 'mc-tok-number',
    operator: 'mc-tok-operator',
    property: 'mc-tok-property',
    punctuation: 'mc-tok-punctuation',
    regex: 'mc-tok-regex',
    selector: 'mc-tok-selector',
    string: 'mc-tok-string',
    symbol: 'mc-tok-symbol',
    tag: 'mc-tok-tag',
    url: 'mc-tok-string',
    variable: 'mc-tok-variable',
  },
  link: 'mc-link',
};

/* ── Code language helpers ─────────────────────────────── */

const CODE_LANGUAGE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Plain Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'xml', label: 'XML' },
];

const CODE_LANGUAGE_FRIENDLY_NAMES: Record<string, string> = Object.fromEntries(
  CODE_LANGUAGE_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label]),
);
// Add common aliases
CODE_LANGUAGE_FRIENDLY_NAMES['js'] = 'JavaScript';
CODE_LANGUAGE_FRIENDLY_NAMES['ts'] = 'TypeScript';
CODE_LANGUAGE_FRIENDLY_NAMES['py'] = 'Python';
CODE_LANGUAGE_FRIENDLY_NAMES['rb'] = 'Ruby';
CODE_LANGUAGE_FRIENDLY_NAMES['yml'] = 'YAML';
CODE_LANGUAGE_FRIENDLY_NAMES['md'] = 'Markdown';
CODE_LANGUAGE_FRIENDLY_NAMES['shell'] = 'Bash';
CODE_LANGUAGE_FRIENDLY_NAMES['sh'] = 'Bash';

function friendlyLanguageName(lang: string): string {
  return CODE_LANGUAGE_FRIENDLY_NAMES[lang.toLowerCase()] ?? lang;
}

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

/* ── Highlight.js tokenization ─────────────────────────── */

/** Maps a highlight.js scope name to a Lexical codeHighlight theme key. */
const HLJS_TYPE_MAP: Record<string, string> = {
  keyword: 'keyword',
  built_in: 'builtin',
  type: 'class-name',
  literal: 'boolean',
  number: 'number',
  operator: 'operator',
  punctuation: 'punctuation',
  property: 'property',
  regexp: 'regex',
  string: 'string',
  char: 'string',
  subst: 'variable',
  symbol: 'symbol',
  class: 'class-name',
  function: 'function',
  variable: 'variable',
  title: 'function',
  params: 'variable',
  comment: 'comment',
  doctag: 'comment',
  meta: 'comment',
  tag: 'tag',
  name: 'tag',
  attr: 'attr',
  attribute: 'attr',
  'selector-tag': 'selector',
  'selector-id': 'selector',
  'selector-class': 'selector',
  'template-tag': 'keyword',
  'template-variable': 'variable',
  addition: 'inserted',
  deletion: 'deleted',
  section: 'keyword',
  bullet: 'symbol',
  link: 'url',
  quote: 'string',
};

function mapHljsType(hljsType: string | undefined): string | undefined {
  if (!hljsType) return undefined;
  const primary = hljsType.split(' ')[0];
  return HLJS_TYPE_MAP[primary] ?? primary;
}

interface HljsToken {
  text: string;
  type?: string;
}

function tokenizeWithHljs(code: string, language: string): HljsToken[] {
  try {
    if (!language || !hljs.getLanguage(language)) return [{ text: code }];
    const result = hljs.highlight(code, { language, ignoreIllegals: true });
    return parseHljsHtml(result.value);
  } catch {
    return [{ text: code }];
  }
}

function parseHljsHtml(html: string): HljsToken[] {
  const tokens: HljsToken[] = [];
  const typeStack: Array<string | undefined> = [undefined];
  let pos = 0;

  while (pos < html.length) {
    if (html[pos] === '<') {
      if (html.startsWith('</span>', pos)) {
        typeStack.pop();
        pos += 7;
        continue;
      }
      const openMatch = /^<span class="hljs-([^"]*)">/i.exec(html.slice(pos));
      if (openMatch) {
        typeStack.push(openMatch[1]);
        pos += openMatch[0].length;
        continue;
      }
      // Unknown tag — treat '<' as text
      const currentType = typeStack[typeStack.length - 1];
      const prev = tokens[tokens.length - 1];
      if (prev && prev.type === currentType) prev.text += '<';
      else tokens.push({ text: '<', type: currentType });
      pos++;
    } else {
      const nextTag = html.indexOf('<', pos);
      const raw = nextTag === -1 ? html.slice(pos) : html.slice(pos, nextTag);
      if (raw) {
        const text = raw
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/&#39;/g, "'");
        const currentType = typeStack[typeStack.length - 1];
        const prev = tokens[tokens.length - 1];
        if (prev && prev.type === currentType) prev.text += text;
        else tokens.push({ text, type: currentType });
      }
      pos = nextTag === -1 ? html.length : nextTag;
    }
  }

  return tokens;
}

/* ── Code highlight plugin ────────────────────────────── */

function getAbsoluteOffset(
  codeNode: ReturnType<typeof $getNodeByKey>,
  point: { key: string; offset: number },
): number {
  if (!codeNode || !('getChildren' in codeNode)) return 0;
  let offset = 0;
  for (const child of (codeNode as CodeNode).getChildren()) {
    if (child.getKey() === point.key) return offset + point.offset;
    offset += $isLineBreakNode(child) ? 1 : child.getTextContentSize();
  }
  return offset;
}

function restoreSelectionFromOffsets(codeNode: CodeNode, anchorOff: number, focusOff: number) {
  const children = codeNode.getChildren();

  function findPoint(target: number) {
    let offset = 0;
    for (const child of children) {
      const size = $isLineBreakNode(child) ? 1 : child.getTextContentSize();
      if (offset + size > target || (offset + size === target && $isTextNode(child))) {
        return {
          key: child.getKey(),
          offset: target - offset,
          type: ($isTextNode(child) || $isCodeHighlightNode(child) ? 'text' : 'element') as 'text' | 'element',
        };
      }
      offset += size;
    }
    const last = children[children.length - 1];
    if (last) {
      return {
        key: last.getKey(),
        offset: $isLineBreakNode(last) ? 0 : last.getTextContentSize(),
        type: ($isTextNode(last) || $isCodeHighlightNode(last) ? 'text' : 'element') as 'text' | 'element',
      };
    }
    return { key: codeNode.getKey(), offset: 0, type: 'element' as const };
  }

  const anchor = findPoint(anchorOff);
  const focus = findPoint(focusOff);
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    selection.anchor.set(anchor.key, anchor.offset, anchor.type);
    selection.focus.set(focus.key, focus.offset, focus.type);
  }
}

/** Enables highlight.js-based syntax highlighting inside CodeNodes. */
function CodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const highlightingKeys = new Set<string>();

    function highlightCode(codeNode: CodeNode) {
      const nodeKey = codeNode.getKey();
      if (highlightingKeys.has(nodeKey)) return;

      const language = codeNode.getLanguage() || '';
      const code = codeNode.getTextContent();
      const tokens = tokenizeWithHljs(code, language);

      highlightingKeys.add(nodeKey);
      editor.update(() => {
        const current = $getNodeByKey(nodeKey);
        if (!$isCodeNode(current) || !current.isAttached()) return;

        // Save cursor as absolute character offset
        const sel = $getSelection();
        let anchorOff: number | undefined;
        let focusOff: number | undefined;
        if ($isRangeSelection(sel)) {
          anchorOff = getAbsoluteOffset(current, sel.anchor);
          focusOff = getAbsoluteOffset(current, sel.focus);
        }

        // Build new children from tokens
        current.clear();
        for (const token of tokens) {
          const highlightType = mapHljsType(token.type);
          const lines = token.text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) current.append($createLineBreakNode());
            const tabParts = lines[i].split('\t');
            for (let j = 0; j < tabParts.length; j++) {
              if (j > 0) current.append($createTabNode());
              if (tabParts[j].length > 0) {
                current.append($createCodeHighlightNode(tabParts[j], highlightType));
              }
            }
          }
        }

        // Restore cursor
        if (anchorOff !== undefined && focusOff !== undefined) {
          restoreSelectionFromOffsets(current, anchorOff, focusOff);
        }
      });
      queueMicrotask(() => highlightingKeys.delete(nodeKey));
    }

    const r1 = editor.registerNodeTransform(CodeNode, highlightCode);
    const r2 = editor.registerNodeTransform(TextNode, (node) => {
      const parent = node.getParent();
      if ($isCodeNode(parent)) highlightCode(parent);
    });
    const r3 = editor.registerNodeTransform(CodeHighlightNode, (node) => {
      const parent = node.getParent();
      if ($isCodeNode(parent)) {
        highlightCode(parent);
      } else if (parent) {
        node.replace($createTextNode(node.getTextContent()));
      }
    });

    return () => {
      r1();
      r2();
      r3();
    };
  }, [editor]);

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

/** Renders language-selector overlays for CodeNodes outside Lexical's managed DOM. */
function CodeBlockLanguagePlugin() {
  const [editor] = useLexicalComposerContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [codeBlocks, setCodeBlocks] = useState<Array<{ key: string; language: string }>>([]);

  useEffect(() => {
    function collectCodeBlocks() {
      editor.getEditorState().read(() => {
        const blocks: Array<{ key: string; language: string }> = [];
        for (const child of $getRoot().getChildren()) {
          if ($isCodeNode(child)) {
            blocks.push({ key: child.getKey(), language: child.getLanguage() ?? '' });
          }
        }
        setCodeBlocks((prev) => {
          if (
            prev.length === blocks.length &&
            prev.every((b, i) => b.key === blocks[i].key && b.language === blocks[i].language)
          ) {
            return prev;
          }
          return blocks;
        });
      });
    }

    const removeMutation = editor.registerMutationListener(CodeNode, collectCodeBlocks);
    const removeUpdate = editor.registerUpdateListener(collectCodeBlocks);
    return () => {
      removeMutation();
      removeUpdate();
    };
  }, [editor]);

  // Position overlays to match their corresponding code block elements
  const positionOverlays = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    for (const { key } of codeBlocks) {
      const codeEl = editor.getElementByKey(key);
      const overlayEl = container.querySelector(`[data-code-key="${key}"]`) as HTMLElement | null;
      if (!codeEl || !overlayEl) continue;

      const codeRect = codeEl.getBoundingClientRect();
      overlayEl.style.top = `${codeRect.top - containerRect.top + 3}px`;
      overlayEl.style.right = `${containerRect.right - codeRect.right + 4}px`;
    }
  }, [editor, codeBlocks]);

  // Reposition on editor updates, scroll, and resize
  useEffect(() => {
    if (codeBlocks.length === 0) return;
    positionOverlays();

    let rafId: number | null = null;
    const schedulePosition = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(positionOverlays);
    };

    const removeUpdate = editor.registerUpdateListener(schedulePosition);
    const rootElement = editor.getRootElement();
    rootElement?.addEventListener('scroll', schedulePosition);

    return () => {
      removeUpdate();
      rootElement?.removeEventListener('scroll', schedulePosition);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [editor, codeBlocks, positionOverlays]);

  const handleLanguageChange = useCallback(
    (nodeKey: string, newLanguage: string) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isCodeNode(node)) node.setLanguage(newLanguage || undefined);
      });
      requestAnimationFrame(() => editor.focus());
    },
    [editor],
  );

  if (codeBlocks.length === 0) return null;

  return (
    <div ref={containerRef} className="mc-code-overlays-container">
      {codeBlocks.map(({ key, language }) => (
        <div key={key} data-code-key={key} className="mc-code-lang-overlay">
          <select
            className="mc-code-lang-select"
            value={language}
            onChange={(e) => handleLanguageChange(key, e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {CODE_LANGUAGE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
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
        // Ensure a paragraph follows so the user can type below the code block
        if (!code.getNextSibling()) {
          code.insertAfter($createParagraphNode());
        }
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
      aria-pressed={active}
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
          <CodeBlockLanguagePlugin />
          {children}
        </div>

        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <CodeHighlightPlugin />
        <MarkdownShortcutPlugin transformers={[...markdownEditorTransformers]} />
        <ClearEditorPlugin />
        <ContentTrackingPlugin onContentChange={onContentChange} />
        <SubmitOnEnterPlugin disabled={disabled} submitRef={submitRef} />
        <MarkdownPastePlugin />
      </LexicalComposer>
    );
  },
);
