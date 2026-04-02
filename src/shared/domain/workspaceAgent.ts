import type { PatternAgentCopilotConfig } from '@shared/contracts/sidecar';
import type { PatternAgentDefinition, PatternDefinition, ReasoningEffort } from '@shared/domain/pattern';

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

export interface PatternAgentOverrides {
  name?: string;
  description?: string;
  instructions?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface WorkspaceAgentUsage {
  patternId: string;
  patternName: string;
}

/**
 * Resolves a single pattern agent by merging its workspace agent base with
 * per-pattern overrides. Returns the agent unchanged if it is inline.
 */
export function resolvePatternAgent(
  agent: PatternAgentDefinition,
  workspaceAgents: ReadonlyArray<WorkspaceAgentDefinition>,
): PatternAgentDefinition {
  if (!agent.workspaceAgentId) {
    return agent;
  }

  const base = workspaceAgents.find((wa) => wa.id === agent.workspaceAgentId);
  if (!base) {
    return agent;
  }

  const overrides = agent.overrides ?? {};
  return {
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

/**
 * Resolves all agents in a pattern, producing a new pattern whose agents
 * have workspace-agent references merged with their base definitions.
 */
export function resolvePatternAgents(
  pattern: PatternDefinition,
  workspaceAgents: ReadonlyArray<WorkspaceAgentDefinition>,
): PatternDefinition {
  return {
    ...pattern,
    agents: pattern.agents.map((agent) => resolvePatternAgent(agent, workspaceAgents)),
  };
}

/**
 * Returns every pattern that references the given workspace agent.
 */
export function findWorkspaceAgentUsages(
  agentId: string,
  patterns: ReadonlyArray<PatternDefinition>,
): WorkspaceAgentUsage[] {
  const usages: WorkspaceAgentUsage[] = [];
  for (const pattern of patterns) {
    if (pattern.agents.some((a) => a.workspaceAgentId === agentId)) {
      usages.push({ patternId: pattern.id, patternName: pattern.name });
    }
  }
  return usages;
}

/**
 * Normalizes a workspace agent definition, trimming string fields and
 * ensuring consistent shape.
 */
export function normalizeWorkspaceAgentDefinition(
  agent: WorkspaceAgentDefinition,
): WorkspaceAgentDefinition {
  return {
    ...agent,
    name: agent.name.trim(),
    description: agent.description.trim(),
    instructions: agent.instructions.trim(),
    model: agent.model.trim(),
  };
}
