import { useCallback } from 'react';
import { AlertCircle, Radio, Trash2 } from 'lucide-react';

import type {
  RequestPortConfig,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowValidationIssue,
} from '@shared/domain/workflow';

interface RequestPortInspectorProps {
  node: WorkflowNode;
  validationIssues?: WorkflowValidationIssue[];
  onNodeChange: (nodeId: string, patch: Partial<WorkflowNode>) => void;
  onNodeConfigChange: (nodeId: string, config: WorkflowNodeConfig) => void;
  onNodeRemove: (nodeId: string) => void;
}

function InputField({
  label,
  value,
  onChange,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const base =
    'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50';
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</span>
      {multiline ? (
        <textarea
          className={`${base} min-h-20 resize-y`}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          value={value}
        />
      ) : (
        <input
          className={base}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          value={value}
        />
      )}
    </label>
  );
}

export function RequestPortInspector({
  node,
  validationIssues,
  onNodeChange,
  onNodeConfigChange,
  onNodeRemove,
}: RequestPortInspectorProps) {
  const config = node.config as RequestPortConfig;
  const nodeIssues = validationIssues?.filter((i) => i.nodeId === node.id) ?? [];

  const patchConfig = useCallback(
    (patch: Partial<RequestPortConfig>) => {
      onNodeConfigChange(node.id, { ...config, ...patch });
    },
    [node.id, config, onNodeConfigChange],
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-teal-500/10">
            <Radio className="size-4 text-teal-400" />
          </div>
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
            {node.label || 'Request Port'}
          </div>
        </div>
        <button
          className="flex size-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-status-error)]/10 hover:text-[var(--color-status-error)]"
          onClick={() => onNodeRemove(node.id)}
          title="Remove node"
          type="button"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* Label */}
      <InputField
        label="Label"
        onChange={(v) => onNodeChange(node.id, { label: v })}
        placeholder="Display label"
        value={node.label}
      />

      {/* Port ID */}
      <InputField
        label="Port ID"
        onChange={(v) => patchConfig({ portId: v })}
        placeholder="Unique port identifier"
        value={config.portId}
      />

      {/* Request Type */}
      <div className="space-y-1.5">
        <InputField
          label="Request Type"
          onChange={(v) => patchConfig({ requestType: v })}
          placeholder="e.g. string, boolean, number, json"
          value={config.requestType}
        />
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Supported types: string, boolean, number, json
        </p>
      </div>

      {/* Response Type */}
      <div className="space-y-1.5">
        <InputField
          label="Response Type"
          onChange={(v) => patchConfig({ responseType: v })}
          placeholder="e.g. string, boolean, number, json"
          value={config.responseType}
        />
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Supported types: string, boolean, number, json
        </p>
      </div>

      {/* Prompt */}
      <InputField
        label="Prompt"
        multiline
        onChange={(v) => patchConfig({ prompt: v || undefined })}
        placeholder="Optional question shown to the user"
        value={config.prompt ?? ''}
      />

      {/* Info callout */}
      <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 px-3 py-2 text-[12px] text-teal-400">
        This node pauses workflow execution and requests input from the user. The response is
        coerced to the specified response type before continuing.
      </div>

      {/* Validation issues */}
      {nodeIssues.length > 0 && (
        <div className="space-y-1">
          {nodeIssues.map((issue, i) => (
            <div
              className={`flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] ${
                issue.level === 'error'
                  ? 'bg-[var(--color-status-error)]/10 text-[var(--color-status-error)]'
                  : 'bg-[var(--color-status-warning)]/10 text-[var(--color-status-warning)]'
              }`}
              key={`${issue.field ?? 'v'}-${i}`}
            >
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
