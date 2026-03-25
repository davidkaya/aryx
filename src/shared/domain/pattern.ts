import type { ChatMessageRecord } from '@shared/domain/session';
import {
  applyDefaultToolApprovalPolicy,
  normalizeApprovalPolicy,
  type ApprovalPolicy,
  validateApprovalPolicy,
} from '@shared/domain/approval';
import { buildMarkdownExcerpt } from '@shared/utils/markdownText';

export type OrchestrationMode =
  | 'single'
  | 'sequential'
  | 'concurrent'
  | 'handoff'
  | 'group-chat'
  | 'magentic';

export type PatternAvailability = 'available' | 'preview' | 'unavailable';
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type PatternGraphNodeKind =
  | 'user-input'
  | 'user-output'
  | 'agent'
  | 'distributor'
  | 'collector'
  | 'orchestrator';

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

export interface PatternGraphPosition {
  x: number;
  y: number;
}

export interface PatternGraphNode {
  id: string;
  kind: PatternGraphNodeKind;
  position: PatternGraphPosition;
  agentId?: string;
  order?: number;
}

export interface PatternGraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface PatternGraph {
  nodes: PatternGraphNode[];
  edges: PatternGraphEdge[];
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
  graph?: PatternGraph;
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

const SYSTEM_NODE_IDS = {
  userInput: 'system-user-input',
  userOutput: 'system-user-output',
  distributor: 'system-distributor',
  collector: 'system-collector',
  orchestrator: 'system-orchestrator',
} as const;

export function isReasoningEffort(value: string | undefined): value is ReasoningEffort {
  return value !== undefined && reasoningEffortSet.has(value as ReasoningEffort);
}

function agentNodeId(agentId: string): string {
  return `agent-node-${agentId}`;
}

function edgeId(source: string, target: string): string {
  return `edge-${source}-to-${target}`;
}

function createEdge(source: string, target: string): PatternGraphEdge {
  return {
    id: edgeId(source, target),
    source,
    target,
  };
}

function createAgentNode(
  agent: PatternAgentDefinition,
  order: number,
  position: PatternGraphPosition,
): PatternGraphNode {
  return {
    id: agentNodeId(agent.id),
    kind: 'agent',
    agentId: agent.id,
    order,
    position,
  };
}

function spreadY(index: number, count: number, gap = 170): number {
  return (index - (count - 1) / 2) * gap;
}

function createLinearGraph(agents: PatternAgentDefinition[]): PatternGraph {
  const xStep = 250;
  const inputNode: PatternGraphNode = {
    id: SYSTEM_NODE_IDS.userInput,
    kind: 'user-input',
    position: { x: 0, y: 0 },
  };
  const outputNode: PatternGraphNode = {
    id: SYSTEM_NODE_IDS.userOutput,
    kind: 'user-output',
    position: { x: xStep * Math.max(agents.length + 1, 2), y: 0 },
  };
  const agentNodes = agents.map((agent, index) =>
    createAgentNode(agent, index, { x: xStep * (index + 1), y: 0 }),
  );
  const edges: PatternGraphEdge[] = [];
  const path = [inputNode.id, ...agentNodes.map((node) => node.id), outputNode.id];
  for (let index = 0; index < path.length - 1; index += 1) {
    edges.push(createEdge(path[index]!, path[index + 1]!));
  }

  return {
    nodes: [inputNode, ...agentNodes, outputNode],
    edges,
  };
}

function createConcurrentGraph(agents: PatternAgentDefinition[]): PatternGraph {
  const agentCount = Math.max(agents.length, 1);
  const agentGap = 150;
  const inputNode: PatternGraphNode = {
    id: SYSTEM_NODE_IDS.userInput,
    kind: 'user-input',
    position: { x: 0, y: 0 },
  };
  const distributorNode: PatternGraphNode = {
    id: SYSTEM_NODE_IDS.distributor,
    kind: 'distributor',
    position: { x: 200, y: 0 },
  };
  const collectorNode: PatternGraphNode = {
    id: SYSTEM_NODE_IDS.collector,
    kind: 'collector',
    position: { x: 700, y: 0 },
  };
  const outputNode: PatternGraphNode = {
    id: SYSTEM_NODE_IDS.userOutput,
    kind: 'user-output',
    position: { x: 920, y: 0 },
  };
  // Stagger agents at alternating X offsets so fan-out/fan-in edges
  // take distinct bezier paths and don't overlap each other.
  const agentNodes = agents.map((agent, index) =>
    createAgentNode(agent, index, {
      x: index % 2 === 0 ? 420 : 480,
      y: spreadY(index, agentCount, agentGap),
    }),
  );

  return {
    nodes: [inputNode, distributorNode, ...agentNodes, collectorNode, outputNode],
    edges: [
      createEdge(inputNode.id, distributorNode.id),
      ...agentNodes.map((node) => createEdge(distributorNode.id, node.id)),
      ...agentNodes.map((node) => createEdge(node.id, collectorNode.id)),
      createEdge(collectorNode.id, outputNode.id),
    ],
  };
}

function createHandoffGraph(agents: PatternAgentDefinition[]): PatternGraph {
  const inputNode: PatternGraphNode = {
    id: SYSTEM_NODE_IDS.userInput,
    kind: 'user-input',
    position: { x: 0, y: 0 },
  };
  const outputNode: PatternGraphNode = {
    id: SYSTEM_NODE_IDS.userOutput,
    kind: 'user-output',
    position: { x: 780, y: 0 },
  };
  const entryAgent = agents[0];
  const specialistCount = Math.max(agents.length - 1, 1);
  const entryNode = entryAgent
    ? createAgentNode(entryAgent, 0, { x: 220, y: 0 })
    : undefined;
  // Place specialists in a staggered column with wider horizontal and vertical
  // spacing so bidirectional bezier edges between triage↔specialists route cleanly.
  const specialistNodes = agents.slice(1).map((agent, index) =>
    createAgentNode(agent, index + 1, {
      x: index % 2 === 0 ? 500 : 560,
      y: spreadY(index, specialistCount, 160),
    }),
  );
  const nodes = [inputNode, ...(entryNode ? [entryNode] : []), ...specialistNodes, outputNode];
  const edges: PatternGraphEdge[] = [];

  if (entryNode) {
    edges.push(createEdge(inputNode.id, entryNode.id));
    edges.push(createEdge(entryNode.id, outputNode.id));

    for (const specialistNode of specialistNodes) {
      edges.push(createEdge(entryNode.id, specialistNode.id));
      edges.push(createEdge(specialistNode.id, entryNode.id));
      edges.push(createEdge(specialistNode.id, outputNode.id));
    }
  }

  return { nodes, edges };
}

function createGroupChatGraph(agents: PatternAgentDefinition[]): PatternGraph {
  const agentCount = Math.max(agents.length, 1);
  const inputNode: PatternGraphNode = {
    id: SYSTEM_NODE_IDS.userInput,
    kind: 'user-input',
    position: { x: 0, y: 0 },
  };
  const orchestratorNode: PatternGraphNode = {
    id: SYSTEM_NODE_IDS.orchestrator,
    kind: 'orchestrator',
    position: { x: 220, y: 0 },
  };
  const outputNode: PatternGraphNode = {
    id: SYSTEM_NODE_IDS.userOutput,
    kind: 'user-output',
    position: { x: 740, y: 0 },
  };
  // Place agents in a staggered column to the right of the orchestrator.
  // Alternating X offsets give bezier curves distinct paths so bidirectional
  // orchestrator↔agent edges don't stack on top of each other.
  const agentNodes = agents.map((agent, index) =>
    createAgentNode(agent, index, {
      x: index % 2 === 0 ? 460 : 520,
      y: spreadY(index, agentCount, 140),
    }),
  );

  return {
    nodes: [inputNode, orchestratorNode, ...agentNodes, outputNode],
    edges: [
      createEdge(inputNode.id, orchestratorNode.id),
      ...agentNodes.flatMap((node) => [
        createEdge(orchestratorNode.id, node.id),
        createEdge(node.id, orchestratorNode.id),
      ]),
      createEdge(orchestratorNode.id, outputNode.id),
    ],
  };
}

export function createDefaultPatternGraph(
  pattern: Pick<PatternDefinition, 'mode' | 'agents'>,
): PatternGraph {
  switch (pattern.mode) {
    case 'single':
    case 'sequential':
    case 'magentic':
      return createLinearGraph(pattern.agents);
    case 'concurrent':
      return createConcurrentGraph(pattern.agents);
    case 'handoff':
      return createHandoffGraph(pattern.agents);
    case 'group-chat':
      return createGroupChatGraph(pattern.agents);
    default:
      return createLinearGraph(pattern.agents);
  }
}

export function resolvePatternGraph(pattern: PatternDefinition): PatternGraph {
  return pattern.graph ?? createDefaultPatternGraph(pattern);
}

export function syncPatternGraph(pattern: PatternDefinition): PatternDefinition {
  return {
    ...pattern,
    graph: createDefaultPatternGraph(pattern),
  };
}

export function createBuiltinPatterns(timestamp: string): PatternDefinition[] {
  const patterns: PatternDefinition[] = [
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
      description: 'Agents execute in order, each seeing the full conversation and appending to a shared transcript.',
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
      description: 'Agents work independently in parallel and the final conversation aggregates every response.',
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
      description: 'A triage agent routes work to specialists, and the next user turn continues when more input is needed.',
      mode: 'handoff',
      availability: 'available',
      maxIterations: 4,
      agents: [
        {
          id: 'agent-handoff-triage',
          name: 'Triage',
          description: 'Routes the request to the right specialist.',
          instructions:
            'You triage requests and must hand them off to the most appropriate specialist. For any substantive task, hand off before inspecting files, calling tools, or drafting the implementation yourself. Do not claim that you delegated unless you actually executed the handoff.',
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
      description: 'Agents take turns under a round-robin manager, iteratively refining a shared conversation.',
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

  return patterns.map((pattern) => syncPatternGraph({
    ...pattern,
    approvalPolicy: applyDefaultToolApprovalPolicy(pattern.approvalPolicy),
  }));
}

function countByKind(graph: PatternGraph): Map<PatternGraphNodeKind, number> {
  const counts = new Map<PatternGraphNodeKind, number>();
  for (const node of graph.nodes) {
    counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
  }
  return counts;
}

function getNodeByKind(graph: PatternGraph, kind: PatternGraphNodeKind): PatternGraphNode | undefined {
  return graph.nodes.find((node) => node.kind === kind);
}

function getAgentNodes(graph: PatternGraph): PatternGraphNode[] {
  return graph.nodes.filter((node) => node.kind === 'agent');
}

function pushGraphIssue(
  issues: PatternValidationIssue[],
  message: string,
  field = 'graph',
  level: 'error' | 'warning' = 'error',
): void {
  issues.push({ level, field, message });
}

function buildAdjacency(graph: PatternGraph): {
  incoming: Map<string, PatternGraphEdge[]>;
  outgoing: Map<string, PatternGraphEdge[]>;
} {
  const incoming = new Map<string, PatternGraphEdge[]>();
  const outgoing = new Map<string, PatternGraphEdge[]>();

  for (const node of graph.nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }

  for (const edge of graph.edges) {
    incoming.get(edge.target)?.push(edge);
    outgoing.get(edge.source)?.push(edge);
  }

  return { incoming, outgoing };
}

function validateSystemNodeCounts(
  graph: PatternGraph,
  expectedKinds: readonly PatternGraphNodeKind[],
  issues: PatternValidationIssue[],
): void {
  const counts = countByKind(graph);
  const expectedSet = new Set(expectedKinds);

  for (const kind of expectedKinds) {
    if ((counts.get(kind) ?? 0) !== 1) {
      pushGraphIssue(issues, `Pattern graph must include exactly one "${kind}" node.`);
    }
  }

  for (const [kind, count] of counts) {
    if (kind === 'agent') {
      continue;
    }

    if (!expectedSet.has(kind) && count > 0) {
      pushGraphIssue(issues, `Pattern graph does not allow "${kind}" nodes in ${graphModeLabel(expectedKinds)} mode.`);
    }
  }
}

function graphModeLabel(expectedKinds: readonly PatternGraphNodeKind[]): string {
  if (expectedKinds.includes('collector')) {
    return 'concurrent';
  }

  if (expectedKinds.includes('orchestrator')) {
    return 'group chat';
  }

  return 'this';
}

function validateLinearGraph(
  pattern: PatternDefinition,
  graph: PatternGraph,
  issues: PatternValidationIssue[],
): void {
  validateSystemNodeCounts(graph, ['user-input', 'user-output'], issues);
  const inputNode = getNodeByKind(graph, 'user-input');
  const outputNode = getNodeByKind(graph, 'user-output');
  if (!inputNode || !outputNode) {
    return;
  }

  const { incoming, outgoing } = buildAdjacency(graph);
  const agentNodes = getAgentNodes(graph);

  if (graph.edges.length !== pattern.agents.length + 1) {
    pushGraphIssue(issues, 'Linear orchestration graphs must be a single path from user input through every agent to user output.');
  }

  if ((incoming.get(inputNode.id)?.length ?? 0) !== 0 || (outgoing.get(inputNode.id)?.length ?? 0) !== 1) {
    pushGraphIssue(issues, 'User input must start exactly one path.');
  }

  if ((incoming.get(outputNode.id)?.length ?? 0) !== 1 || (outgoing.get(outputNode.id)?.length ?? 0) !== 0) {
    pushGraphIssue(issues, 'User output must terminate exactly one path.');
  }

  for (const node of agentNodes) {
    if ((incoming.get(node.id)?.length ?? 0) !== 1 || (outgoing.get(node.id)?.length ?? 0) !== 1) {
      pushGraphIssue(issues, 'Each agent in a linear orchestration must have exactly one incoming and one outgoing edge.');
      break;
    }
  }

  const visited = new Set<string>();
  let currentNodeId = inputNode.id;

  while (!visited.has(currentNodeId)) {
    visited.add(currentNodeId);
    const nextEdge = outgoing.get(currentNodeId);
    if (!nextEdge || nextEdge.length === 0) {
      break;
    }

    if (nextEdge.length !== 1) {
      pushGraphIssue(issues, 'Linear orchestration nodes may only branch to one next step.');
      break;
    }

    currentNodeId = nextEdge[0]!.target;
    if (currentNodeId === outputNode.id) {
      visited.add(currentNodeId);
      break;
    }
  }

  const expectedVisited = new Set<string>([inputNode.id, outputNode.id, ...agentNodes.map((node) => node.id)]);
  if (visited.size !== expectedVisited.size || [...expectedVisited].some((nodeId) => !visited.has(nodeId))) {
    pushGraphIssue(issues, 'Linear orchestration graphs must visit every agent exactly once.');
  }
}

function validateConcurrentGraph(
  pattern: PatternDefinition,
  graph: PatternGraph,
  issues: PatternValidationIssue[],
): void {
  validateSystemNodeCounts(graph, ['user-input', 'distributor', 'collector', 'user-output'], issues);
  const inputNode = getNodeByKind(graph, 'user-input');
  const distributorNode = getNodeByKind(graph, 'distributor');
  const collectorNode = getNodeByKind(graph, 'collector');
  const outputNode = getNodeByKind(graph, 'user-output');
  if (!inputNode || !distributorNode || !collectorNode || !outputNode) {
    return;
  }

  const { incoming, outgoing } = buildAdjacency(graph);
  const agentNodes = getAgentNodes(graph);

  if (graph.edges.length !== pattern.agents.length * 2 + 2) {
    pushGraphIssue(issues, 'Concurrent orchestration graphs must fan out from the distributor and fan back into the collector.');
  }

  const distributorTargets = new Set((outgoing.get(distributorNode.id) ?? []).map((edge) => edge.target));
  const collectorSources = new Set((incoming.get(collectorNode.id) ?? []).map((edge) => edge.source));

  if ((incoming.get(inputNode.id)?.length ?? 0) !== 0 || (outgoing.get(inputNode.id)?.length ?? 0) !== 1) {
    pushGraphIssue(issues, 'User input must connect only to the distributor.');
  }

  if ((incoming.get(distributorNode.id)?.length ?? 0) !== 1) {
    pushGraphIssue(issues, 'Distributor must receive exactly one edge from user input.');
  }

  if ((outgoing.get(collectorNode.id)?.length ?? 0) !== 1 || (incoming.get(outputNode.id)?.length ?? 0) !== 1) {
    pushGraphIssue(issues, 'Collector must forward exactly one edge to user output.');
  }

  for (const agentNode of agentNodes) {
    if (!distributorTargets.has(agentNode.id)) {
      pushGraphIssue(issues, `Distributor must connect to agent "${agentNode.agentId}".`);
    }

    if (!collectorSources.has(agentNode.id)) {
      pushGraphIssue(issues, `Agent "${agentNode.agentId}" must connect to the collector.`);
    }
  }
}

function validateHandoffGraph(
  graph: PatternGraph,
  issues: PatternValidationIssue[],
): void {
  validateSystemNodeCounts(graph, ['user-input', 'user-output'], issues);
  const inputNode = getNodeByKind(graph, 'user-input');
  const outputNode = getNodeByKind(graph, 'user-output');
  if (!inputNode || !outputNode) {
    return;
  }

  const { incoming, outgoing } = buildAdjacency(graph);
  const agentNodes = getAgentNodes(graph);
  const agentNodeIds = new Set(agentNodes.map((node) => node.id));
  const entryEdges = outgoing.get(inputNode.id) ?? [];
  const completionEdges = incoming.get(outputNode.id) ?? [];

  if (entryEdges.length !== 1) {
    pushGraphIssue(issues, 'Handoff graphs must connect user input to exactly one entry agent.');
    return;
  }

  if (!agentNodeIds.has(entryEdges[0]!.target)) {
    pushGraphIssue(issues, 'Handoff entry edges must target an agent node.');
  }

  if (completionEdges.length === 0) {
    pushGraphIssue(issues, 'Handoff graphs must allow at least one agent to complete back to user output.');
  }

  let hasAgentToAgentRoute = false;
  for (const edge of graph.edges) {
    if (edge.source === inputNode.id) {
      continue;
    }

    if (edge.target === outputNode.id) {
      if (!agentNodeIds.has(edge.source)) {
        pushGraphIssue(issues, 'Only agent nodes may complete to user output.');
      }
      continue;
    }

    if (!agentNodeIds.has(edge.source) || !agentNodeIds.has(edge.target)) {
      pushGraphIssue(issues, 'Handoff routes may only connect agents to agents or agents to user output.');
      continue;
    }

    if (edge.source === edge.target) {
      pushGraphIssue(issues, 'Handoff routes cannot target the same agent node.');
    }

    hasAgentToAgentRoute = true;
  }

  if (!hasAgentToAgentRoute && agentNodes.length > 1) {
    pushGraphIssue(issues, 'Handoff graphs must include at least one agent-to-agent handoff route.');
  }

  const reachable = new Set<string>();
  const stack = [entryEdges[0]!.target];

  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (reachable.has(nodeId)) {
      continue;
    }

    reachable.add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (agentNodeIds.has(edge.target) && !reachable.has(edge.target)) {
        stack.push(edge.target);
      }
    }
  }

  for (const agentNode of agentNodes) {
    if (!reachable.has(agentNode.id)) {
      pushGraphIssue(issues, `Handoff entry agent must be able to reach "${agentNode.agentId}".`, 'graph', 'warning');
    }
  }

  if ((incoming.get(inputNode.id)?.length ?? 0) !== 0 || (outgoing.get(outputNode.id)?.length ?? 0) !== 0) {
    pushGraphIssue(issues, 'User input cannot have incoming edges and user output cannot have outgoing edges.');
  }
}

function validateGroupChatGraph(
  pattern: PatternDefinition,
  graph: PatternGraph,
  issues: PatternValidationIssue[],
): void {
  validateSystemNodeCounts(graph, ['user-input', 'orchestrator', 'user-output'], issues);
  const inputNode = getNodeByKind(graph, 'user-input');
  const orchestratorNode = getNodeByKind(graph, 'orchestrator');
  const outputNode = getNodeByKind(graph, 'user-output');
  if (!inputNode || !orchestratorNode || !outputNode) {
    return;
  }

  const { incoming, outgoing } = buildAdjacency(graph);
  const agentNodes = getAgentNodes(graph);
  const orchestratorTargets = new Set((outgoing.get(orchestratorNode.id) ?? []).map((edge) => edge.target));
  const orchestratorSources = new Set((incoming.get(orchestratorNode.id) ?? []).map((edge) => edge.source));

  if (graph.edges.length !== pattern.agents.length * 2 + 2) {
    pushGraphIssue(issues, 'Group chat graphs must connect the orchestrator to every participant and then back to user output.', 'graph', 'warning');
  }

  if ((outgoing.get(inputNode.id) ?? []).some((edge) => edge.target !== orchestratorNode.id)) {
    pushGraphIssue(issues, 'User input must only connect to the orchestrator.');
  }

  if (!(outgoing.get(orchestratorNode.id) ?? []).some((edge) => edge.target === outputNode.id)) {
    pushGraphIssue(issues, 'Group chat orchestrator must connect to user output.');
  }

  for (const agentNode of agentNodes) {
    if (!orchestratorTargets.has(agentNode.id)) {
      pushGraphIssue(issues, `Orchestrator must connect to agent "${agentNode.agentId}".`, 'graph', 'warning');
    }

    if (!orchestratorSources.has(agentNode.id)) {
      pushGraphIssue(issues, `Agent "${agentNode.agentId}" must connect back to the orchestrator.`, 'graph', 'warning');
    }
  }
}

function validatePatternGraph(
  pattern: PatternDefinition,
  graph: PatternGraph,
  issues: PatternValidationIssue[],
): void {
  if (graph.nodes.length === 0) {
    pushGraphIssue(issues, 'Pattern graph must include nodes.');
    return;
  }

  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const agentIds = new Set(pattern.agents.map((agent) => agent.id));
  const seenAgentIds = new Set<string>();
  const seenAgentOrders = new Set<number>();
  const nodesById = new Map<string, PatternGraphNode>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      pushGraphIssue(issues, `Pattern graph contains duplicate node "${node.id}".`);
    }

    nodeIds.add(node.id);
    nodesById.set(node.id, node);

    if (node.kind === 'agent') {
      if (!node.agentId || !agentIds.has(node.agentId)) {
        pushGraphIssue(issues, `Agent node "${node.id}" must reference a known agent.`);
      }

      if (node.agentId) {
        if (seenAgentIds.has(node.agentId)) {
          pushGraphIssue(issues, `Pattern graph contains multiple nodes for agent "${node.agentId}".`);
        }
        seenAgentIds.add(node.agentId);
      }

      if (typeof node.order !== 'number' || !Number.isInteger(node.order)) {
        pushGraphIssue(issues, `Agent node "${node.id}" must define an integer order.`);
      } else if (seenAgentOrders.has(node.order)) {
        pushGraphIssue(issues, `Pattern graph contains duplicate agent order "${node.order}".`);
      } else {
        seenAgentOrders.add(node.order);
      }
    } else if (node.agentId) {
      pushGraphIssue(issues, `System node "${node.id}" cannot reference an agent.`);
    }
  }

