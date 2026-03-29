import { useCallback, useMemo, useState } from 'react';
import { ArrowUp, FileText, X } from 'lucide-react';

import { useClickOutside } from '@renderer/hooks/useClickOutside';
import type { ProjectPromptFile, ProjectPromptVariable } from '@shared/domain/projectCustomization';

const promptVariablePattern = /\$\{input:([a-zA-Z0-9_-]+):[^}]+\}/g;

function resolvePromptTemplate(template: string, values: Record<string, string>): string {
  return template.replace(promptVariablePattern, (_match, name: string) => {
    return values[name] ?? '';
  });
}

export function InlinePromptPill({
  promptFiles,
  disabled,
  onSubmit,
}: {
  promptFiles: ReadonlyArray<ProjectPromptFile>;
  disabled: boolean;
  onSubmit: (resolvedContent: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<ProjectPromptFile | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const ref = useClickOutside<HTMLDivElement>(() => handleClose(), open);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSelectedPrompt(null);
    setVariableValues({});
  }, []);

  const handleSelectPrompt = useCallback((prompt: ProjectPromptFile) => {
    if (prompt.variables.length === 0) {
      onSubmit(prompt.template.trim());
      handleClose();
    } else {
      setSelectedPrompt(prompt);
      setVariableValues({});
    }
  }, [onSubmit, handleClose]);

  const handleSubmitWithVariables = useCallback(() => {
    if (!selectedPrompt) return;
    const resolved = resolvePromptTemplate(selectedPrompt.template, variableValues).trim();
    if (!resolved) return;
    onSubmit(resolved);
    handleClose();
  }, [selectedPrompt, variableValues, onSubmit, handleClose]);

  const handleVariableChange = useCallback((name: string, value: string) => {
    setVariableValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const allVariablesFilled = useMemo(() => {
    if (!selectedPrompt) return false;
    return selectedPrompt.variables.every((v) => (variableValues[v.name] ?? '').trim().length > 0);
  }, [selectedPrompt, variableValues]);

  if (promptFiles.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <FileText className="size-3" />
        Prompts
        <span className="text-[var(--color-text-muted)]">({promptFiles.length})</span>
      </button>

      {open && !disabled && (
        <div
          className="absolute bottom-full left-0 z-40 mb-1.5 w-80 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-xl"
          role="listbox"
        >
          {selectedPrompt ? (
            <PromptVariableForm
              onBack={() => {
                setSelectedPrompt(null);
                setVariableValues({});
              }}
              onSubmit={handleSubmitWithVariables}
              onVariableChange={handleVariableChange}
              prompt={selectedPrompt}
              submitDisabled={!allVariablesFilled}
              values={variableValues}
            />
          ) : (
            <PromptList
              onSelect={handleSelectPrompt}
              promptFiles={promptFiles}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PromptList({
  promptFiles,
  onSelect,
}: {
  promptFiles: ReadonlyArray<ProjectPromptFile>;
  onSelect: (prompt: ProjectPromptFile) => void;
}) {
  return (
    <div className="max-h-64 overflow-y-auto py-1">
      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        Prompt files
      </div>
      {promptFiles.map((prompt) => (
        <button
          key={prompt.id}
          className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-all duration-200 hover:bg-[var(--color-surface-3)]"
          onClick={() => onSelect(prompt)}
          role="option"
          type="button"
        >
          <FileText className="mt-0.5 size-3.5 shrink-0 text-[var(--color-text-muted)]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">
              {prompt.name}
            </div>
            {prompt.description && (
              <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">
                {prompt.description}
              </div>
            )}
            {prompt.variables.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {prompt.variables.map((v) => (
                  <span
                    key={v.name}
                    className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
                  >
                    {v.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function PromptVariableForm({
  prompt,
  values,
  submitDisabled,
  onVariableChange,
  onSubmit,
  onBack,
}: {
  prompt: ProjectPromptFile;
  values: Record<string, string>;
  submitDisabled: boolean;
  onVariableChange: (name: string, value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center gap-2">
        <button
          className="flex size-5 items-center justify-center rounded text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
          onClick={onBack}
          type="button"
          aria-label="Back to prompt list"
        >
          <X className="size-3" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">
            {prompt.name}
          </div>
          {prompt.description && (
            <div className="truncate text-[10px] text-[var(--color-text-muted)]">{prompt.description}</div>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        {prompt.variables.map((variable) => (
          <PromptVariableInput
            key={variable.name}
            onChange={(value) => onVariableChange(variable.name, value)}
            onSubmit={!submitDisabled ? onSubmit : undefined}
            value={values[variable.name] ?? ''}
            variable={variable}
          />
        ))}
      </div>

      <button
        className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition-all duration-200 ${
          submitDisabled
            ? 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'
            : 'brand-gradient-bg text-white hover:brightness-110'
        }`}
        disabled={submitDisabled}
        onClick={onSubmit}
        type="button"
      >
        <ArrowUp className="size-3.5" />
        Send prompt
      </button>
    </div>
  );
}

function PromptVariableInput({
  variable,
  value,
  onChange,
  onSubmit,
}: {
  variable: ProjectPromptVariable;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-[var(--color-text-secondary)]">
        {variable.name}
      </label>
      <input
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-all duration-200 focus:border-[var(--color-border-glow)] focus:outline-none"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={variable.placeholder}
        type="text"
        value={value}
      />
    </div>
  );
}
