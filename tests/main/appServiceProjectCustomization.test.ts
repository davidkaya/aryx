import { describe, expect, mock, test } from 'bun:test';

import type { RunTurnCommand } from '@shared/contracts/sidecar';
import { buildAvailableModelCatalog } from '@shared/domain/models';
import type { ProjectRecord } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';
import { resolveWorkflowAgentNodes, type WorkflowDefinition } from '@shared/domain/workflow';

const TIMESTAMP = '2026-03-28T00:00:00.000Z';

mock.module('electron', () => {
  const electronMock = {
    app: {
      isPackaged: false,
      getAppPath: () => 'C:\\workspace\\personal\\repositories\\aryx',
      getPath: () => 'C:\\workspace\\personal\\repositories\\aryx\\tests\\fixtures',
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    shell: {
      openPath: async () => '',
    },
  };

  return {
    ...electronMock,
    default: electronMock,
  };
});

mock.module('keytar', () => ({
  default: {
    getPassword: async () => null,
    setPassword: async () => undefined,
    deletePassword: async () => false,
  },
}));

const { AryxAppService } = await import('@main/AryxAppService');

function createProject(overrides?: Partial<ProjectRecord>): ProjectRecord {
  return {
    id: 'project-alpha',
    name: 'alpha',
    path: 'C:\\workspace\\alpha',
    addedAt: TIMESTAMP,
    ...overrides,
  };
}

function createSession(projectId: string, workflowId: string, overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'session-alpha',
    projectId,
    workflowId,
    title: 'Alpha session',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    status: 'idle',
    messages: [],
    runs: [],
    ...overrides,
  };
}

function createService(
  workspace: WorkspaceState,
  workflow: WorkflowDefinition,
  options?: {
    captureRunTurn?: (command: RunTurnCommand) => void;
  },
): InstanceType<typeof AryxAppService> {
  const service = new AryxAppService();
  const internals = service as unknown as Record<string, unknown>;
  internals.loadWorkspace = async () => workspace;
  internals.persistAndBroadcast = async (nextWorkspace: WorkspaceState) => nextWorkspace;
  internals.buildEffectiveWorkflow = async () => workflow;
  internals.loadAvailableModelCatalog = async () => buildAvailableModelCatalog();
  internals.awaitFinalResponseApproval = async () => undefined;
  internals.finalizeTurn = () => undefined;
  internals.emitSessionEvent = () => undefined;
  internals.pruneUnavailableApprovalTools = async () => false;
  internals.pruneUnavailableSessionToolingSelections = () => false;
  (
    service as unknown as {
      sidecar: {
        runTurn: (command: RunTurnCommand) => Promise<[]>;
        resolveApproval: () => Promise<void>;
      };
    }
  ).sidecar = {
    runTurn: async (command) => {
      options?.captureRunTurn?.(command);
      return [];
    },
    resolveApproval: async () => undefined,
  };

  return service;
}

function updatePrimaryAgent(
  workflow: WorkflowDefinition,
  update: (agent: NonNullable<ReturnType<typeof resolveWorkflowAgentNodes>[number]>['config']) => NonNullable<ReturnType<typeof resolveWorkflowAgentNodes>[number]>['config'],
): WorkflowDefinition {
  let updated = false;
  return {
    ...workflow,
    graph: {
      ...workflow.graph,
      nodes: workflow.graph.nodes.map((node) => {
        if (updated || node.kind !== 'agent' || node.config.kind !== 'agent') {
          return node;
        }

        updated = true;
        return {
          ...node,
          config: update(node.config),
        };
      }),
    },
  };
}

function getPrimaryAgentConfig(workflow: WorkflowDefinition | undefined) {
  const node = workflow ? resolveWorkflowAgentNodes(workflow)[0] : undefined;
  return node?.config.kind === 'agent' ? node.config : undefined;
}

