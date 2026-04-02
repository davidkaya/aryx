import { FormField, TextInput, TextareaInput } from '@renderer/components/ui';
import { ModelSelect, ReasoningEffortSelect } from '@renderer/components/AgentConfigFields';
import { findModel, type ModelDefinition } from '@shared/domain/models';
import { resolveReasoningEffort } from '@shared/domain/models';
import type { WorkspaceAgentDefinition } from '@shared/domain/workspaceAgent';
import type { PatternDefinition } from '@shared/domain/pattern';
import { findWorkspaceAgentUsages } from '@shared/domain/workspaceAgent';
import { ToolingEditorShell } from './ToolingEditorShell';
import { Link2, Workflow } from 'lucide-react';

function validateWorkspaceAgent(agent: WorkspaceAgentDefinition): string | undefined {
  if (!agent.name.trim()) return 'Agent name is required.';
  if (!agent.model.trim()) return 'Model is required.';
  return undefined;
}

export function WorkspaceAgentEditor({
  agent,
  onChange,
  onBack,
  onSave,
  onDelete,
  availableModels,
  patterns,
}: {
  agent: WorkspaceAgentDefinition;
  onChange: (agent: WorkspaceAgentDefinition) => void;
  onBack: () => void;
  onSave: () => Promise<void>;
  onDelete?: () => Promise<void>;
  availableModels: ReadonlyArray<ModelDefinition>;
  patterns: PatternDefinition[];
}) {
  const validationError = validateWorkspaceAgent(agent);
  const usages = findWorkspaceAgentUsages(agent.id, patterns);

  return (
    <ToolingEditorShell
      disableSave={Boolean(validationError)}
      error={validationError}
      onBack={onBack}
      onDelete={onDelete}
      onSave={onSave}
      subtitle="Reusable agent definition"
      title={agent.name || 'Untitled Agent'}
    >
      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          General
        </h4>
        <FormField label="Name" required>
          <TextInput
            onChange={(value) => onChange({ ...agent, name: value })}
            placeholder="e.g. Code Reviewer, Architect, QA Agent"
            value={agent.name}
          />
        </FormField>
      </section>

      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          AI Configuration
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <ModelSelect
              models={availableModels}
              onChange={(model) => {
                const m = findModel(model, availableModels);
                onChange({
                  ...agent,
                  model,
                  reasoningEffort: resolveReasoningEffort(m, agent.reasoningEffort),
                });
              }}
              value={agent.model}
            />
          </div>
          <div>
            <ReasoningEffortSelect
              onChange={(value) => onChange({ ...agent, reasoningEffort: value })}
              supportedEfforts={findModel(agent.model, availableModels)?.supportedReasoningEfforts}
              value={agent.reasoningEffort}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Agent Identity
        </h4>
        <FormField label="Description">
          <TextareaInput
            onChange={(value) => onChange({ ...agent, description: value })}
            placeholder="A short description of this agent's role and purpose"
            rows={2}
            value={agent.description}
          />
        </FormField>
        <FormField label="Instructions">
          <TextareaInput
            onChange={(value) => onChange({ ...agent, instructions: value })}
            placeholder="System instructions that define this agent's behavior"
            rows={8}
            value={agent.instructions}
          />
        </FormField>
      </section>

      {usages.length > 0 && (
        <section className="space-y-3">
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Used By
          </h4>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass)]">
            {usages.map((usage) => (
              <div
                className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-3.5 py-2.5 last:border-b-0"
                key={usage.patternId}
              >
                <Workflow className="size-3.5 shrink-0 text-[var(--color-text-muted)]" />
                <span className="text-[13px] text-[var(--color-text-secondary)]">
                  {usage.patternName}
                </span>
                <Link2 className="ml-auto size-3 text-[var(--color-accent)]" />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            Referenced by {usages.length} pattern{usages.length === 1 ? '' : 's'}.
            Changes to this agent will affect all linked patterns.
          </p>
        </section>
      )}
    </ToolingEditorShell>
  );
}
