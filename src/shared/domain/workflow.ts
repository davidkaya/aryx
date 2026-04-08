import type { PatternAgentCopilotConfig } from '@shared/contracts/sidecar';
import type { ApprovalPolicy } from '@shared/domain/approval';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';
export type WorkflowOrchestrationMode = 'single' | 'sequential' | 'concurrent' | 'handoff' | 'group-chat';
export type HandoffToolCallFiltering = 'none' | 'handoff-only' | 'all';
export type GroupChatSelectionStrategy = 'round-robin';

export interface HandoffModeSettings {
  toolCallFiltering: HandoffToolCallFiltering;
  returnToPrevious: boolean;
  handoffInstructions?: string;
  triageAgentNodeId?: string;
}

export interface GroupChatModeSettings {
  selectionStrategy: GroupChatSelectionStrategy;
  maxRounds: number;
}

export interface OrchestrationModeSettings {
  handoff?: HandoffModeSettings;
  groupChat?: GroupChatModeSettings;
}

export interface WorkflowAgentOverrides {
  name?: string;
  description?: string;
  instructions?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export const reasoningEffortOptions: ReadonlyArray<{ value: ReasoningEffort; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Very High' },
];

export type WorkflowNodeKind =
  | 'start'
  | 'end'
  | 'agent'
  | 'invoke-function'
  | 'sub-workflow'
  | 'request-port';

export type WorkflowEdgeKind = 'direct' | 'fan-out' | 'fan-in';
export type WorkflowExecutionMode = 'off-thread' | 'lockstep';

export interface WorkflowPosition {
  x: number;
  y: number;
}

export interface WorkflowCheckpointSettings {
  enabled: boolean;
}

export interface WorkflowTelemetrySettings {
  openTelemetry?: boolean;
  sensitiveData?: boolean;
}

export interface WorkflowStateScope {
  name: string;
  description?: string;
  initialValues?: Record<string, unknown>;
}

export interface WorkflowSettings {
  checkpointing: WorkflowCheckpointSettings;
  executionMode: WorkflowExecutionMode;
  orchestrationMode?: WorkflowOrchestrationMode;
  modeSettings?: OrchestrationModeSettings;
  maxIterations?: number;
  approvalPolicy?: ApprovalPolicy;
  stateScopes?: WorkflowStateScope[];
  telemetry?: WorkflowTelemetrySettings;
}

export interface StartNodeConfig {
  kind: 'start';
  inputType?: string;
}

export interface EndNodeConfig {
  kind: 'end';
  outputType?: string;
}

export interface AgentNodeConfig {
  kind: 'agent';
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  copilot?: PatternAgentCopilotConfig;
  workspaceAgentId?: string;
  overrides?: WorkflowAgentOverrides;
}

export interface InvokeFunctionConfig {
  kind: 'invoke-function';
  functionName: string;
  arguments?: Record<string, unknown>;
  requireApproval?: boolean;
  resultVariable?: string;
}

export interface SubWorkflowConfig {
  kind: 'sub-workflow';
  workflowId?: string;
  inlineWorkflow?: WorkflowDefinition;
}

export interface RequestPortConfig {
  kind: 'request-port';
  portId: string;
  requestType: string;
  responseType: string;
  prompt?: string;
}

export type WorkflowNodeConfig =
  | StartNodeConfig
  | EndNodeConfig
  | AgentNodeConfig
  | InvokeFunctionConfig
  | SubWorkflowConfig
  | RequestPortConfig;

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  position: WorkflowPosition;
  order?: number;
  config: WorkflowNodeConfig;
}

export interface WorkflowConditionRule {
  propertyPath: string;
  operator: 'equals' | 'not-equals' | 'contains' | 'gt' | 'lt' | 'regex';
  value: string;
}

export type EdgeCondition =
  | { type: 'always' }
  | { type: 'message-type'; typeName: string }
  | { type: 'expression'; expression: string }
  | { type: 'property'; combinator?: 'and' | 'or'; rules: WorkflowConditionRule[] };

