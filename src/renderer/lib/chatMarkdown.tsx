import { useState, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Clipboard } from 'lucide-react';

function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;
  if (n.type === 'text') return String(n.value ?? '');
  if (Array.isArray(n.children)) {
    return (n.children as unknown[]).map(extractText).join('');
  }
  return '';
}

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-zinc-800 bg-[#0d0d10]">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-1.5">
        <span className="select-none text-[11px] text-zinc-500">
          {language || 'text'}
        </span>
        <button
          className="flex items-center gap-1 text-[11px] text-zinc-500 transition hover:text-zinc-300"
          onClick={handleCopy}
          type="button"
        >
          {copied ? (
            <>
              <Check className="size-3" />
              Copied!
            </>
          ) : (
            <>
              <Clipboard className="size-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4">
        <code className="font-mono text-[13px] leading-relaxed text-zinc-300">
          {children}
        </code>
      </pre>
    </div>
  );
}

export const chatMarkdownRemarkPlugins = [remarkGfm];

export const chatMarkdownComponents: Components = {
  pre({ children, node }) {
    const nodeChildren =
      typeof node === 'object' && node !== null && Array.isArray((node as { children?: unknown[] }).children)
        ? (node as { children: unknown[] }).children
        : undefined;
    const codeChild = nodeChildren?.[0] as Record<string, unknown> | undefined;

    if (codeChild && (codeChild as Record<string, string>).tagName === 'code') {
      const classNames = ((codeChild.properties as Record<string, string[]>)?.className ??
        []) as string[];
      const hasLanguage = classNames.some((className) => className.startsWith('language-'));

      if (!hasLanguage) {
        const text = extractText(codeChild).replace(/\n$/, '');
        return <CodeBlock language="">{text}</CodeBlock>;
      }
    }

    return <>{children as ReactNode}</>;
  },

  code({ className, children, ...rest }) {
    const match = /language-(\w+)/.exec(String(className ?? ''));
    if (match) {
      return (
        <CodeBlock language={match[1]}>
          {String(children).replace(/\n$/, '')}
        </CodeBlock>
      );
    }

    return (
      <code
        className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[0.875em] text-zinc-200"
        {...rest}
      >
        {children as ReactNode}
      </code>
    );
  },

  a({ href, children }) {
    const url = String(href ?? '');
    const isSafe = /^https?:|^mailto:|^#/i.test(url);
    if (!isSafe) {
      return <span className="text-indigo-400">{children as ReactNode}</span>;
    }
    return (
      <a
        className="text-indigo-400 underline underline-offset-2 transition hover:text-indigo-300"
        href={url}
        rel="noopener noreferrer"
        target="_blank"
      >
        {children as ReactNode}
      </a>
    );
  },
};
