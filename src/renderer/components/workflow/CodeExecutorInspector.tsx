import { useCallback } from 'react';
import { AlertCircle, Code, Trash2 } from 'lucide-react';

import type {
  CodeExecutorConfig,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowValidationIssue,
} from '@shared/domain/workflow';

interface CodeExecutorInspectorProps {
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

export function CodeExecutorInspector({
  node,
  validationIssues,
  onNodeChange,
  onNodeConfigChange,
  onNodeRemove,
}: CodeExecutorInspectorProps) {
  const config = node.config as CodeExecutorConfig;
  const nodeIssues = validationIssues?.filter((i) => i.nodeId === node.id) ?? [];

  const patchConfig = useCallback(
    (patch: Partial<CodeExecutorConfig>) => {
      onNodeConfigChange(node.id, { ...config, ...patch });
    },
    [node.id, config, onNodeConfigChange],
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-sky-500/10">
            <Code className="size-4 text-sky-400" />
          </div>
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
            {node.label || 'Code Executor'}
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

      {/* Implementation */}
      <label className="block space-y-1.5">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
          Implementation
        </span>
        <textarea
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 font-mono text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50 min-h-20 resize-y"
          onChange={(e) => patchConfig({ implementation: e.target.value })}
          placeholder="e.g. return-input, return-text:hello, state:set:scope:key:{&quot;value&quot;:1}"
          value={config.implementation ?? ''}
        />
      </label>

      {/* Directives help */}
      <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-[12px] text-sky-400">
        <div className="mb-1.5 font-medium">Supported directives</div>
        <ul className="space-y-0.5 text-[11px]">
          <li>
            <code className="font-mono">return-input</code> — Forward incoming payload
          </li>
          <li>
            <code className="font-mono">return-text:&lt;text&gt;</code> — Emit literal text
          </li>
          <li>
            <code className="font-mono">return-json:&lt;json&gt;</code> — Emit parsed JSON
          </li>
          <li>
            <code className="font-mono">state:set:&lt;scope&gt;:&lt;key&gt;:&lt;json&gt;</code> — Set state value
          </li>
          <li>
            <code className="font-mono">state:get:&lt;scope&gt;:&lt;key&gt;</code> — Read state value
          </li>
        </ul>
      </div>

      {/* Input Type */}
      <InputField
        label="Input Type"
        onChange={(v) => patchConfig({ inputType: v || undefined })}
        placeholder="Optional type annotation"
        value={config.inputType ?? ''}
      />

      {/* Output Type */}
      <InputField
        label="Output Type"
        onChange={(v) => patchConfig({ outputType: v || undefined })}
        placeholder="Optional type annotation"
        value={config.outputType ?? ''}
      />

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