export interface FanOutConfig {
  strategy: 'broadcast' | 'partition';
  partitionExpression?: string;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  kind: WorkflowEdgeKind;
  condition?: EdgeCondition;
  label?: string;
  fanOutConfig?: FanOutConfig;
  isLoop?: boolean;
  maxIterations?: number;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  isFavorite?: boolean;
  graph: WorkflowGraph;
  settings: WorkflowSettings;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowValidationIssue {
  level: 'error' | 'warning';
  field?: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowReference {
  referencingWorkflowId: string;
  referencingWorkflowName: string;
  nodeId: string;
  nodeLabel: string;
}

export interface WorkflowResolutionOptions {
  resolveWorkflow?: (workflowId: string) => WorkflowDefinition | undefined;
}

export interface WorkflowExecutionDefinition {
  id: string;
  name: string;
  description: string;
  orchestrationMode: WorkflowOrchestrationMode;
  maxIterations: number;
  approvalPolicy?: ApprovalPolicy;
  agents: AgentNodeConfig[];
}

const executableNodeKinds = new Set<WorkflowNodeKind>([
  'start',
  'end',
  'agent',
  'invoke-function',
  'sub-workflow',
  'request-port',
]);

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeWorkflowOrchestrationMode(
  mode?: WorkflowOrchestrationMode,
): WorkflowOrchestrationMode | undefined {
  switch (mode) {
    case 'single':
    case 'sequential':
    case 'concurrent':
    case 'handoff':
    case 'group-chat':
      return mode;
    default:
      return undefined;
  }
}

function normalizeHandoffToolCallFiltering(
  value?: HandoffToolCallFiltering,
): HandoffToolCallFiltering {
  switch (value) {
    case 'none':
    case 'handoff-only':
    case 'all':
      return value;
    default:
      return 'handoff-only';
  }
}

function normalizeGroupChatSelectionStrategy(
  value?: GroupChatSelectionStrategy,
): GroupChatSelectionStrategy {
  return value === 'round-robin' ? 'round-robin' : 'round-robin';
}

export function createDefaultModeSettings(
  mode?: WorkflowOrchestrationMode,
): OrchestrationModeSettings | undefined {
  switch (mode) {
    case 'handoff':
      return {
        handoff: {
          toolCallFiltering: 'handoff-only',
          returnToPrevious: false,
        },
      };
    case 'group-chat':
      return {
        groupChat: {
          selectionStrategy: 'round-robin',
          maxRounds: 5,
        },
      };
    default:
      return undefined;
  }
}

export function isGraphBasedMode(mode?: WorkflowOrchestrationMode): boolean {
  return mode === 'single' || mode === 'sequential' || mode === 'concurrent';
}

export function isBuilderBasedMode(mode?: WorkflowOrchestrationMode): boolean {
  return mode === 'handoff' || mode === 'group-chat';
}

function normalizeModeSettings(
  mode: WorkflowOrchestrationMode | undefined,
  modeSettings: OrchestrationModeSettings | undefined,
  workflowMaxIterations: number | undefined,
): OrchestrationModeSettings | undefined {
  const defaults = createDefaultModeSettings(mode);
  const handoffSource = modeSettings?.handoff ?? defaults?.handoff;
  const groupChatSource = modeSettings?.groupChat ?? defaults?.groupChat;
  const normalized: OrchestrationModeSettings = {};

  if (handoffSource) {
    normalized.handoff = {
      toolCallFiltering: normalizeHandoffToolCallFiltering(handoffSource.toolCallFiltering),
      returnToPrevious: handoffSource.returnToPrevious ?? false,
      handoffInstructions: normalizeOptionalString(handoffSource.handoffInstructions),
      triageAgentNodeId: normalizeOptionalString(handoffSource.triageAgentNodeId),
    };
  }

  if (groupChatSource) {
    const fallbackMaxRounds = workflowMaxIterations && workflowMaxIterations > 0
      ? Math.round(workflowMaxIterations)
      : (defaults?.groupChat?.maxRounds ?? 5);

    normalized.groupChat = {
      selectionStrategy: normalizeGroupChatSelectionStrategy(groupChatSource.selectionStrategy),
      maxRounds:
        typeof groupChatSource.maxRounds === 'number' && groupChatSource.maxRounds > 0
          ? Math.round(groupChatSource.maxRounds)
          : fallbackMaxRounds,
    };
  }

  return normalized.handoff || normalized.groupChat ? normalized : undefined;
}

export function isReasoningEffort(value: string | undefined): value is ReasoningEffort {
  return reasoningEffortOptions.some((option) => option.value === value);
}

function normalizePosition(position?: Partial<WorkflowPosition>): WorkflowPosition {
  return {
    x: typeof position?.x === 'number' && Number.isFinite(position.x) ? position.x : 0,
    y: typeof position?.y === 'number' && Number.isFinite(position.y) ? position.y : 0,
  };
}

function normalizeNodeConfig(kind: WorkflowNodeKind, config?: Partial<WorkflowNodeConfig>): WorkflowNodeConfig {
  switch (kind) {
    case 'start':
      return {
        kind,
        inputType: normalizeOptionalString((config as Partial<StartNodeConfig> | undefined)?.inputType),
      };
    case 'end':
      return {
        kind,
        outputType: normalizeOptionalString((config as Partial<EndNodeConfig> | undefined)?.outputType),
      };
    case 'agent': {
      const agent = config as Partial<AgentNodeConfig> | undefined;
      return {
        kind,
        id: normalizeOptionalString(agent?.id) ?? '',
        name: normalizeOptionalString(agent?.name) ?? '',
        description: agent?.description?.trim() ?? '',
        instructions: agent?.instructions?.trim() ?? '',
        model: normalizeOptionalString(agent?.model) ?? '',
        reasoningEffort: agent?.reasoningEffort,
        copilot: agent?.copilot,
        workspaceAgentId: normalizeOptionalString(agent?.workspaceAgentId),
        overrides: agent?.overrides,
      };
    }
    case 'invoke-function': {
      const value = config as Partial<InvokeFunctionConfig> | undefined;
      return {
        kind,
        functionName: normalizeOptionalString(value?.functionName) ?? '',
        arguments: value?.arguments,
        requireApproval: value?.requireApproval,
        resultVariable: normalizeOptionalString(value?.resultVariable),
      };
    }
    case 'sub-workflow': {
      const value = config as Partial<SubWorkflowConfig> | undefined;
      return {
        kind,
        workflowId: normalizeOptionalString(value?.workflowId),
        inlineWorkflow: value?.inlineWorkflow ? normalizeWorkflowDefinition(value.inlineWorkflow) : undefined,
      };
    }
    case 'request-port': {
      const value = config as Partial<RequestPortConfig> | undefined;
      return {
        kind,
        portId: normalizeOptionalString(value?.portId) ?? '',
        requestType: normalizeOptionalString(value?.requestType) ?? '',
        responseType: normalizeOptionalString(value?.responseType) ?? '',
        prompt: value?.prompt?.trim(),
      };
    }
  }
}

function normalizeConditionRule(rule: WorkflowConditionRule): WorkflowConditionRule {
  return {
    propertyPath: rule.propertyPath.trim(),
    operator: rule.operator,
    value: rule.value.trim(),
  };
}

function normalizeEdgeCondition(condition?: EdgeCondition): EdgeCondition | undefined {
  if (!condition) {
    return undefined;
  }

  switch (condition.type) {
    case 'always':
      return { type: 'always' };
    case 'message-type':
      return {
        type: 'message-type',
        typeName: condition.typeName.trim(),
      };
    case 'expression':
      return {
        type: 'expression',
        expression: condition.expression.trim(),
      };
    case 'property':
      return {
        type: 'property',
        combinator: condition.combinator === 'or' ? 'or' : 'and',
        rules: condition.rules.map(normalizeConditionRule),
      };
  }
}

export function normalizeWorkflowDefinition(workflow: WorkflowDefinition): WorkflowDefinition {
  const normalizedOrchestrationMode = normalizeWorkflowOrchestrationMode(workflow.settings?.orchestrationMode);
  const normalizedMaxIterations =
    typeof workflow.settings?.maxIterations === 'number' && workflow.settings.maxIterations > 0
      ? Math.round(workflow.settings.maxIterations)
      : undefined;

  const normalized: WorkflowDefinition = {
    ...workflow,
    name: workflow.name.trim(),
    description: workflow.description.trim(),
    graph: {
      nodes: (workflow.graph?.nodes ?? []).map((node) => ({
        ...node,
        id: node.id.trim(),
        kind: node.kind,
        label: node.label.trim(),
        position: normalizePosition(node.position),
        config: normalizeNodeConfig(node.kind, node.config),
      })),
      edges: (workflow.graph?.edges ?? []).map((edge) => ({
        ...edge,
        id: edge.id.trim(),
        source: edge.source.trim(),
        target: edge.target.trim(),
        kind: edge.kind,
        condition: normalizeEdgeCondition(edge.condition),
        label: normalizeOptionalString(edge.label),
        isLoop: edge.isLoop === true ? true : undefined,
        maxIterations:
          typeof edge.maxIterations === 'number' && edge.maxIterations > 0
            ? Math.round(edge.maxIterations)
            : undefined,
      })),
    },
    settings: {
      checkpointing: {
        enabled: workflow.settings?.checkpointing?.enabled ?? false,
      },
      executionMode: workflow.settings?.executionMode === 'lockstep' ? 'lockstep' : 'off-thread',
      orchestrationMode: normalizedOrchestrationMode,
      modeSettings: normalizeModeSettings(
        normalizedOrchestrationMode,
        workflow.settings?.modeSettings,
        normalizedMaxIterations,
      ),
      maxIterations: normalizedMaxIterations,
      approvalPolicy: workflow.settings?.approvalPolicy,
      stateScopes: workflow.settings?.stateScopes?.map((scope) => ({
        name: scope.name.trim(),
        description: normalizeOptionalString(scope.description),
        initialValues: scope.initialValues,
      })),
      telemetry: workflow.settings?.telemetry
        ? {
          openTelemetry: workflow.settings.telemetry.openTelemetry ?? false,
          sensitiveData: workflow.settings.telemetry.sensitiveData ?? false,
        }
        : undefined,
    },
  };

  return syncBuilderModeEdgeIterations(normalized);
}

export function resolveWorkflowAgentNodes(workflow: WorkflowDefinition): WorkflowNode[] {
  return workflow.graph.nodes
    .filter((node) => node.kind === 'agent')
    .slice()
    .sort((left, right) => {
      const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.label.localeCompare(right.label);
    });
}

export function resolveWorkflowAgents(workflow: WorkflowDefinition): AgentNodeConfig[] {
  return resolveWorkflowAgentNodes(workflow).flatMap((node) => {
    if (node.config.kind !== 'agent') {
      return [];
    }

    return [{
      kind: 'agent',
      id: node.config.id || node.id,
      name: node.config.name,
      description: node.config.description,
      instructions: node.config.instructions,
      model: node.config.model,
      reasoningEffort: node.config.reasoningEffort,
      copilot: node.config.copilot,
      workspaceAgentId: node.config.workspaceAgentId,
      overrides: node.config.overrides,
    }];
  });
}

export interface SubWorkflowGroupDescriptor {
  nodeId: string;
  nodeLabel: string;
  workflowId?: string;
  workflowName: string;
  orchestrationMode: WorkflowOrchestrationMode;
  agents: AgentNodeConfig[];
}

export interface WorkflowAgentHierarchy {
  topLevelAgents: AgentNodeConfig[];
  subWorkflows: SubWorkflowGroupDescriptor[];
}

export function resolveWorkflowAgentHierarchy(
  workflow: WorkflowDefinition,
  options?: WorkflowResolutionOptions,
): WorkflowAgentHierarchy {
  const topLevelAgents = resolveWorkflowAgents(workflow);
  const subWorkflows: SubWorkflowGroupDescriptor[] = [];

  const subWorkflowNodes = workflow.graph.nodes
    .filter((node): node is WorkflowNode & { config: SubWorkflowConfig } => node.kind === 'sub-workflow')
    .slice()
    .sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.label.localeCompare(b.label);
    });

  for (const node of subWorkflowNodes) {
    const subWorkflowDef = resolveSubWorkflowDefinition(node, options);
    if (!subWorkflowDef) continue;

    const agents = resolveWorkflowAgents(subWorkflowDef);
    const mode = inferWorkflowOrchestrationMode(subWorkflowDef, options);

    subWorkflows.push({
      nodeId: node.id,
      nodeLabel: node.label,
      workflowId: node.config.workflowId,
      workflowName: subWorkflowDef.name || node.label,
      orchestrationMode: mode,
      agents,
    });
  }

