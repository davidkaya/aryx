import { useState } from 'react';
import { Check, Copy, Download, Upload, X } from 'lucide-react';

import type { WorkflowDefinition } from '@shared/domain/workflow';

type ExportFormat = 'yaml' | 'mermaid' | 'dot';
type ImportFormat = 'yaml' | 'json';

/* ── Export Modal ──────────────────────────────────────────── */

interface ExportModalProps {
  format: ExportFormat;
  content: string;
  onClose: () => void;
}

export function ExportModal({ format, content, onClose }: ExportModalProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-0)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 id="export-modal-title" className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">
            Export — {format.toUpperCase()}
          </h3>
          <button
            className="flex size-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <pre className="max-h-80 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 font-mono text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
          {content}
        </pre>

        <div className="mt-4 flex justify-end">
          <button
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-[13px] font-medium text-white transition-all duration-200 hover:bg-[var(--color-accent-sky)]"
            onClick={handleCopy}
            type="button"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Import Modal ──────────────────────────────────────────── */

interface ImportModalProps {
  onImport: (content: string, format: ImportFormat) => Promise<WorkflowDefinition>;
  onClose: () => void;
}

export function ImportModal({ onImport, onClose }: ImportModalProps) {
  const [content, setContent] = useState('');
  const [format, setFormat] = useState<ImportFormat>('yaml');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function handleImport() {
    if (!content.trim()) {
      setError('Please paste workflow content');
      return;
    }
    setError(null);
    setImporting(true);
    try {
      await onImport(content, format);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-0)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 id="import-modal-title" className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">
            Import Workflow
          </h3>
          <button
            className="flex size-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mb-3 flex gap-2">
          {(['yaml', 'json'] as const).map((f) => (
            <button
              key={f}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all duration-200 ${
                format === f
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
              onClick={() => setFormat(f)}
              type="button"
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        <textarea
          className="min-h-48 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 font-mono text-[12px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition-all duration-200 focus:border-[var(--color-accent)]/50"
          onChange={(e) => setContent(e.target.value)}
          placeholder={`Paste your ${format.toUpperCase()} workflow definition here...`}
          value={content}
        />

        {error && (
          <p className="mt-2 text-[12px] text-[var(--color-status-error)]">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)]"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-[13px] font-medium text-white transition-all duration-200 hover:bg-[var(--color-accent-sky)] disabled:opacity-50"
            disabled={importing || !content.trim()}
            onClick={handleImport}
            type="button"
          >
            <Upload className="size-3.5" />
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Export Dropdown ───────────────────────────────────────── */

interface ExportDropdownProps {
  onSelectFormat: (format: ExportFormat) => void;
  onClose: () => void;
}

export function ExportDropdown({ onSelectFormat, onClose }: ExportDropdownProps) {
  const formats: { value: ExportFormat; label: string }[] = [
    { value: 'yaml', label: 'YAML' },
    { value: 'mermaid', label: 'Mermaid' },
    { value: 'dot', label: 'DOT (Graphviz)' },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] py-1 shadow-xl"
        role="listbox"
      >
        {formats.map((f) => (
          <button
            key={f.value}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
            onClick={() => { onSelectFormat(f.value); onClose(); }}
            role="option"
            aria-selected={false}
            type="button"
          >
            <Download className="size-3" />
            {f.label}
          </button>
        ))}
      </div>
    </>
  );
}
