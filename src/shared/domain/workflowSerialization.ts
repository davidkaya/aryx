import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import {
  normalizeWorkflowDefinition,
  validateWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowSettings,
} from '@shared/domain/workflow';
import { nowIso } from '@shared/utils/ids';

export type WorkflowExportFormat = 'yaml' | 'mermaid' | 'dot';

export interface WorkflowExportResult {
  format: WorkflowExportFormat;
  content: string;
}

function coerceWorkflowDefinition(value: unknown): WorkflowDefinition {
  if (!value || typeof value !== 'object') {
    throw new Error('Imported workflow must be an object.');
  }

  const candidate = value as Partial<WorkflowDefinition>;
  const settings = candidate.settings as Partial<WorkflowSettings> | undefined;
  return normalizeWorkflowDefinition({
    id: typeof candidate.id === 'string' ? candidate.id.trim() : '',
    name: typeof candidate.name === 'string' ? candidate.name : '',
    description: typeof candidate.description === 'string' ? candidate.description : '',
    isFavorite: candidate.isFavorite,
    graph: (candidate.graph as WorkflowGraph | undefined) ?? { nodes: [], edges: [] },
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

function ensureValidWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  const normalized = normalizeWorkflowDefinition(workflow);
  const issue = validateWorkflowDefinition(normalized).find((candidate) => candidate.level === 'error');
  if (issue) {
    throw new Error(issue.message);
  }

  return normalized;
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '<br/>');
}

function escapeDotLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatNodeLabel(node: WorkflowNode): string {
  return node.label || node.id;
}

function formatEdgeConditionLabel(condition?: WorkflowEdge['condition']): string | undefined {
  if (!condition) {
    return undefined;
  }

  switch (condition.type) {
    case 'always':
      return 'always';
    case 'message-type':
      return `message:${condition.typeName}`;
    case 'expression':
      return condition.expression;
    case 'property':
      return condition.rules
        .map((rule) => `${rule.propertyPath} ${rule.operator} ${rule.value}`)
        .join(` ${condition.combinator === 'or' ? 'OR' : 'AND'} `);
  }
}

function formatEdgeLabel(edge: WorkflowEdge): string | undefined {
  const parts = [
    edge.label,
    edge.kind === 'fan-out' ? 'fan-out' : undefined,
    edge.kind === 'fan-in' ? 'fan-in' : undefined,
    edge.isLoop ? `loop≤${edge.maxIterations ?? '?'}` : undefined,
    formatEdgeConditionLabel(edge.condition),
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(' • ') : undefined;
}

function buildMermaidContent(workflow: WorkflowDefinition): string {
  const nodeIds = new Map(workflow.graph.nodes.map((node, index) => [node.id, `n${index}`]));
  const lines = ['flowchart LR'];

  for (const node of workflow.graph.nodes) {
    const nodeId = nodeIds.get(node.id)!;
    const label = escapeMermaidLabel(formatNodeLabel(node));
    switch (node.kind) {
      case 'start':
      case 'end':
        lines.push(`  ${nodeId}(["${label}"])`);
        break;
      default:
        lines.push(`  ${nodeId}["${label}"]`);
        break;
    }
  }

  for (const edge of workflow.graph.edges) {
    const source = nodeIds.get(edge.source);
    const target = nodeIds.get(edge.target);
    if (!source || !target) {
      continue;
    }

    const label = formatEdgeLabel(edge);
    lines.push(label
      ? `  ${source} -->|${escapeMermaidLabel(label)}| ${target}`
      : `  ${source} --> ${target}`);
  }

  return `${lines.join('\n')}\n`;
}

function buildDotContent(workflow: WorkflowDefinition): string {
  const lines = ['digraph Workflow {', '  rankdir=LR;'];

  for (const node of workflow.graph.nodes) {
    const shape = node.kind === 'start' || node.kind === 'end' ? 'oval' : 'box';
    lines.push(`  "${node.id}" [label="${escapeDotLabel(formatNodeLabel(node))}", shape=${shape}];`);
  }

  for (const edge of workflow.graph.edges) {
    const label = formatEdgeLabel(edge);
    lines.push(label
      ? `  "${edge.source}" -> "${edge.target}" [label="${escapeDotLabel(label)}"];`
      : `  "${edge.source}" -> "${edge.target}";`);
  }

  lines.push('}');
  return `${lines.join('\n')}\n`;
}

export function exportWorkflowDefinition(
  workflow: WorkflowDefinition,
  format: WorkflowExportFormat,
): WorkflowExportResult {
  const normalized = ensureValidWorkflow(workflow);

  switch (format) {
    case 'yaml':
      return {
        format,
        content: stringifyYaml(normalized, { indent: 2 }),
      };
    case 'mermaid':
      return {
        format,
        content: buildMermaidContent(normalized),
      };
    case 'dot':
      return {
        format,
        content: buildDotContent(normalized),
      };
  }
}

const safeYamlOptions = {
  schema: 'core' as const,
  customTags: [] as [],
  merge: false as const,
};

export function importWorkflowDefinition(content: string, format: 'yaml' | 'json'): WorkflowDefinition {
  const parsed = format === 'yaml'
    ? parseYaml(content, safeYamlOptions)
    : JSON.parse(content) as unknown;

  return ensureValidWorkflow(coerceWorkflowDefinition(parsed));
}