  return { topLevelAgents, subWorkflows };
}

function resolveSubWorkflowDefinition(
  node: WorkflowNode & { config: SubWorkflowConfig },
  options?: WorkflowResolutionOptions,
): WorkflowDefinition | undefined {
  if (node.config.inlineWorkflow) return node.config.inlineWorkflow;
  if (node.config.workflowId && options?.resolveWorkflow) {
    return options.resolveWorkflow(node.config.workflowId);
  }
  return undefined;
}

function hasWorkflowExecutionFanEdges(
  workflow: WorkflowDefinition,
  options?: WorkflowResolutionOptions,
  visitedReferencedWorkflowIds = new Set<string>([workflow.id]),
  visitedInlineWorkflows = new Set<WorkflowDefinition>(),
): boolean {
  if (workflow.graph.edges.some((edge) => edge.kind !== 'direct')) {
    return true;
  }

  for (const node of workflow.graph.nodes) {
    if (node.kind !== 'sub-workflow' || node.config.kind !== 'sub-workflow') {
      continue;
    }

    const { inlineWorkflow, workflowId } = node.config;
    if (inlineWorkflow) {
      if (!visitedInlineWorkflows.has(inlineWorkflow)) {
        visitedInlineWorkflows.add(inlineWorkflow);
        if (hasWorkflowExecutionFanEdges(inlineWorkflow, options, visitedReferencedWorkflowIds, visitedInlineWorkflows)) {
          return true;
        }
      }
    }

    if (workflowId && options?.resolveWorkflow && !visitedReferencedWorkflowIds.has(workflowId)) {
      const referencedWorkflow = options.resolveWorkflow(workflowId);
      if (referencedWorkflow) {
        visitedReferencedWorkflowIds.add(workflowId);
        if (hasWorkflowExecutionFanEdges(referencedWorkflow, options, visitedReferencedWorkflowIds, visitedInlineWorkflows)) {
          return true;
        }
      }
    }
  }

  return false;
}

function resolveWorkflowExecutionAgents(
  workflow: WorkflowDefinition,
  options?: WorkflowResolutionOptions,
  visitedReferencedWorkflowIds = new Set<string>([workflow.id]),
  visitedInlineWorkflows = new Set<WorkflowDefinition>(),
): AgentNodeConfig[] {
  const agents = [...resolveWorkflowAgents(workflow)];

  for (const node of workflow.graph.nodes) {
    if (node.kind !== 'sub-workflow' || node.config.kind !== 'sub-workflow') {
      continue;
    }

    const { inlineWorkflow, workflowId } = node.config;
    if (inlineWorkflow) {
      if (!visitedInlineWorkflows.has(inlineWorkflow)) {
        visitedInlineWorkflows.add(inlineWorkflow);
        agents.push(...resolveWorkflowExecutionAgents(
          inlineWorkflow,
          options,
          visitedReferencedWorkflowIds,
          visitedInlineWorkflows,
        ));
      }
    }

    if (workflowId && options?.resolveWorkflow && !visitedReferencedWorkflowIds.has(workflowId)) {
      const referencedWorkflow = options.resolveWorkflow(workflowId);
      if (referencedWorkflow) {
        visitedReferencedWorkflowIds.add(workflowId);
        agents.push(...resolveWorkflowExecutionAgents(
          referencedWorkflow,
          options,
          visitedReferencedWorkflowIds,
          visitedInlineWorkflows,
        ));
      }
    }
  }

  return agents;
}

export function inferWorkflowOrchestrationMode(
  workflow: WorkflowDefinition,
  options?: WorkflowResolutionOptions,
): WorkflowOrchestrationMode {
  const configuredMode = normalizeWorkflowOrchestrationMode(workflow.settings?.orchestrationMode);
  if (configuredMode) {
    return configuredMode;
  }

  const hasFanEdges = hasWorkflowExecutionFanEdges(workflow, options);
  const agentCount = resolveWorkflowExecutionAgents(workflow, options).length;
  if (hasFanEdges) {
    return 'concurrent';
  }

  return agentCount <= 1 ? 'single' : 'sequential';
}

export function buildWorkflowExecutionDefinition(
  workflow: WorkflowDefinition,
  options?: WorkflowResolutionOptions,
): WorkflowExecutionDefinition {
  const agents = resolveWorkflowExecutionAgents(workflow, options);

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    orchestrationMode: inferWorkflowOrchestrationMode(workflow, options),
    maxIterations: workflow.settings.maxIterations ?? 5,
    approvalPolicy: workflow.settings.approvalPolicy,
    agents,
  };
}

const builtinWorkflowModels = {
  claude: 'claude-opus-4.5',
  gpt54: 'gpt-5.4',
  gpt53: 'gpt-5.3-codex',
} as const;

function createStartNode(x: number, y: number): WorkflowNode {
  return { id: 'start', kind: 'start', label: 'Start', position: { x, y }, config: { kind: 'start' } };
}

function createEndNode(x: number, y: number): WorkflowNode {
  return { id: 'end', kind: 'end', label: 'End', position: { x, y }, config: { kind: 'end' } };
}

function createAgentNode(
  id: string,
  label: string,
  description: string,
  instructions: string,
  model: string,
  reasoningEffort: ReasoningEffort | undefined,
  x: number,
  y: number,
  order: number,
): WorkflowNode {
  return {
    id,
    kind: 'agent',
    label,
    position: { x, y },
    order,
    config: {
      kind: 'agent',
      id,
      name: label,
      description,
      instructions,
      model,
      reasoningEffort,
    },
  };
}

function createScaffoldAgentLabel(mode: WorkflowOrchestrationMode, index: number): string {
  if (mode === 'handoff') {
    return index === 0 ? 'Triage Agent' : `Specialist ${index}`;
  }

  if (mode === 'group-chat') {
    return index === 0 ? 'Writer' : index === 1 ? 'Reviewer' : `Participant ${index + 1}`;
  }

  return `Agent ${index + 1}`;
}

function createScaffoldAgentDescription(mode: WorkflowOrchestrationMode, index: number): string {
  if (mode === 'handoff') {
    return index === 0
      ? 'Routes work to the right specialist.'
      : `Handles specialist lane ${index}.`;
  }

  if (mode === 'group-chat') {
    return index === 0
      ? 'Produces the initial draft.'
      : index === 1
        ? 'Reviews and refines the draft.'
        : `Contributes perspective ${index + 1}.`;
  }

  return `Handles step ${index + 1} in the workflow.`;
}

function createScaffoldAgentInstructions(mode: WorkflowOrchestrationMode, index: number): string {
  if (mode === 'handoff') {
    return index === 0
      ? 'Triages each request and hands off to the best specialist when needed.'
      : `Own the specialist response for lane ${index}.`;
  }

  if (mode === 'group-chat') {
    return index === 0
      ? 'Draft the first answer, then refine it based on peer feedback.'
      : index === 1
        ? 'Review the current draft and suggest concrete improvements.'
        : `Build on the current draft with contribution ${index + 1}.`;
  }

  return `Complete step ${index + 1} of the workflow.`;
}

function createPlaceholderAgentNode(mode: WorkflowOrchestrationMode, index: number): WorkflowNode {
  const id = mode === 'handoff'
    ? index === 0 ? 'agent-handoff-triage' : `agent-handoff-specialist-${index}`
    : mode === 'group-chat'
      ? index === 0 ? 'agent-group-writer' : index === 1 ? 'agent-group-reviewer' : `agent-group-participant-${index + 1}`
      : `agent-${index + 1}`;

  return createAgentNode(
    id,
    createScaffoldAgentLabel(mode, index),
    createScaffoldAgentDescription(mode, index),
    createScaffoldAgentInstructions(mode, index),
    builtinWorkflowModels.gpt54,
    'medium',
    0,
    0,
    index,
  );
}

function cloneAgentNode(node: WorkflowNode, index: number, position: WorkflowPosition): WorkflowNode {
  const label = node.label.trim() || (node.config.kind === 'agent' ? node.config.name : node.id);
  return {
    ...node,
    id: node.id.trim(),
    kind: 'agent',
    label,
    order: index,
    position,
    config: node.config.kind === 'agent'
      ? {
        ...node.config,
        id: normalizeOptionalString(node.config.id) ?? node.id.trim(),
        name: normalizeOptionalString(node.config.name) ?? label,
      }
      : createPlaceholderAgentNode('single', index).config,
  };
}

