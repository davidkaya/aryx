import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, FileCode2, FileText, FolderOpen, GitBranch, RefreshCw, Server, Sparkles, Trash2, AlertTriangle, Circle } from 'lucide-react';

import { ToggleSwitch } from '@renderer/components/ui';
import type { ProjectRecord, ProjectGitContext } from '@shared/domain/project';
import type { DiscoveredMcpServer } from '@shared/domain/discoveredTooling';
import { listAcceptedDiscoveredMcpServers, listPendingDiscoveredMcpServers } from '@shared/domain/discoveredTooling';
import type { ProjectAgentProfile, ProjectInstructionFile, ProjectPromptFile } from '@shared/domain/projectCustomization';

/* ── Types ────────────────────────────────────────────────── */

type ProjectSettingsSection = 'overview' | 'instructions' | 'agents' | 'prompts' | 'mcp-servers' | 'danger-zone';

interface NavItem {
  id: ProjectSettingsSection;
  label: string;
  icon: ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface ProjectSettingsPanelProps {
  project: ProjectRecord;
  onClose: () => void;
  onRescanConfigs: () => void;
  onRescanCustomization: () => void;
  onResolveDiscoveredTooling: (serverIds: string[], resolution: 'accept' | 'dismiss') => void;
  onSetAgentProfileEnabled: (agentProfileId: string, enabled: boolean) => void;
  onRemoveProject: () => void;
}

/* ── Main component ───────────────────────────────────────── */

export function ProjectSettingsPanel({
  project,
  onClose,
  onRescanConfigs,
  onRescanCustomization,
  onResolveDiscoveredTooling,
  onSetAgentProfileEnabled,
  onRemoveProject,
}: ProjectSettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<ProjectSettingsSection>('overview');
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const acceptedServers = useMemo(() => listAcceptedDiscoveredMcpServers(project.discoveredTooling), [project.discoveredTooling]);
  const pendingServers = useMemo(() => listPendingDiscoveredMcpServers(project.discoveredTooling), [project.discoveredTooling]);
  const instructions = project.customization?.instructions ?? [];
  const agentProfiles = project.customization?.agentProfiles ?? [];
  const promptFiles = project.customization?.promptFiles ?? [];
  const enabledAgentCount = agentProfiles.filter((a) => a.enabled).length;

  const handleRemove = useCallback(() => {
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }
    onRemoveProject();
  }, [confirmingRemove, onRemoveProject]);

  const navGroups: NavGroup[] = [
    {
      label: 'Project',
      items: [
        { id: 'overview', label: 'Overview', icon: <FolderOpen className="size-3.5" /> },
      ],
    },
    {
      label: 'Copilot',
      items: [
        { id: 'instructions', label: 'Instructions', icon: <FileCode2 className="size-3.5" /> },
        { id: 'agents', label: 'Custom Agents', icon: <Sparkles className="size-3.5" /> },
        { id: 'prompts', label: 'Prompt Files', icon: <FileText className="size-3.5" /> },
      ],
    },
    {
      label: 'Tooling',
      items: [
        { id: 'mcp-servers', label: 'MCP Servers', icon: <Server className="size-3.5" /> },
      ],
    },
  ];

  function sectionBadge(section: ProjectSettingsSection): ReactNode {
    switch (section) {
      case 'instructions':
        return instructions.length > 0
          ? <CountBadge count={instructions.length} />
          : null;
      case 'agents':
        return agentProfiles.length > 0
          ? <CountBadge count={enabledAgentCount} total={agentProfiles.length} />
          : null;
      case 'prompts':
        return promptFiles.length > 0
          ? <CountBadge count={promptFiles.length} />
          : null;
      case 'mcp-servers': {
        if (pendingServers.length > 0) {
          return <PendingBadge count={pendingServers.length} />;
        }
        const totalServers = acceptedServers.length + pendingServers.length;
        return totalServers > 0 ? <CountBadge count={totalServers} /> : null;
      }
      default:
        return null;
    }
  }

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
        <h2 className="text-[13px] font-semibold text-zinc-100">
          Project Settings
          <span className="ml-2 font-normal text-zinc-500">·</span>
          <span className="ml-2 font-normal text-zinc-400">{project.name}</span>
        </h2>
      </div>

