import {
  createBuiltinPatterns,
  resolvePatternGraph,
  type PatternAgentDefinition,
  type PatternDefinition,
  type PatternGraphNode,
} from '@shared/domain/pattern';
import {
  normalizeWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowSettings,
} from '@shared/domain/workflow';
import { nowIso } from '@shared/utils/ids';

export type WorkflowTemplateCategory = 'orchestration' | 'data-pipeline' | 'human-in-loop';

export interface WorkflowTemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: WorkflowTemplateCategory;
  source: 'builtin' | 'custom';
  workflow: WorkflowDefinition;
  createdAt: string;
  updatedAt: string;
}

const workflowTemplateCategories = new Set<WorkflowTemplateCategory>([
  'orchestration',
  'data-pipeline',
  'human-in-loop',
]);

const builtinTemplateIdsByPatternId: Record<string, string> = {
  'pattern-single-chat': 'workflow-template-single',
  'pattern-sequential-review': 'workflow-template-sequential',
  'pattern-concurrent-brainstorm': 'workflow-template-concurrent',
  'pattern-handoff-support': 'workflow-template-handoff',
  'pattern-group-chat': 'workflow-template-group-chat',
};

function normalizeTemplateCategory(category?: WorkflowTemplateCategory): WorkflowTemplateCategory {
  return category && workflowTemplateCategories.has(category) ? category : 'orchestration';
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRequiredString(value: string | undefined, fallback: string): string {
  return normalizeOptionalString(value) ?? fallback;
}

function toWorkflowIdFromPatternId(patternId: string): string {
  const trimmed = patternId.trim();
  return trimmed.startsWith('pattern-')
    ? `workflow-${trimmed.slice('pattern-'.length)}`
    : `${trimmed}-workflow`;
}

function createWorkflowEdge(
  source: string,
  target: string,
  kind: WorkflowEdge['kind'],
  overrides?: Partial<WorkflowEdge>,
): WorkflowEdge {
  return {
    id: overrides?.id?.trim() || `workflow-edge-${source}-to-${target}`,
    source,
    target,
    kind,
    label: normalizeOptionalString(overrides?.label),
    condition: overrides?.condition,
    fanOutConfig: overrides?.fanOutConfig,
    isLoop: overrides?.isLoop,
    maxIterations: overrides?.maxIterations,
  };
}

function sortAgentNodes(nodes: ReadonlyArray<PatternGraphNode>): PatternGraphNode[] {
  return nodes
    .filter((node) => node.kind === 'agent' && node.agentId)
    .slice()
    .sort((left, right) => {
      const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.id.localeCompare(right.id);
    });
}

function normalizeTemplateWorkflow(
  workflow: WorkflowDefinition | Partial<WorkflowDefinition> | undefined,
): WorkflowDefinition {
  const candidate = workflow ?? {};
  const settings = candidate.settings as Partial<WorkflowSettings> | undefined;
  return normalizeWorkflowDefinition({
    id: normalizeRequiredString(candidate.id, 'workflow-template'),
    name: typeof candidate.name === 'string' ? candidate.name : '',
    description: typeof candidate.description === 'string' ? candidate.description : '',
    isFavorite: candidate.isFavorite,
    graph: (candidate.graph as WorkflowDefinition['graph'] | undefined) ?? {
      nodes: [],
      edges: [],
    },
    settings: {
      checkpointing: {
        enabled: settings?.checkpointing?.enabled ?? false,
      },
      executionMode: settings?.executionMode === 'lockstep' ? 'lockstep' : 'off-thread',
      maxIterations: settings?.maxIterations,
      approvalPolicy: settings?.approvalPolicy,
      stateScopes: settings?.stateScopes,
      telemetry: settings?.telemetry,
    },
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : nowIso(),
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : nowIso(),
  });
}

function createWorkflowAgentNode(
  patternNode: PatternGraphNode,
  agent: PatternAgentDefinition,
  fallbackOrder: number,
): WorkflowNode {
  return {
    id: patternNode.id.trim(),
    kind: 'agent',
    label: normalizeRequiredString(agent.name, `Agent ${fallbackOrder + 1}`),
    position: {
      x: patternNode.position.x,
      y: patternNode.position.y,
    },
    order: patternNode.order ?? fallbackOrder,
    config: {
      kind: 'agent',
      ...agent,
    },
  };
}

function mapPatternNodeId(node: PatternGraphNode | undefined): string | undefined {
  if (!node) {
    return undefined;
  }

  switch (node.kind) {
    case 'user-input':
      return 'start';
    case 'user-output':
      return 'end';
    case 'agent':
      return node.id.trim();
    default:
      return undefined;
  }
}

function buildWorkflowAdjacency(
  edges: ReadonlyArray<WorkflowEdge>,
  excludedEdgeId?: string,
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.id === excludedEdgeId) {
      continue;
    }

    const next = adjacency.get(edge.source);
    if (next) {
      next.push(edge.target);
    } else {
      adjacency.set(edge.source, [edge.target]);
    }
  }

  return adjacency;
}