function getMinimumAgentCountForMode(mode: WorkflowOrchestrationMode): number {
  switch (mode) {
    case 'single':
      return 1;
    case 'sequential':
      return 2;
    case 'concurrent':
    case 'handoff':
    case 'group-chat':
      return 2;
  }
}

function prepareScaffoldAgentNodes(
  mode: WorkflowOrchestrationMode,
  agentNodes?: WorkflowNode[],
): WorkflowNode[] {
  const existingAgentNodes = (agentNodes ?? [])
    .filter((node) => node.kind === 'agent' && node.config.kind === 'agent')
    .map((node) => normalizeWorkflowDefinition({
      id: 'scaffold-normalizer',
      name: 'scaffold-normalizer',
      description: '',
      createdAt: '',
      updatedAt: '',
      graph: { nodes: [node], edges: [] },
      settings: {
        checkpointing: { enabled: false },
        executionMode: 'off-thread',
      },
    }).graph.nodes[0]!)
    .filter((node): node is WorkflowNode => Boolean(node));

  const desiredCount = Math.max(existingAgentNodes.length, getMinimumAgentCountForMode(mode));
  const agents = existingAgentNodes.slice(0, desiredCount);

  while (agents.length < desiredCount) {
    agents.push(createPlaceholderAgentNode(mode, agents.length));
  }

  return agents;
}

export interface ScaffoldGraphOptions {
  agentNodes?: WorkflowNode[];
  settings?: WorkflowSettings;
}

const defaultHandoffLoopIterations = 4;
const defaultGroupChatLoopIterations = 5;

export function scaffoldGraphForMode(
  mode: WorkflowOrchestrationMode,
  agentNodesOrOptions?: WorkflowNode[] | ScaffoldGraphOptions,
): WorkflowGraph {
  const options: ScaffoldGraphOptions = Array.isArray(agentNodesOrOptions)
    ? { agentNodes: agentNodesOrOptions }
    : (agentNodesOrOptions ?? {});

  const preparedAgents = prepareScaffoldAgentNodes(mode, options.agentNodes);

  if (mode === 'single') {
    const agent = cloneAgentNode(preparedAgents[0]!, 0, { x: 220, y: 0 });
    return {
      nodes: [createStartNode(0, 0), agent, createEndNode(440, 0)],
      edges: [
        createWorkflowEdge('edge-start-to-agent', 'start', agent.id),
        createWorkflowEdge(`edge-${agent.id}-to-end`, agent.id, 'end'),
      ],
    };
  }

  if (mode === 'sequential') {
    const agents = preparedAgents.map((node, index) => cloneAgentNode(node, index, { x: 220 + (index * 220), y: 0 }));
    const edges = [
      createWorkflowEdge(`edge-start-to-${agents[0]!.id}`, 'start', agents[0]!.id),
      ...agents.slice(1).map((agent, index) =>
        createWorkflowEdge(`edge-${agents[index]!.id}-to-${agent.id}`, agents[index]!.id, agent.id)),
      createWorkflowEdge(`edge-${agents[agents.length - 1]!.id}-to-end`, agents[agents.length - 1]!.id, 'end'),
    ];

    return {
      nodes: [createStartNode(0, 0), ...agents, createEndNode(220 + (agents.length * 220), 0)],
      edges,
    };
  }

  if (mode === 'concurrent') {
    const centerY = ((preparedAgents.length - 1) * 120) / 2;
    const agents = preparedAgents.map((node, index) =>
      cloneAgentNode(node, index, { x: 260, y: (index * 120) - centerY }));

    return {
      nodes: [createStartNode(0, 0), ...agents, createEndNode(520, 0)],
      edges: [
        ...agents.map((agent) =>
          createWorkflowEdge(`edge-start-to-${agent.id}`, 'start', agent.id, 'fan-out', {
            fanOutConfig: { strategy: 'broadcast' },
          })),
        ...agents.map((agent) => createWorkflowEdge(`edge-${agent.id}-to-end`, agent.id, 'end', 'fan-in')),
      ],
    };
  }

  if (mode === 'handoff') {
    const loopIterations = options.settings?.maxIterations ?? defaultHandoffLoopIterations;
    const triage = cloneAgentNode(preparedAgents[0]!, 0, { x: 240, y: 120 });
    const specialists = preparedAgents.slice(1).map((node, index) =>
      cloneAgentNode(node, index + 1, { x: 520, y: index * 240 }));

    return {
      nodes: [createStartNode(0, 120), triage, ...specialists, createEndNode(800, 120)],
      edges: [
        createWorkflowEdge(`edge-start-to-${triage.id}`, 'start', triage.id),
        createWorkflowEdge(`edge-${triage.id}-to-end`, triage.id, 'end'),
        ...specialists.map((specialist) => createWorkflowEdge(`edge-${triage.id}-to-${specialist.id}`, triage.id, specialist.id, 'direct', {
          isLoop: true,
          maxIterations: loopIterations,
          condition: { type: 'always' },
        })),
        ...specialists.map((specialist) => createWorkflowEdge(`edge-${specialist.id}-to-${triage.id}`, specialist.id, triage.id, 'direct', {
          isLoop: true,
          maxIterations: loopIterations,
          condition: { type: 'always' },
        })),
        ...specialists.map((specialist) => createWorkflowEdge(`edge-${specialist.id}-to-end`, specialist.id, 'end')),
      ],
    };
  }

  const loopIterations = options.settings?.modeSettings?.groupChat?.maxRounds
    ?? options.settings?.maxIterations
    ?? defaultGroupChatLoopIterations;
  const agents = preparedAgents.map((node, index) => cloneAgentNode(node, index, { x: 240 + (index * 240), y: 0 }));
  return {
    nodes: [createStartNode(0, 0), ...agents, createEndNode(240 + (agents.length * 240), 0)],
    edges: [
      createWorkflowEdge(`edge-start-to-${agents[0]!.id}`, 'start', agents[0]!.id),
      ...agents.slice(1).map((agent, index) => createWorkflowEdge(
        `edge-${agents[index]!.id}-to-${agent.id}`,
        agents[index]!.id,
        agent.id,
        'direct',
        {
          isLoop: true,
          maxIterations: loopIterations,
          condition: { type: 'always' },
        },
      )),
      createWorkflowEdge(
        `edge-${agents[agents.length - 1]!.id}-to-${agents[0]!.id}`,
        agents[agents.length - 1]!.id,
        agents[0]!.id,
        'direct',
        {
          isLoop: true,
          maxIterations: loopIterations,
          condition: { type: 'always' },
          label: 'Loop',
        },
      ),
      createWorkflowEdge(`edge-${agents[agents.length - 1]!.id}-to-end`, agents[agents.length - 1]!.id, 'end'),
    ],
  };
}

/**
 * For builder-based modes (handoff, group-chat), synchronize loop edge maxIterations
 * with the authoritative mode settings. The backend ignores edge maxIterations for these
 * modes, so the edges are visual only and should reflect the actual runtime limit.
 */
export function syncBuilderModeEdgeIterations(workflow: WorkflowDefinition): WorkflowDefinition {
  const mode = workflow.settings.orchestrationMode;
  if (!isBuilderBasedMode(mode)) {
    return workflow;
  }

  const loopIterations = mode === 'group-chat'
    ? (workflow.settings.modeSettings?.groupChat?.maxRounds ?? workflow.settings.maxIterations ?? defaultGroupChatLoopIterations)
    : (workflow.settings.maxIterations ?? defaultHandoffLoopIterations);

  const hasStaleEdge = workflow.graph.edges.some(
    (edge) => edge.isLoop && edge.maxIterations !== loopIterations,
  );
  if (!hasStaleEdge) {
    return workflow;
  }

  return {
    ...workflow,
    graph: {
      ...workflow.graph,
      edges: workflow.graph.edges.map((edge) =>
        edge.isLoop ? { ...edge, maxIterations: loopIterations } : edge,
      ),
    },
  };
}

function createWorkflowEdge(
  id: string,
  source: string,
  target: string,
  kind: WorkflowEdgeKind = 'direct',
  overrides?: Partial<Omit<WorkflowEdge, 'id' | 'source' | 'target' | 'kind'>>,
): WorkflowEdge {
  return {
    id,
    source,
    target,
    kind,
    ...overrides,
  };
}

