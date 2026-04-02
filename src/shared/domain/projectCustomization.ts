export type ProjectInstructionApplicationMode = 'always' | 'file' | 'task' | 'manual';

export interface ProjectInstructionFile {
  id: string;
  sourcePath: string;
  content: string;
  name?: string;
  description?: string;
  applyTo?: string;
  applicationMode: ProjectInstructionApplicationMode;
}

export interface ProjectAgentProfileMcpServerConfig {
  [key: string]: unknown;
}

export interface ProjectAgentProfile {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  tools?: string[];
  prompt: string;
  mcpServers?: Record<string, ProjectAgentProfileMcpServerConfig>;
  infer?: boolean;
  sourcePath: string;
  enabled: boolean;
}

export interface ProjectPromptVariable {
  name: string;
  placeholder: string;
}

export interface ProjectPromptFile {
  id: string;
  name: string;
  description?: string;
  argumentHint?: string;
  agent?: string;
  model?: string;
  tools?: string[];
  template: string;
  variables: ProjectPromptVariable[];
  sourcePath: string;
}

export interface ProjectPromptInvocation {
  id: string;
  name: string;
  sourcePath: string;
  resolvedPrompt: string;
  description?: string;
  agent?: string;
  model?: string;
  tools?: string[];
}

export interface ProjectCustomizationState {
  instructions: ProjectInstructionFile[];
  agentProfiles: ProjectAgentProfile[];
  promptFiles: ProjectPromptFile[];
  lastScannedAt?: string;
}

export function createProjectCustomizationState(): ProjectCustomizationState {
  return {
    instructions: [],
    agentProfiles: [],
    promptFiles: [],
  };
}

export function normalizeProjectCustomizationState(
  value?: Partial<ProjectCustomizationState>,
): ProjectCustomizationState {
  return {
    instructions: (value?.instructions ?? [])
      .map(normalizeProjectInstructionFile)
      .filter((instruction) => instruction.content.length > 0)
      .sort(compareProjectFiles),
    agentProfiles: (value?.agentProfiles ?? [])
      .map(normalizeProjectAgentProfile)
      .filter((profile) => profile.name.length > 0 && profile.prompt.length > 0)
      .sort(compareProjectFiles),
    promptFiles: (value?.promptFiles ?? [])
      .map(normalizeProjectPromptFile)
      .filter((promptFile) => promptFile.name.length > 0 && promptFile.template.length > 0)
      .sort(compareProjectFiles),
    lastScannedAt: normalizeOptionalString(value?.lastScannedAt),
  };
}

export function mergeProjectCustomizationState(
  current: ProjectCustomizationState | undefined,
  scanned: Omit<ProjectCustomizationState, 'lastScannedAt'>,
  lastScannedAt: string,
): ProjectCustomizationState {
  const normalizedCurrent = normalizeProjectCustomizationState(current);
  const currentProfilesById = new Map(
    normalizedCurrent.agentProfiles.map((profile) => [profile.id, profile]),
  );

  return {
    instructions: scanned.instructions
      .map(normalizeProjectInstructionFile)
      .filter((instruction) => instruction.content.length > 0)
      .sort(compareProjectFiles),
    agentProfiles: scanned.agentProfiles
      .map(normalizeProjectAgentProfile)
      .filter((profile) => profile.name.length > 0 && profile.prompt.length > 0)
      .map((profile) => ({
        ...profile,
        enabled: currentProfilesById.get(profile.id)?.enabled ?? profile.enabled,
      }))
      .sort(compareProjectFiles),
    promptFiles: scanned.promptFiles
      .map(normalizeProjectPromptFile)
      .filter((promptFile) => promptFile.name.length > 0 && promptFile.template.length > 0)
      .sort(compareProjectFiles),
    lastScannedAt,
  };
}

export function listEnabledProjectAgentProfiles(
  state?: Partial<ProjectCustomizationState>,
): ProjectAgentProfile[] {
  return normalizeProjectCustomizationState(state).agentProfiles.filter((profile) => profile.enabled);
}

export function resolveProjectInstructionsContent(
  state?: Partial<ProjectCustomizationState>,
): string | undefined {
  const instructions = normalizeProjectCustomizationState(state).instructions;
  const contentBlocks = instructions
    .filter((instruction) => instruction.applicationMode === 'always')
    .map((instruction) => instruction.content);

  const fileScopedInstructions = instructions.filter((instruction) => instruction.applicationMode === 'file');
  if (fileScopedInstructions.length > 0) {
    contentBlocks.push(
      formatProjectInstructionSection(
        'Repository file-scoped instructions:',
        'Apply each instruction only when working on files whose relative workspace path matches the listed glob.',
        fileScopedInstructions,
      ),
    );
  }

  const taskScopedInstructions = instructions.filter((instruction) => instruction.applicationMode === 'task');
  if (taskScopedInstructions.length > 0) {
    contentBlocks.push(
      formatProjectInstructionSection(
        'Repository task-scoped instructions:',
        'Apply each instruction only when the current task matches its description.',
        taskScopedInstructions,
      ),
    );
  }

  const content = contentBlocks
    .filter((value) => value.length > 0)
    .join('\n\n')
    .trim();

  return content.length > 0 ? content : undefined;
}

