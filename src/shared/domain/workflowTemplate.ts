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

export function createBuiltinWorkflowTemplates(timestamp: string): WorkflowTemplateDefinition[] {
  return [
    createCodeReviewPipeline(timestamp),
    createResearchAndSummarize(timestamp),
    createCustomerSupportTriage(timestamp),
    createContentCreationPipeline(timestamp),
    createMultiAgentDebate(timestamp),
    createDataProcessingWithValidation(timestamp),
    createApprovalWorkflow(timestamp),
    createNestedWorkflowOrchestrator(timestamp),
  ];
}

function makeAgentNode(
  id: string,
  label: string,
  x: number,
  y: number,
  instructions: string,
  order?: number,
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
      description: label,
      instructions,
      model: 'gpt-5.4',
    },
  };
}

function makeStartNode(x: number, y: number): WorkflowNode {
  return { id: 'start', kind: 'start', label: 'Start', position: { x, y }, config: { kind: 'start' } };
}

function makeEndNode(x: number, y: number): WorkflowNode {
  return { id: 'end', kind: 'end', label: 'End', position: { x, y }, config: { kind: 'end' } };
}

function makeEdge(
  source: string,
  target: string,
  kind: WorkflowEdge['kind'],
  overrides?: Partial<Omit<WorkflowEdge, 'source' | 'target' | 'kind'>>,
): WorkflowEdge {
  return {
    id: `edge-${source}-to-${target}`,
    source,
    target,
    kind,
    ...overrides,
  };
}

