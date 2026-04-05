import { useCallback, useState } from 'react';
import { AlertCircle, FunctionSquare, Plus, Trash2, X } from 'lucide-react';

import type {
  FunctionExecutorConfig,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowValidationIssue,
} from '@shared/domain/workflow';

interface FunctionExecutorInspectorProps {
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
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const base =
    'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50';
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</span>
      <input
        className={base}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

const builtInFunctions = [
  { value: 'identity', label: 'identity — Pass through input' },
  { value: 'return-parameter', label: 'return-parameter — Return a parameter value' },
  { value: 'concat-text', label: 'concat-text — Concatenate text values' },
  { value: 'state:get', label: 'state:get — Read state value' },
  { value: 'state:set', label: 'state:set — Set state value' },
] as const;

function stringifyValue(v: unknown): string {
  if (typeof v === 'string') return v;
  return JSON.stringify(v) ?? '';
}

export function FunctionExecutorInspector({
  node,
  validationIssues,
  onNodeChange,
  onNodeConfigChange,
  onNodeRemove,
}: FunctionExecutorInspectorProps) {
  const config = node.config as FunctionExecutorConfig;
  const nodeIssues = validationIssues?.filter((i) => i.nodeId === node.id) ?? [];
  const parameters = config.parameters ?? {};
  const paramEntries = Object.entries(parameters);

  const [newKey, setNewKey] = useState('');

  const patchConfig = useCallback(
    (patch: Partial<FunctionExecutorConfig>) => {
      onNodeConfigChange(node.id, { ...config, ...patch });
    },
    [node.id, config, onNodeConfigChange],
  );

  const handleParamChange = useCallback(
    (oldKey: string, newParamKey: string, value: string) => {
      const next = { ...parameters };
      if (newParamKey !== oldKey) {
        delete next[oldKey];
      }
      next[newParamKey] = value;
      patchConfig({ parameters: next });
    },
    [parameters, patchConfig],
  );

  const handleParamRemove = useCallback(
    (key: string) => {
      const next = { ...parameters };
      delete next[key];
      patchConfig({ parameters: next });
    },
    [parameters, patchConfig],
  );

  const handleParamAdd = useCallback(() => {
    const key = newKey.trim() || `param${paramEntries.length + 1}`;
    patchConfig({ parameters: { ...parameters, [key]: '' } });
    setNewKey('');
  }, [newKey, paramEntries.length, parameters, patchConfig]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-violet-500/10">
            <FunctionSquare className="size-4 text-violet-400" />
          </div>
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">
            {node.label || 'Function Executor'}
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

      {/* Function reference */}
      <label className="block space-y-1.5">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Function</span>
        <select
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]/50"
          onChange={(e) => patchConfig({ functionRef: e.target.value })}
          value={config.functionRef}
        >
          <option value="">Select a function…</option>
          {builtInFunctions.map((fn) => (
            <option key={fn.value} value={fn.value}>
              {fn.label}
            </option>
          ))}
        </select>
      </label>

      {/* Parameters editor */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
            Parameters
          </span>
          <button
            className="flex size-6 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]"
            onClick={handleParamAdd}
            title="Add parameter"
            type="button"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        {paramEntries.length === 0 && (
          <p className="text-[11px] text-[var(--color-text-muted)]">No parameters defined.</p>
        )}

        {paramEntries.map(([key, value]) => (
          <div className="flex items-center gap-1.5" key={key}>
            <input
              className="w-1/3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50"
              onChange={(e) => handleParamChange(key, e.target.value, stringifyValue(value))}
              placeholder="key"
              value={key}
            />
            <input
              className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-2 py-1.5 text-[12px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50"
              onChange={(e) => handleParamChange(key, key, e.target.value)}
              placeholder="value"
              value={stringifyValue(value)}
            />
            <button
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-status-error)]/10 hover:text-[var(--color-status-error)]"
              onClick={() => handleParamRemove(key)}
              title="Remove parameter"
              type="button"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
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