  for (const agent of pattern.agents) {
    if (!seenAgentIds.has(agent.id)) {
      pushGraphIssue(issues, `Pattern graph is missing node metadata for agent "${agent.id}".`);
    }
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      pushGraphIssue(issues, `Pattern graph contains duplicate edge "${edge.id}".`);
    }
    edgeIds.add(edge.id);

    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      pushGraphIssue(issues, `Pattern graph edge "${edge.id}" must connect known nodes.`);
    }
  }

  switch (pattern.mode) {
    case 'single':
    case 'sequential':
    case 'magentic':
      validateLinearGraph(pattern, graph, issues);
      break;
    case 'concurrent':
      validateConcurrentGraph(pattern, graph, issues);
      break;
    case 'handoff':
      validateHandoffGraph(graph, issues);
      break;
    case 'group-chat':
      validateGroupChatGraph(pattern, graph, issues);
      break;
    default:
      break;
  }
}

export function validatePatternDefinition(
  pattern: PatternDefinition,
  knownToolNames?: readonly string[],
): PatternValidationIssue[] {
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

  validatePatternGraph(pattern, resolvePatternGraph(pattern), issues);

  for (const message of validateApprovalPolicy(
    normalizeApprovalPolicy(pattern.approvalPolicy),
    pattern.agents.map((agent) => agent.id),
    knownToolNames,
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

  return buildMarkdownExcerpt(firstUserMessage.content, 48) ?? pattern.name;
}
