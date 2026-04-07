import { useCallback, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Bot,
  ChevronDown,
  Layers,
  MessageCircle,
  Repeat,
  Route,
  User,
} from 'lucide-react';

import type {
  HandoffModeSettings,
  GroupChatModeSettings,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowOrchestrationMode,
} from '@shared/domain/workflow';
import {
  createDefaultModeSettings,
  inferWorkflowOrchestrationMode,
  isBuilderBasedMode,
  isGraphBasedMode,
  scaffoldGraphForMode,
} from '@shared/domain/workflow';
import { FormField, InfoCallout, SelectInput, ToggleSwitch } from '@renderer/components/ui';

/* ── Mode metadata ─────────────────────────────────────────── */

interface ModeOption {
  value: WorkflowOrchestrationMode;
  label: string;
  description: string;
  icon: typeof Bot;
  accentClass: string;
}

const modeOptions: ModeOption[] = [
  {
    value: 'single',
    label: 'Single Agent',
    description: 'One agent handles the full conversation directly.',
    icon: User,
    accentClass: 'text-emerald-400',
  },
  {
    value: 'sequential',
    label: 'Sequential',
    description: 'Agents execute in order, each seeing the full conversation history.',
    icon: ArrowRightLeft,
    accentClass: 'text-sky-400',
  },
  {
    value: 'concurrent',
    label: 'Concurrent',
    description: 'Agents execute in parallel via fan-out, results collected at barrier.',
    icon: Layers,
    accentClass: 'text-amber-400',
  },
  {
    value: 'handoff',
    label: 'Handoff',
    description: 'Triage agent routes requests to specialists via handoff tool calls.',
    icon: Route,
    accentClass: 'text-violet-400',
  },
  {
    value: 'group-chat',
    label: 'Group Chat',
    description: 'Agents take turns in a managed conversation loop.',
    icon: MessageCircle,
    accentClass: 'text-rose-400',
  },
];

const modeMap = new Map(modeOptions.map((m) => [m.value, m]));

/* ── Scaffold confirmation dialog ──────────────────────────── */

function ScaffoldDialog({
  fromMode,
  toMode,
  onAccept,
  onDecline,
}: {
  fromMode: string;
  toMode: WorkflowOrchestrationMode;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const target = modeMap.get(toMode);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scaffold-dialog-title"
    >
      <div
        className="mx-4 w-full max-w-md animate-[palette-enter_0.2s_ease-out] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6 shadow-2xl"
      >
        <h3
          id="scaffold-dialog-title"
          className="mb-2 text-[14px] font-semibold text-[var(--color-text-primary)]"
        >
          Restructure graph for {target?.label ?? toMode}?
        </h3>
        <p className="mb-5 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
          This will update edges to match the <span className="font-medium text-[var(--color-text-primary)]">{target?.label ?? toMode}</span> topology while keeping your existing agents.
          {fromMode && (
            <span className="mt-1 block text-[12px] text-[var(--color-text-muted)]">
              Changing from {fromMode}.
            </span>
          )}
        </p>
        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onDecline}
            className="rounded-lg px-4 py-2 text-[13px] text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
          >
            Keep current graph
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-[13px] font-medium text-white transition-all duration-200 hover:bg-[var(--color-accent-hover)]"
          >
            Restructure
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Mode selector card ────────────────────────────────────── */

function ModeCard({
  option,
  selected,
  onClick,
}: {
  option: ModeOption;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = option.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-200 ${
        selected
          ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent-muted)] shadow-[0_0_0_1px_rgba(36,92,249,0.15),0_0_16px_rgba(36,92,249,0.06)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface-1)] hover:border-[var(--color-border-glow)] hover:bg-[var(--color-surface-2)]'
      }`}
      aria-pressed={selected}
    >
      <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${
        selected ? 'bg-[var(--color-accent)]/15' : 'bg-[var(--color-surface-3)]'
      }`}>
        <Icon className={`size-3.5 ${selected ? 'text-[var(--color-accent)]' : option.accentClass}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-medium ${
          selected ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]'
        }`}>
          {option.label}
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
          {option.description}
        </div>
      </div>
    </button>
  );
}

/* ── Handoff settings sub-panel ────────────────────────────── */