function createBuiltinWorkflow(
  workflow: Omit<WorkflowDefinition, 'createdAt' | 'updatedAt'>,
  timestamp: string,
): WorkflowDefinition {
  return normalizeWorkflowDefinition({
    ...workflow,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function createBuiltinWorkflows(timestamp: string): WorkflowDefinition[] {
  return [
    createBuiltinWorkflow({
      id: 'workflow-single-chat',
      name: '1-on-1 Copilot Chat',
      description: 'Direct human-agent conversation for a selected project.',
      graph: {
        nodes: [
          createStartNode(0, 0),
          createAgentNode(
            'agent-single-primary',
            'Primary Agent',
            'General-purpose project assistant.',
            'You are a helpful coding assistant working inside the selected project.',
            builtinWorkflowModels.gpt54,
            'high',
            220,
            0,
            0,
          ),
          createEndNode(440, 0),
        ],
        edges: [
          createWorkflowEdge('edge-start-to-agent-single-primary', 'start', 'agent-single-primary'),
          createWorkflowEdge('edge-agent-single-primary-to-end', 'agent-single-primary', 'end'),
        ],
      },
      settings: {
        checkpointing: { enabled: false },
        executionMode: 'off-thread',
        orchestrationMode: 'single',
        maxIterations: 1,
      },
    }, timestamp),
    createBuiltinWorkflow({
      id: 'workflow-sequential-review',
      name: 'Sequential Trio Review',
      description: 'Agents execute in order, each seeing the full conversation and appending to a shared transcript.',
      graph: {
        nodes: [
          createStartNode(0, 0),
          createAgentNode(
            'agent-sequential-analyst',
            'Analyst',
            'Breaks the task down and captures risks.',
            'Analyze the request, identify constraints, and produce a short working plan.',
            builtinWorkflowModels.gpt54,
            'high',
            220,
            0,
            0,
          ),
          createAgentNode(
            'agent-sequential-builder',
            'Builder',
            'Translates the plan into a practical implementation.',
            'Use the prior context to propose a concrete implementation.',
            builtinWorkflowModels.gpt53,
            'medium',
            440,
            0,
            1,
          ),
          createAgentNode(
            'agent-sequential-reviewer',
            'Reviewer',
            'Checks the proposal for gaps and edge cases.',
            'Review the previous answer, tighten it, and call out any missing edge cases.',
            builtinWorkflowModels.claude,
            'medium',
            660,
            0,
            2,
          ),
          createEndNode(880, 0),
        ],
        edges: [
          createWorkflowEdge('edge-start-to-agent-sequential-analyst', 'start', 'agent-sequential-analyst'),
          createWorkflowEdge('edge-agent-sequential-analyst-to-agent-sequential-builder', 'agent-sequential-analyst', 'agent-sequential-builder'),
          createWorkflowEdge('edge-agent-sequential-builder-to-agent-sequential-reviewer', 'agent-sequential-builder', 'agent-sequential-reviewer'),
          createWorkflowEdge('edge-agent-sequential-reviewer-to-end', 'agent-sequential-reviewer', 'end'),
        ],
      },
      settings: {
        checkpointing: { enabled: false },
        executionMode: 'off-thread',
        orchestrationMode: 'sequential',
        maxIterations: 1,
      },
    }, timestamp),
    createBuiltinWorkflow({
      id: 'workflow-concurrent-brainstorm',
      name: 'Concurrent Brainstorm',
      description: 'Agents work independently in parallel and the final conversation aggregates every response.',
      graph: {
        nodes: [
          createStartNode(0, 120),
          createAgentNode(
            'agent-concurrent-architect',
            'Architect',
            'Focuses on architecture and boundaries.',
            'Answer from an architecture-first perspective.',
            builtinWorkflowModels.gpt54,
            'high',
            260,
            0,
            0,
          ),
          createAgentNode(
            'agent-concurrent-product',
            'Product',
            'Focuses on UX and scope.',
            'Answer from a product and UX perspective.',
            builtinWorkflowModels.claude,
            'medium',
            260,
            120,
            1,
          ),
          createAgentNode(
            'agent-concurrent-implementer',
            'Implementer',
            'Focuses on practical delivery.',
            'Answer from an implementation and testing perspective.',
            builtinWorkflowModels.gpt53,
            'medium',
            260,
            240,
            2,
          ),
          createEndNode(520, 120),
        ],
        edges: [
          createWorkflowEdge('edge-start-to-agent-concurrent-architect', 'start', 'agent-concurrent-architect', 'fan-out', { fanOutConfig: { strategy: 'broadcast' } }),
          createWorkflowEdge('edge-start-to-agent-concurrent-product', 'start', 'agent-concurrent-product', 'fan-out', { fanOutConfig: { strategy: 'broadcast' } }),
          createWorkflowEdge('edge-start-to-agent-concurrent-implementer', 'start', 'agent-concurrent-implementer', 'fan-out', { fanOutConfig: { strategy: 'broadcast' } }),
          createWorkflowEdge('edge-agent-concurrent-architect-to-end', 'agent-concurrent-architect', 'end', 'fan-in'),
          createWorkflowEdge('edge-agent-concurrent-product-to-end', 'agent-concurrent-product', 'end', 'fan-in'),
          createWorkflowEdge('edge-agent-concurrent-implementer-to-end', 'agent-concurrent-implementer', 'end', 'fan-in'),
        ],
      },
      settings: {
        checkpointing: { enabled: false },
        executionMode: 'off-thread',
        orchestrationMode: 'concurrent',
        maxIterations: 1,
      },
    }, timestamp),
    createBuiltinWorkflow({
      id: 'workflow-handoff-support',
      name: 'Handoff Support Flow',
      description: 'A triage agent routes work to specialists, and the next user turn continues when more input is needed.',
      graph: {
        nodes: [
          createStartNode(0, 120),
          createAgentNode(
            'agent-handoff-triage',
            'Triage',
            'Routes the request to the right specialist.',
            'You triage requests and must hand them off to the most appropriate specialist. For any substantive task, hand off before inspecting files, calling tools, or drafting the implementation yourself. Do not claim that you delegated unless you actually executed the handoff.',
            builtinWorkflowModels.gpt54,
            'medium',
            240,
            120,
            0,
          ),
          createAgentNode(
            'agent-handoff-ux',
            'UX Specialist',
            'Handles user experience questions.',
            'You focus on navigation, UX, and interaction details. Once triage hands work to you, you own the substantive answer.',
            builtinWorkflowModels.claude,
            'medium',
            520,
            0,
            1,
          ),
          createAgentNode(
            'agent-handoff-runtime',
            'Runtime Specialist',
            'Handles backend and execution details.',
            'You focus on runtime, orchestration, and backend integration details. Once triage hands work to you, you own the substantive answer.',
            builtinWorkflowModels.gpt53,
            'medium',
            520,
            240,
            2,
          ),
          createEndNode(800, 120),
        ],
        edges: [
          createWorkflowEdge('edge-start-to-agent-handoff-triage', 'start', 'agent-handoff-triage'),
          createWorkflowEdge('edge-agent-handoff-triage-to-end', 'agent-handoff-triage', 'end'),
          createWorkflowEdge('edge-agent-handoff-triage-to-agent-handoff-ux', 'agent-handoff-triage', 'agent-handoff-ux', 'direct', {
            isLoop: true,
            maxIterations: 4,
            condition: { type: 'always' },
          }),
          createWorkflowEdge('edge-agent-handoff-triage-to-agent-handoff-runtime', 'agent-handoff-triage', 'agent-handoff-runtime', 'direct', {
            isLoop: true,
            maxIterations: 4,
            condition: { type: 'always' },
          }),
          createWorkflowEdge('edge-agent-handoff-ux-to-agent-handoff-triage', 'agent-handoff-ux', 'agent-handoff-triage', 'direct', {
            isLoop: true,
            maxIterations: 4,
            condition: { type: 'always' },
          }),
          createWorkflowEdge('edge-agent-handoff-runtime-to-agent-handoff-triage', 'agent-handoff-runtime', 'agent-handoff-triage', 'direct', {
            isLoop: true,
            maxIterations: 4,
            condition: { type: 'always' },
          }),
          createWorkflowEdge('edge-agent-handoff-ux-to-end', 'agent-handoff-ux', 'end'),
          createWorkflowEdge('edge-agent-handoff-runtime-to-end', 'agent-handoff-runtime', 'end'),
        ],
      },
      settings: {
        checkpointing: { enabled: true },
        executionMode: 'off-thread',
        orchestrationMode: 'handoff',
        modeSettings: createDefaultModeSettings('handoff'),
        maxIterations: 4,
      },
    }, timestamp),
    createBuiltinWorkflow({
      id: 'workflow-group-chat',
      name: 'Collaborative Group Chat',
      description: 'Agents take turns under a round-robin manager, iteratively refining a shared conversation.',
      graph: {
        nodes: [
          createStartNode(0, 0),
          createAgentNode(
            'agent-group-writer',
            'Writer',
            'Produces candidate answers.',
            'You draft a concise, useful answer for the task. On later turns, refine your earlier draft based on peer feedback rather than restarting.',
            builtinWorkflowModels.gpt54,
            'medium',
            240,
            0,
            0,
          ),
          createAgentNode(
            'agent-group-reviewer',
            'Reviewer',
            'Critiques and refines the answer.',
            'You review the latest draft and offer specific improvements. Focus on critique and refinement instead of restarting the conversation.',
            builtinWorkflowModels.claude,
            'medium',
            480,
            0,
            1,
          ),
          createEndNode(720, 0),
        ],
        edges: [
          createWorkflowEdge('edge-start-to-agent-group-writer', 'start', 'agent-group-writer'),
          createWorkflowEdge('edge-agent-group-writer-to-agent-group-reviewer', 'agent-group-writer', 'agent-group-reviewer', 'direct', {
            isLoop: true,
            maxIterations: 5,
            condition: { type: 'always' },
          }),
          createWorkflowEdge('edge-agent-group-reviewer-to-agent-group-writer', 'agent-group-reviewer', 'agent-group-writer', 'direct', {
            isLoop: true,
            maxIterations: 5,
            condition: { type: 'always' },
            label: 'Loop',
          }),
          createWorkflowEdge('edge-agent-group-reviewer-to-end', 'agent-group-reviewer', 'end'),
        ],
      },
      settings: {
        checkpointing: { enabled: false },
        executionMode: 'off-thread',
        orchestrationMode: 'group-chat',
        modeSettings: createDefaultModeSettings('group-chat'),
        maxIterations: 5,
      },
    }, timestamp),
  ];
}

function addIssue(
  issues: WorkflowValidationIssue[],
  issue: WorkflowValidationIssue,
): void {
  issues.push(issue);
}

function hasPathToEnd(startNodeId: string, graph: WorkflowGraph, endNodeIds: Set<string>): boolean {
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    const current = outgoing.get(edge.source);
    if (current) {
      current.push(edge);
    } else {
      outgoing.set(edge.source, [edge]);
    }
  }

  const queue = [startNodeId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    if (endNodeIds.has(nodeId)) {
      return true;
    }
    for (const edge of outgoing.get(nodeId) ?? []) {
      queue.push(edge.target);
    }
  }

  return false;
}

function buildOutgoingEdges(graph: WorkflowGraph, excludedEdgeId?: string): Map<string, WorkflowEdge[]> {
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    if (edge.id === excludedEdgeId) {
      continue;
    }

    const current = outgoing.get(edge.source);
    if (current) {
      current.push(edge);
    } else {
      outgoing.set(edge.source, [edge]);
    }
  }

  return outgoing;
}

function canReachNode(graph: WorkflowGraph, startNodeId: string, targetNodeId: string, excludedEdgeId?: string): boolean {
  if (startNodeId === targetNodeId) {
    return true;
  }

  const outgoing = buildOutgoingEdges(graph, excludedEdgeId);
  const queue = [startNodeId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);

    for (const edge of outgoing.get(nodeId) ?? []) {
      if (edge.target === targetNodeId) {
        return true;
      }

      queue.push(edge.target);
    }
  }

  return false;
}

