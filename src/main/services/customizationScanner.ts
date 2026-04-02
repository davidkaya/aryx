import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import { parse as parseYaml } from 'yaml';

import {
  mergeProjectCustomizationState,
  normalizeProjectCustomizationState,
  type ProjectAgentProfile,
  type ProjectInstructionApplicationMode,
  type ProjectCustomizationState,
  type ProjectInstructionFile,
  type ProjectPromptFile,
  type ProjectPromptVariable,
} from '@shared/domain/projectCustomization';
import { nowIso } from '@shared/utils/ids';

const promptVariablePattern = /\$\{input:([a-zA-Z0-9_-]+):([^}]+)\}/g;

export class ProjectCustomizationScanner {
  async scanProject(
    projectPath: string,
    current?: ProjectCustomizationState,
  ): Promise<ProjectCustomizationState> {
    const previous = normalizeProjectCustomizationState(current);
    const instructions = await this.scanInstructionFiles(projectPath, previous);
    const agentProfiles = await this.scanAgentProfiles(projectPath, previous);
    const promptFiles = await this.scanPromptFiles(projectPath, previous);

    return mergeProjectCustomizationState(
      previous,
      {
        instructions,
        agentProfiles,
        promptFiles,
      },
      nowIso(),
    );
  }

  private async scanInstructionFiles(
    projectPath: string,
    previous: ProjectCustomizationState,
  ): Promise<ProjectInstructionFile[]> {
    const previousByPath = new Map(previous.instructions.map((instruction) => [instruction.sourcePath, instruction]));
    const sourcePaths = [
      '.github\\copilot-instructions.md',
      'AGENTS.md',
      'CLAUDE.md',
      '.claude\\CLAUDE.md',
    ] as const;
    const instructions: ProjectInstructionFile[] = [];

    for (const sourcePath of sourcePaths) {
      const filePath = join(projectPath, ...sourcePath.split('\\'));
      const instruction = await this.scanInstructionFile(filePath, sourcePath, previousByPath, 'always');
      if (instruction) {
        instructions.push(instruction);
      }
    }

    const instructionFilePaths = await this.listProjectFiles(join(projectPath, '.github', 'instructions'), '.instructions.md');
    for (const filePath of instructionFilePaths) {
      const sourcePath = toProjectSourcePath(projectPath, filePath);
      const instruction = await this.scanInstructionFile(filePath, sourcePath, previousByPath);
      if (instruction) {
        instructions.push(instruction);
      }
    }

    return instructions;
  }

  private async scanAgentProfiles(
    projectPath: string,
    previous: ProjectCustomizationState,
  ): Promise<ProjectAgentProfile[]> {
    const previousByPath = new Map(previous.agentProfiles.map((profile) => [profile.sourcePath, profile]));
    const filePaths = await this.listProjectFiles(join(projectPath, '.github', 'agents'), '.agent.md');
    const profiles: ProjectAgentProfile[] = [];

    for (const filePath of filePaths) {
      const sourcePath = toProjectSourcePath(projectPath, filePath);
      const contents = await this.readProjectFile(filePath);
      if (contents.kind === 'retain-previous') {
        const existing = previousByPath.get(sourcePath);
        if (existing) {
          profiles.push(existing);
        }
        continue;
      }

      if (contents.kind === 'missing') {
        continue;
      }

      const parsedFile = parseProjectFrontmatter(contents.value, sourcePath);
      if (!parsedFile) {
        const existing = previousByPath.get(sourcePath);
        if (existing) {
          profiles.push(existing);
        }
        continue;
      }

      const name = readOptionalString(parsedFile.attributes, ['name'])
        ?? basename(filePath, '.agent.md');
      const prompt = parsedFile.body.trim();
      if (!name || !prompt) {
        continue;
      }

      profiles.push({
        id: buildProjectCustomizationItemId('agent', sourcePath),
        name,
        displayName: readOptionalString(parsedFile.attributes, ['displayName', 'display-name']),
        description: readOptionalString(parsedFile.attributes, ['description']),
        tools: readOptionalStringArray(parsedFile.attributes.tools),
        prompt,
        mcpServers: readOptionalNamedObjectMap(parsedFile.attributes['mcp-servers']),
        infer: typeof parsedFile.attributes.infer === 'boolean' ? parsedFile.attributes.infer : undefined,
        sourcePath,
        enabled: previousByPath.get(sourcePath)?.enabled ?? true,
      });
    }

    return profiles;
  }

  private async scanPromptFiles(
    projectPath: string,
    previous: ProjectCustomizationState,
  ): Promise<ProjectPromptFile[]> {
    const previousByPath = new Map(previous.promptFiles.map((promptFile) => [promptFile.sourcePath, promptFile]));
    const filePaths = await this.listProjectFiles(join(projectPath, '.github', 'prompts'), '.prompt.md');
    const promptFiles: ProjectPromptFile[] = [];

    for (const filePath of filePaths) {
      const sourcePath = toProjectSourcePath(projectPath, filePath);
      const contents = await this.readProjectFile(filePath);
      if (contents.kind === 'retain-previous') {
        const existing = previousByPath.get(sourcePath);
        if (existing) {
          promptFiles.push(existing);
        }
        continue;
      }

      if (contents.kind === 'missing') {
        continue;
      }

      const parsedFile = parseProjectFrontmatter(contents.value, sourcePath);
      if (!parsedFile) {
        const existing = previousByPath.get(sourcePath);
        if (existing) {
          promptFiles.push(existing);
        }
        continue;
      }

      const template = parsedFile.body.trim();
      if (!template) {
        continue;
      }

      promptFiles.push({
        id: buildProjectCustomizationItemId('prompt', sourcePath),
        name: readOptionalString(parsedFile.attributes, ['name']) ?? basename(filePath, '.prompt.md'),
        description: readOptionalString(parsedFile.attributes, ['description']),
        agent: readOptionalString(parsedFile.attributes, ['agent']),
        template,
        variables: extractPromptVariables(template),
        sourcePath,
      });
    }

    return promptFiles;
  }