function HandoffSettingsPanel({
  settings,
  agentNodes,
  onChange,
}: {
  settings: HandoffModeSettings;
  agentNodes: WorkflowNode[];
  onChange: (settings: HandoffModeSettings) => void;
}) {
  const triageOptions = useMemo(() => [
    { value: '', label: 'First agent (default)' },
    ...agentNodes.map((node) => ({
      value: node.id,
      label: node.label || (node.config.kind === 'agent' ? node.config.name : node.id),
    })),
  ], [agentNodes]);

  const filteringOptions = [
    { value: 'none', label: 'None — All tools available' },
    { value: 'handoff-only', label: 'Handoff-only — Restrict to handoff tools' },
    { value: 'all', label: 'All — Full tool filtering' },
  ];

  return (
    <div className="space-y-3.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <div className="flex items-center gap-2">
        <Route className="size-3.5 text-violet-400" />
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Handoff Settings
        </span>
      </div>

      <FormField label="Triage Agent" description="The entry-point agent that receives requests and decides which specialist to hand off to.">
        <SelectInput
          value={settings.triageAgentNodeId ?? ''}
          options={triageOptions}
          onChange={(v) => onChange({ ...settings, triageAgentNodeId: v || undefined })}
        />
      </FormField>

      <FormField label="Tool-Call Filtering" description="Controls which tools each agent can see and invoke during handoff routing.">
        <SelectInput
          value={settings.toolCallFiltering}
          options={filteringOptions}
          onChange={(v) => onChange({ ...settings, toolCallFiltering: v as HandoffModeSettings['toolCallFiltering'] })}
        />
      </FormField>

      <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3.5 py-2.5">
        <div>
          <div className="text-[13px] font-medium text-[var(--color-text-primary)]">Return to Previous</div>
          <p className="text-[11px] text-[var(--color-text-muted)]">Allow specialists to hand back to the previous agent</p>
        </div>
        <button type="button" className="cursor-pointer" onClick={() => onChange({ ...settings, returnToPrevious: !settings.returnToPrevious })}>
          <ToggleSwitch enabled={settings.returnToPrevious} />
        </button>
      </div>

      <FormField label="Custom Handoff Instructions" description="Additional guidance given to agents when performing handoffs between specialists.">
        <textarea
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition-all duration-200 placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-glow)] focus:shadow-[0_0_0_1px_rgba(36,92,249,0.15),0_0_12px_rgba(36,92,249,0.08)]"
          rows={3}
          placeholder="Override default handoff guidance (optional)"
          value={settings.handoffInstructions ?? ''}
          onChange={(e) => onChange({ ...settings, handoffInstructions: e.target.value || undefined })}
        />
      </FormField>
    </div>
  );
}

/* ── Group-chat settings sub-panel ─────────────────────────── */

function GroupChatSettingsPanel({
  settings,
  onChange,
}: {
  settings: GroupChatModeSettings;
  onChange: (settings: GroupChatModeSettings) => void;
}) {
  return (
    <div className="space-y-3.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="size-3.5 text-rose-400" />
        <span className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          Group Chat Settings
        </span>
      </div>

      <FormField label="Selection Strategy" description="Determines which agent speaks next in each conversation turn.">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3.5 py-2.5">
          <Repeat className="size-3.5 text-[var(--color-text-muted)]" />
          <span className="text-[13px] text-[var(--color-text-primary)]">Round Robin</span>
          <span className="ml-auto text-[11px] text-[var(--color-text-muted)]">Only strategy</span>
        </div>
      </FormField>

      <FormField label="Max Rounds" description="Maximum number of conversation turns across all agents before the group chat terminates.">
        <input
          type="number"
          min={1}
          max={100}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition-all duration-200 placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-glow)] focus:shadow-[0_0_0_1px_rgba(36,92,249,0.15),0_0_12px_rgba(36,92,249,0.08)]"
          placeholder="5"
          value={settings.maxRounds}
          onChange={(e) => {
            const raw = parseInt(e.target.value, 10);
            onChange({ ...settings, maxRounds: Number.isNaN(raw) ? 5 : Math.max(1, Math.min(100, raw)) });
          }}
        />
      </FormField>
    </div>
  );
}

/* ── Main orchestration mode panel ─────────────────────────── */

