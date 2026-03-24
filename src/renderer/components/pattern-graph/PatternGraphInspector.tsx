import { Bot, CircleUser, Layers, Plus, Radio, Shuffle, Trash2 } from 'lucide-react';

import {
  findModel,
  getSupportedReasoningEfforts,
  resolveReasoningEffort,
  type ModelDefinition,
} from '@shared/domain/models';
import type { PatternAgentDefinition, PatternGraph, PatternGraphNodeKind } from '@shared/domain/pattern';
import { findAgentForNode } from '@renderer/lib/patternGraph';
import { ModelSelect, ReasoningEffortSelect } from '../AgentConfigFields';

interface PatternGraphInspectorProps {
  availableModels: ReadonlyArray<ModelDefinition>;
  agents: PatternAgentDefinition[];
  graph: PatternGraph;
  selectedNodeId: string | null;
  onAgentChange: (agentId: string, patch: Partial<PatternAgentDefinition>) => void;
  onAgentRemove: (agentId: string) => void;
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
    'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-indigo-500/50';
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-zinc-400">{label}</span>
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
        <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10">
          <Icon className="size-4 text-indigo-400" />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-zinc-200">{kindLabels[kind]}</div>
          <span className="rounded bg-zinc-700/50 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500">
            System node
          </span>
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-zinc-500">{kindDescriptions[kind]}</p>
    </div>
  );
}

function AgentNodeInspector({
  agent,
  availableModels,
  onAgentChange,
  onAgentRemove,
}: {
  agent: PatternAgentDefinition;
  availableModels: ReadonlyArray<ModelDefinition>;
  onAgentChange: (agentId: string, patch: Partial<PatternAgentDefinition>) => void;
  onAgentRemove: (agentId: string) => void;
}) {
  const model = findModel(agent.model, availableModels);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-zinc-800">
            <Bot className="size-4 text-zinc-300" />
          </div>
          <div className="text-[13px] font-semibold text-zinc-200">{agent.name || 'Unnamed'}</div>
        </div>
        <button
          className="flex items-center gap-1 text-[12px] text-zinc-600 transition hover:text-red-400"
          onClick={() => onAgentRemove(agent.id)}
          type="button"
        >
          <Trash2 className="size-3" />
          Remove
        </button>
      </div>

      <InputField
        label="Name"
        onChange={(v) => onAgentChange(agent.id, { name: v })}
        value={agent.name}
      />

      <div className="grid gap-3 sm:grid-cols-2">
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
  selectedNodeId,
  onAgentChange,
  onAgentRemove,
}: PatternGraphInspectorProps) {
  if (!selectedNodeId) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-center text-[12px] text-zinc-600">
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
        onAgentChange={onAgentChange}
        onAgentRemove={onAgentRemove}
      />
    </div>
  );
}