describe('AryxAppService project customization', () => {
  test('sendSessionMessage injects project instructions and enabled project agent profiles', async () => {
    const workspace = createWorkspaceSeed();
    const baseWorkflow = workspace.workflows.find((candidate) => candidate.settings.orchestrationMode === 'single');
    if (!baseWorkflow) {
      throw new Error('Expected a single-agent workflow in the workspace seed.');
    }

    const workflow = updatePrimaryAgent(baseWorkflow, (agent) => ({
      ...agent,
          copilot: {
            customAgents: [
              {
                name: 'reviewer',
                prompt: 'Built-in reviewer prompt.',
              },
            ],
          },
        }));

    const project = createProject({
      customization: {
        instructions: [
          {
            id: 'instruction-repo',
            sourcePath: '.github\\copilot-instructions.md',
            content: 'Use TypeScript.',
            applicationMode: 'always',
          },
          {
            id: 'instruction-agents',
            sourcePath: 'AGENTS.md',
            content: 'Prefer focused tests.',
            applicationMode: 'always',
          },
        ],
        agentProfiles: [
          {
            id: 'agent-reviewer',
            name: 'reviewer',
            prompt: 'Project reviewer prompt.',
            sourcePath: '.github\\agents\\reviewer.agent.md',
            enabled: true,
          },
          {
            id: 'agent-readme',
            name: 'readme-specialist',
            description: 'Documentation specialist',
            tools: ['read', 'edit'],
            prompt: 'Focus on README improvements.',
            sourcePath: '.github\\agents\\readme-specialist.agent.md',
            enabled: true,
          },
          {
            id: 'agent-disabled',
            name: 'disabled-specialist',
            prompt: 'Should never be injected.',
            sourcePath: '.github\\agents\\disabled-specialist.agent.md',
            enabled: false,
          },
        ],
        promptFiles: [],
        lastScannedAt: TIMESTAMP,
      },
    });
    const session = createSession(project.id, workflow.id);

    workspace.projects = [project];
    workspace.sessions = [session];
    workspace.selectedProjectId = project.id;
    workspace.selectedWorkflowId = workflow.id;
    workspace.selectedSessionId = session.id;

    let command: RunTurnCommand | undefined;
    const service = createService(workspace, workflow, {
      captureRunTurn: (capturedCommand) => {
        command = capturedCommand;
      },
    });

    await service.sendSessionMessage(session.id, 'Use the repository guidance.');

    expect(command?.projectInstructions).toBe('Use TypeScript.\n\nPrefer focused tests.');
    expect(getPrimaryAgentConfig(command?.workflow)?.copilot?.customAgents).toEqual([
      {
        name: 'reviewer',
        prompt: 'Built-in reviewer prompt.',
      },
      {
        name: 'readme-specialist',
        description: 'Documentation specialist',
        tools: ['read', 'edit'],
        prompt: 'Focus on README improvements.',
        infer: undefined,
      },
    ]);
  });

  test('sendSessionMessage formats file-scoped and task-scoped project instructions for the sidecar', async () => {
    const workspace = createWorkspaceSeed();
    const workflow = workspace.workflows.find((candidate) => candidate.settings.orchestrationMode === 'single');
    if (!workflow) {
      throw new Error('Expected a single-agent workflow in the workspace seed.');
    }

    const project = createProject({
      customization: {
        instructions: [
          {
            id: 'instruction-repo',
            sourcePath: '.github\\copilot-instructions.md',
            content: 'Use TypeScript.',
            applicationMode: 'always',
          },
          {
            id: 'instruction-react',
            sourcePath: '.github\\instructions\\frontend\\react.instructions.md',
            name: 'React Standards',
            description: 'React file conventions',
            applyTo: '**/*.tsx',
            content: 'Use hooks.',
            applicationMode: 'file',
          },
          {
            id: 'instruction-planning',
            sourcePath: '.github\\instructions\\tasks\\planning.instructions.md',
            description: 'Planning workflows',
            content: 'Create phased plans before implementation.',
            applicationMode: 'task',
          },
          {
            id: 'instruction-manual',
            sourcePath: '.github\\instructions\\manual.instructions.md',
            content: 'Never auto-apply me.',
            applicationMode: 'manual',
          },
        ],
        agentProfiles: [],
        promptFiles: [],
        lastScannedAt: TIMESTAMP,
      },
    });
    const session = createSession(project.id, workflow.id);

    workspace.projects = [project];
    workspace.sessions = [session];
    workspace.selectedProjectId = project.id;
    workspace.selectedWorkflowId = workflow.id;
    workspace.selectedSessionId = session.id;

    let command: RunTurnCommand | undefined;
    const service = createService(workspace, workflow, {
      captureRunTurn: (capturedCommand) => {
        command = capturedCommand;
      },
    });

    await service.sendSessionMessage(session.id, 'Handle the frontend task.');

    expect(command?.projectInstructions).toBe(
      'Use TypeScript.\n\n'
      + 'Repository file-scoped instructions:\n'
      + 'Apply each instruction only when working on files whose relative workspace path matches the listed glob.\n\n'
      + 'Source: .github\\instructions\\frontend\\react.instructions.md\n'
      + 'Name: React Standards\n'
      + 'Description: React file conventions\n'
      + 'ApplyTo: **/*.tsx\n'
      + 'Instructions:\n'
      + 'Use hooks.\n\n'
      + 'Repository task-scoped instructions:\n'
      + 'Apply each instruction only when the current task matches its description.\n\n'
      + 'Source: .github\\instructions\\tasks\\planning.instructions.md\n'
      + 'Description: Planning workflows\n'
      + 'Instructions:\n'
      + 'Create phased plans before implementation.',
    );
  });

  test('sendSessionMessage carries structured prompt invocations and uses prompt agent plan mode', async () => {
    const workspace = createWorkspaceSeed();
    const workflow = workspace.workflows.find((candidate) => candidate.settings.orchestrationMode === 'single');
    if (!workflow) {
      throw new Error('Expected a single-agent workflow in the workspace seed.');
    }

    const project = createProject();
    const session = createSession(project.id, workflow.id);

    workspace.projects = [project];
    workspace.sessions = [session];
    workspace.selectedProjectId = project.id;
    workspace.selectedWorkflowId = workflow.id;
    workspace.selectedSessionId = session.id;

    let command: RunTurnCommand | undefined;
    const service = createService(workspace, workflow, {
      captureRunTurn: (capturedCommand) => {
        command = capturedCommand;
      },
    });

    await service.sendSessionMessage(session.id, '', undefined, undefined, {
      id: 'project_customization_prompt_doc_review',
      name: 'doc-review',
      sourcePath: '.github\\prompts\\docs\\doc-review.prompt.md',
      description: 'Review the docs for missing steps',
      agent: 'plan',
      tools: ['view', 'glob'],
      resolvedPrompt: 'Review the docs for missing steps and propose updates.',
    });

    expect(session.messages.at(-1)).toMatchObject({
      id: expect.any(String),
      role: 'user',
      authorName: 'You',
      content: 'Run prompt file: doc-review',
      createdAt: expect.any(String),
      promptInvocation: {
        id: 'project_customization_prompt_doc_review',
        name: 'doc-review',
        sourcePath: '.github\\prompts\\docs\\doc-review.prompt.md',
        description: 'Review the docs for missing steps',
        agent: 'plan',
        tools: ['view', 'glob'],
        resolvedPrompt: 'Review the docs for missing steps and propose updates.',
      },
    });
    expect(command?.mode).toBe('plan');
    expect(command?.promptInvocation).toEqual({
      id: 'project_customization_prompt_doc_review',
      name: 'doc-review',
      sourcePath: '.github\\prompts\\docs\\doc-review.prompt.md',
      description: 'Review the docs for missing steps',
      agent: 'plan',
      tools: ['view', 'glob'],
      resolvedPrompt: 'Review the docs for missing steps and propose updates.',
    });
    expect(command?.messages.at(-1)?.content).toBe('Run prompt file: doc-review');
  });

  test('sendSessionMessage hydrates prompt model metadata and overrides the turn pattern model', async () => {
    const workspace = createWorkspaceSeed();
    const baseWorkflow = workspace.workflows.find((candidate) => candidate.settings.orchestrationMode === 'single');
    if (!baseWorkflow) {
      throw new Error('Expected a single-agent workflow in the workspace seed.');
    }

    const workflow = updatePrimaryAgent(baseWorkflow, (agent) => ({
      ...agent,
          model: 'gpt-5.4',
          reasoningEffort: 'high',
        }));

    const project = createProject({
      customization: {
        instructions: [],
        agentProfiles: [],
        promptFiles: [
          {
            id: 'project_customization_prompt_rest_review',
            name: 'rest-review',
            description: 'Review the REST API surface',
            model: 'Claude Sonnet 4.5',
            template: 'Review the REST API for security gaps.',
            variables: [],
            sourcePath: '.github\\prompts\\rest-review.prompt.md',
          },
        ],
        lastScannedAt: TIMESTAMP,
      },
    });
    const session = createSession(project.id, workflow.id);

    workspace.projects = [project];
    workspace.sessions = [session];
    workspace.selectedProjectId = project.id;
    workspace.selectedWorkflowId = workflow.id;
    workspace.selectedSessionId = session.id;

    let command: RunTurnCommand | undefined;
    const service = createService(workspace, workflow, {
      captureRunTurn: (capturedCommand) => {
        command = capturedCommand;
      },
    });

    await service.sendSessionMessage(session.id, '', undefined, undefined, {
      id: 'project_customization_prompt_rest_review',
      name: 'rest-review',
      sourcePath: '.github\\prompts\\rest-review.prompt.md',
      resolvedPrompt: 'Review the REST API for security gaps.',
    });

    expect(session.messages.at(-1)?.promptInvocation).toEqual({
      id: 'project_customization_prompt_rest_review',
      name: 'rest-review',
      sourcePath: '.github\\prompts\\rest-review.prompt.md',
      description: 'Review the REST API surface',
      model: 'Claude Sonnet 4.5',
      resolvedPrompt: 'Review the REST API for security gaps.',
    });
    expect(getPrimaryAgentConfig(command?.workflow)?.model).toBe('claude-sonnet-4.5');
    expect(getPrimaryAgentConfig(command?.workflow)?.reasoningEffort).toBeUndefined();
    expect(command?.promptInvocation).toEqual({
      id: 'project_customization_prompt_rest_review',
      name: 'rest-review',
      sourcePath: '.github\\prompts\\rest-review.prompt.md',
      description: 'Review the REST API surface',
      model: 'Claude Sonnet 4.5',
      resolvedPrompt: 'Review the REST API for security gaps.',
    });
  });

  test('setProjectAgentProfileEnabled persists the updated enabled state', async () => {
    const workspace = createWorkspaceSeed();
    const workflow = workspace.workflows.find((candidate) => candidate.settings.orchestrationMode === 'single');
    if (!workflow) {
      throw new Error('Expected a single-agent workflow in the workspace seed.');
    }

    const project = createProject({
      customization: {
        instructions: [],
        agentProfiles: [
          {
            id: 'agent-readme',
            name: 'readme-specialist',
            prompt: 'Focus on docs.',
            sourcePath: '.github\\agents\\readme-specialist.agent.md',
            enabled: true,
          },
        ],
        promptFiles: [],
        lastScannedAt: TIMESTAMP,
      },
    });
    const session = createSession(project.id, workflow.id);

    workspace.projects = [project];
    workspace.sessions = [session];

    const service = createService(workspace, workflow);
    const updated = await service.setProjectAgentProfileEnabled(project.id, 'agent-readme', false);

    expect(updated.projects[0]?.customization?.agentProfiles).toEqual([
      {
        id: 'agent-readme',
        name: 'readme-specialist',
        prompt: 'Focus on docs.',
        sourcePath: '.github\\agents\\readme-specialist.agent.md',
        enabled: false,
      },
    ]);
  });
});