function collectStronglyConnectedNodes(graph: WorkflowGraph, nodeId: string): Set<string> {
  const connected = new Set<string>();
  for (const candidate of graph.nodes) {
    if (canReachNode(graph, nodeId, candidate.id) && canReachNode(graph, candidate.id, nodeId)) {
      connected.add(candidate.id);
    }
  }

  return connected;
}

function isLoopEdge(graph: WorkflowGraph, edge: WorkflowEdge): boolean {
  return canReachNode(graph, edge.target, edge.source, edge.id);
}

function isSupportedExpressionCondition(expression: string): boolean {
  const trimmed = expression.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed === 'true' || trimmed === 'false') {
    return true;
  }

  const comparisonPattern =
    /^[A-Za-z_][A-Za-z0-9_.]*\s*(==|!=|>|<|contains|matches)\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false)$/;
  const logicalOperator = trimmed.includes('&&') ? '&&' : trimmed.includes('||') ? '||' : undefined;
  if (!logicalOperator) {
    return comparisonPattern.test(trimmed);
  }

  return trimmed
    .split(logicalOperator)
    .map((segment) => segment.trim())
    .every((segment) => comparisonPattern.test(segment));
}

function validateEdgeCondition(edge: WorkflowEdge, issues: WorkflowValidationIssue[]): void {
  const condition = edge.condition;
  if (!condition) {
    return;
  }

  switch (condition.type) {
    case 'always':
      return;
    case 'message-type':
      if (!condition.typeName.trim()) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.edges.condition.typeName',
          edgeId: edge.id,
          message: 'Message-type conditions require a type name.',
        });
      }
      return;
    case 'expression':
      if (!condition.expression.trim()) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.edges.condition.expression',
          edgeId: edge.id,
          message: 'Expression conditions require a non-empty expression.',
        });
        return;
      }

      if (!isSupportedExpressionCondition(condition.expression)) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.edges.condition.expression',
          edgeId: edge.id,
          message:
            'Expression conditions currently support simple comparisons using ==, !=, >, <, contains, matches, optionally combined with && or ||.',
        });
      }
      return;
    case 'property': {
      if (condition.rules.length === 0) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.edges.condition.rules',
          edgeId: edge.id,
          message: 'Property conditions require at least one rule.',
        });
      }

      if (condition.combinator && condition.combinator !== 'and' && condition.combinator !== 'or') {
        addIssue(issues, {
          level: 'error',
          field: 'graph.edges.condition.combinator',
          edgeId: edge.id,
          message: 'Property conditions must use the "and" or "or" combinator.',
        });
      }

      for (const rule of condition.rules) {
        if (!rule.propertyPath.trim()) {
          addIssue(issues, {
            level: 'error',
            field: 'graph.edges.condition.rules.propertyPath',
            edgeId: edge.id,
            message: 'Property condition rules require a property path.',
          });
        }

        if (!['equals', 'not-equals', 'contains', 'gt', 'lt', 'regex'].includes(rule.operator)) {
          addIssue(issues, {
            level: 'error',
            field: 'graph.edges.condition.rules.operator',
            edgeId: edge.id,
            message: `Property condition operator "${rule.operator}" is not supported.`,
          });
        }

        if (rule.operator === 'regex') {
          try {
            new RegExp(rule.value);
          } catch {
            addIssue(issues, {
              level: 'error',
              field: 'graph.edges.condition.rules.value',
              edgeId: edge.id,
              message: `Regex pattern "${rule.value}" is invalid.`,
            });
          }
        }
      }
    }
  }
}

function validateSubWorkflowNode(node: WorkflowNode, issues: WorkflowValidationIssue[]): void {
  if (node.kind !== 'sub-workflow' || node.config.kind !== 'sub-workflow') {
    return;
  }

  const hasWorkflowId = Boolean(node.config.workflowId);
  const hasInlineWorkflow = Boolean(node.config.inlineWorkflow);
  if (hasWorkflowId === hasInlineWorkflow) {
    addIssue(issues, {
      level: 'error',
      field: 'graph.nodes.config',
      nodeId: node.id,
      message: 'Sub-workflow nodes must specify exactly one of workflowId or inlineWorkflow.',
    });
    return;
  }

  if (!node.config.inlineWorkflow) {
    return;
  }

  for (const inlineIssue of validateWorkflowDefinition(node.config.inlineWorkflow)) {
    addIssue(issues, {
      ...inlineIssue,
      field: inlineIssue.field
        ? `graph.nodes.config.inlineWorkflow.${inlineIssue.field}`
        : 'graph.nodes.config.inlineWorkflow',
      nodeId: node.id,
      message: `Inline workflow for node "${node.label || node.id}": ${inlineIssue.message}`,
    });
  }
}