export function setProjectAgentProfileEnabled(
  state: ProjectCustomizationState | undefined,
  agentProfileId: string,
  enabled: boolean,
): ProjectCustomizationState {
  const normalizedState = normalizeProjectCustomizationState(state);
  return {
    ...normalizedState,
    agentProfiles: normalizedState.agentProfiles.map((profile) =>
      profile.id === agentProfileId
        ? {
            ...profile,
            enabled,
          }
        : profile),
  };
}

function normalizeProjectInstructionFile(file: ProjectInstructionFile): ProjectInstructionFile {
  const normalizedSourcePath = normalizePathLikeString(file.sourcePath);
  const normalizedName = normalizeOptionalString(file.name);
  const normalizedDescription = normalizeOptionalString(file.description);
  const normalizedApplyTo = normalizeOptionalString(file.applyTo);
  const normalizedInstruction: ProjectInstructionFile = {
    id: file.id.trim(),
    sourcePath: normalizedSourcePath,
    content: file.content.trim(),
    applicationMode: normalizeInstructionApplicationMode(
      file.applicationMode,
      normalizedSourcePath,
      normalizedApplyTo,
      normalizedDescription,
    ),
  };

  if (normalizedName) {
    normalizedInstruction.name = normalizedName;
  }

  if (normalizedDescription) {
    normalizedInstruction.description = normalizedDescription;
  }

  if (normalizedApplyTo) {
    normalizedInstruction.applyTo = normalizedApplyTo;
  }

  return normalizedInstruction;
}

function normalizeProjectAgentProfile(profile: ProjectAgentProfile): ProjectAgentProfile {
  const tools = normalizeOptionalStringArray(profile.tools);
  const normalizedProfile: ProjectAgentProfile = {
    id: profile.id.trim(),
    name: profile.name.trim(),
    prompt: profile.prompt.trim(),
    sourcePath: normalizePathLikeString(profile.sourcePath),
    enabled: profile.enabled !== false,
  };

  const displayName = normalizeOptionalString(profile.displayName);
  if (displayName) {
    normalizedProfile.displayName = displayName;
  }

  const description = normalizeOptionalString(profile.description);
  if (description) {
    normalizedProfile.description = description;
  }

  if (tools) {
    normalizedProfile.tools = tools;
  }

  const mcpServers = normalizeOptionalMcpServers(profile.mcpServers);
  if (mcpServers) {
    normalizedProfile.mcpServers = mcpServers;
  }

  if (typeof profile.infer === 'boolean') {
    normalizedProfile.infer = profile.infer;
  }

  return normalizedProfile;
}

function normalizeProjectPromptFile(promptFile: ProjectPromptFile): ProjectPromptFile {
  const normalizedPromptFile: ProjectPromptFile = {
    id: promptFile.id.trim(),
    name: promptFile.name.trim(),
    template: promptFile.template.trim(),
    variables: promptFile.variables
      .map((variable) => ({
        name: variable.name.trim(),
        placeholder: variable.placeholder.trim(),
      }))
      .filter((variable) => variable.name.length > 0),
    sourcePath: normalizePathLikeString(promptFile.sourcePath),
  };

  const description = normalizeOptionalString(promptFile.description);
  if (description) {
    normalizedPromptFile.description = description;
  }

  const argumentHint = normalizeOptionalString(promptFile.argumentHint);
  if (argumentHint) {
    normalizedPromptFile.argumentHint = argumentHint;
  }

  const agent = normalizeOptionalString(promptFile.agent);
  if (agent) {
    normalizedPromptFile.agent = agent;
  }

  const model = normalizeOptionalString(promptFile.model);
  if (model) {
    normalizedPromptFile.model = model;
  }

  const tools = normalizeOptionalStringArray(promptFile.tools);
  if (tools) {
    normalizedPromptFile.tools = tools;
  }

  return normalizedPromptFile;
}