function buildTemplate(
  id: string,
  name: string,
  description: string,
  category: WorkflowTemplateCategory,
  workflow: WorkflowDefinition,
  timestamp: string,
): WorkflowTemplateDefinition {
  return normalizeWorkflowTemplateDefinition({
    id,
    name,
    description,
    category,
    source: 'builtin',
    workflow: normalizeWorkflowDefinition(workflow),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

// 1. Code Review Pipeline
function createCodeReviewPipeline(timestamp: string): WorkflowTemplateDefinition {
  return buildTemplate(
    'workflow-template-code-review',
    'Code Review Pipeline',
    'Sequential code analysis and review pipeline with checkpointing.',
    'data-pipeline',
    {
      id: 'workflow-code-review',
      name: 'Code Review Pipeline',
      description: 'Analyze code for issues, then review and prioritize findings.',
      graph: {
        nodes: [
          makeStartNode(0, 0),
          makeAgentNode(
            'analyzer', 'Analyzer', 250, 0,
            'Analyze the provided code for bugs, security vulnerabilities, and performance issues. Produce a structured list of findings.',
            0,
          ),
          makeAgentNode(
            'reviewer', 'Reviewer', 500, 0,
            'Review the analysis findings. Prioritize by severity, suggest concrete fixes, and produce a final review report.',
            1,
          ),
          makeEndNode(750, 0),
        ],
        edges: [
          makeEdge('start', 'analyzer', 'direct'),
          makeEdge('analyzer', 'reviewer', 'direct'),
          makeEdge('reviewer', 'end', 'direct'),
        ],
      },
      settings: {
        checkpointing: { enabled: true },
        executionMode: 'off-thread',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    timestamp,
  );
}

// 2. Research & Summarize
function createResearchAndSummarize(timestamp: string): WorkflowTemplateDefinition {
  return buildTemplate(
    'workflow-template-research-summarize',
    'Research & Summarize',
    'Fan-out to parallel research agents, then synthesize findings.',
    'orchestration',
    {
      id: 'workflow-research-summarize',
      name: 'Research & Summarize',
      description: 'Parallel research across domains with a unified synthesis.',
      graph: {
        nodes: [
          makeStartNode(0, 120),
          makeAgentNode(
            'technical-research', 'Technical Research', 250, 0,
            'Conduct in-depth technical research on the given topic. Focus on technical specifications, implementation details, and engineering trade-offs.',
            0,
          ),
          makeAgentNode(
            'market-research', 'Market Research', 250, 120,
            'Conduct market research on the given topic. Focus on market size, competitive landscape, trends, and commercial viability.',
            1,
          ),
          makeAgentNode(
            'academic-research', 'Academic Research', 250, 240,
            'Conduct academic research on the given topic. Focus on peer-reviewed literature, theoretical foundations, and recent publications.',
            2,
          ),
          makeAgentNode(
            'synthesizer', 'Synthesizer', 500, 120,
            'Combine findings from all research agents into a cohesive, well-structured report with citations.',
            3,
          ),
          makeEndNode(750, 120),
        ],
        edges: [
          makeEdge('start', 'technical-research', 'fan-out', { fanOutConfig: { strategy: 'broadcast' } }),
          makeEdge('start', 'market-research', 'fan-out', {
            id: 'edge-start-to-market-research',
            fanOutConfig: { strategy: 'broadcast' },
          }),
          makeEdge('start', 'academic-research', 'fan-out', {
            id: 'edge-start-to-academic-research',
            fanOutConfig: { strategy: 'broadcast' },
          }),
          makeEdge('technical-research', 'synthesizer', 'fan-in'),
          makeEdge('market-research', 'synthesizer', 'fan-in', { id: 'edge-market-research-to-synthesizer' }),
          makeEdge('academic-research', 'synthesizer', 'fan-in', { id: 'edge-academic-research-to-synthesizer' }),
          makeEdge('synthesizer', 'end', 'direct'),
        ],
      },
      settings: {
        checkpointing: { enabled: false },
        executionMode: 'off-thread',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    timestamp,
  );
}

// 3. Customer Support Triage
function createCustomerSupportTriage(timestamp: string): WorkflowTemplateDefinition {
  return buildTemplate(
    'workflow-template-customer-support',
    'Customer Support Triage',
    'Route customer issues to specialized agents via intelligent triage.',
    'human-in-loop',
    {
      id: 'workflow-customer-support',
      name: 'Customer Support Triage',
      description: 'Triage customer issues and route to the appropriate specialist agent.',
      graph: {
        nodes: [
          makeStartNode(0, 120),
          makeAgentNode(
            'triage', 'Triage Agent', 250, 120,
            'Classify the incoming customer support request. Determine whether it is a billing issue, a technical issue, or a general inquiry, and route accordingly.',
            0,
          ),
          makeAgentNode(
            'billing', 'Billing Agent', 500, 0,
            'Handle billing-related customer inquiries. Assist with invoices, payment issues, subscription changes, and refund requests.',
            1,
          ),
          makeAgentNode(
            'technical', 'Technical Agent', 500, 120,
            'Handle technical support requests. Diagnose problems, provide troubleshooting steps, and escalate complex issues when needed.',
            2,
          ),
          makeAgentNode(
            'general', 'General Agent', 500, 240,
            'Handle general customer inquiries. Provide information about products, services, policies, and account management.',
            3,
          ),
          makeEndNode(750, 120),
        ],
        edges: [
          makeEdge('start', 'triage', 'direct'),
          makeEdge('triage', 'billing', 'direct', {
            label: 'Billing issue',
            condition: { type: 'expression', expression: 'issue.category == "billing"' },
          }),
          makeEdge('triage', 'technical', 'direct', {
            id: 'edge-triage-to-technical',
            label: 'Technical issue',
            condition: { type: 'expression', expression: 'issue.category == "technical"' },
          }),
          makeEdge('triage', 'general', 'direct', {
            id: 'edge-triage-to-general',
            label: 'General inquiry',
            condition: { type: 'expression', expression: 'issue.category == "general"' },
          }),
          makeEdge('billing', 'end', 'direct'),
          makeEdge('technical', 'end', 'direct', { id: 'edge-technical-to-end' }),
          makeEdge('general', 'end', 'direct', { id: 'edge-general-to-end' }),
        ],
      },
      settings: {
        checkpointing: { enabled: false },
        executionMode: 'off-thread',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    timestamp,
  );
}

// 4. Content Creation Pipeline
function createContentCreationPipeline(timestamp: string): WorkflowTemplateDefinition {
  return buildTemplate(
    'workflow-template-content-creation',
    'Content Creation Pipeline',
    'Write, edit, and fact-check content with a revision loop.',
    'data-pipeline',
    {
      id: 'workflow-content-creation',
      name: 'Content Creation Pipeline',
      description: 'Iterative content creation with writing, editing, revision loops, and fact-checking.',
      graph: {
        nodes: [
          makeStartNode(0, 0),
          makeAgentNode(
            'writer', 'Writer', 250, 0,
            'Write high-quality content based on the given brief. Incorporate feedback from the editor when revisions are requested.',
            0,
          ),
          makeAgentNode(
            'editor', 'Editor', 500, 0,
            'Review the written content for clarity, grammar, structure, and adherence to the brief. Request revisions if needed or approve for fact-checking.',
            1,
          ),
          makeAgentNode(
            'fact-checker', 'Fact-Checker', 750, 0,
            'Verify all factual claims, statistics, and references in the content. Flag any inaccuracies and confirm the content is ready for publication.',
            2,
          ),
          makeEndNode(1000, 0),
        ],
        edges: [
          makeEdge('start', 'writer', 'direct'),
          makeEdge('writer', 'editor', 'direct', {
            isLoop: true,
            maxIterations: 3,
            condition: { type: 'always' },
          }),
          makeEdge('editor', 'writer', 'direct', {
            id: 'edge-editor-to-writer-loop',
            label: 'Revisions needed',
            isLoop: true,
            maxIterations: 3,
            condition: { type: 'expression', expression: 'review.needsRevision == true' },
          }),
          makeEdge('editor', 'fact-checker', 'direct', {
            id: 'edge-editor-to-fact-checker',
            label: 'Approved',
            condition: { type: 'expression', expression: 'review.needsRevision != true' },
          }),
          makeEdge('fact-checker', 'end', 'direct'),
        ],
      },
      settings: {
        checkpointing: { enabled: true },
        executionMode: 'off-thread',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    timestamp,
  );
}

// 5. Multi-Agent Debate
function createMultiAgentDebate(timestamp: string): WorkflowTemplateDefinition {
  return buildTemplate(
    'workflow-template-multi-agent-debate',
    'Multi-Agent Debate',
    'Structured debate between a proposer and critic with synthesis.',
    'orchestration',
    {
      id: 'workflow-multi-agent-debate',
      name: 'Multi-Agent Debate',
      description: 'Iterative debate between agents converging on a well-reasoned conclusion.',
      graph: {
        nodes: [
          makeStartNode(0, 0),
          makeAgentNode(
            'proposer', 'Proposer', 250, 0,
            'Present and refine arguments for the given position. Respond to criticisms by strengthening weak points and incorporating valid counterarguments.',
            0,
          ),
          makeAgentNode(
            'critic', 'Critic', 500, 0,
            'Critically evaluate the proposer\'s arguments. Identify logical flaws, missing evidence, and alternative perspectives. Push for a stronger conclusion.',
            1,
          ),
          makeAgentNode(
            'debate-synthesizer', 'Synthesizer', 750, 0,
            'Analyze the full debate transcript. Identify points of agreement, unresolved tensions, and produce a balanced final conclusion.',
            2,
          ),
          makeEndNode(1000, 0),
        ],
        edges: [
          makeEdge('start', 'proposer', 'direct'),
          makeEdge('proposer', 'critic', 'direct', {
            isLoop: true,
            maxIterations: 5,
            condition: { type: 'always' },
          }),
          makeEdge('critic', 'proposer', 'direct', {
            id: 'edge-critic-to-proposer-loop',
            label: 'Continue debate',
            isLoop: true,
            maxIterations: 5,
            condition: { type: 'expression', expression: 'debate.consensusReached != true' },
          }),
          makeEdge('critic', 'debate-synthesizer', 'direct', {
            id: 'edge-critic-to-synthesizer',
            label: 'Consensus reached',
            condition: { type: 'expression', expression: 'debate.consensusReached == true' },
          }),
          makeEdge('debate-synthesizer', 'end', 'direct'),
        ],
      },
      settings: {
        checkpointing: { enabled: false },
        executionMode: 'off-thread',
        maxIterations: 5,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    timestamp,
  );
}

// 6. Data Processing with Validation
function createDataProcessingWithValidation(timestamp: string): WorkflowTemplateDefinition {
  return buildTemplate(
    'workflow-template-data-processing',
    'Data Processing with Validation',
    'ETL pipeline mixing function calls and agents with validation loops.',
    'data-pipeline',
    {
      id: 'workflow-data-processing',
      name: 'Data Processing with Validation',
      description: 'Extract, transform, validate, and load data with automated validation and retry.',
      graph: {
        nodes: [
          makeStartNode(0, 0),
          {
            id: 'extract',
            kind: 'invoke-function',
            label: 'Extract Data',
            position: { x: 250, y: 0 },
            config: {
              kind: 'invoke-function',
              functionName: 'ExtractData',
              resultVariable: 'Local.rawData',
            },
          },
          makeAgentNode(
            'transform', 'Transform Agent', 500, 0,
            'Transform the raw extracted data into the target schema. Apply data cleaning, normalization, and enrichment rules.',
            0,
          ),
          {
            id: 'validate',
            kind: 'invoke-function',
            label: 'Validate Schema',
            position: { x: 750, y: 0 },
            config: {
              kind: 'invoke-function',
              functionName: 'ValidateSchema',
              requireApproval: true,
              resultVariable: 'Local.validationResult',
            },
          },
          makeAgentNode(
            'load', 'Load Agent', 1000, 0,
            'Load the validated and transformed data into the target system. Handle upserts, conflict resolution, and post-load verification.',
            1,
          ),
          makeEndNode(1250, 0),
        ],
        edges: [
          makeEdge('start', 'extract', 'direct'),
          makeEdge('extract', 'transform', 'direct'),
          makeEdge('transform', 'validate', 'direct', {
            isLoop: true,
            maxIterations: 3,
            condition: { type: 'always' },
          }),
          makeEdge('validate', 'load', 'direct', {
            label: 'Valid',
            condition: { type: 'expression', expression: 'Local.validationResult.valid == true' },
          }),
          makeEdge('validate', 'transform', 'direct', {
            id: 'edge-validate-to-transform-loop',
            label: 'Invalid',
            isLoop: true,
            maxIterations: 3,
            condition: { type: 'expression', expression: 'Local.validationResult.valid != true' },
          }),
          makeEdge('load', 'end', 'direct'),
        ],
      },
      settings: {
        checkpointing: { enabled: true },
        executionMode: 'off-thread',
        stateScopes: [
          { name: 'Local', description: 'Pipeline-scoped data tracking', initialValues: { rawData: null, validationResult: null } },
        ],
        telemetry: { openTelemetry: true },
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    timestamp,
  );
}

// 7. Approval Workflow
function createApprovalWorkflow(timestamp: string): WorkflowTemplateDefinition {
  return buildTemplate(
    'workflow-template-approval',
    'Approval Workflow',
    'Draft content with human-in-the-loop review and approval.',
    'human-in-loop',
    {
      id: 'workflow-approval',
      name: 'Approval Workflow',
      description: 'Agent-drafted content with human review gate before publishing.',
      graph: {
        nodes: [
          makeStartNode(0, 0),
          makeAgentNode(
            'drafter', 'Drafter', 250, 0,
            'Draft content based on the given requirements. Incorporate reviewer feedback when revising after a rejection.',
            0,
          ),
          {
            id: 'review-port',
            kind: 'request-port',
            label: 'Human Review',
            position: { x: 500, y: 0 },
            config: {
              kind: 'request-port',
              portId: 'review',
              requestType: 'ReviewRequest',
              responseType: 'ReviewDecision',
              prompt: 'Please review the drafted content and approve or reject with feedback.',
            },
          },
          makeAgentNode(
            'publisher', 'Publisher', 750, 0,
            'Publish the approved content to the target platform. Handle formatting, metadata, and distribution.',
            1,
          ),
          makeEndNode(1000, 0),
        ],
        edges: [
          makeEdge('start', 'drafter', 'direct'),
          makeEdge('drafter', 'review-port', 'direct', {
            isLoop: true,
            maxIterations: 3,
            condition: { type: 'always' },
          }),
          makeEdge('review-port', 'publisher', 'direct', {
            label: 'Approved',
            condition: { type: 'expression', expression: 'review.decision == "approved"' },
          }),
          makeEdge('review-port', 'drafter', 'direct', {
            id: 'edge-review-to-drafter-loop',
            label: 'Rejected',
            isLoop: true,
            maxIterations: 3,
            condition: { type: 'expression', expression: 'review.decision == "rejected"' },
          }),
          makeEdge('publisher', 'end', 'direct'),
        ],
      },
      settings: {
        checkpointing: { enabled: true },
        executionMode: 'off-thread',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    timestamp,
  );
}

// 8. Nested Workflow Orchestrator
function createNestedWorkflowOrchestrator(timestamp: string): WorkflowTemplateDefinition {
  const inlineWorkflow: WorkflowDefinition = normalizeWorkflowDefinition({
    id: 'sub-workflow-worker',
    name: 'Worker Sub-Workflow',
    description: 'Inline worker sub-workflow that executes the planned task.',
    graph: {
      nodes: [
        makeStartNode(0, 0),
        makeAgentNode(
          'worker', 'Worker', 250, 0,
          'Execute the assigned task from the planner. Produce detailed output and intermediate results.',
          0,
        ),
        makeEndNode(500, 0),
      ],
      edges: [
        makeEdge('start', 'worker', 'direct'),
        makeEdge('worker', 'end', 'direct'),
      ],
    },
    settings: {
      checkpointing: { enabled: false },
      executionMode: 'off-thread',
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return buildTemplate(
    'workflow-template-nested-orchestrator',
    'Nested Workflow Orchestrator',
    'Plan, execute via sub-workflow, and evaluate with iterative refinement.',
    'orchestration',
    {
      id: 'workflow-nested-orchestrator',
      name: 'Nested Workflow Orchestrator',
      description: 'Orchestrate planning, sub-workflow execution, and evaluation with a refinement loop.',
      graph: {
        nodes: [
          makeStartNode(0, 0),
          makeAgentNode(
            'planner', 'Planner', 250, 0,
            'Decompose the objective into a concrete execution plan. Refine the plan based on evaluator feedback when iterating.',
            0,
          ),
          {
            id: 'sub-workflow',
            kind: 'sub-workflow',
            label: 'Execute Plan',
            position: { x: 500, y: 0 },
            config: {
              kind: 'sub-workflow',
              inlineWorkflow,
            },
          },
          makeAgentNode(
            'evaluator', 'Evaluator', 750, 0,
            'Evaluate the output of the sub-workflow against the original objective. Determine if the result is satisfactory or needs another iteration.',
            1,
          ),
          makeEndNode(1000, 0),
        ],
        edges: [
          makeEdge('start', 'planner', 'direct'),
          makeEdge('planner', 'sub-workflow', 'direct', {
            isLoop: true,
            maxIterations: 3,
            condition: { type: 'always' },
          }),
          makeEdge('sub-workflow', 'evaluator', 'direct', {
            isLoop: true,
            maxIterations: 3,
            condition: { type: 'always' },
          }),
          makeEdge('evaluator', 'end', 'direct', {
            label: 'Satisfactory',
            condition: { type: 'expression', expression: 'evaluation.satisfactory == true' },
          }),
          makeEdge('evaluator', 'planner', 'direct', {
            id: 'edge-evaluator-to-planner-loop',
            label: 'Needs refinement',
            isLoop: true,
            maxIterations: 3,
            condition: { type: 'expression', expression: 'evaluation.satisfactory != true' },
          }),
        ],
      },
      settings: {
        checkpointing: { enabled: true },
        executionMode: 'off-thread',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    timestamp,
  );
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
