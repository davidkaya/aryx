export interface ProjectInstructionFile {
  id: string;
  sourcePath: string;
  content: string;
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
  agent?: string;
  template: string;
  variables: ProjectPromptVariable[];
  sourcePath: string;
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
  const content = normalizeProjectCustomizationState(state).instructions
    .map((instruction) => instruction.content)
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
  return {
    id: file.id.trim(),
    sourcePath: normalizePathLikeString(file.sourcePath),
    content: file.content.trim(),
  };
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

  const agent = normalizeOptionalString(promptFile.agent);
  if (agent) {
    normalizedPromptFile.agent = agent;
  }

  return normalizedPromptFile;
}

function compareProjectFiles(
  left: Pick<ProjectInstructionFile | ProjectAgentProfile | ProjectPromptFile, 'sourcePath' | 'id'>,
  right: Pick<ProjectInstructionFile | ProjectAgentProfile | ProjectPromptFile, 'sourcePath' | 'id'>,
): number {
  return left.sourcePath.localeCompare(right.sourcePath) || left.id.localeCompare(right.id);
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

function normalizeOptionalStringArray(values?: ReadonlyArray<string>): string[] | undefined {
  if (!values) {
    return undefined;
  }

  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalizePathLikeString(value: string): string {
  return value.trim().replaceAll('/', '\\');
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
