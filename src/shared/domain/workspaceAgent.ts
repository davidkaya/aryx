import type { PatternAgentCopilotConfig } from '@shared/contracts/sidecar';
import type {
  AgentNodeConfig,
  ReasoningEffort,
  WorkflowDefinition,
} from '@shared/domain/workflow';

export interface WorkspaceAgentDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  copilot?: PatternAgentCopilotConfig;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowAgentUsage {
  workflowId: string;
  workflowName: string;
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveWorkflowAgentNode(
  agent: AgentNodeConfig,
  workspaceAgents: ReadonlyArray<WorkspaceAgentDefinition>,
): AgentNodeConfig {
  if (!agent.workspaceAgentId) {
    return agent;
  }

  const base = workspaceAgents.find((workspaceAgent) => workspaceAgent.id === agent.workspaceAgentId);
  if (!base) {
    return agent;
  }

  const overrides = agent.overrides ?? {};
  return {
    ...agent,
    id: agent.id,
    name: overrides.name ?? base.name,
    description: overrides.description ?? base.description,
    instructions: overrides.instructions ?? base.instructions,
    model: overrides.model ?? base.model,
    reasoningEffort: overrides.reasoningEffort ?? base.reasoningEffort,
    copilot: base.copilot,
    workspaceAgentId: agent.workspaceAgentId,
    overrides: agent.overrides,
  };
}

export function resolveWorkflowAgents(
  workflow: WorkflowDefinition,
  workspaceAgents: ReadonlyArray<WorkspaceAgentDefinition>,
): WorkflowDefinition {
  return {
    ...workflow,
    graph: {
      ...workflow.graph,
      nodes: workflow.graph.nodes.map((node) => {
        if (node.kind !== 'agent' || node.config.kind !== 'agent') {
          return node;
        }

        return {
          ...node,
          config: resolveWorkflowAgentNode(node.config, workspaceAgents),
        };
      }),
    },
  };
}

export function findWorkspaceAgentUsages(
  agentId: string,
  workflows: ReadonlyArray<WorkflowDefinition>,
): WorkflowAgentUsage[] {
  const usages: WorkflowAgentUsage[] = [];
  for (const workflow of workflows) {
    if (workflow.graph.nodes.some((node) =>
      node.kind === 'agent'
      && node.config.kind === 'agent'
      && node.config.workspaceAgentId === agentId)) {
      usages.push({ workflowId: workflow.id, workflowName: workflow.name });
    }
  }

  return usages;
}

export function normalizeWorkspaceAgentDefinition(
  agent: WorkspaceAgentDefinition,
): WorkspaceAgentDefinition {
  return {
    ...agent,
    name: agent.name.trim(),
    description: agent.description.trim(),
    instructions: agent.instructions.trim(),
    model: agent.model.trim(),
    reasoningEffort: normalizeOptionalString(agent.reasoningEffort) as ReasoningEffort | undefined,
  };
}
