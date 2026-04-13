import type {
  AgentActivityEvent,
  ApprovalRequestedEvent,
  ExitPlanModeRequestedEvent,
  InteractionMode,
  McpOauthRequiredEvent,
  MessageMode,
  MessageReclassifiedEvent,
  RunTurnCommand,
  RunTurnCustomAgentConfig,
  RunTurnToolingConfig,
  TurnDeltaEvent,
  UserInputRequestedEvent,
  WorkflowCheckpointResume,
} from '@shared/contracts/sidecar';
import {
  buildAvailableModelCatalog,
  findModelByReference,
  normalizeWorkflowModels,
  resolveReasoningEffort,
} from '@shared/domain/models';
import {
  approvalPolicyRequiresCheckpoint,
  type ApprovalDecision,
  type PendingApprovalMessageRecord,
  type PendingApprovalRecord,
} from '@shared/domain/approval';
import {
  listEnabledProjectAgentProfiles,
  normalizeProjectPromptInvocation,
  type ProjectAgentProfile,
  type ProjectPromptInvocation,
  type ProjectCustomizationState,
} from '@shared/domain/projectCustomization';
import { isScratchpadProject, type ProjectRecord } from '@shared/domain/project';
import {
  applySessionApprovalSettings,
  applySessionModelConfig,
  resolveSessionTitle,
  type ChatMessageRecord,
  type SessionRecord,
} from '@shared/domain/session';
import {
  appendRunActivityEvent,
  cancelSessionRunRecord,
  completeSessionRunRecord,
  createSessionRunRecord,
  failSessionRunRecord,
  upsertRunMessageEvent,
  type SessionRunRecord,
} from '@shared/domain/runTimeline';
import type { ChatMessageAttachment } from '@shared/domain/attachment';
import type { SessionEventRecord } from '@shared/domain/event';
import type { WorkspaceState } from '@shared/domain/workspace';
import {
  resolveWorkflowAgentNodes,
  type ReasoningEffort,
  type WorkflowDefinition,
} from '@shared/domain/workflow';
import {
  resolveWorkflowAgents as resolveWorkspaceWorkflowAgents,
  type WorkspaceAgentDefinition,
} from '@shared/domain/workspaceAgent';
import { nowIso } from '@shared/utils/ids';
import { mergeStreamingText } from '@shared/utils/streamingText';

import type { TurnScopedEvent } from '@main/sidecar/runTurnPending';
import { TurnCancelledError } from '@main/sidecar/turnCancelledError';

function isPlanPromptInvocation(promptInvocation?: ProjectPromptInvocation): boolean {
  return promptInvocation?.agent?.trim().toLowerCase() === 'plan';
}