export function normalizeProjectPromptInvocation(
  promptInvocation?: ProjectPromptInvocation,
): ProjectPromptInvocation | undefined {
  if (!promptInvocation) {
    return undefined;
  }

  const normalizedPromptInvocation: ProjectPromptInvocation = {
    id: promptInvocation.id.trim(),
    name: promptInvocation.name.trim(),
    sourcePath: normalizePathLikeString(promptInvocation.sourcePath),
    resolvedPrompt: promptInvocation.resolvedPrompt.trim(),
  };

  if (
    normalizedPromptInvocation.id.length === 0
    || normalizedPromptInvocation.name.length === 0
    || normalizedPromptInvocation.resolvedPrompt.length === 0
  ) {
    return undefined;
  }

  const description = normalizeOptionalString(promptInvocation.description);
  if (description) {
    normalizedPromptInvocation.description = description;
  }

  const agent = normalizeOptionalString(promptInvocation.agent);
  if (agent) {
    normalizedPromptInvocation.agent = agent;
  }

  const model = normalizeOptionalString(promptInvocation.model);
  if (model) {
    normalizedPromptInvocation.model = model;
  }

  const tools = normalizeOptionalStringArray(promptInvocation.tools);
  if (tools) {
    normalizedPromptInvocation.tools = tools;
  }

  return normalizedPromptInvocation;
}

function compareProjectFiles(
  left: Pick<ProjectInstructionFile | ProjectAgentProfile | ProjectPromptFile, 'sourcePath' | 'id'>,
  right: Pick<ProjectInstructionFile | ProjectAgentProfile | ProjectPromptFile, 'sourcePath' | 'id'>,
): number {
  return left.sourcePath.localeCompare(right.sourcePath) || left.id.localeCompare(right.id);
}

function formatProjectInstructionSection(
  title: string,
  guidance: string,
  instructions: ReadonlyArray<ProjectInstructionFile>,
): string {
  return [`${title}\n${guidance}`, ...instructions.map(formatProjectInstructionEntry)]
    .filter((block) => block.length > 0)
    .join('\n\n')
    .trim();
}

function formatProjectInstructionEntry(instruction: ProjectInstructionFile): string {
  const lines = [`Source: ${instruction.sourcePath}`];

  if (instruction.name) {
    lines.push(`Name: ${instruction.name}`);
  }

  if (instruction.description) {
    lines.push(`Description: ${instruction.description}`);
  }

  if (instruction.applyTo) {
    lines.push(`ApplyTo: ${instruction.applyTo}`);
  }

  lines.push('Instructions:');
  lines.push(instruction.content);

  return lines.join('\n');
}

function normalizeOptionalMcpServers(
  value?: Record<string, ProjectAgentProfileMcpServerConfig>,
): Record<string, ProjectAgentProfileMcpServerConfig> | undefined {
  if (!value) {
    return undefined;
  }

  const normalizedEntries = Object.entries(value)
    .map(([name, config]) => [name.trim(), normalizeYamlValue(config)] as const)
    .filter(([name, config]) => name.length > 0 && isPlainObject(config))
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName));

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    normalizedEntries.map(([name, config]) => [name, config as ProjectAgentProfileMcpServerConfig]),
  );
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeInstructionApplicationMode(
  value: ProjectInstructionApplicationMode | undefined,
  sourcePath: string,
  applyTo?: string,
  description?: string,
): ProjectInstructionApplicationMode {
  if (value === 'always' || value === 'file' || value === 'task' || value === 'manual') {
    return value;
  }

  return inferInstructionApplicationMode(sourcePath, applyTo, description);
}

function normalizeOptionalStringArray(values?: ReadonlyArray<string>): string[] | undefined {
  if (!values) {
    return undefined;
  }

  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalizePathLikeString(value: string): string {
  return value.trim().replaceAll('/', '\\');
}

function inferInstructionApplicationMode(
  sourcePath: string,
  applyTo?: string,
  description?: string,
): ProjectInstructionApplicationMode {
  if (isAlwaysOnInstructionSource(sourcePath) || isMatchAllInstructionGlob(applyTo)) {
    return 'always';
  }

  if (applyTo) {
    return 'file';
  }

  if (description) {
    return 'task';
  }

  return 'manual';
}

function isAlwaysOnInstructionSource(sourcePath: string): boolean {
  const normalizedSourcePath = normalizePathLikeString(sourcePath).toLowerCase();
  return normalizedSourcePath === '.github\\copilot-instructions.md'
    || normalizedSourcePath === 'agents.md'
    || normalizedSourcePath === 'claude.md'
    || normalizedSourcePath === '.claude\\claude.md';
}

function isMatchAllInstructionGlob(value?: string): boolean {
  if (!value) {
    return false;
  }

  const normalizedValue = value.trim().replaceAll('\\', '/');
  return normalizedValue === '**' || normalizedValue === '**/*';
}

function normalizeYamlValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeYamlValue);
  }

  if (!isPlainObject(value)) {
    return typeof value === 'string' ? value.trim() : value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, nestedValue]) => [key.trim(), normalizeYamlValue(nestedValue)] as const)
      .filter(([key]) => key.length > 0)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
