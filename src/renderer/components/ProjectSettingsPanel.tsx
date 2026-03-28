import { useCallback, useState } from 'react';
import { ChevronLeft, FileCode2, FileText, FolderOpen, GitBranch, RefreshCw, Server, Sparkles, Trash2, AlertTriangle, Circle } from 'lucide-react';

import { ToggleSwitch } from '@renderer/components/ui';
import type { ProjectRecord, ProjectGitContext } from '@shared/domain/project';
import type { DiscoveredMcpServer } from '@shared/domain/discoveredTooling';
import { listAcceptedDiscoveredMcpServers, listPendingDiscoveredMcpServers } from '@shared/domain/discoveredTooling';
import type { ProjectAgentProfile, ProjectCustomizationState, ProjectInstructionFile, ProjectPromptFile } from '@shared/domain/projectCustomization';

interface ProjectSettingsPanelProps {
  project: ProjectRecord;
  onClose: () => void;
  onRescanConfigs: () => void;
  onRescanCustomization: () => void;
  onResolveDiscoveredTooling: (serverIds: string[], resolution: 'accept' | 'dismiss') => void;
  onSetAgentProfileEnabled: (agentProfileId: string, enabled: boolean) => void;
  onRemoveProject: () => void;
}

export function ProjectSettingsPanel({
  project,
  onClose,
  onRescanConfigs,
  onRescanCustomization,
  onResolveDiscoveredTooling,
  onSetAgentProfileEnabled,
  onRemoveProject,
}: ProjectSettingsPanelProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const acceptedServers = listAcceptedDiscoveredMcpServers(project.discoveredTooling);
  const pendingServers = listPendingDiscoveredMcpServers(project.discoveredTooling);
  const hasDiscoveredServers = acceptedServers.length + pendingServers.length > 0;
  const customization = project.customization;
  const hasCustomization =
    (customization?.instructions?.length ?? 0) > 0 ||
    (customization?.agentProfiles?.length ?? 0) > 0 ||
    (customization?.promptFiles?.length ?? 0) > 0;

  const handleRemove = useCallback(() => {
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }
    onRemoveProject();
  }, [confirmingRemove, onRemoveProject]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface-0)]">
      {/* Header */}
      <div className="drag-region flex items-center gap-3 border-b border-[var(--color-border)] px-5 pb-3 pt-3">
        <button
          className="no-drag flex size-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onClose}
          type="button"
        >
          <ChevronLeft className="size-4" />
        </button>
        <h2 className="text-[13px] font-semibold text-zinc-100">Project Settings</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-6 space-y-8">
          {/* Project info */}
          <ProjectInfoSection project={project} />

          {/* Discovered MCP Servers */}
          {hasDiscoveredServers ? (
            <DiscoveredServersSection
              accepted={acceptedServers}
              onRescan={onRescanConfigs}
              onResolve={onResolveDiscoveredTooling}
              pending={pendingServers}
            />
          ) : (
            <div>
              <SectionHeader
                description="MCP servers discovered from project config files (.vscode/mcp.json, .mcp.json, .copilot/mcp.json)."
                title="Discovered MCP Servers"
              >
                <button
                  className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[13px] font-medium text-zinc-200 transition hover:bg-zinc-700"
                  onClick={onRescanConfigs}
                  title="Scan project config files for MCP servers"
                  type="button"
                >
                  <RefreshCw className="size-3.5" />
                  Scan
                </button>
              </SectionHeader>
              <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-5 py-8 text-center text-[12px] leading-relaxed text-zinc-500">
                No MCP servers discovered in this project yet. Click Scan to check project config files.
              </div>
            </div>
          )}

          {/* Copilot Customization */}
          {hasCustomization ? (
            <CustomizationSection
              customization={customization!}
              onRescan={onRescanCustomization}
              onSetAgentProfileEnabled={onSetAgentProfileEnabled}
            />
          ) : (
            <div>
              <SectionHeader
                description="Instructions, custom agents, and prompt files discovered from .github/ and AGENTS.md."
                title="Copilot Customization"
              >
                <button
                  className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[13px] font-medium text-zinc-200 transition hover:bg-zinc-700"
                  onClick={onRescanCustomization}
                  title="Scan for Copilot customization files"
                  type="button"
                >
                  <RefreshCw className="size-3.5" />
                  Scan
                </button>
              </SectionHeader>
              <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-5 py-8 text-center text-[12px] leading-relaxed text-zinc-500">
                No customization files found. Add <code className="text-zinc-400">.github/copilot-instructions.md</code>, <code className="text-zinc-400">AGENTS.md</code>, or files
                in <code className="text-zinc-400">.github/agents/</code> and <code className="text-zinc-400">.github/prompts/</code> to customize Copilot behavior.
              </div>
            </div>
          )}

          {/* Remove project */}
          <div className="border-t border-zinc-800 pt-6">
            <h3 className="text-[13px] font-semibold text-zinc-200">Danger zone</h3>
            <p className="mt-1 text-[12px] text-zinc-500">
              Removing a project deletes all its sessions and discovered tooling from Aryx.
              Your project files on disk are not affected.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                  confirmingRemove
                    ? 'bg-red-600 text-white hover:bg-red-500'
                    : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                }`}
                onClick={handleRemove}
                type="button"
              >
                <Trash2 className="size-3.5" />
                {confirmingRemove ? 'Confirm removal' : 'Remove project'}
              </button>
              {confirmingRemove && (
                <button
                  className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
                  onClick={() => setConfirmingRemove(false)}
                  type="button"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Project info ─────────────────────────────────────────── */

function ProjectInfoSection({ project }: { project: ProjectRecord }) {
  return (
    <div>
      <SectionHeader
        description="Project details and git status."
        title="Project Info"
      />
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4 space-y-3">
        <div className="flex items-center gap-3">
          <FolderOpen className="size-5 shrink-0 text-indigo-400" />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-zinc-200">{project.name}</div>
            <div className="mt-0.5 truncate text-[12px] text-zinc-500">{project.path}</div>
          </div>
        </div>
        {project.git && <ProjectGitInfo git={project.git} />}
      </div>
    </div>
  );
}

function ProjectGitInfo({ git }: { git: ProjectGitContext }) {
  if (git.status === 'not-repository') {
    return (
      <div className="flex items-center gap-2 text-[12px] text-zinc-600">
        <GitBranch className="size-3.5" />
        Not a git repository
      </div>
    );
  }

  if (git.status === 'git-missing') {
    return (
      <div className="flex items-center gap-2 text-[12px] text-amber-500/70">
        <AlertTriangle className="size-3.5" />
        Git is not installed
      </div>
    );
  }

  if (git.status === 'error') {
    return (
      <div className="flex items-center gap-2 text-[12px] text-red-400/70">
        <AlertTriangle className="size-3.5" />
        {git.errorMessage ?? 'Git error'}
      </div>
    );
  }

  const branchLabel = git.branch ?? git.head?.shortHash ?? 'HEAD';
  const parts: string[] = [];
  if (git.isDirty && git.changedFileCount) parts.push(`${git.changedFileCount} changed`);
  if (git.ahead) parts.push(`${git.ahead} ahead`);
  if (git.behind) parts.push(`${git.behind} behind`);

  return (
    <div className="flex items-center gap-2 text-[12px] text-zinc-400">
      <GitBranch className="size-3.5 shrink-0" />
      <span>{branchLabel}</span>
      {git.isDirty && <Circle className="size-1.5 shrink-0 fill-amber-500 text-amber-500" />}
      {parts.length > 0 && (
        <span className="text-zinc-600">· {parts.join(' · ')}</span>
      )}
    </div>
  );
}

/* ── Discovered MCP servers ──────────────────────────────── */

function DiscoveredServersSection({
  accepted,
  pending,
  onRescan,
  onResolve,
}: {
  accepted: DiscoveredMcpServer[];
  pending: DiscoveredMcpServer[];
  onRescan: () => void;
  onResolve: (serverIds: string[], resolution: 'accept' | 'dismiss') => void;
}) {
  return (
    <div>
      <SectionHeader
        description="MCP servers discovered from project config files (.vscode/mcp.json, .mcp.json, .copilot/mcp.json)."
        title="Discovered MCP Servers"
      >
        <button
          className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[13px] font-medium text-zinc-200 transition hover:bg-zinc-700"
          onClick={onRescan}
          title="Re-scan project config files"
          type="button"
        >
          <RefreshCw className="size-3.5" />
          Re-scan
        </button>
      </SectionHeader>

      <div className="space-y-1">
        {accepted.map((server) => (
          <DiscoveredServerRow
            key={server.id}
            onDismiss={() => onResolve([server.id], 'dismiss')}
            server={server}
            status="accepted"
          />
        ))}
        {pending.map((server) => (
          <DiscoveredServerRow
            key={server.id}
            onAccept={() => onResolve([server.id], 'accept')}
            onDismiss={() => onResolve([server.id], 'dismiss')}
            server={server}
            status="pending"
          />
        ))}
      </div>

      {pending.length > 1 && (
        <div className="mt-3 flex items-center gap-2">
          <button
            className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-[12px] font-medium text-emerald-400 transition hover:bg-emerald-500/20"
            onClick={() => onResolve(pending.map((s) => s.id), 'accept')}
            type="button"
          >
            Accept all ({pending.length})
          </button>
          <button
            className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
            onClick={() => onResolve(pending.map((s) => s.id), 'dismiss')}
            type="button"
          >
            Dismiss all
          </button>
        </div>
      )}
    </div>
  );
}

function DiscoveredServerRow({
  server,
  status,
  onAccept,
  onDismiss,
}: {
  server: DiscoveredMcpServer;
  status: 'accepted' | 'pending';
  onAccept?: () => void;
  onDismiss?: () => void;
}) {
  const detail =
    server.transport === 'local'
      ? server.command || 'No command'
      : server.url || 'No URL';

  const statusBadge = status === 'accepted'
    ? 'bg-emerald-500/10 text-emerald-400'
    : 'bg-amber-500/10 text-amber-400';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-transparent px-4 py-3 hover:border-zinc-800 hover:bg-zinc-900">
      <Server className="size-4 shrink-0 text-zinc-600" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-zinc-200">{server.name}</span>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            {server.transport}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadge}`}>
            {status}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-zinc-500">
          {detail}
          <span className="ml-2 text-zinc-700">· {server.sourceLabel}</span>
        </p>
      </div>
      <div className="flex items-center gap-1">
        {onAccept && (
          <button
            className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-emerald-400 transition hover:bg-emerald-500/10"
            onClick={onAccept}
            type="button"
          >
            Accept
          </button>
        )}
        {onDismiss && (
          <button
            className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
            onClick={onDismiss}
            type="button"
          >
            {status === 'accepted' ? 'Remove' : 'Dismiss'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Copilot Customization ────────────────────────────────── */

function CustomizationSection({
  customization,
  onRescan,
  onSetAgentProfileEnabled,
}: {
  customization: ProjectCustomizationState;
  onRescan: () => void;
  onSetAgentProfileEnabled: (agentProfileId: string, enabled: boolean) => void;
}) {
  return (
    <div>
      <SectionHeader
        description="Instructions, custom agents, and prompt files discovered from .github/ and AGENTS.md."
        title="Copilot Customization"
      >
        <button
          className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[13px] font-medium text-zinc-200 transition hover:bg-zinc-700"
          onClick={onRescan}
          title="Re-scan for Copilot customization files"
          type="button"
        >
          <RefreshCw className="size-3.5" />
          Re-scan
        </button>
      </SectionHeader>

      <div className="space-y-4">
        {customization.instructions.length > 0 && (
          <CustomizationInstructionsList instructions={customization.instructions} />
        )}
        {customization.agentProfiles.length > 0 && (
          <CustomizationAgentsList
            agents={customization.agentProfiles}
            onSetEnabled={onSetAgentProfileEnabled}
          />
        )}
        {customization.promptFiles.length > 0 && (
          <CustomizationPromptsList promptFiles={customization.promptFiles} />
        )}
      </div>
    </div>
  );
}

function CustomizationInstructionsList({ instructions }: { instructions: ProjectInstructionFile[] }) {
  return (
    <div>
      <h4 className="mb-2 text-[12px] font-medium text-zinc-400">Instructions</h4>
      <div className="space-y-1">
        {instructions.map((instruction) => (
          <div
            key={instruction.id}
            className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <FileCode2 className="size-3.5 shrink-0 text-indigo-400" />
              <span className="text-[12px] font-medium text-zinc-200">{instruction.sourcePath}</span>
            </div>
            <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-zinc-500">
              {instruction.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomizationAgentsList({
  agents,
  onSetEnabled,
}: {
  agents: ProjectAgentProfile[];
  onSetEnabled: (agentProfileId: string, enabled: boolean) => void;
}) {
  return (
    <div>
      <h4 className="mb-2 text-[12px] font-medium text-zinc-400">Custom Agents</h4>
      <div className="space-y-1">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center gap-3 rounded-xl border border-transparent px-4 py-3 hover:border-zinc-800 hover:bg-zinc-900"
          >
            <Sparkles className="size-4 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium text-zinc-200">
                  {agent.displayName ?? agent.name}
                </span>
                {agent.tools && agent.tools.length > 0 && (
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                    {agent.tools.length} tool{agent.tools.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              {agent.description && (
                <p className="mt-0.5 truncate text-[12px] text-zinc-500">{agent.description}</p>
              )}
              <p className="mt-0.5 truncate text-[11px] text-zinc-600">{agent.sourcePath}</p>
            </div>
            <button
              aria-label={agent.enabled ? `Disable ${agent.name}` : `Enable ${agent.name}`}
              aria-pressed={agent.enabled}
              className="shrink-0"
              onClick={() => onSetEnabled(agent.id, !agent.enabled)}
              type="button"
            >
              <ToggleSwitch enabled={agent.enabled} size="sm" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomizationPromptsList({ promptFiles }: { promptFiles: ProjectPromptFile[] }) {
  return (
    <div>
      <h4 className="mb-2 text-[12px] font-medium text-zinc-400">Prompt Files</h4>
      <div className="space-y-1">
        {promptFiles.map((prompt) => (
          <div
            key={prompt.id}
            className="rounded-xl border border-transparent px-4 py-3 hover:border-zinc-800 hover:bg-zinc-900"
          >
            <div className="flex items-center gap-2">
              <FileText className="size-3.5 shrink-0 text-emerald-400" />
              <span className="text-[13px] font-medium text-zinc-200">{prompt.name}</span>
              {prompt.variables.length > 0 && (
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                  {prompt.variables.length} variable{prompt.variables.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {prompt.description && (
              <p className="mt-0.5 text-[12px] text-zinc-500">{prompt.description}</p>
            )}
            <p className="mt-0.5 truncate text-[11px] text-zinc-600">{prompt.sourcePath}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Shared helpers ──────────────────────────────────────── */

function SectionHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h3 className="text-[13px] font-semibold text-zinc-200">{title}</h3>
        <p className="mt-0.5 text-[12px] text-zinc-500">{description}</p>
      </div>
      {children}
    </div>
  );
}