function validateExecutableNodeConfig(node: WorkflowNode, issues: WorkflowValidationIssue[]): void {
  switch (node.kind) {
    case 'invoke-function':
      if (node.config.kind === 'invoke-function' && !node.config.functionName.trim()) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.nodes.config.functionName',
          nodeId: node.id,
          message: 'Function tool nodes require a non-empty functionName.',
        });
      }
      return;
    case 'request-port':
      if (node.config.kind !== 'request-port') {
        return;
      }

      if (!node.config.portId.trim()) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.nodes.config.portId',
          nodeId: node.id,
          message: 'Request port nodes require a non-empty portId.',
        });
      }

      if (!node.config.requestType.trim()) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.nodes.config.requestType',
          nodeId: node.id,
          message: 'Request port nodes require a non-empty requestType.',
        });
      }

      if (!node.config.responseType.trim()) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.nodes.config.responseType',
          nodeId: node.id,
          message: 'Request port nodes require a non-empty responseType.',
        });
      }

      return;
    default:
      return;
  }
}

function addModeShapeWarning(
  issues: WorkflowValidationIssue[],
  field: string,
  message: string,
  nodeId?: string,
): void {
  addIssue(issues, {
    level: 'warning',
    field,
    nodeId,
    message,
  });
}

function createOutgoingEdgeMap(graph: WorkflowGraph): Map<string, WorkflowEdge[]> {
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    const current = outgoing.get(edge.source);
    if (current) {
      current.push(edge);
    } else {
      outgoing.set(edge.source, [edge]);
    }
  }

  return outgoing;
}

function createIncomingEdgeMap(graph: WorkflowGraph): Map<string, WorkflowEdge[]> {
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const edge of graph.edges) {
    const current = incoming.get(edge.target);
    if (current) {
      current.push(edge);
    } else {
      incoming.set(edge.target, [edge]);
    }
  }

  return incoming;
}

function validateGraphModeCompatibility(
  workflow: WorkflowDefinition,
  issues: WorkflowValidationIssue[],
): void {
  const mode = workflow.settings.orchestrationMode;
  if (!mode) {
    return;
  }

  const agentNodes = resolveWorkflowAgentNodes(workflow);
  const agentIds = new Set(agentNodes.map((node) => node.id));
  const outgoing = createOutgoingEdgeMap(workflow.graph);
  const incoming = createIncomingEdgeMap(workflow.graph);
  const fanOutEdges = workflow.graph.edges.filter((edge) => edge.kind === 'fan-out');
  const fanInEdges = workflow.graph.edges.filter((edge) => edge.kind === 'fan-in');
  const nonAgentExecutableNodes = workflow.graph.nodes.filter((node) =>
    node.kind !== 'start'
    && node.kind !== 'end'
    && node.kind !== 'agent');

  switch (mode) {
    case 'single': {
      if (agentNodes.length !== 1) {
        addIssue(issues, {
          level: 'error',
          field: 'settings.orchestrationMode',
          message: 'Single mode requires exactly one agent node.',
        });
      }

      if (fanOutEdges.length > 0 || fanInEdges.length > 0) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.edges.kind',
          message: 'Single mode does not support fan-out or fan-in edges.',
        });
      }

      if (nonAgentExecutableNodes.length > 0 || workflow.graph.nodes.length > 3 || workflow.graph.edges.length > 2) {
        addModeShapeWarning(
          issues,
          'graph',
          'Single mode works best with a simple start → agent → end graph.',
        );
      }

      return;
    }
    case 'sequential': {
      if (agentNodes.length === 0) {
        addIssue(issues, {
          level: 'error',
          field: 'settings.orchestrationMode',
          message: 'Sequential mode requires at least one agent node.',
        });
      }

      if (fanOutEdges.length > 0 || fanInEdges.length > 0) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.edges.kind',
          message: 'Sequential mode does not support fan-out or fan-in edges.',
        });
      }

      const firstAgent = agentNodes[0];
      const lastAgent = agentNodes[agentNodes.length - 1];
      const isLinear = agentNodes.every((agent, index) => {
        const incomingEdges = incoming.get(agent.id) ?? [];
        const outgoingEdges = outgoing.get(agent.id) ?? [];

        if (agentNodes.length === 1) {
          return incomingEdges.some((edge) => edge.source === 'start')
            && outgoingEdges.some((edge) => edge.target === 'end');
        }

        if (agent === firstAgent) {
          return incomingEdges.some((edge) => edge.source === 'start')
            && outgoingEdges.some((edge) => agentIds.has(edge.target));
        }

        if (agent === lastAgent) {
          return incomingEdges.some((edge) => agentIds.has(edge.source))
            && outgoingEdges.some((edge) => edge.target === 'end');
        }

        return incomingEdges.some((edge) => agentIds.has(edge.source))
          && outgoingEdges.some((edge) => agentIds.has(edge.target));
      });

      if (!isLinear) {
        addModeShapeWarning(
          issues,
          'graph.edges',
          'Sequential mode works best with a linear start → agent … → end graph.',
        );
      }

      return;
    }
    case 'concurrent': {
      if (agentNodes.length === 0) {
        addIssue(issues, {
          level: 'error',
          field: 'settings.orchestrationMode',
          message: 'Concurrent mode requires at least one agent node.',
        });
      }

      if (fanOutEdges.length === 0 || fanInEdges.length === 0) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.edges.kind',
          message: 'Concurrent mode requires both fan-out and fan-in edges.',
        });
      }

      const fanOutTargets = new Set(fanOutEdges.map((edge) => edge.target));
      const fanInSources = new Set(fanInEdges.map((edge) => edge.source));
      const missingJoin = [...fanOutTargets].some((target) => !fanInSources.has(target));
      if (missingJoin) {
        addModeShapeWarning(
          issues,
          'graph.edges.kind',
          'Concurrent mode works best when every fan-out branch rejoins through a matching fan-in edge.',
        );
      }

      return;
    }
    case 'handoff': {
      if (agentNodes.length < 2) {
        addIssue(issues, {
          level: 'error',
          field: 'settings.orchestrationMode',
          message: 'Handoff mode requires at least two agent nodes.',
        });
        return;
      }

      const triageAgentNodeId = workflow.settings.modeSettings?.handoff?.triageAgentNodeId;
      const triageAgent = triageAgentNodeId
        ? agentNodes.find((node) => node.id === triageAgentNodeId)
        : agentNodes[0];

      if (triageAgentNodeId && !triageAgent) {
        addIssue(issues, {
          level: 'error',
          field: 'settings.modeSettings.handoff.triageAgentNodeId',
          message: `Handoff mode triage agent "${triageAgentNodeId}" must reference an agent node in the graph.`,
        });
        return;
      }

      const specialists = agentNodes.filter((node) => node.id !== triageAgent!.id);
      const triageOutgoingSpecialistEdges = (outgoing.get(triageAgent!.id) ?? [])
        .filter((edge) => agentIds.has(edge.target) && edge.target !== triageAgent!.id);
      if (triageOutgoingSpecialistEdges.length === 0) {
        addModeShapeWarning(
          issues,
          'graph.edges',
          'Handoff mode works best when the triage agent has outgoing edges to specialist agents.',
          triageAgent!.id,
        );
      }

      for (const specialist of specialists) {
        if (!canReachNode(workflow.graph, specialist.id, triageAgent!.id)) {
          addModeShapeWarning(
            issues,
            'graph.edges',
            `Handoff specialist "${specialist.label || specialist.id}" should have a return path back to the triage agent.`,
            specialist.id,
          );
        }
      }

      return;
    }
    case 'group-chat': {
      if (agentNodes.length < 2) {
        addIssue(issues, {
          level: 'error',
          field: 'settings.orchestrationMode',
          message: 'Group-chat mode requires at least two agent nodes.',
        });
      }

      const hasLoopAmongAgents = workflow.graph.edges.some((edge) =>
        agentIds.has(edge.source)
        && agentIds.has(edge.target)
        && (edge.isLoop === true || canReachNode(workflow.graph, edge.target, edge.source, edge.id)));

      if (!hasLoopAmongAgents) {
        addModeShapeWarning(
          issues,
          'graph.edges.isLoop',
          'Group-chat mode works best when agent nodes form a loop for repeated turns.',
        );
      }

      return;
    }
  }
}