      {/* Sidebar + Content */}
      <div className="flex min-h-0 flex-1">
        {/* Navigation sidebar */}
        <nav className="w-52 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
          <div className="space-y-4">
            {navGroups.map((group) => (
              <div key={group.label}>
                <span className="mb-1 block px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                  {group.label}
                </span>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = item.id === activeSection;
                    const badge = sectionBadge(item.id);
                    return (
                      <button
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition ${
                          isActive
                            ? 'bg-zinc-800 font-medium text-zinc-100'
                            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
                        }`}
                        key={item.id}
                        onClick={() => {
                          setActiveSection(item.id);
                          setConfirmingRemove(false);
                        }}
                        type="button"
                      >
                        <span className={isActive ? 'text-zinc-300' : 'text-zinc-500'}>{item.icon}</span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {badge}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Danger zone at the bottom */}
            <div className="border-t border-zinc-800 pt-3">
              <div className="space-y-0.5">
                <button
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition ${
                    activeSection === 'danger-zone'
                      ? 'bg-zinc-800 font-medium text-red-400'
                      : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-red-400'
                  }`}
                  onClick={() => {
                    setActiveSection('danger-zone');
                    setConfirmingRemove(false);
                  }}
                  type="button"
                >
                  <Trash2 className="size-3.5" />
                  <span className="flex-1 truncate">Danger Zone</span>
                </button>
              </div>
            </div>
          </div>
        </nav>

        {/* Content panel */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-6">
            {activeSection === 'overview' && (
              <OverviewContent project={project} />
            )}
            {activeSection === 'instructions' && (
              <InstructionsContent
                instructions={instructions}
                onRescan={onRescanCustomization}
              />
            )}
            {activeSection === 'agents' && (
              <AgentsContent
                agents={agentProfiles}
                onRescan={onRescanCustomization}
                onSetEnabled={onSetAgentProfileEnabled}
              />
            )}
            {activeSection === 'prompts' && (
              <PromptsContent
                onRescan={onRescanCustomization}
                promptFiles={promptFiles}
              />
            )}
            {activeSection === 'mcp-servers' && (
              <McpServersContent
                accepted={acceptedServers}
                onRescan={onRescanConfigs}
                onResolve={onResolveDiscoveredTooling}
                pending={pendingServers}
              />
            )}
            {activeSection === 'danger-zone' && (
              <DangerZoneContent
                confirmingRemove={confirmingRemove}
                onCancelRemove={() => setConfirmingRemove(false)}
                onRemove={handleRemove}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Nav badges ───────────────────────────────────────────── */

function CountBadge({ count, total }: { count: number; total?: number }) {
  return (
    <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
      {total !== undefined ? `${count}/${total}` : count}
    </span>
  );
}

function PendingBadge({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
      {count} new
    </span>
  );
}

/* ── Overview ─────────────────────────────────────────────── */

function OverviewContent({ project }: { project: ProjectRecord }) {
  return (
    <div>
      <SectionHeader
        description="Project details and git status."
        title="Overview"
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

/* ── Instructions ─────────────────────────────────────────── */

function InstructionsContent({
  instructions,
  onRescan,
}: {
  instructions: ProjectInstructionFile[];
  onRescan: () => void;
}) {
  return (
    <div>
      <SectionHeader
        description="Repository instructions automatically included in every session. Discovered from .github/copilot-instructions.md and AGENTS.md."
        title="Instructions"
      >
        <RescanButton onClick={onRescan} />
      </SectionHeader>

      {instructions.length === 0 ? (
        <EmptyState>
          No instruction files found. Add a <code className="text-zinc-400">.github/copilot-instructions.md</code> or <code className="text-zinc-400">AGENTS.md</code> file to your project root.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {instructions.map((instruction) => (
            <InstructionCard key={instruction.id} instruction={instruction} />
          ))}
        </div>
      )}
    </div>
  );
}

function InstructionCard({ instruction }: { instruction: ProjectInstructionFile }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = instruction.content.length > 300;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40">
      <button
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-zinc-900/60"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <FileCode2 className="size-4 shrink-0 text-indigo-400" />
        <span className="flex-1 text-[13px] font-medium text-zinc-200">{instruction.sourcePath}</span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-zinc-800 px-5 py-4">
          <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">
            {instruction.content}
          </pre>
        </div>
      )}
      {!expanded && (
        <div className="px-5 pb-3">
          <p className={`text-[11px] leading-relaxed text-zinc-500 ${isLong ? 'line-clamp-2' : ''}`}>
            {instruction.content}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Custom Agents ────────────────────────────────────────── */

function AgentsContent({
  agents,
  onRescan,
  onSetEnabled,
}: {
  agents: ProjectAgentProfile[];
  onRescan: () => void;
  onSetEnabled: (agentProfileId: string, enabled: boolean) => void;
}) {
  const enabledCount = agents.filter((a) => a.enabled).length;

  return (
    <div>
      <SectionHeader
        description="Custom agent profiles discovered from .github/agents/*.agent.md. Enable or disable individual agents."
        title="Custom Agents"
      >
        <RescanButton onClick={onRescan} />
      </SectionHeader>

      {agents.length === 0 ? (
        <EmptyState>
          No custom agents found. Add <code className="text-zinc-400">.agent.md</code> files to <code className="text-zinc-400">.github/agents/</code> in your project.
        </EmptyState>
      ) : (
        <>
          {agents.length > 1 && (
            <div className="mb-3 text-[11px] text-zinc-500">
              {enabledCount} of {agents.length} agent{agents.length === 1 ? '' : 's'} enabled
            </div>
          )}
          <div className="space-y-2">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onToggle={() => onSetEnabled(agent.id, !agent.enabled)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  onToggle,
}: {
  agent: ProjectAgentProfile;
  onToggle: () => void;
}) {
  return (
    <div className={`rounded-xl border px-5 py-4 transition ${
      agent.enabled
        ? 'border-zinc-800 bg-zinc-900/40'
        : 'border-zinc-800/50 bg-zinc-900/20 opacity-60'
    }`}>
      <div className="flex items-start gap-3">
        <Sparkles className={`mt-0.5 size-4 shrink-0 ${agent.enabled ? 'text-amber-400' : 'text-zinc-600'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-zinc-200">
              {agent.displayName ?? agent.name}
            </span>
            {agent.tools && agent.tools.length > 0 && (
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                {agent.tools.length} tool{agent.tools.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {agent.description && (
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">{agent.description}</p>
          )}
          <p className="mt-1 text-[11px] text-zinc-600">{agent.sourcePath}</p>
        </div>
        <button
          aria-label={agent.enabled ? `Disable ${agent.name}` : `Enable ${agent.name}`}
          aria-pressed={agent.enabled}
          className="mt-0.5 shrink-0"
          onClick={onToggle}
          type="button"
        >
          <ToggleSwitch enabled={agent.enabled} size="sm" />
        </button>
      </div>
    </div>
  );
}

/* ── Prompt Files ─────────────────────────────────────────── */

function PromptsContent({
  promptFiles,
  onRescan,
}: {
  promptFiles: ProjectPromptFile[];
  onRescan: () => void;
}) {
  return (
    <div>
      <SectionHeader
        description="Reusable prompt templates discovered from .github/prompts/*.prompt.md. Use them from the Prompts pill in the chat input."
        title="Prompt Files"
      >
        <RescanButton onClick={onRescan} />
      </SectionHeader>

      {promptFiles.length === 0 ? (
        <EmptyState>
          No prompt files found. Add <code className="text-zinc-400">.prompt.md</code> files to <code className="text-zinc-400">.github/prompts/</code> in your project.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {promptFiles.map((prompt) => (
            <PromptCard key={prompt.id} prompt={prompt} />
          ))}
        </div>
      )}
    </div>
  );
}

function PromptCard({ prompt }: { prompt: ProjectPromptFile }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-4">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 size-4 shrink-0 text-emerald-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-zinc-200">{prompt.name}</span>
            {prompt.variables.length > 0 && (
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                {prompt.variables.length} variable{prompt.variables.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {prompt.description && (
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">{prompt.description}</p>
          )}
          {prompt.variables.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {prompt.variables.map((v) => (
                <span
                  key={v.name}
                  className="rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400"
                  title={v.placeholder}
                >
                  {v.name}
                </span>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-zinc-600">{prompt.sourcePath}</p>
        </div>
      </div>
    </div>
  );
}

/* ── MCP Servers ──────────────────────────────────────────── */

function McpServersContent({
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
  const hasServers = accepted.length + pending.length > 0;

  return (
    <div>
      <SectionHeader
        description="MCP servers discovered from project config files (.vscode/mcp.json, .mcp.json, .copilot/mcp.json)."
        title="MCP Servers"
      >
        <RescanButton label={hasServers ? 'Re-scan' : 'Scan'} onClick={onRescan} />
      </SectionHeader>

      {!hasServers ? (
        <EmptyState>
          No MCP servers discovered. Click Scan to check project config files.
        </EmptyState>
      ) : (
        <>
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
        </>
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

/* ── Danger Zone ──────────────────────────────────────────── */

function DangerZoneContent({
  confirmingRemove,
  onRemove,
  onCancelRemove,
}: {
  confirmingRemove: boolean;
  onRemove: () => void;
  onCancelRemove: () => void;
}) {
  return (
    <div>
      <SectionHeader
        description="Irreversible actions for this project."
        title="Danger Zone"
      />
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-5">
        <h4 className="text-[13px] font-semibold text-zinc-200">Remove project</h4>
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
            onClick={onRemove}
            type="button"
          >
            <Trash2 className="size-3.5" />
            {confirmingRemove ? 'Confirm removal' : 'Remove project'}
          </button>
          {confirmingRemove && (
            <button
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
              onClick={onCancelRemove}
              type="button"
            >
              Cancel
            </button>
          )}
        </div>
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
  children?: ReactNode;
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

function RescanButton({ onClick, label = 'Re-scan' }: { onClick: () => void; label?: string }) {
  return (
    <button
      className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[13px] font-medium text-zinc-200 transition hover:bg-zinc-700"
      onClick={onClick}
      title={label === 'Scan' ? 'Scan for files' : 'Re-scan for changes'}
      type="button"
    >
      <RefreshCw className="size-3.5" />
      {label}
    </button>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-5 py-8 text-center text-[12px] leading-relaxed text-zinc-500">
      {children}
    </div>
  );
}