type SessionTurnExecutorDeps = {
  saveWorkspace: (workspace: WorkspaceState) => Promise<void>;
  persistWorkspace: (workspace: WorkspaceState) => Promise<WorkspaceState>;
  requireSession: (workspace: WorkspaceState, sessionId: string) => SessionRecord;
  resolveSessionWorkflow: (workspace: WorkspaceState, session: SessionRecord) => WorkflowDefinition;
  updateSessionRun: (
    session: SessionRecord,
    requestId: string,
    updater: (run: SessionRunRecord) => SessionRunRecord,
  ) => SessionRunRecord | undefined;
  emitRunUpdated: (sessionId: string, occurredAt: string, run: SessionRunRecord) => void;
  emitSessionEvent: (event: SessionEventRecord) => void;
  rejectPendingApprovals: (session: SessionRecord, failedAt: string, error: string) => string[];
  buildRunTurnToolingConfig: (
    workspace: WorkspaceState,
    session: SessionRecord,
  ) => RunTurnToolingConfig | undefined;
  runSidecarTurnWithCheckpointRecovery: (
    workspace: WorkspaceState,
    session: SessionRecord,
    requestId: string,
    createCommand: (resumeFromCheckpoint?: WorkflowCheckpointResume) => RunTurnCommand,
    onDelta: (event: TurnDeltaEvent) => void | Promise<void>,
    onActivity: (event: AgentActivityEvent) => void | Promise<void>,
    onApproval: (event: ApprovalRequestedEvent) => void | Promise<void>,
    onUserInput: (event: UserInputRequestedEvent) => void | Promise<void>,
    onMcpOAuthRequired: (event: McpOauthRequiredEvent) => void | Promise<void>,
    onExitPlanMode: (event: ExitPlanModeRequestedEvent) => void | Promise<void>,
    onMessageReclassified: (event: MessageReclassifiedEvent) => void | Promise<void>,
    onTurnScopedEvent: (event: TurnScopedEvent) => void | Promise<void>,
  ) => Promise<ChatMessageRecord[]>;
  handleApprovalRequested: (
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    approval: ApprovalRequestedEvent | PendingApprovalRecord,
    resolve: (decision: ApprovalDecision, alwaysApprove?: boolean) => void | Promise<void>,
  ) => Promise<void>;
  handleUserInputRequested: (
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    event: UserInputRequestedEvent,
    resolve: (answer: string, wasFreeform: boolean) => void | Promise<void>,
  ) => Promise<void>;
  handleMcpOAuthRequired: (
    workspace: WorkspaceState,
    sessionId: string,
    event: McpOauthRequiredEvent,
  ) => Promise<void>;
  handleExitPlanModeRequested: (
    workspace: WorkspaceState,
    sessionId: string,
    event: ExitPlanModeRequestedEvent,
  ) => Promise<void>;
  handleTurnScopedEvent: (
    workspace: WorkspaceState,
    sessionId: string,
    event: TurnScopedEvent,
  ) => void | Promise<void>;
  sidecarResolveApproval: (
    approvalId: string,
    decision: ApprovalDecision,
    alwaysApprove?: boolean,
  ) => Promise<void>;
  sidecarResolveUserInput: (
    userInputId: string,
    answer: string,
    wasFreeform: boolean,
  ) => Promise<void>;
  captureWorkingTreeSnapshot: (
    projectPath: string,
    scannedAt: string,
  ) => Promise<import('@shared/domain/project').ProjectGitWorkingTreeSnapshot | undefined>;
  captureWorkingTreeBaseline: (
    projectPath: string,
    snapshot: import('@shared/domain/project').ProjectGitWorkingTreeSnapshot,
  ) => Promise<import('@shared/domain/project').ProjectGitBaselineFile[]>;
  refreshSessionRunGitSummary: (
    session: SessionRecord,
    project: ProjectRecord,
    requestId: string,
    occurredAt: string,
  ) => Promise<SessionRunRecord | undefined>;
  cleanupWorkflowCheckpointRecovery: (requestId: string) => Promise<void>;
  scheduleProjectGitRefresh: (projectId: string) => void;
  loadAvailableModelCatalog: () => Promise<ReturnType<typeof buildAvailableModelCatalog>>;
};

export class SessionTurnExecutor {
  private readonly saveWorkspace: SessionTurnExecutorDeps['saveWorkspace'];

  private readonly persistWorkspace: SessionTurnExecutorDeps['persistWorkspace'];

  private readonly requireSession: SessionTurnExecutorDeps['requireSession'];

  private readonly resolveSessionWorkflow: SessionTurnExecutorDeps['resolveSessionWorkflow'];

  private readonly updateSessionRun: SessionTurnExecutorDeps['updateSessionRun'];

  private readonly emitRunUpdated: SessionTurnExecutorDeps['emitRunUpdated'];

  private readonly emitSessionEvent: SessionTurnExecutorDeps['emitSessionEvent'];

  private readonly rejectPendingApprovals: SessionTurnExecutorDeps['rejectPendingApprovals'];

  private readonly buildRunTurnToolingConfig: SessionTurnExecutorDeps['buildRunTurnToolingConfig'];

  private readonly runSidecarTurnWithCheckpointRecovery: SessionTurnExecutorDeps['runSidecarTurnWithCheckpointRecovery'];

  private readonly handleApprovalRequested: SessionTurnExecutorDeps['handleApprovalRequested'];

  private readonly handleUserInputRequested: SessionTurnExecutorDeps['handleUserInputRequested'];

  private readonly handleMcpOAuthRequired: SessionTurnExecutorDeps['handleMcpOAuthRequired'];

  private readonly handleExitPlanModeRequested: SessionTurnExecutorDeps['handleExitPlanModeRequested'];

