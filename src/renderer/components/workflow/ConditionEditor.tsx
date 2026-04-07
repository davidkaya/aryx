import { useCallback } from 'react';
import { Info, Plus, Trash2 } from 'lucide-react';

import type { EdgeCondition, WorkflowConditionRule } from '@shared/domain/workflow';

type ConditionType = 'none' | 'always' | 'property' | 'message-type' | 'expression';

interface ConditionEditorProps {
  condition: EdgeCondition | undefined;
  onChange: (condition: EdgeCondition | undefined) => void;
  disabled?: boolean;
}

const OPERATOR_OPTIONS: { value: WorkflowConditionRule['operator']; label: string }[] = [
  { value: 'equals', label: '=' },
  { value: 'not-equals', label: '≠' },
  { value: 'contains', label: 'contains' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'regex', label: 'matches regex' },
];

const inputClasses =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none transition focus:border-[var(--color-accent)]/50 disabled:cursor-not-allowed disabled:opacity-50';

const selectClasses =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]/50 disabled:cursor-not-allowed disabled:opacity-50';

function resolveConditionType(condition: EdgeCondition | undefined): ConditionType {
  if (!condition) return 'none';
  return condition.type;
}

function emptyRule(): WorkflowConditionRule {
  return { propertyPath: '', operator: 'equals', value: '' };
}

function defaultConditionForType(type: ConditionType): EdgeCondition | undefined {
  switch (type) {
    case 'none':
      return undefined;
    case 'always':
      return { type: 'always' };
    case 'property':
      return { type: 'property', combinator: 'and', rules: [emptyRule()] };
    case 'message-type':
      return { type: 'message-type', typeName: '' };
    case 'expression':
      return { type: 'expression', expression: '' };
  }
}

/* ── Property rules editor ─────────────────────────────────── */