function canReachWorkflowNode(
  edges: ReadonlyArray<WorkflowEdge>,
  startNodeId: string,
  targetNodeId: string,
  excludedEdgeId?: string,
): boolean {
  if (startNodeId === targetNodeId) {
    return true;
  }

  const adjacency = buildWorkflowAdjacency(edges, excludedEdgeId);
  const queue = [startNodeId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) {
      continue;
    }

    visited.add(current);
    for (const candidate of adjacency.get(current) ?? []) {
      if (candidate === targetNodeId) {
        return true;
      }

      queue.push(candidate);
    }
  }

  return false;
}

function markLoopEdges(
  edges: ReadonlyArray<WorkflowEdge>,
  maxIterations: number,
): WorkflowEdge[] {
  return edges.map((edge) => {
    const participatesInCycle = canReachWorkflowNode(edges, edge.target, edge.source, edge.id);
    if (!participatesInCycle) {
      return edge;
    }

    return {
      ...edge,
      isLoop: true,
      maxIterations,
      condition: edge.condition ?? { type: 'always' },
    };
  });
}

export function normalizeWorkflowTemplateDefinition(template: WorkflowTemplateDefinition): WorkflowTemplateDefinition {
  const workflow = normalizeTemplateWorkflow(template.workflow);
  return {
    ...template,
    id: normalizeRequiredString(template.id, `workflow-template-${workflow.id}`),
    name: normalizeRequiredString(template.name, workflow.name || 'Workflow Template'),
    description: template.description?.trim() ?? '',
    category: normalizeTemplateCategory(template.category),
    source: template.source === 'builtin' ? 'builtin' : 'custom',
    workflow,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

export function buildWorkflowFromPattern(pattern: PatternDefinition): WorkflowDefinition {
  const resolvedGraph = resolvePatternGraph(pattern);
  const patternNodesById = new Map(resolvedGraph.nodes.map((node) => [node.id, node]));
  const agentsById = new Map(pattern.agents.map((agent) => [agent.id, agent]));
  const orderedAgentNodes = sortAgentNodes(resolvedGraph.nodes);
  const startPosition = patternNodesById.get('system-user-input')?.position ?? { x: 0, y: 0 };
  const endPosition = patternNodesById.get('system-user-output')?.position ?? { x: 500, y: 0 };
  const workflowNodes: WorkflowNode[] = [
    {
      id: 'start',
      kind: 'start',
      label: 'Start',
      position: { x: startPosition.x, y: startPosition.y },
      config: { kind: 'start' },
    },
    ...orderedAgentNodes.map((node, index) => {
      const agent = node.agentId ? agentsById.get(node.agentId) : undefined;
      if (!agent) {
        throw new Error(`Pattern "${pattern.id}" references missing agent "${node.agentId ?? node.id}".`);
      }

      return createWorkflowAgentNode(node, agent, index);
    }),
    {
      id: 'end',
      kind: 'end',
      label: 'End',
      position: { x: endPosition.x, y: endPosition.y },
      config: { kind: 'end' },
    },
  ];

  const orderedAgentIds = workflowNodes.filter((node) => node.kind === 'agent').map((node) => node.id);
  const edges: WorkflowEdge[] = [];
  const seenEdges = new Set<string>();
  const pushEdge = (edge: WorkflowEdge) => {
    const dedupeKey = `${edge.source}:${edge.target}:${edge.kind}:${edge.isLoop === true ? 'loop' : 'plain'}`;
    if (seenEdges.has(dedupeKey)) {
      return;
    }

    seenEdges.add(dedupeKey);
    edges.push(edge);
  };

  switch (pattern.mode) {
    case 'single':
    case 'sequential':
    case 'magentic': {
      const path = ['start', ...orderedAgentIds, 'end'];
      for (let index = 0; index < path.length - 1; index += 1) {
        pushEdge(createWorkflowEdge(path[index]!, path[index + 1]!, 'direct'));
      }
      break;
    }
    case 'concurrent': {
      for (const agentId of orderedAgentIds) {
        pushEdge(createWorkflowEdge('start', agentId, 'fan-out', {
          fanOutConfig: { strategy: 'broadcast' },
        }));
        pushEdge(createWorkflowEdge(agentId, 'end', 'fan-in'));
      }
      break;
    }
    case 'handoff': {
      for (const patternEdge of resolvedGraph.edges) {
        const sourceNode = patternNodesById.get(patternEdge.source);
        const targetNode = patternNodesById.get(patternEdge.target);
        const source = mapPatternNodeId(sourceNode);
        const target = mapPatternNodeId(targetNode);
        if (!source || !target) {
          continue;
        }

        pushEdge(createWorkflowEdge(source, target, 'direct', {
          id: `workflow-${patternEdge.id.trim()}`,
        }));
      }
      break;
    }
    case 'group-chat': {
      const path = ['start', ...orderedAgentIds, 'end'];
      for (let index = 0; index < path.length - 1; index += 1) {
        const source = path[index]!;
        const target = path[index + 1]!;
        pushEdge(createWorkflowEdge(source, target, 'direct', source !== 'start' && target !== 'end'
          ? {
            isLoop: true,
            maxIterations: pattern.maxIterations,
            condition: { type: 'always' },
          }
          : undefined));
      }

      if (orderedAgentIds.length > 0) {
        pushEdge(createWorkflowEdge(
          orderedAgentIds[orderedAgentIds.length - 1]!,
          orderedAgentIds[0]!,
          'direct',
          {
            id: `workflow-edge-${orderedAgentIds[orderedAgentIds.length - 1]}-loop-${orderedAgentIds[0]}`,
            isLoop: true,
            maxIterations: pattern.maxIterations,
            condition: { type: 'always' },
            label: 'Loop',
          },
        ));
      }
      break;
    }
  }

  const finalizedEdges = pattern.mode === 'handoff'
    ? markLoopEdges(edges, Math.max(pattern.maxIterations, 1))
    : edges;

  return normalizeWorkflowDefinition({
    id: toWorkflowIdFromPatternId(pattern.id),
    name: pattern.name,
    description: pattern.description,
    graph: {
      nodes: workflowNodes,
      edges: finalizedEdges,
    },
    settings: {
      checkpointing: { enabled: false },
      executionMode: 'off-thread',
      maxIterations: pattern.maxIterations,
      approvalPolicy: pattern.approvalPolicy,
    },
    createdAt: pattern.createdAt,
    updatedAt: pattern.updatedAt,
  });
}

export function createBuiltinWorkflowTemplates(timestamp: string): WorkflowTemplateDefinition[] {
  return createBuiltinPatterns(timestamp)
    .filter((pattern) => pattern.availability !== 'unavailable')
    .map((pattern) => normalizeWorkflowTemplateDefinition({
      id: builtinTemplateIdsByPatternId[pattern.id] ?? `workflow-template-${pattern.id}`,
      name: pattern.name,
      description: pattern.description,
      category: 'orchestration',
      source: 'builtin',
      workflow: buildWorkflowFromPattern(pattern),
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
}

export function createWorkflowTemplateFromWorkflow(
  workflow: WorkflowDefinition,
  options?: {
    templateId?: string;
    name?: string;
    description?: string;
    category?: WorkflowTemplateCategory;
  },
): WorkflowTemplateDefinition {
  const timestamp = nowIso();
  const normalizedWorkflow = normalizeTemplateWorkflow(workflow);
  return normalizeWorkflowTemplateDefinition({
    id: normalizeOptionalString(options?.templateId) ?? `workflow-template-${normalizedWorkflow.id}`,
    name: normalizeOptionalString(options?.name) ?? normalizedWorkflow.name,
    description: options?.description?.trim() ?? normalizedWorkflow.description,
    category: options?.category ?? 'orchestration',
    source: 'custom',
    workflow: normalizedWorkflow,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function applyWorkflowTemplate(
  template: WorkflowTemplateDefinition,
  options?: {
    workflowId?: string;
    name?: string;
    description?: string;
  },
): WorkflowDefinition {
  const timestamp = nowIso();
  const normalizedTemplate = normalizeWorkflowTemplateDefinition(template);
  return normalizeWorkflowDefinition({
    ...normalizedTemplate.workflow,
    id: normalizeOptionalString(options?.workflowId) ?? normalizedTemplate.workflow.id,
    name: normalizeOptionalString(options?.name) ?? normalizedTemplate.workflow.name,
    description: options?.description?.trim() ?? normalizedTemplate.workflow.description,
    isFavorite: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