  private readonly handleTurnScopedEvent: SessionTurnExecutorDeps['handleTurnScopedEvent'];

  private readonly sidecarResolveApproval: SessionTurnExecutorDeps['sidecarResolveApproval'];

  private readonly sidecarResolveUserInput: SessionTurnExecutorDeps['sidecarResolveUserInput'];

  private readonly captureWorkingTreeSnapshot: SessionTurnExecutorDeps['captureWorkingTreeSnapshot'];

  private readonly captureWorkingTreeBaseline: SessionTurnExecutorDeps['captureWorkingTreeBaseline'];

  private readonly refreshSessionRunGitSummary: SessionTurnExecutorDeps['refreshSessionRunGitSummary'];

  private readonly cleanupWorkflowCheckpointRecovery: SessionTurnExecutorDeps['cleanupWorkflowCheckpointRecovery'];

  private readonly scheduleProjectGitRefresh: SessionTurnExecutorDeps['scheduleProjectGitRefresh'];

  private readonly loadAvailableModelCatalog: SessionTurnExecutorDeps['loadAvailableModelCatalog'];

  constructor(deps: SessionTurnExecutorDeps) {
    this.saveWorkspace = deps.saveWorkspace;
    this.persistWorkspace = deps.persistWorkspace;
    this.requireSession = deps.requireSession;
    this.resolveSessionWorkflow = deps.resolveSessionWorkflow;
    this.updateSessionRun = deps.updateSessionRun;
    this.emitRunUpdated = deps.emitRunUpdated;
    this.emitSessionEvent = deps.emitSessionEvent;
    this.rejectPendingApprovals = deps.rejectPendingApprovals;
    this.buildRunTurnToolingConfig = deps.buildRunTurnToolingConfig;
    this.runSidecarTurnWithCheckpointRecovery = deps.runSidecarTurnWithCheckpointRecovery;
    this.handleApprovalRequested = deps.handleApprovalRequested;
    this.handleUserInputRequested = deps.handleUserInputRequested;
    this.handleMcpOAuthRequired = deps.handleMcpOAuthRequired;
    this.handleExitPlanModeRequested = deps.handleExitPlanModeRequested;
    this.handleTurnScopedEvent = deps.handleTurnScopedEvent;
    this.sidecarResolveApproval = deps.sidecarResolveApproval;
    this.sidecarResolveUserInput = deps.sidecarResolveUserInput;
    this.captureWorkingTreeSnapshot = deps.captureWorkingTreeSnapshot;
    this.captureWorkingTreeBaseline = deps.captureWorkingTreeBaseline;
    this.refreshSessionRunGitSummary = deps.refreshSessionRunGitSummary;
    this.cleanupWorkflowCheckpointRecovery = deps.cleanupWorkflowCheckpointRecovery;
    this.scheduleProjectGitRefresh = deps.scheduleProjectGitRefresh;
    this.loadAvailableModelCatalog = deps.loadAvailableModelCatalog;
  }