function PropertyRuleRow({
  rule,
  index,
  disabled,
  onRuleChange,
  onRemove,
  canRemove,
}: {
  rule: WorkflowConditionRule;
  index: number;
  disabled?: boolean;
  onRuleChange: (index: number, patch: Partial<WorkflowConditionRule>) => void;
  onRemove: (index: number) => void;
  canRemove: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        className={inputClasses}
        disabled={disabled}
        onChange={(e) => onRuleChange(index, { propertyPath: e.target.value })}
        placeholder="property.path"
        style={{ flex: 2 }}
        value={rule.propertyPath}
      />
      <select
        className={selectClasses}
        disabled={disabled}
        onChange={(e) =>
          onRuleChange(index, { operator: e.target.value as WorkflowConditionRule['operator'] })
        }
        style={{ flex: 1.2 }}
        value={rule.operator}
      >
        {OPERATOR_OPTIONS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      <input
        className={inputClasses}
        disabled={disabled}
        onChange={(e) => onRuleChange(index, { value: e.target.value })}
        placeholder="value"
        style={{ flex: 2 }}
        value={rule.value}
      />
      {canRemove && (
        <button
          className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] transition hover:bg-[var(--color-status-error)]/10 hover:text-[var(--color-status-error)] disabled:pointer-events-none disabled:opacity-50"
          disabled={disabled}
          onClick={() => onRemove(index)}
          title="Remove rule"
          type="button"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}

function PropertyRulesEditor({
  condition,
  disabled,
  onChange,
}: {
  condition: Extract<EdgeCondition, { type: 'property' }>;
  disabled?: boolean;
  onChange: (condition: EdgeCondition) => void;
}) {
  const rules = condition.rules;

  const handleRuleChange = useCallback(
    (index: number, patch: Partial<WorkflowConditionRule>) => {
      const updated = rules.map((r, i) => (i === index ? { ...r, ...patch } : r));
      onChange({ ...condition, rules: updated });
    },
    [rules, condition, onChange],
  );

  const handleRemoveRule = useCallback(
    (index: number) => {
      onChange({ ...condition, rules: rules.filter((_, i) => i !== index) });
    },
    [rules, condition, onChange],
  );

  const handleAddRule = useCallback(() => {
    onChange({ ...condition, rules: [...rules, emptyRule()] });
  }, [rules, condition, onChange]);

  const handleCombinatorChange = useCallback(
    (combinator: 'and' | 'or') => {
      onChange({ ...condition, combinator });
    },
    [condition, onChange],
  );

  return (
    <div className="space-y-2">
      {rules.length >= 2 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--color-text-muted)]">Combine</span>
          <div className="flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]">
            <button
              className={`px-2.5 py-1 text-[11px] font-medium transition ${
                (condition.combinator ?? 'and') === 'and'
                  ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
              disabled={disabled}
              onClick={() => handleCombinatorChange('and')}
              type="button"
            >
              AND
            </button>
            <button
              className={`px-2.5 py-1 text-[11px] font-medium transition ${
                condition.combinator === 'or'
                  ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
              disabled={disabled}
              onClick={() => handleCombinatorChange('or')}
              type="button"
            >
              OR
            </button>
          </div>
        </div>
      )}

      {rules.map((rule, i) => (
        <PropertyRuleRow
          canRemove={rules.length > 1}
          disabled={disabled}
          index={i}
          key={i}
          onRemove={handleRemoveRule}
          onRuleChange={handleRuleChange}
          rule={rule}
        />
      ))}

      <button
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[var(--color-accent)] transition hover:bg-[var(--color-accent)]/10 disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
        onClick={handleAddRule}
        type="button"
      >
        <Plus className="size-3" />
        Add Rule
      </button>
    </div>
  );
}

/* ── Main condition editor ─────────────────────────────────── */

export function ConditionEditor({ condition, onChange, disabled }: ConditionEditorProps) {
  const currentType = resolveConditionType(condition);

  const handleTypeChange = useCallback(
    (type: ConditionType) => {
      onChange(defaultConditionForType(type));
    },
    [onChange],
  );

  return (
    <div className="space-y-2.5">
      <label className="block space-y-1.5">
        <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
          Condition
        </span>
        <select
          className={selectClasses}
          disabled={disabled}
          onChange={(e) => handleTypeChange(e.target.value as ConditionType)}
          value={currentType}
        >
          <option value="none">None</option>
          <option value="always">Always</option>
          <option value="property">Property Rule</option>
          <option value="message-type">Message Type</option>
          <option value="expression">Expression</option>
        </select>
        <p className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          Determines when this edge fires. Use property rules or expressions to create conditional branches.
        </p>
      </label>

      {condition?.type === 'property' && (
        <PropertyRulesEditor condition={condition} disabled={disabled} onChange={onChange} />
      )}

      {condition?.type === 'message-type' && (
        <label className="block space-y-1.5">
          <span className="text-[11px] text-[var(--color-text-muted)]">Type Name</span>
          <input
            className={inputClasses}
            disabled={disabled}
            onChange={(e) => onChange({ ...condition, typeName: e.target.value })}
            placeholder="e.g. ApprovalResponse"
            value={condition.typeName}
          />
        </label>
      )}

      {condition?.type === 'expression' && (
        <div className="space-y-1.5">
          <label className="block space-y-1.5">
            <span className="text-[11px] text-[var(--color-text-muted)]">Expression</span>
            <input
              className={`${inputClasses} font-mono`}
              disabled={disabled}
              onChange={(e) => onChange({ ...condition, expression: e.target.value })}
              placeholder='e.g. result.status == "done"'
              value={condition.expression}
            />
          </label>
          <div className="flex items-start gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2">
            <Info className="mt-0.5 size-3 shrink-0 text-[var(--color-text-muted)]" />
            <span className="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              Supported: ==, !=, &gt;, &lt;, contains, matches. Combine with &amp;&amp; or ||
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
