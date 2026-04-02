import { useCallback, useMemo, useState } from 'react';
import { ArrowUp, FileText, X } from 'lucide-react';

import { useClickOutside } from '@renderer/hooks/useClickOutside';
import type { ProjectPromptFile, ProjectPromptInvocation, ProjectPromptVariable } from '@shared/domain/projectCustomization';

const promptVariablePattern = /\$\{input:([a-zA-Z0-9_-]+):[^}]+\}/g;

function resolvePromptTemplate(template: string, values: Record<string, string>): string {
  return template.replace(promptVariablePattern, (_match, name: string) => {
    return values[name] ?? '';
  });
}

function buildPromptInvocation(prompt: ProjectPromptFile, resolvedTemplate: string): ProjectPromptInvocation {
  const invocation: ProjectPromptInvocation = {
    id: prompt.id,
    name: prompt.name,
    sourcePath: prompt.sourcePath,
    resolvedPrompt: resolvedTemplate,
  };

  if (prompt.description) invocation.description = prompt.description;
  if (prompt.agent) invocation.agent = prompt.agent;
  if (prompt.model) invocation.model = prompt.model;
  if (prompt.tools?.length) invocation.tools = prompt.tools;

  return invocation;
}

/** Returns a human-friendly display label for source paths, shortening ancestor-relative segments. */
function formatPromptSourcePath(sourcePath: string): string {
  const normalized = sourcePath.replace(/\\/g, '/');
  const ancestorPrefix = /^(\.\.\/)+(\.github|\.claude)\//;
  if (ancestorPrefix.test(normalized)) {
    const segments = normalized.split('/').filter((s) => s !== '..');
    return `↑ ${segments.join('/')}`;
  }
  return normalized;
}

export interface ArmedPrompt {
  prompt: ProjectPromptFile;
  invocation: ProjectPromptInvocation;
}

export function InlinePromptPill({
  promptFiles,
  disabled,
  armedPrompt,
  onArm,
  onDisarm,
  onSubmit,
}: {
  promptFiles: ReadonlyArray<ProjectPromptFile>;
  disabled: boolean;
  armedPrompt?: ArmedPrompt | null;
  onArm?: (armed: ArmedPrompt) => void;
  onDisarm?: () => void;
  onSubmit: (invocation: ProjectPromptInvocation) => void;
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

  const armOrSubmit = useCallback((prompt: ProjectPromptFile, resolvedTemplate: string) => {
    const invocation = buildPromptInvocation(prompt, resolvedTemplate);
    if (prompt.argumentHint && onArm) {
      onArm({ prompt, invocation });
      handleClose();
    } else {
      onSubmit(invocation);
      handleClose();
    }
  }, [onArm, onSubmit, handleClose]);

  const handleSelectPrompt = useCallback((prompt: ProjectPromptFile) => {
    if (prompt.variables.length === 0) {
      armOrSubmit(prompt, prompt.template.trim());
    } else {
      setSelectedPrompt(prompt);
      setVariableValues({});
    }
  }, [armOrSubmit]);

  const handleSubmitWithVariables = useCallback(() => {
    if (!selectedPrompt) return;
    const resolved = resolvePromptTemplate(selectedPrompt.template, variableValues).trim();
    if (!resolved) return;
    armOrSubmit(selectedPrompt, resolved);
  }, [selectedPrompt, variableValues, armOrSubmit]);

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
      {armedPrompt ? (
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-status-success)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--color-status-success)] transition-all duration-200 hover:bg-[var(--color-status-success)]/20"
          onClick={() => onDisarm?.()}
          type="button"
          aria-label={`Disarm prompt: ${armedPrompt.prompt.name}`}
        >
          <FileText className="size-3" />
          <span className="max-w-[120px] truncate">{armedPrompt.prompt.name}</span>
          <X className="size-3 opacity-60" />
        </button>
      ) : (
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
      )}

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
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">
                {prompt.name}
              </span>
              {prompt.agent && (
                <span className="shrink-0 rounded bg-[var(--color-accent-sky)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-accent-sky)]">
                  {prompt.agent}
                </span>
              )}
              {prompt.model && (
                <span className="shrink-0 rounded bg-[var(--color-accent-purple)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-accent-purple)]">
                  {prompt.model}
                </span>
              )}
            </div>
            {prompt.description && (
              <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">
                {prompt.description}
              </div>
            )}
            <div className="mt-1 flex flex-wrap gap-1">
              {prompt.tools && prompt.tools.length > 0 && (
                <span className="rounded bg-[var(--color-status-warning)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-status-warning)]">
                  {prompt.tools.length} tool{prompt.tools.length === 1 ? '' : 's'}
                </span>
              )}
              {prompt.argumentHint && (
                <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] italic text-[var(--color-text-muted)]">
                  hint: {prompt.argumentHint}
                </span>
              )}
              {prompt.variables.map((v) => (
                <span
                  key={v.name}
                  className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]"
                >
                  {v.name}
                </span>
              ))}
            </div>
            {prompt.sourcePath.startsWith('..') && (
              <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                {formatPromptSourcePath(prompt.sourcePath)}
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
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">
              {prompt.name}
            </span>
            {prompt.model && (
              <span className="shrink-0 rounded bg-[var(--color-accent-purple)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-accent-purple)]">
                {prompt.model}
              </span>
            )}
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
        {prompt.argumentHint ? 'Arm prompt' : 'Send prompt'}
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