  async runPreparedSessionTurn(
    workspace: WorkspaceState,
    session: SessionRecord,
    project: ProjectRecord,
    effectiveWorkflow: WorkflowDefinition,
    projectInstructions: string | undefined,
    options: {
      occurredAt: string;
      requestId: string;
      triggerMessageId: string;
      messageMode?: MessageMode;
      attachments?: ChatMessageAttachment[];
    },
  ): Promise<void> {
    const workspaceKind = isScratchpadProject(project) ? 'scratchpad' : 'project';
    const { occurredAt, requestId, triggerMessageId, messageMode, attachments } = options;
    const promptInvocation = this.resolveRunTurnPromptInvocation(session, triggerMessageId);
    const workflowForTurn = await this.applyPromptInvocationToWorkflow(effectiveWorkflow, promptInvocation);
    const interactionMode: InteractionMode = isPlanPromptInvocation(promptInvocation)
      ? 'plan'
      : session.interactionMode ?? 'interactive';
    const runWorkingDirectory = session.cwd ?? project.path;
    const preRunGitSnapshot = workspaceKind === 'project'
      ? await this.captureWorkingTreeSnapshot(runWorkingDirectory, occurredAt)
      : undefined;
    const preRunGitBaselineFiles = workspaceKind === 'project' && preRunGitSnapshot
      ? await this.captureWorkingTreeBaseline(runWorkingDirectory, preRunGitSnapshot)
      : undefined;
    if (workspaceKind === 'project' && project.git?.status === 'ready' && !preRunGitSnapshot) {
      console.warn(`[aryx git] Failed to capture pre-run git snapshot for project "${project.id}".`);
    }

    session.title = resolveSessionTitle(session, workflowForTurn, session.messages);
    session.status = 'running';
    session.lastError = undefined;
    session.pendingPlanReview = undefined;
    session.pendingMcpAuth = undefined;
    session.updatedAt = occurredAt;
    session.runs = [
      createSessionRunRecord({
        requestId,
        project,
        workingDirectory: runWorkingDirectory,
        workspaceKind,
        workflow: workflowForTurn,
        triggerMessageId,
        startedAt: occurredAt,
        preRunGitSnapshot,
        preRunGitBaselineFiles,
      }),
      ...session.runs,
    ];

    await this.persistWorkspace(workspace);
    this.emitSessionEvent({
      sessionId: session.id,
      kind: 'status',
      status: 'running',
      occurredAt,
    });

    try {
      const createRunTurnCommand = (
        resumeFromCheckpoint?: WorkflowCheckpointResume,
      ): RunTurnCommand => ({
        type: 'run-turn',
        requestId,
        sessionId: session.id,
        projectPath: runWorkingDirectory,
        workspaceKind,
        mode: interactionMode,
        messageMode,
        projectInstructions,
        workflow: workflowForTurn,
        workflowLibrary: workspace.workflows,
        messages: session.messages,
        attachments: attachments?.length ? attachments : undefined,
        promptInvocation,
        tooling: this.buildRunTurnToolingConfig(workspace, session),
        resumeFromCheckpoint,
      });

      const responseMessages = await this.runSidecarTurnWithCheckpointRecovery(
        workspace,
        session,
        requestId,
        createRunTurnCommand,
        async (event) => {
          await this.applyTurnDelta(workspace, session.id, requestId, event);
        },
        async (event) => {
          await this.applyAgentActivity(workspace, session.id, requestId, event);
        },
        async (event) => {
          await this.handleApprovalRequested(workspace, session.id, requestId, event, (decision, alwaysApprove) =>
            this.sidecarResolveApproval(event.approvalId, decision, alwaysApprove));
        },
        async (event) => {
          await this.handleUserInputRequested(workspace, session.id, requestId, event, (answer, wasFreeform) =>
            this.sidecarResolveUserInput(event.userInputId, answer, wasFreeform));
        },
        async (event) => {
          await this.handleMcpOAuthRequired(workspace, session.id, event);
        },
        async (event) => {
          await this.handleExitPlanModeRequested(workspace, session.id, event);
        },
        async (event) => {
          await this.applyMessageReclassified(workspace, session.id, event);
        },
        async (event) => {
          await this.handleTurnScopedEvent(workspace, session.id, event);
        },
      );

      await this.awaitFinalResponseApproval(workspace, session.id, requestId, workflowForTurn, responseMessages);
      this.finalizeTurn(workspace, session.id, requestId, responseMessages);
      if (workspaceKind === 'project') {
        const completedRun = await this.refreshSessionRunGitSummary(session, project, requestId, nowIso());
        if (completedRun) {
          this.emitRunUpdated(session.id, nowIso(), completedRun);
        }
      }
      await this.persistWorkspace(workspace);
      await this.cleanupWorkflowCheckpointRecovery(requestId);
      if (workspaceKind === 'project') {
        this.scheduleProjectGitRefresh(project.id);
      }
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        this.finalizeCancelledTurn(session, requestId);
        if (workspaceKind === 'project') {
          const cancelledRun = await this.refreshSessionRunGitSummary(session, project, requestId, nowIso());
          if (cancelledRun) {
            this.emitRunUpdated(session.id, nowIso(), cancelledRun);
          }
        }
        await this.persistWorkspace(workspace);
        await this.cleanupWorkflowCheckpointRecovery(requestId);
        if (workspaceKind === 'project') {
          this.scheduleProjectGitRefresh(project.id);
        }
        return;
      }

      const failedAt = nowIso();
      session.status = 'error';
      session.lastError = error instanceof Error ? error.message : String(error);
      session.updatedAt = failedAt;

      const failedRun = this.updateSessionRun(session, requestId, (run) =>
        failSessionRunRecord(run, failedAt, session.lastError ?? 'Unknown error.'));

      this.emitSessionEvent({
        sessionId: session.id,
        kind: 'error',
        occurredAt: failedAt,
        error: session.lastError,
      });
      if (failedRun) {
        this.emitRunUpdated(session.id, failedAt, failedRun);
      }

      if (workspaceKind === 'project') {
        const summarizedRun = await this.refreshSessionRunGitSummary(session, project, requestId, failedAt);
        if (summarizedRun) {
          this.emitRunUpdated(session.id, failedAt, summarizedRun);
        }
      }

      await this.persistWorkspace(workspace);
      await this.cleanupWorkflowCheckpointRecovery(requestId);
      if (workspaceKind === 'project') {
        this.scheduleProjectGitRefresh(project.id);
      }
    }
  }

  async buildEffectiveWorkflow(
    workflow: WorkflowDefinition,
    session: SessionRecord,
    workspaceAgents: ReadonlyArray<WorkspaceAgentDefinition>,
  ): Promise<WorkflowDefinition> {
    const resolvedWorkflow = resolveWorkspaceWorkflowAgents(workflow, workspaceAgents);
    const workflowWithSessionConfig = session.sessionModelConfig
      ? applySessionModelConfig(resolvedWorkflow, session)
      : resolvedWorkflow;
    const workflowWithApprovalSettings = applySessionApprovalSettings(workflowWithSessionConfig, session);

    const modelCatalog = await this.loadAvailableModelCatalog();
    return normalizeWorkflowModels(workflowWithApprovalSettings, modelCatalog);
  }

  applyProjectCustomizationToWorkflow(
    workflow: WorkflowDefinition,
    project: ProjectRecord,
  ): WorkflowDefinition {
    if (isScratchpadProject(project)) {
      return workflow;
    }

    const projectCustomAgents = this.buildProjectCustomAgents(project.customization);
    if (projectCustomAgents.length === 0) {
      return workflow;
    }

    const primaryAgentNode = resolveWorkflowAgentNodes(workflow)[0];
    if (!primaryAgentNode || primaryAgentNode.config.kind !== 'agent') {
      return workflow;
    }

    const existingCustomAgents = primaryAgentNode.config.copilot?.customAgents ?? [];
    const existingAgentNames = new Set(existingCustomAgents.map((agent) => agent.name.toLowerCase()));
    const mergedCustomAgents = [
      ...existingCustomAgents,
      ...projectCustomAgents.filter((agent) => !existingAgentNames.has(agent.name.toLowerCase())),
    ];

    return {
      ...workflow,
      graph: {
        ...workflow.graph,
        nodes: workflow.graph.nodes.map((node) => {
          if (node.id !== primaryAgentNode.id || node.kind !== 'agent' || node.config.kind !== 'agent') {
            return node;
          }

          return {
            ...node,
            config: {
              ...node.config,
              copilot: {
                ...node.config.copilot,
                customAgents: mergedCustomAgents,
              },
            },
          };
        }),
      },
    };
  }

  resolveRunTurnPromptInvocation(
    session: SessionRecord,
    triggerMessageId: string,
  ): ProjectPromptInvocation | undefined {
    const triggerMessage = session.messages.find((message) => message.id === triggerMessageId);
    return normalizeProjectPromptInvocation(triggerMessage?.promptInvocation);
  }

  async applyPromptInvocationToWorkflow(
    workflow: WorkflowDefinition,
    promptInvocation?: ProjectPromptInvocation,
  ): Promise<WorkflowDefinition> {
    const requestedModel = promptInvocation?.model?.trim();
    if (!requestedModel) {
      return workflow;
    }

    const modelCatalog = await this.loadAvailableModelCatalog();
    const resolvedModel = findModelByReference(requestedModel, modelCatalog);
    const effectiveModelId = resolvedModel?.id ?? requestedModel;

    let didChange = false;
    const nodes = workflow.graph.nodes.map((node) => {
      if (node.kind !== 'agent' || node.config.kind !== 'agent') {
        return node;
      }

      const agent = node.config;
      const reasoningEffort: ReasoningEffort | undefined = resolvedModel?.supportedReasoningEfforts
        ? resolveReasoningEffort(resolvedModel, agent.reasoningEffort)
        : undefined;

      if (agent.model === effectiveModelId && agent.reasoningEffort === reasoningEffort) {
        return node;
      }

      didChange = true;
      return {
        ...node,
        config: {
          ...agent,
          model: effectiveModelId,
          reasoningEffort,
        },
      };
    });

    return didChange
      ? {
        ...workflow,
        graph: {
          ...workflow.graph,
          nodes,
        },
      }
      : workflow;
  }

  buildProjectCustomAgents(
    customization?: ProjectCustomizationState,
  ): RunTurnCustomAgentConfig[] {
    return listEnabledProjectAgentProfiles(customization).map((profile) => this.mapProjectAgentProfile(profile));
  }

  mapProjectAgentProfile(profile: ProjectAgentProfile): RunTurnCustomAgentConfig {
    const customAgent: RunTurnCustomAgentConfig = {
      name: profile.name,
      prompt: profile.prompt,
    };

    if (profile.displayName) {
      customAgent.displayName = profile.displayName;
    }

    if (profile.description) {
      customAgent.description = profile.description;
    }

    if (profile.tools) {
      customAgent.tools = profile.tools;
    }

    if (profile.infer !== undefined) {
      customAgent.infer = profile.infer;
    }

    return customAgent;
  }

  private async applyTurnDelta(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    event: TurnDeltaEvent,
  ): Promise<void> {
    if (event.content === undefined && event.contentDelta === undefined) {
      return;
    }

    const occurredAt = nowIso();
    const session = this.requireSession(workspace, sessionId);
    const existing = session.messages.find((message) => message.id === event.messageId);
    const content =
      existing && event.content === undefined
        ? mergeStreamingText(existing.content, event.contentDelta)
        : (event.content ?? event.contentDelta);

    const completedMessages: ChatMessageRecord[] = [];
    if (existing) {
      existing.content = content;
      existing.pending = true;
      existing.authorName = event.authorName;
    } else {
      for (const message of session.messages) {
        if (message.pending && message.role === 'assistant') {
          message.pending = false;
          completedMessages.push(message);
        }
      }
      session.messages.push({
        id: event.messageId,
        role: 'assistant',
        authorName: event.authorName,
        content,
        createdAt: occurredAt,
        pending: true,
      });
    }

    const nextRun = this.updateSessionRun(session, requestId, (run) =>
      upsertRunMessageEvent(run, {
        messageId: event.messageId,
        occurredAt,
        authorName: event.authorName,
        content,
        status: 'running',
      }));

    session.updatedAt = occurredAt;
    await this.saveWorkspace(workspace);

    for (const completed of completedMessages) {
      this.emitSessionEvent({
        sessionId,
        kind: 'message-complete',
        occurredAt,
        messageId: completed.id,
        authorName: completed.authorName,
        content: completed.content,
      });
    }
    this.emitSessionEvent({
      sessionId,
      kind: 'message-delta',
      occurredAt,
      messageId: event.messageId,
      authorName: event.authorName,
      contentDelta: event.contentDelta,
      content,
    });
    if (nextRun) {
      this.emitRunUpdated(sessionId, occurredAt, nextRun);
    }
  }

  private async applyMessageReclassified(
    workspace: WorkspaceState,
    sessionId: string,
    event: MessageReclassifiedEvent,
  ): Promise<void> {
    const session = this.requireSession(workspace, sessionId);
    const message = session.messages.find((m) => m.id === event.messageId);
    if (!message || message.messageKind === 'thinking') {
      return;
    }

    message.messageKind = 'thinking';
    const occurredAt = nowIso();
    session.updatedAt = occurredAt;
    await this.saveWorkspace(workspace);

    this.emitSessionEvent({
      sessionId,
      kind: 'message-reclassified',
      occurredAt,
      messageId: event.messageId,
      messageKind: 'thinking',
    });
  }

  private async applyAgentActivity(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    event: AgentActivityEvent,
  ): Promise<void> {
    const occurredAt = nowIso();
    const session = this.requireSession(workspace, sessionId);
    const activityType = event.activityType;
    let nextRun: SessionRunRecord | undefined;
    if (activityType === 'thinking' || activityType === 'tool-calling' || activityType === 'handoff') {
      nextRun = this.updateSessionRun(session, requestId, (run) =>
        appendRunActivityEvent(run, {
          activityType,
          occurredAt,
          agentId: event.agentId,
          agentName: event.agentName,
          sourceAgentId: event.sourceAgentId,
          sourceAgentName: event.sourceAgentName,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          toolArguments: event.toolArguments,
          fileChanges: event.fileChanges,
        }));
    }
    if (nextRun) {
      session.updatedAt = occurredAt;
      await this.saveWorkspace(workspace);
      this.emitRunUpdated(sessionId, occurredAt, nextRun);
    }

    this.emitSessionEvent({
      sessionId,
      kind: 'agent-activity',
      occurredAt,
      activityType: event.activityType,
      agentId: event.agentId,
      agentName: event.agentName,
      subworkflowNodeId: event.subworkflowNodeId,
      subworkflowName: event.subworkflowName,
      sourceAgentId: event.sourceAgentId,
      sourceAgentName: event.sourceAgentName,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      toolArguments: event.toolArguments,
      fileChanges: event.fileChanges,
    });
  }

  private emitCompletedActivity(
    sessionId: string,
    workflow: WorkflowDefinition,
    message: ChatMessageRecord,
  ): void {
    if (message.role !== 'assistant') {
      return;
    }

    const agentNode = resolveWorkflowAgentNodes(workflow)
      .find((candidate) =>
        candidate.config.kind === 'agent'
        && (candidate.config.id === message.authorName || candidate.config.name === message.authorName))
      ;
    const agent = agentNode?.config.kind === 'agent' ? agentNode.config : undefined;
    if (!agent) {
      return;
    }

    this.emitSessionEvent({
      sessionId,
      kind: 'agent-activity',
      occurredAt: nowIso(),
      activityType: 'completed',
      agentId: agent.id,
      agentName: agent.name,
    });
  }

  private finalizeTurn(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    messages: ChatMessageRecord[],
  ): void {
    const session = this.requireSession(workspace, sessionId);
    const workflow = this.resolveSessionWorkflow(workspace, session);
    const incomingIds = new Set(messages.map((message) => message.id));
    const existingIds = new Set(session.messages.map((message) => message.id));
    const hasVisibleResponse = session.messages.some(
      (message) => message.role === 'assistant' && message.messageKind !== 'thinking',
    );

    for (const message of messages) {
      const occurredAt = nowIso();
      const existing = session.messages.find((current) => current.id === message.id);
      if (existing) {
        existing.authorName = message.authorName;
        existing.content = message.content;
        existing.pending = false;
      } else {
        const isUnstreamedIntermediate =
          message.role === 'assistant'
          && hasVisibleResponse
          && !message.messageKind;
        session.messages.push({
          ...message,
          pending: false,
          messageKind: message.messageKind ?? (isUnstreamedIntermediate ? 'thinking' : undefined),
        });
      }

      const reclassifiedAsThinking =
        !existingIds.has(message.id)
        && (message.messageKind === 'thinking'
          || (message.role === 'assistant' && hasVisibleResponse && !message.messageKind));

      const nextRun = this.updateSessionRun(session, requestId, (run) =>
        upsertRunMessageEvent(run, {
          messageId: message.id,
          occurredAt,
          authorName: message.authorName,
          content: message.content,
          status: 'completed',
        }));
      this.emitSessionEvent({
        sessionId,
        kind: 'message-complete',
        occurredAt,
        messageId: message.id,
        authorName: message.authorName,
        content: message.content,
      });
      if (reclassifiedAsThinking) {
        this.emitSessionEvent({
          sessionId,
          kind: 'message-reclassified',
          occurredAt,
          messageId: message.id,
          messageKind: 'thinking',
        });
      }
      if (nextRun) {
        this.emitRunUpdated(sessionId, occurredAt, nextRun);
      }

      this.emitCompletedActivity(sessionId, workflow, message);
    }

    for (const message of session.messages) {
      if (message.pending && incomingIds.has(message.id)) {
        message.pending = false;
      }
    }

    const completedAt = nowIso();
    session.status = 'idle';
    session.lastError = undefined;
    session.currentIntent = undefined;
    session.pendingUserInput = undefined;
    session.pendingPlanReview = undefined;
    session.pendingMcpAuth = undefined;
    session.updatedAt = completedAt;
    const completedRun = this.updateSessionRun(session, requestId, (run) =>
      completeSessionRunRecord(run, completedAt));
    this.emitSessionEvent({
      sessionId,
      kind: 'status',
      occurredAt: completedAt,
      status: 'idle',
    });
    if (completedRun) {
      this.emitRunUpdated(sessionId, completedAt, completedRun);
    }
  }

  private finalizeCancelledTurn(
    session: SessionRecord,
    requestId: string,
  ): void {
    for (const message of session.messages) {
      if (message.pending) {
        message.pending = false;
      }
    }

    this.rejectPendingApprovals(session, nowIso(), 'The turn was cancelled.');

    const cancelledAt = nowIso();
    session.status = 'idle';
    session.lastError = undefined;
    session.currentIntent = undefined;
    session.pendingUserInput = undefined;
    session.pendingPlanReview = undefined;
    session.pendingMcpAuth = undefined;
    session.updatedAt = cancelledAt;
    const cancelledRun = this.updateSessionRun(session, requestId, (run) =>
      cancelSessionRunRecord(run, cancelledAt));
    this.emitSessionEvent({
      sessionId: session.id,
      kind: 'status',
      occurredAt: cancelledAt,
      status: 'idle',
    });
    if (cancelledRun) {
      this.emitRunUpdated(session.id, cancelledAt, cancelledRun);
    }
  }

  private async awaitFinalResponseApproval(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    workflow: WorkflowDefinition,
    messages: ChatMessageRecord[],
  ): Promise<void> {
    const pendingApproval = this.buildFinalResponseApproval(workflow, messages);
    if (!pendingApproval) {
      return;
    }

    let resolveDecision: ((decision: ApprovalDecision) => void) | undefined;
    const decisionPromise = new Promise<ApprovalDecision>((resolve) => {
      resolveDecision = resolve;
    });

    await this.handleApprovalRequested(
      workspace,
      sessionId,
      requestId,
      pendingApproval,
      (decision) => {
        resolveDecision?.(decision);
      },
    );

    const decision = await decisionPromise;
    if (decision === 'rejected') {
      throw new Error('Final response approval was rejected.');
    }
  }

  private buildFinalResponseApproval(
    workflow: WorkflowDefinition,
    messages: ChatMessageRecord[],
  ): PendingApprovalRecord | undefined {
    const assistantMessages = messages.filter((message) => message.role === 'assistant');
    if (assistantMessages.length === 0) {
      return undefined;
    }

    const previewMessages: PendingApprovalMessageRecord[] = assistantMessages.map((message) => ({
      id: message.id,
      authorName: message.authorName,
      content: message.content,
    }));

    for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
      const message = assistantMessages[index];
      if (!message) {
        continue;
      }

      const agentNode = resolveWorkflowAgentNodes(workflow)
        .find((candidate) =>
          candidate.config.kind === 'agent'
          && (candidate.config.id === message.authorName || candidate.config.name === message.authorName))
        ;
      const agent = agentNode?.config.kind === 'agent' ? agentNode.config : undefined;
      if (!approvalPolicyRequiresCheckpoint(workflow.settings.approvalPolicy, 'final-response', agent?.id)) {
        continue;
      }

      const agentName = agent?.name ?? message.authorName;
      return {
        id: `approval-${crypto.randomUUID()}`,
        kind: 'final-response',
        status: 'pending',
        requestedAt: nowIso(),
        agentId: agent?.id,
        agentName,
        title: agentName ? `Approve final response from ${agentName}` : 'Approve final response',
        detail: 'Review the pending assistant response before it is added to the session transcript.',
        messages: previewMessages,
      };
    }

    return undefined;
  }
}