export function OrchestrationModePanel({
  workflow,
  onChange,
}: {
  workflow: WorkflowDefinition;
  onChange: (workflow: WorkflowDefinition) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [scaffoldRequest, setScaffoldRequest] = useState<{
    newMode: WorkflowOrchestrationMode;
    fromLabel: string;
  } | null>(null);

  const currentMode = workflow.settings.orchestrationMode;
  const inferredMode = useMemo(() => inferWorkflowOrchestrationMode(workflow), [workflow]);
  const effectiveMode = currentMode ?? inferredMode;
  const effectiveMeta = modeMap.get(effectiveMode);

  const agentNodes = useMemo(
    () => workflow.graph.nodes.filter((n) => n.kind === 'agent'),
    [workflow.graph.nodes],
  );

  const handoffSettings: HandoffModeSettings = useMemo(
    () => workflow.settings.modeSettings?.handoff ?? createDefaultModeSettings('handoff')!.handoff!,
    [workflow.settings.modeSettings?.handoff],
  );

  const groupChatSettings: GroupChatModeSettings = useMemo(
    () => workflow.settings.modeSettings?.groupChat ?? createDefaultModeSettings('group-chat')!.groupChat!,
    [workflow.settings.modeSettings?.groupChat],
  );

  const applyModeChange = useCallback(
    (newMode: WorkflowOrchestrationMode, restructure: boolean) => {
      const modeSettings = createDefaultModeSettings(newMode);
      const base: WorkflowDefinition = {
        ...workflow,
        settings: {
          ...workflow.settings,
          orchestrationMode: newMode,
          modeSettings: modeSettings
            ? { ...workflow.settings.modeSettings, ...modeSettings }
            : workflow.settings.modeSettings,
        },
      };

      if (restructure) {
        const existingAgents = workflow.graph.nodes.filter((n) => n.kind === 'agent');
        const newGraph = scaffoldGraphForMode(newMode, existingAgents.length > 0 ? existingAgents : undefined);
        onChange({ ...base, graph: newGraph });
      } else {
        onChange(base);
      }
    },
    [workflow, onChange],
  );

  const handleModeSelect = useCallback(
    (newMode: WorkflowOrchestrationMode) => {
      if (newMode === currentMode) return;

      const hasAgents = agentNodes.length > 0;
      const fromLabel = currentMode
        ? (modeMap.get(currentMode)?.label ?? currentMode)
        : `Auto (${modeMap.get(inferredMode)?.label ?? inferredMode})`;

      if (hasAgents) {
        setScaffoldRequest({ newMode, fromLabel });
      } else {
        applyModeChange(newMode, true);
      }
    },
    [currentMode, inferredMode, agentNodes.length, applyModeChange],
  );

  const handleHandoffChange = useCallback(
    (handoff: HandoffModeSettings) => {
      onChange({
        ...workflow,
        settings: {
          ...workflow.settings,
          modeSettings: { ...workflow.settings.modeSettings, handoff },
        },
      });
    },
    [workflow, onChange],
  );

  const handleGroupChatChange = useCallback(
    (groupChat: GroupChatModeSettings) => {
      onChange({
        ...workflow,
        settings: {
          ...workflow.settings,
          modeSettings: { ...workflow.settings.modeSettings, groupChat },
        },
      });
    },
    [workflow, onChange],
  );

  return (
    <>
      <div className="space-y-4">
        {/* Section header */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between"
          aria-expanded={expanded}
        >
          <h4 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Orchestration Mode
          </h4>
          <div className="flex items-center gap-2">
            {!currentMode && (
              <span className="rounded-md bg-[var(--color-surface-3)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
                Auto
              </span>
            )}
            {effectiveMeta && (
              <span className={`text-[11px] font-medium ${effectiveMeta.accentClass}`}>
                {effectiveMeta.label}
              </span>
            )}
            <ChevronDown
              className={`size-3.5 text-[var(--color-text-muted)] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            />
          </div>
        </button>

        {expanded && (
          <div className="space-y-4">
            {/* Mode cards */}
            <div className="grid grid-cols-1 gap-2">
              {modeOptions.map((option) => (
                <ModeCard
                  key={option.value}
                  option={option}
                  selected={effectiveMode === option.value}
                  onClick={() => handleModeSelect(option.value)}
                />
              ))}
            </div>

            {/* Auto-inference indicator */}
            {!currentMode && (
              <InfoCallout>
                Mode is auto-inferred from graph shape as <span className="font-medium text-[var(--color-text-primary)]">{effectiveMeta?.label}</span>.
                Select a mode explicitly to lock it.
              </InfoCallout>
            )}

            {/* Builder-based mode info */}
            {isBuilderBasedMode(effectiveMode) && (
              <InfoCallout>
                In {effectiveMeta?.label} mode, the framework manages agent routing automatically. The graph defines participants.
              </InfoCallout>
            )}

            {/* Graph-based mode info */}
            {isGraphBasedMode(effectiveMode) && currentMode && (
              <InfoCallout>
                This mode uses the graph topology for execution. Connect agents with the appropriate edge types.
              </InfoCallout>
            )}

            {/* Mode-specific settings */}
            {effectiveMode === 'handoff' && (
              <HandoffSettingsPanel
                settings={handoffSettings}
                agentNodes={agentNodes}
                onChange={handleHandoffChange}
              />
            )}

            {effectiveMode === 'group-chat' && (
              <GroupChatSettingsPanel
                settings={groupChatSettings}
                onChange={handleGroupChatChange}
              />
            )}
          </div>
        )}
      </div>

      {/* Scaffold confirmation dialog */}
      {scaffoldRequest && (
        <ScaffoldDialog
          fromMode={scaffoldRequest.fromLabel}
          toMode={scaffoldRequest.newMode}
          onAccept={() => {
            applyModeChange(scaffoldRequest.newMode, true);
            setScaffoldRequest(null);
          }}
          onDecline={() => {
            applyModeChange(scaffoldRequest.newMode, false);
            setScaffoldRequest(null);
          }}
        />
      )}
    </>
  );
}
