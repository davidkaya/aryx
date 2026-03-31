import { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ExternalLink,
  FileEdit,
  FileText,
  Globe,
  Server,
} from 'lucide-react';

import type { PermissionDetail } from '@shared/contracts/sidecar';

export function PermissionDetailView({ detail }: { detail: PermissionDetail }) {
  switch (detail.kind) {
    case 'shell':
      return <ShellDetail detail={detail} />;
    case 'write':
      return <WriteDetail detail={detail} />;
    case 'read':
      return <ReadDetail detail={detail} />;
    case 'mcp':
      return <McpDetail detail={detail} />;
    case 'url':
      return <UrlDetail detail={detail} />;
    case 'memory':
      return <MemoryDetail detail={detail} />;
    case 'custom-tool':
      return <CustomToolDetail detail={detail} />;
    case 'hook':
      return <HookDetail detail={detail} />;
    default:
      return null;
  }
}

export function permissionDetailSummary(detail: PermissionDetail): string | undefined {
  switch (detail.kind) {
    case 'shell':
      return detail.command ? truncate(detail.command, 80) : undefined;
    case 'write':
      return detail.fileName;
    case 'read':
      return detail.path;
    case 'url':
      return detail.url;
    case 'mcp':
      return detail.serverName
        ? `${detail.serverName} → ${detail.toolTitle ?? ''}`
        : detail.toolTitle;
    case 'memory':
      return detail.subject;
    case 'custom-tool':
      return detail.toolDescription ? truncate(detail.toolDescription, 80) : undefined;
    case 'hook':
      return detail.hookMessage ? truncate(detail.hookMessage, 80) : undefined;
    default:
      return undefined;
  }
}

/* ── Display helpers ─────────────────────────────────────────── */

/** Recursively parse string values that contain JSON objects or arrays (display-time only). */
function deepParseJsonStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return deepParseJsonStrings(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deepParseJsonStrings);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = deepParseJsonStrings(v);
    }
    return result;
  }
  return value;
}

/* ── Kind-specific renderers ────────────────────────────────── */

function ShellDetail({ detail }: { detail: PermissionDetail }) {
  return (
    <div className="mt-2.5 space-y-2">
      {detail.intention && <IntentionLine text={detail.intention} />}
      {detail.warning && (
        <div className="flex items-start gap-1.5 rounded-md bg-[var(--color-status-error)]/10 px-2.5 py-1.5 text-[11px] text-[var(--color-status-error)]">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>{detail.warning}</span>
        </div>
      )}
      {detail.command && <CommandBlock text={detail.command} />}
      {detail.possiblePaths && detail.possiblePaths.length > 0 && (
        <MetaList label="Paths" items={detail.possiblePaths} />
      )}
      {detail.possibleUrls && detail.possibleUrls.length > 0 && (
        <MetaList label="URLs" items={detail.possibleUrls} />
      )}
    </div>
  );
}

function WriteDetail({ detail }: { detail: PermissionDetail }) {
  return (
    <div className="mt-2.5 space-y-2">
      {detail.intention && <IntentionLine text={detail.intention} />}
      {detail.fileName && (
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-primary)]">
          <FileEdit className="size-3 shrink-0 text-[var(--color-text-muted)]" />
          <code className="font-mono">{detail.fileName}</code>
        </div>
      )}
      {detail.diff && <DiffBlock text={detail.diff} />}
      {!detail.diff && detail.newFileContents && (
        <CollapsibleCode label="New file contents" text={detail.newFileContents} />
      )}
    </div>
  );
}

function ReadDetail({ detail }: { detail: PermissionDetail }) {
  return (
    <div className="mt-2.5 space-y-2">
      {detail.intention && <IntentionLine text={detail.intention} />}
      {detail.path && (
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-primary)]">
          <FileText className="size-3 shrink-0 text-[var(--color-text-muted)]" />
          <code className="font-mono">{detail.path}</code>
        </div>
      )}
    </div>
  );
}

function McpDetail({ detail }: { detail: PermissionDetail }) {
  return (
    <div className="mt-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {detail.serverName && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-muted)] px-2 py-0.5 text-[var(--color-text-accent)]">
            <Server className="size-2.5" />
            {detail.serverName}
          </span>
        )}
        {detail.toolTitle && <span className="text-[var(--color-text-primary)]">{detail.toolTitle}</span>}
        {detail.readOnly && (
          <span className="rounded-full bg-[var(--color-status-success)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-status-success)]">
            read-only
          </span>
        )}
      </div>
      {detail.args && Object.keys(detail.args).length > 0 && (
        <CollapsibleCode label="Arguments" text={JSON.stringify(deepParseJsonStrings(detail.args), null, 2)} />
      )}
    </div>
  );
}

function UrlDetail({ detail }: { detail: PermissionDetail }) {
  return (
    <div className="mt-2.5 space-y-2">
      {detail.intention && <IntentionLine text={detail.intention} />}
      {detail.url && (
        <div className="flex items-center gap-1.5 rounded-md bg-[var(--color-surface-2)]/60 px-2.5 py-1.5 text-[11px] text-[var(--color-accent-sky)]">
          <Globe className="size-3 shrink-0" />
          <code className="min-w-0 flex-1 break-all font-mono">{detail.url}</code>
          <ExternalLink className="size-3 shrink-0 text-[var(--color-text-muted)]" />
        </div>
      )}
    </div>
  );
}

