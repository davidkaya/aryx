import { Bot, ChevronDown, ChevronUp, CircleUser, Layers, Radio, Shuffle, Trash2 } from 'lucide-react';

import {
  findModel,
  getSupportedReasoningEfforts,
  resolveReasoningEffort,
  type ModelDefinition,
} from '@shared/domain/models';
import type {
  OrchestrationMode,
  PatternAgentDefinition,
  PatternGraph,
  PatternGraphNodeKind,
} from '@shared/domain/pattern';
import {
  canMoveSequential,
  findAgentForNode,
  swapSequentialOrder,
} from '@renderer/lib/patternGraph';
import { ModelSelect, ReasoningEffortSelect } from '../AgentConfigFields';

interface PatternGraphInspectorProps {
  availableModels: ReadonlyArray<ModelDefinition>;
  agents: PatternAgentDefinition[];
  graph: PatternGraph;
  mode: OrchestrationMode;
  selectedNodeId: string | null;
  onAgentChange: (agentId: string, patch: Partial<PatternAgentDefinition>) => void;
  onAgentRemove: (agentId: string) => void;
  onGraphChange: (graph: PatternGraph) => void;
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

const kindIcons: Record<PatternGraphNodeKind, typeof Bot> = {
  'user-input': CircleUser,
  'user-output': CircleUser,
  agent: Bot,
  distributor: Shuffle,
  collector: Layers,
  orchestrator: Radio,
};

const kindLabels: Partial<Record<PatternGraphNodeKind, string>> = {
  'user-input': 'User Input',
  'user-output': 'User Output',
  distributor: 'Distributor',
  collector: 'Collector',
  orchestrator: 'Orchestrator',
};

const kindDescriptions: Partial<Record<PatternGraphNodeKind, string>> = {
  'user-input': 'Entry point — receives user messages.',
  'user-output': 'Exit point — returns final response to the user.',
  distributor: 'Fans user input to all agents in parallel.',
  collector: 'Aggregates parallel agent responses.',
  orchestrator: 'Manages group chat round-robin turns.',
};

function SystemNodeInspector({ kind }: { kind: PatternGraphNodeKind }) {
  const Icon = kindIcons[kind];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-accent)]/10">
          <Icon className="size-4 text-[var(--color-accent-sky)]" />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">{kindLabels[kind]}</div>
          <span className="rounded bg-[var(--color-surface-3)]/50 px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-text-muted)]">
            System node
          </span>
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-[var(--color-text-muted)]">{kindDescriptions[kind]}</p>
    </div>
  );
}

function AgentNodeInspector({
  agent,
  availableModels,
  mode,
  graph,
  nodeId,
  onAgentChange,
  onAgentRemove,
  onGraphChange,
}: {
  agent: PatternAgentDefinition;
  availableModels: ReadonlyArray<ModelDefinition>;
  mode: OrchestrationMode;
  graph: PatternGraph;
  nodeId: string;
  onAgentChange: (agentId: string, patch: Partial<PatternAgentDefinition>) => void;
  onAgentRemove: (agentId: string) => void;
  onGraphChange: (graph: PatternGraph) => void;
}) {
  const model = findModel(agent.model, availableModels);
  const showReorder = mode === 'sequential' || mode === 'single' || mode === 'magentic';
  const canUp = showReorder && canMoveSequential(graph, nodeId, 'up');
  const canDown = showReorder && canMoveSequential(graph, nodeId, 'down');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-surface-2)]">
            <Bot className="size-4 text-[var(--color-text-secondary)]" />
          </div>
          <div className="text-[13px] font-semibold text-[var(--color-text-primary)]">{agent.name || 'Unnamed'}</div>
        </div>
        <div className="flex items-center gap-1">
          {showReorder && (
            <>
              <button
                className="flex size-6 items-center justify-center rounded text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-muted)]"
                disabled={!canUp}
                onClick={() => onGraphChange(swapSequentialOrder(graph, nodeId, 'up'))}
                title="Move earlier in sequence"
                type="button"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <button
                className="flex size-6 items-center justify-center rounded text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-muted)]"
                disabled={!canDown}
                onClick={() => onGraphChange(swapSequentialOrder(graph, nodeId, 'down'))}
                title="Move later in sequence"
                type="button"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </>
          )}
          <button
            className="flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] transition hover:text-red-400"
            onClick={() => onAgentRemove(agent.id)}
            type="button"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>

      <InputField
        label="Name"
        onChange={(v) => onAgentChange(agent.id, { name: v })}
        value={agent.name}
      />

      <div className="space-y-3">
        <ModelSelect
          models={availableModels}
          onChange={(value) => {
            const m = findModel(value, availableModels);
            onAgentChange(agent.id, {
              model: value,
              reasoningEffort: resolveReasoningEffort(m, agent.reasoningEffort),
            });
          }}
          value={agent.model}
        />
        <ReasoningEffortSelect
          label="Reasoning"
          onChange={(value) => onAgentChange(agent.id, { reasoningEffort: value })}
          supportedEfforts={getSupportedReasoningEfforts(model)}
          value={resolveReasoningEffort(model, agent.reasoningEffort)}
        />
      </div>

      <InputField
        label="Description"
        onChange={(v) => onAgentChange(agent.id, { description: v })}
        placeholder="What this agent does..."
        value={agent.description}
      />

      <InputField
        label="Instructions"
        multiline
        onChange={(v) => onAgentChange(agent.id, { instructions: v })}
        placeholder="System prompt for this agent..."
        value={agent.instructions}
      />
    </div>
  );
}

export function PatternGraphInspector({
  availableModels,
  agents,
  graph,
  mode,
  selectedNodeId,
  onAgentChange,
  onAgentRemove,
  onGraphChange,
}: PatternGraphInspectorProps) {
  if (!selectedNodeId) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-center text-[12px] text-[var(--color-text-muted)]">
          Select a node on the graph to inspect it
        </p>
      </div>
    );
  }

  const node = graph.nodes.find((n) => n.id === selectedNodeId);
  if (!node) {
    return null;
  }

  if (node.kind !== 'agent') {
    return (
      <div className="p-4">
        <SystemNodeInspector kind={node.kind} />
      </div>
    );
  }

  const agent = findAgentForNode(selectedNodeId, graph, agents);
  if (!agent) {
    return null;
  }

  return (
    <div className="p-4">
      <AgentNodeInspector
        agent={agent}
        availableModels={availableModels}
        mode={mode}
        graph={graph}
        nodeId={selectedNodeId}
        onAgentChange={onAgentChange}
        onAgentRemove={onAgentRemove}
        onGraphChange={onGraphChange}
      />
    </div>
  );
}
