import type { ChatMessageRecord } from '@shared/domain/session';
import {
  normalizeApprovalPolicy,
  type ApprovalPolicy,
  validateApprovalPolicy,
} from '@shared/domain/approval';

export type OrchestrationMode =
  | 'single'
  | 'sequential'
  | 'concurrent'
  | 'handoff'
  | 'group-chat'
  | 'magentic';

export type PatternAvailability = 'available' | 'preview' | 'unavailable';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export const reasoningEffortOptions: ReadonlyArray<{ value: ReasoningEffort; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Maximum' },
];

export interface PatternAgentDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
}

export interface PatternDefinition {
  id: string;
  name: string;
  description: string;
  isFavorite?: boolean;
  mode: OrchestrationMode;
  availability: PatternAvailability;
  unavailabilityReason?: string;
  maxIterations: number;
  approvalPolicy?: ApprovalPolicy;
  agents: PatternAgentDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface PatternValidationIssue {
  level: 'error' | 'warning';
  field?: string;
  message: string;
}

const defaultModels = {
  claude: 'claude-opus-4.5',
  gpt54: 'gpt-5.4',
  gpt53: 'gpt-5.3-codex',
} as const;

const reasoningEffortSet = new Set<ReasoningEffort>(reasoningEffortOptions.map((option) => option.value));

export function isReasoningEffort(value: string | undefined): value is ReasoningEffort {
  return value !== undefined && reasoningEffortSet.has(value as ReasoningEffort);
}

export function createBuiltinPatterns(timestamp: string): PatternDefinition[] {
  return [
    {
      id: 'pattern-single-chat',
      name: '1-on-1 Copilot Chat',
      description: 'Direct human-agent conversation for a selected project.',
      mode: 'single',
      availability: 'available',
      maxIterations: 1,
      agents: [
        {
          id: 'agent-single-primary',
          name: 'Primary Agent',
          description: 'General-purpose project assistant.',
          instructions: 'You are a helpful coding assistant working inside the selected project.',
          model: defaultModels.gpt54,
          reasoningEffort: 'high',
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'pattern-sequential-review',
      name: 'Sequential Trio Review',
      description: 'Three Copilot-backed agents execute in order, refining the answer each step.',
      mode: 'sequential',
      availability: 'available',
      maxIterations: 1,
      agents: [
        {
          id: 'agent-sequential-analyst',
          name: 'Analyst',
          description: 'Breaks the task down and captures risks.',
          instructions: 'Analyze the request, identify constraints, and produce a short working plan.',
          model: defaultModels.gpt54,
          reasoningEffort: 'high',
        },
        {
          id: 'agent-sequential-builder',
          name: 'Builder',
          description: 'Translates the plan into a practical implementation.',
          instructions: 'Use the prior context to propose a concrete implementation.',
          model: defaultModels.gpt53,
          reasoningEffort: 'medium',
        },
        {
          id: 'agent-sequential-reviewer',
          name: 'Reviewer',
          description: 'Checks the proposal for gaps and edge cases.',
          instructions: 'Review the previous answer, tighten it, and call out any missing edge cases.',
          model: defaultModels.claude,
          reasoningEffort: 'medium',
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'pattern-concurrent-brainstorm',
      name: 'Concurrent Brainstorm',
      description: 'Multiple agents respond in parallel for comparison or voting.',
      mode: 'concurrent',
      availability: 'available',
      maxIterations: 1,
      agents: [
        {
          id: 'agent-concurrent-architect',
          name: 'Architect',
          description: 'Focuses on architecture and boundaries.',
          instructions: 'Answer from an architecture-first perspective.',
          model: defaultModels.gpt54,
          reasoningEffort: 'high',
        },
        {
          id: 'agent-concurrent-product',
          name: 'Product',
          description: 'Focuses on UX and scope.',
          instructions: 'Answer from a product and UX perspective.',
          model: defaultModels.claude,
          reasoningEffort: 'medium',
        },
        {
          id: 'agent-concurrent-implementer',
          name: 'Implementer',
          description: 'Focuses on practical delivery.',
          instructions: 'Answer from an implementation and testing perspective.',
          model: defaultModels.gpt53,
          reasoningEffort: 'medium',
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'pattern-handoff-support',
      name: 'Handoff Support Flow',
      description: 'A triage agent routes the task to specialists and can reclaim control.',
      mode: 'handoff',
      availability: 'available',
      maxIterations: 4,
      agents: [
        {
          id: 'agent-handoff-triage',
          name: 'Triage',
          description: 'Routes the request to the right specialist.',
          instructions:
            'You triage requests and must hand them off to the most appropriate specialist. Do not do the specialist work yourself once the right owner is clear.',
          model: defaultModels.gpt54,
          reasoningEffort: 'medium',
        },
        {
          id: 'agent-handoff-ux',
          name: 'UX Specialist',
          description: 'Handles user experience questions.',
          instructions:
            'You focus on navigation, UX, and interaction details. Once triage hands work to you, you own the substantive answer.',
          model: defaultModels.claude,
          reasoningEffort: 'medium',
        },
        {
          id: 'agent-handoff-runtime',
          name: 'Runtime Specialist',
          description: 'Handles backend and execution details.',
          instructions:
            'You focus on runtime, orchestration, and backend integration details. Once triage hands work to you, you own the substantive answer.',
          model: defaultModels.gpt53,
          reasoningEffort: 'medium',
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'pattern-group-chat',
      name: 'Collaborative Group Chat',
      description: 'Two or more agents iterate together under a round-robin manager.',
      mode: 'group-chat',
      availability: 'available',
      maxIterations: 5,
      agents: [
        {
          id: 'agent-group-writer',
          name: 'Writer',
          description: 'Produces candidate answers.',
          instructions:
            'You draft a concise, useful answer for the task. On later turns, refine your earlier draft based on peer feedback rather than restarting.',
          model: defaultModels.gpt54,
          reasoningEffort: 'medium',
        },
        {
          id: 'agent-group-reviewer',
          name: 'Reviewer',
          description: 'Critiques and refines the answer.',
          instructions:
            'You review the latest draft and offer specific improvements. Focus on critique and refinement instead of restarting the conversation.',
          model: defaultModels.claude,
          reasoningEffort: 'medium',
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'pattern-magentic',
      name: 'Magentic Planning',
      description: 'Reserved for future .NET support when Magentic becomes available in C#.',
      mode: 'magentic',
      availability: 'unavailable',
      unavailabilityReason: 'Microsoft Agent Framework currently documents Magentic orchestration as unsupported in C#.',
      maxIterations: 0,
      agents: [
        {
          id: 'agent-magentic-manager',
          name: 'Manager',
          description: 'Future manager agent.',
          instructions: 'Reserved until the .NET runtime supports Magentic orchestration.',
          model: defaultModels.gpt54,
        },
        {
          id: 'agent-magentic-specialist',
          name: 'Specialist',
          description: 'Future specialist agent.',
          instructions: 'Reserved until the .NET runtime supports Magentic orchestration.',
          model: defaultModels.claude,
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

export function validatePatternDefinition(pattern: PatternDefinition): PatternValidationIssue[] {
  const issues: PatternValidationIssue[] = [];

  if (!pattern.name.trim()) {
    issues.push({ level: 'error', field: 'name', message: 'Pattern name is required.' });
  }

  if (pattern.availability === 'unavailable') {
    issues.push({
      level: 'error',
      field: 'availability',
      message: pattern.unavailabilityReason ?? 'This orchestration mode is currently unavailable.',
    });
  }

  if (pattern.agents.length === 0) {
    issues.push({ level: 'error', field: 'agents', message: 'At least one agent is required.' });
  }

  if (pattern.mode === 'single' && pattern.agents.length !== 1) {
    issues.push({ level: 'error', field: 'agents', message: 'Single-agent chat requires exactly one agent.' });
  }

  if (pattern.mode === 'handoff' && pattern.agents.length < 2) {
    issues.push({ level: 'error', field: 'agents', message: 'Handoff orchestration requires at least two agents.' });
  }

  if (pattern.mode === 'group-chat' && pattern.agents.length < 2) {
    issues.push({ level: 'error', field: 'agents', message: 'Group chat requires at least two agents.' });
  }

  if (pattern.mode === 'magentic') {
    issues.push({
      level: 'error',
      field: 'mode',
      message:
        pattern.unavailabilityReason ??
        'Magentic orchestration is currently documented as unsupported in the .NET Agent Framework.',
    });
  }

  for (const agent of pattern.agents) {
    if (!agent.name.trim()) {
      issues.push({ level: 'error', field: 'agents.name', message: 'Every agent needs a name.' });
    }

    if (!agent.instructions.trim()) {
      issues.push({
        level: 'warning',
        field: 'agents.instructions',
        message: `Agent "${agent.name || agent.id}" should have instructions.`,
      });
    }

    if (!agent.model.trim()) {
      issues.push({
        level: 'error',
        field: 'agents.model',
        message: `Agent "${agent.name || agent.id}" requires a model identifier.`,
      });
    }
  }

  for (const message of validateApprovalPolicy(
    normalizeApprovalPolicy(pattern.approvalPolicy),
    pattern.agents.map((agent) => agent.id),
  )) {
    issues.push({
      level: 'error',
      field: 'approvalPolicy',
      message,
    });
  }

  return issues;
}

export function buildSessionTitle(pattern: PatternDefinition, messages: ChatMessageRecord[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  if (!firstUserMessage) {
    return pattern.name;
  }

  return firstUserMessage.content.slice(0, 48).trim() || pattern.name;
}