function MemoryDetail({ detail }: { detail: PermissionDetail }) {
  return (
    <div className="mt-2.5 space-y-1.5">
      {detail.subject && (
        <div className="flex items-center gap-1.5 text-[11px]">
          <BookOpen className="size-3 shrink-0 text-[var(--color-text-muted)]" />
          <span className="font-medium text-[var(--color-text-primary)]">{detail.subject}</span>
        </div>
      )}
      {detail.fact && (
        <p className="rounded-md bg-[var(--color-surface-2)]/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--color-text-primary)]">
          {detail.fact}
        </p>
      )}
      {detail.citations && (
        <p className="text-[10px] text-[var(--color-text-muted)]">
          Source: <span className="text-[var(--color-text-secondary)]">{detail.citations}</span>
        </p>
      )}
    </div>
  );
}

function CustomToolDetail({ detail }: { detail: PermissionDetail }) {
  return (
    <div className="mt-2.5 space-y-2">
      {detail.toolDescription && (
        <p className="text-[11px] text-[var(--color-text-secondary)]">{detail.toolDescription}</p>
      )}
      {detail.args && Object.keys(detail.args).length > 0 && (
        <CollapsibleCode label="Arguments" text={JSON.stringify(deepParseJsonStrings(detail.args), null, 2)} />
      )}
    </div>
  );
}

function HookDetail({ detail }: { detail: PermissionDetail }) {
  return (
    <div className="mt-2.5 space-y-2">
      {detail.hookMessage && (
        <div className="flex items-start gap-1.5 rounded-md bg-[var(--color-status-warning)]/10 px-2.5 py-1.5 text-[11px] text-[var(--color-status-warning)]">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>{detail.hookMessage}</span>
        </div>
      )}
      {detail.args && Object.keys(detail.args).length > 0 && (
        <CollapsibleCode label="Arguments" text={JSON.stringify(deepParseJsonStrings(detail.args), null, 2)} />
      )}
    </div>
  );
}

/* ── Shared primitives──────────────────────────────────────── */

function IntentionLine({ text }: { text: string }) {
  return <p className="text-[11px] italic text-[var(--color-text-secondary)]">{text}</p>;
}

function CommandBlock({ text }: { text: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-[var(--color-surface-1)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-status-success)]">
      {text}
    </pre>
  );
}

function DiffBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <CollapsibleCode label="Diff" text={text} defaultExpanded>
      <pre className="max-h-48 overflow-auto rounded-md bg-[var(--color-surface-1)] px-3 py-2 font-mono text-[10px] leading-relaxed">
        {lines.map((line, i) => {
          let color = 'text-[var(--color-text-secondary)]';
          if (line.startsWith('+')) color = 'text-[var(--color-status-success)]';
          else if (line.startsWith('-')) color = 'text-[var(--color-status-error)]';
          else if (line.startsWith('@@')) color = 'text-[var(--color-accent-sky)]';
          return (
            <div className={color} key={i}>
              {line}
            </div>
          );
        })}
      </pre>
    </CollapsibleCode>
  );
}

/* ── JSON syntax highlighting ───────────────────────────────── */

const jsonTokenPattern =
  /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],])/g;

function JsonHighlighted({ json }: { json: string }) {
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of json.matchAll(jsonTokenPattern)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) elements.push(json.slice(lastIndex, idx));

    if (match[1] && match[2]) {
      // Object key + colon
      elements.push(
        <span key={key++} className="text-[var(--color-text-accent)]">{match[1]}</span>,
        <span key={key++} className="text-[var(--color-text-muted)]">{match[2]}</span>,
      );
    } else if (match[1]) {
      // String value
      elements.push(<span key={key++} className="text-[var(--color-status-success)]">{match[1]}</span>);
    } else if (match[3]) {
      // true / false / null
      elements.push(<span key={key++} className="text-[var(--color-accent-sky)]">{match[3]}</span>);
    } else if (match[4]) {
      // Number
      elements.push(<span key={key++} className="text-[var(--color-accent-sky)]">{match[4]}</span>);
    } else if (match[5]) {
      // Structural punctuation
      elements.push(<span key={key++} className="text-[var(--color-text-muted)]">{match[5]}</span>);
    }

    lastIndex = idx + match[0].length;
  }

  if (lastIndex < json.length) elements.push(json.slice(lastIndex));
  return <>{elements}</>;
}

function CollapsibleCode({
  label,
  text,
  children,
  defaultExpanded = false,
}: {
  label: string;
  text: string;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isJson = text.trimStart().startsWith('{') || text.trimStart().startsWith('[');

  return (
    <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
      <button
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[10px] font-medium text-[var(--color-text-muted)] transition-all duration-200 hover:text-[var(--color-text-secondary)]"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <ChevronDown
          className={`size-2.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
        {label}
      </button>
      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)] px-2.5 py-1.5">
          {children ?? (
            <pre className="max-h-48 overflow-auto font-mono text-[10px] leading-relaxed text-[var(--color-text-primary)]">
              {isJson ? <JsonHighlighted json={text} /> : text}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function MetaList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="text-[10px] text-[var(--color-text-muted)]">
      <span className="font-medium">{label}:</span>{' '}
      <span className="text-[var(--color-text-secondary)]">{items.join(', ')}</span>
    </div>
  );
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}