export function validateWorkflowDefinition(workflow: WorkflowDefinition): WorkflowValidationIssue[] {
  const normalized = normalizeWorkflowDefinition(workflow);
  const issues: WorkflowValidationIssue[] = [];

  if (!normalized.name) {
    addIssue(issues, { level: 'error', field: 'name', message: 'Workflow name is required.' });
  }

  if (normalized.graph.nodes.length === 0) {
    addIssue(issues, { level: 'error', field: 'graph', message: 'Workflow graph must include nodes.' });
    return issues;
  }

  const nodesById = new Map<string, WorkflowNode>();
  const edgeIds = new Set<string>();
  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();

  for (const node of normalized.graph.nodes) {
    if (!node.id) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.nodes.id',
        nodeId: node.id,
        message: 'Workflow nodes must have an ID.',
      });
      continue;
    }

    if (nodesById.has(node.id)) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.nodes.id',
        nodeId: node.id,
        message: `Workflow graph contains duplicate node "${node.id}".`,
      });
      continue;
    }

    nodesById.set(node.id, node);

    if (!node.label) {
      addIssue(issues, {
        level: 'warning',
        field: 'graph.nodes.label',
        nodeId: node.id,
        message: 'Workflow nodes should have a label.',
      });
    }

    if (!executableNodeKinds.has(node.kind)) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.nodes.kind',
        nodeId: node.id,
        message: `Workflow node kind "${node.kind}" is not executable yet.`,
      });
    }

    if (node.kind === 'agent' && node.config.kind === 'agent') {
      if (!node.config.name) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.nodes.config.name',
          nodeId: node.id,
          message: 'Agent nodes require a name.',
        });
      }
      if (!node.config.model) {
        addIssue(issues, {
          level: 'error',
          field: 'graph.nodes.config.model',
          nodeId: node.id,
          message: `Agent node "${node.label || node.id}" requires a model.`,
        });
      }
    }

    validateExecutableNodeConfig(node, issues);
    validateSubWorkflowNode(node, issues);
  }
  for (const edge of normalized.graph.edges) {
    if (!edge.id) {
      addIssue(issues, { level: 'error', field: 'graph.edges.id', message: 'Workflow edges must have an ID.' });
      continue;
    }
    if (!edgeIds.add(edge.id)) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges.id',
        edgeId: edge.id,
        message: `Workflow graph contains duplicate edge "${edge.id}".`,
      });
    }
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges',
        edgeId: edge.id,
        message: `Workflow edge "${edge.id}" must connect known nodes.`,
      });
      continue;
    }

    outgoingCounts.set(edge.source, (outgoingCounts.get(edge.source) ?? 0) + 1);
    incomingCounts.set(edge.target, (incomingCounts.get(edge.target) ?? 0) + 1);

    if (edge.kind === 'fan-in' && edge.condition) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges.condition',
        edgeId: edge.id,
        message: 'Fan-in edges do not support conditions.',
      });
    }

    validateEdgeCondition(edge, issues);
  }
  const startNodes = normalized.graph.nodes.filter((node) => node.kind === 'start');
  const endNodes = normalized.graph.nodes.filter((node) => node.kind === 'end');
  const executableWorkNodes = normalized.graph.nodes.filter((node) =>
    node.kind === 'agent'
    || node.kind === 'invoke-function'
    || node.kind === 'sub-workflow'
    || node.kind === 'request-port');

  if (startNodes.length !== 1) {
    addIssue(issues, {
      level: 'error',
      field: 'graph.nodes',
      message: 'Workflow graphs must contain exactly one start node.',
    });
  }

  if (endNodes.length !== 1) {
    addIssue(issues, {
      level: 'error',
      field: 'graph.nodes',
      message: 'Workflow graphs must contain exactly one end node.',
    });
  }

  if (executableWorkNodes.length === 0) {
    addIssue(issues, {
      level: 'error',
      field: 'graph.nodes',
      message: 'Workflow graphs must contain at least one executable work node.',
    });
  }

  for (const startNode of startNodes) {
    if ((incomingCounts.get(startNode.id) ?? 0) !== 0) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges',
        nodeId: startNode.id,
        message: 'Start nodes cannot have incoming edges.',
      });
    }
    if ((outgoingCounts.get(startNode.id) ?? 0) === 0) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges',
        nodeId: startNode.id,
        message: 'Start nodes must connect to at least one downstream node.',
      });
    }
  }

  for (const endNode of endNodes) {
    if ((outgoingCounts.get(endNode.id) ?? 0) !== 0) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges',
        nodeId: endNode.id,
        message: 'End nodes cannot have outgoing edges.',
      });
    }
  }

  const fanOutBySource = new Map<string, WorkflowEdge[]>();
  const fanInByTarget = new Map<string, WorkflowEdge[]>();
  for (const edge of normalized.graph.edges) {
    if (edge.kind === 'fan-out') {
      const current = fanOutBySource.get(edge.source);
      if (current) {
        current.push(edge);
      } else {
        fanOutBySource.set(edge.source, [edge]);
      }
    }
    if (edge.kind === 'fan-in') {
      const current = fanInByTarget.get(edge.target);
      if (current) {
        current.push(edge);
      } else {
        fanInByTarget.set(edge.target, [edge]);
      }
    }
  }

  for (const [source, edges] of fanOutBySource.entries()) {
    if (edges.length < 2) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges.kind',
        nodeId: source,
        message: 'Fan-out edges require at least two outgoing fan-out connections from the same source.',
      });
    }
  }

  for (const [target, edges] of fanInByTarget.entries()) {
    if (edges.length < 2) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges.kind',
        nodeId: target,
        message: 'Fan-in edges require at least two incoming fan-in connections to the same target.',
      });
    }
  }
  const startNode = startNodes[0];
  if (startNode && endNodes.length > 0 && !hasPathToEnd(startNode.id, normalized.graph, new Set(endNodes.map((node) => node.id)))) {
    addIssue(issues, {
      level: 'error',
      field: 'graph.edges',
      message: 'Workflow graph must include a path from the start node to at least one end node.',
    });
  }
  if (
    normalized.settings.maxIterations !== undefined
    && (normalized.settings.maxIterations < 1 || normalized.settings.maxIterations > 100)
  ) {
    addIssue(issues, {
      level: 'error',
      field: 'settings.maxIterations',
      message: 'Workflow maxIterations must be between 1 and 100.',
    });
  }

  for (const edge of normalized.graph.edges) {
    const loopEdge = isLoopEdge(normalized.graph, edge);

    if (loopEdge && edge.kind !== 'direct') {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges.kind',
        edgeId: edge.id,
        message: 'Loop edges currently support only direct edges.',
      });
    }

    if (loopEdge && !edge.isLoop) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges.isLoop',
        edgeId: edge.id,
        message: 'Edges that participate in a cycle must be explicitly marked as loops.',
      });
    }

    if (!loopEdge && edge.isLoop) {
      addIssue(issues, {
        level: 'warning',
        field: 'graph.edges.isLoop',
        edgeId: edge.id,
        message: 'This edge is marked as a loop but does not currently form a cycle.',
      });
    }

    if (!loopEdge) {
      continue;
    }

    if (!edge.condition) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges.condition',
        edgeId: edge.id,
        message: 'Loop edges require a condition so the loop can terminate.',
      });
    }

    if (edge.maxIterations === undefined || edge.maxIterations < 1) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges.maxIterations',
        edgeId: edge.id,
        message: 'Loop edges require a maxIterations value of at least 1.',
      });
    }

    const loopComponent = collectStronglyConnectedNodes(normalized.graph, edge.source);
    const hasExitPath = normalized.graph.edges.some((candidate) =>
      loopComponent.has(candidate.source) && !loopComponent.has(candidate.target));
    if (!hasExitPath) {
      addIssue(issues, {
        level: 'error',
        field: 'graph.edges',
        edgeId: edge.id,
        message: 'Loop cycles must include an exit path to a node outside the loop.',
      });
    }
  }

  validateGraphModeCompatibility(normalized, issues);

  return issues;
}