  private async listProjectFiles(directoryPath: string, suffix: string): Promise<string[]> {
    const filePaths: string[] = [];
    await this.collectProjectFiles(directoryPath, suffix, filePaths);
    return filePaths.sort((left, right) => left.localeCompare(right));
  }

  private async collectProjectFiles(directoryPath: string, suffix: string, filePaths: string[]): Promise<void> {
    try {
      const entries = await readdir(directoryPath, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const entryPath = join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          await this.collectProjectFiles(entryPath, suffix, filePaths);
          continue;
        }

        if (entry.isFile() && entry.name.toLowerCase().endsWith(suffix)) {
          filePaths.push(entryPath);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }

      console.warn(`[aryx customization] Failed to read directory ${directoryPath}:`, error);
    }
  }

  private async readProjectFile(filePath: string): Promise<
    | { kind: 'success'; value: string }
    | { kind: 'missing' }
    | { kind: 'retain-previous' }
  > {
    try {
      return {
        kind: 'success',
        value: await readFile(filePath, 'utf8'),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { kind: 'missing' };
      }

      console.warn(`[aryx customization] Failed to read ${filePath}:`, error);
      return { kind: 'retain-previous' };
    }
  }

  private async scanInstructionFile(
    filePath: string,
    sourcePath: string,
    previousByPath: ReadonlyMap<string, ProjectInstructionFile>,
    applicationMode?: ProjectInstructionApplicationMode,
  ): Promise<ProjectInstructionFile | undefined> {
    const contents = await this.readProjectFile(filePath);
    if (contents.kind === 'missing') {
      return undefined;
    }

    if (contents.kind === 'retain-previous') {
      return previousByPath.get(sourcePath);
    }

    const parsedFile = parseProjectFrontmatter(contents.value, sourcePath);
    if (!parsedFile) {
      return previousByPath.get(sourcePath);
    }

    const content = parsedFile.body.trim();
    if (!content) {
      return undefined;
    }

    const description = readOptionalString(parsedFile.attributes, ['description']);
    const applyTo = readOptionalString(parsedFile.attributes, ['applyTo']);
    const instruction: ProjectInstructionFile = {
      id: buildProjectCustomizationItemId('instruction', sourcePath),
      sourcePath,
      content,
      applicationMode: applicationMode ?? resolveInstructionApplicationMode(applyTo, description),
    };

    const name = readOptionalString(parsedFile.attributes, ['name']);
    if (name) {
      instruction.name = name;
    }

    if (description) {
      instruction.description = description;
    }

    if (applyTo) {
      instruction.applyTo = applyTo;
    }

    return instruction;
  }
}

function parseProjectFrontmatter(
  contents: string,
  sourcePath: string,
): { attributes: Record<string, unknown>; body: string } | undefined {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(contents);
  if (!match) {
    return {
      attributes: {},
      body: contents,
    };
  }

  try {
    const parsed = parseYaml(match[1]);
    if (!isPlainObject(parsed) && parsed !== null && parsed !== undefined) {
      console.warn(`[aryx customization] Ignoring non-object frontmatter in ${sourcePath}.`);
      return undefined;
    }

    return {
      attributes: isPlainObject(parsed) ? parsed : {},
      body: match[2],
    };
  } catch (error) {
    console.warn(`[aryx customization] Failed to parse frontmatter in ${sourcePath}:`, error);
    return undefined;
  }
}

function extractPromptVariables(template: string): ProjectPromptVariable[] {
  const variables: ProjectPromptVariable[] = [];
  const seenNames = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = promptVariablePattern.exec(template))) {
    const name = match[1]?.trim();
    if (!name || seenNames.has(name)) {
      continue;
    }

    seenNames.add(name);
    variables.push({
      name,
      placeholder: match[2]?.trim() ?? '',
    });
  }

  promptVariablePattern.lastIndex = 0;
  return variables;
}

function buildProjectCustomizationItemId(kind: 'instruction' | 'agent' | 'prompt', sourcePath: string): string {
  return `project_customization_${kind}_${normalizeIdentifierSegment(sourcePath)}`;
}

function toProjectSourcePath(projectPath: string, filePath: string): string {
  const relativePath = relative(projectPath, filePath).trim();
  return relativePath ? relativePath.replaceAll('/', '\\') : basename(filePath);
}

function normalizeIdentifierSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized.length > 0 ? normalized : 'item';
}

function readOptionalString(
  record: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

function resolveInstructionApplicationMode(
  applyTo: string | undefined,
  description: string | undefined,
): ProjectInstructionApplicationMode {
  if (isMatchAllInstructionGlob(applyTo)) {
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

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0))];
}

function readOptionalNamedObjectMap(
  value: unknown,
): Record<string, Record<string, unknown>> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .map(([name, config]) => [name.trim(), normalizeYamlValue(config)] as const)
    .filter(([name, config]) => name.length > 0 && isPlainObject(config))
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName));

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries.map(([name, config]) => [name, config as Record<string, unknown>]));
}

function normalizeYamlValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeYamlValue(entry));
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

function isMatchAllInstructionGlob(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalizedValue = value.trim().replaceAll('\\', '/');
  return normalizedValue === '**' || normalizedValue === '**/*';
}
