import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, FileCode2, FileText, FolderOpen, GitBranch, RefreshCw, Server, Sparkles, Trash2, AlertTriangle, Circle } from 'lucide-react';

import { ToggleSwitch } from '@renderer/components/ui';
import type { ProjectRecord, ProjectGitContext } from '@shared/domain/project';
import type { DiscoveredMcpServer } from '@shared/domain/discoveredTooling';
import { listAcceptedDiscoveredMcpServers, listPendingDiscoveredMcpServers } from '@shared/domain/discoveredTooling';
import type { ProjectAgentProfile, ProjectInstructionApplicationMode, ProjectInstructionFile, ProjectPromptFile } from '@shared/domain/projectCustomization';

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
    <div className="overlay-slide-enter fixed inset-0 z-50 flex flex-col bg-[var(--color-surface-0)]">
      {/* Header */}
      <div className="drag-region flex items-center gap-3 border-b border-[var(--color-border)] px-5 pb-3 pt-3">
        <button
          className="no-drag flex size-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
          onClick={onClose}
          type="button"
        >
          <ChevronLeft className="size-4" />
        </button>
        <h2 className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">
          Project Settings
          <span className="ml-2 font-normal text-[var(--color-text-muted)]">·</span>
          <span className="ml-2 font-normal text-[var(--color-text-secondary)]">{project.name}</span>
        </h2>
      </div>

      {/* Sidebar + Content */}
      <div className="flex min-h-0 flex-1">
        {/* Navigation sidebar */}
        <nav className="w-52 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
          <div className="space-y-4">
            {navGroups.map((group) => (
              <div key={group.label}>
                <span className="mb-1 block px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  {group.label}
                </span>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = item.id === activeSection;
                    const badge = sectionBadge(item.id);
                    return (
                      <button
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-all duration-200 ${
                          isActive
                            ? 'bg-[var(--color-surface-3)] font-medium text-[var(--color-text-primary)]'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]/50 hover:text-[var(--color-text-secondary)]'
                        }`}
                        key={item.id}
                        onClick={() => {
                          setActiveSection(item.id);
                          setConfirmingRemove(false);
                        }}
                        type="button"
                      >
                        <span className={isActive ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}>{item.icon}</span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {badge}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Danger zone at the bottom */}
            <div className="border-t border-[var(--color-border)] pt-3">
              <div className="space-y-0.5">
                <button
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-all duration-200 ${
                    activeSection === 'danger-zone'
                      ? 'bg-[var(--color-surface-3)] font-medium text-[var(--color-status-error)]'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)]/50 hover:text-[var(--color-status-error)]'
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
    <span className="rounded-full bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
      {total !== undefined ? `${count}/${total}` : count}
    </span>
  );
}

function PendingBadge({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-[var(--color-status-warning)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-status-warning)]">
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
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-glass)] px-5 py-4 space-y-3">
        <div className="flex items-center gap-3">
          <FolderOpen className="size-5 shrink-0 text-[var(--color-text-accent)]" />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[var(--color-text-primary)]">{project.name}</div>
            <div className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{project.path}</div>
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
      <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
        <GitBranch className="size-3.5" />
        Not a git repository
      </div>
    );
  }

  if (git.status === 'git-missing') {
    return (
      <div className="flex items-center gap-2 text-[12px] text-[var(--color-status-warning)]">
        <AlertTriangle className="size-3.5" />
        Git is not installed
      </div>
    );
  }

  if (git.status === 'error') {
    return (
      <div className="flex items-center gap-2 text-[12px] text-[var(--color-status-error)]">
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
    <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
      <GitBranch className="size-3.5 shrink-0" />
      <span>{branchLabel}</span>
      {git.isDirty && <Circle className="size-1.5 shrink-0 fill-[var(--color-status-warning)] text-[var(--color-status-warning)]" />}
      {parts.length > 0 && (
        <span className="text-[var(--color-text-muted)]">· {parts.join(' · ')}</span>
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
        description="Repository instructions discovered from copilot-instructions.md, AGENTS.md, CLAUDE.md, and .github/instructions/**/*.instructions.md."
        title="Instructions"
      >
        <RescanButton onClick={onRescan} />
      </SectionHeader>

      {instructions.length === 0 ? (
        <EmptyState>
          No instruction files found. Add <code className="text-[var(--color-text-secondary)]">.github/copilot-instructions.md</code>, <code className="text-[var(--color-text-secondary)]">AGENTS.md</code>, <code className="text-[var(--color-text-secondary)]">CLAUDE.md</code>, or <code className="text-[var(--color-text-secondary)]">*.instructions.md</code> files under <code className="text-[var(--color-text-secondary)]">.github/instructions/</code>.
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
  const displayName = instruction.name ?? instruction.sourcePath;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-glass)]">
      <button
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-all duration-200 hover:bg-[var(--color-glass)]"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <FileCode2 className="size-4 shrink-0 text-[var(--color-text-accent)]" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{displayName}</span>
          <InstructionModeBadge mode={instruction.applicationMode} />
          {instruction.applyTo && (
            <span
              className="truncate rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]"
              title={`Applies to files matching: ${instruction.applyTo}`}
            >
              {instruction.applyTo}
            </span>
          )}
        </div>
        <ChevronDown
          className={`size-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-[var(--color-border)] px-5 py-4">
          {instruction.description && (
            <p className="mb-2 text-[11px] italic text-[var(--color-text-muted)]">{instruction.description}</p>
          )}
          {instruction.name && (
            <p className="mb-2 text-[11px] text-[var(--color-text-muted)]">{instruction.sourcePath}</p>
          )}
          <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
            {instruction.content}
          </pre>
        </div>
      )}
      {!expanded && (
        <div className="px-5 pb-3">
          {instruction.description && (
            <p className="mb-1 text-[11px] italic text-[var(--color-text-muted)]">{instruction.description}</p>
          )}
          <p className={`text-[11px] leading-relaxed text-[var(--color-text-muted)] ${isLong ? 'line-clamp-2' : ''}`}>
            {instruction.content}
          </p>
        </div>
      )}
    </div>
  );
}

function InstructionModeBadge({ mode }: { mode: ProjectInstructionApplicationMode }) {
  switch (mode) {
    case 'always':
      return (
        <span className="shrink-0 rounded-full bg-[var(--color-status-success)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-status-success)]">
          always
        </span>
      );
    case 'file':
      return (
        <span className="shrink-0 rounded-full bg-[var(--color-text-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-accent)]">
          file
        </span>
      );
    case 'task':
      return (
        <span className="shrink-0 rounded-full bg-[var(--color-status-warning)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-status-warning)]">
          task
        </span>
      );
    case 'manual':
      return (
        <span
          className="shrink-0 rounded-full bg-[var(--color-surface-3)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]"
          title="Discovered but not auto-applied to sessions"
        >
          manual
        </span>
      );
  }
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
        description="Custom agent profiles discovered from .github/agents/**/*.agent.md. Enable or disable individual agents."
        title="Custom Agents"
      >
        <RescanButton onClick={onRescan} />
      </SectionHeader>

      {agents.length === 0 ? (
        <EmptyState>
          No custom agents found. Add <code className="text-[var(--color-text-secondary)]">.agent.md</code> files under <code className="text-[var(--color-text-secondary)]">.github/agents/</code> in your project.
        </EmptyState>
      ) : (
        <>
          {agents.length > 1 && (
            <div className="mb-3 text-[11px] text-[var(--color-text-muted)]">
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
        ? 'border-[var(--color-border)] bg-[var(--color-glass)]'
        : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]/20 opacity-60'
    }`}>
      <div className="flex items-start gap-3">
        <Sparkles className={`mt-0.5 size-4 shrink-0 ${agent.enabled ? 'text-[var(--color-status-warning)]' : 'text-[var(--color-text-muted)]'}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
              {agent.displayName ?? agent.name}
            </span>
            {agent.tools && agent.tools.length > 0 && (
              <span className="rounded-full bg-[var(--color-surface-3)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
                {agent.tools.length} tool{agent.tools.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {agent.description && (
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">{agent.description}</p>
          )}
          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">{agent.sourcePath}</p>
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
        description="Reusable prompt templates discovered from .github/prompts/**/*.prompt.md. Use them from the Prompts pill in the chat input."
        title="Prompt Files"
      >
        <RescanButton onClick={onRescan} />
      </SectionHeader>

      {promptFiles.length === 0 ? (
        <EmptyState>
          No prompt files found. Add <code className="text-[var(--color-text-secondary)]">.prompt.md</code> files under <code className="text-[var(--color-text-secondary)]">.github/prompts/</code> in your project.
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
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-glass)] px-5 py-4">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 size-4 shrink-0 text-[var(--color-status-success)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{prompt.name}</span>
            {prompt.agent && (
              <span className="rounded-full bg-[var(--color-accent-sky)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-sky)]">
                {prompt.agent}
              </span>
            )}
            {prompt.variables.length > 0 && (
              <span className="rounded-full bg-[var(--color-surface-3)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
                {prompt.variables.length} variable{prompt.variables.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {prompt.description && (
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">{prompt.description}</p>
          )}
          {prompt.tools && prompt.tools.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {prompt.tools.map((tool) => (
                <span
                  key={tool}
                  className="rounded-md bg-[var(--color-status-warning)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-status-warning)]"
                >
                  {tool}
                </span>
              ))}
            </div>
          )}
          {prompt.variables.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {prompt.variables.map((v) => (
                <span
                  key={v.name}
                  className="rounded-md bg-[var(--color-surface-3)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)]"
                  title={v.placeholder}
                >
                  {v.name}
                </span>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">{prompt.sourcePath}</p>
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
                className="rounded-lg bg-[var(--color-status-success)]/10 px-3 py-1.5 text-[12px] font-medium text-[var(--color-status-success)] transition-all duration-200 hover:bg-[var(--color-status-success)]/20"
                onClick={() => onResolve(pending.map((s) => s.id), 'accept')}
                type="button"
              >
                Accept all ({pending.length})
              </button>
              <button
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
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
    ? 'bg-[var(--color-status-success)]/10 text-[var(--color-status-success)]'
    : 'bg-[var(--color-status-warning)]/10 text-[var(--color-status-warning)]';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-transparent px-4 py-3 hover:border-[var(--color-border)] hover:bg-[var(--color-surface-1)]">
      <Server className="size-4 shrink-0 text-[var(--color-text-muted)]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{server.name}</span>
          <span className="rounded-full bg-[var(--color-surface-3)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
            {server.transport}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadge}`}>
            {status}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">
          {detail}
          <span className="ml-2 text-[var(--color-text-muted)]">· {server.sourceLabel}</span>
        </p>
      </div>
      <div className="flex items-center gap-1">
        {onAccept && (
          <button
            className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-[var(--color-status-success)] transition-all duration-200 hover:bg-[var(--color-status-success)]/10"
            onClick={onAccept}
            type="button"
          >
            Accept
          </button>
        )}
        {onDismiss && (
          <button
            className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-muted)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
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
      <div className="rounded-xl border border-[var(--color-status-error)]/20 bg-[var(--color-status-error)]/5 px-5 py-5">
        <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)]">Remove project</h4>
        <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
          Removing a project deletes all its sessions and discovered tooling from Aryx.
          Your project files on disk are not affected.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <button
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-200 ${
              confirmingRemove
                ? 'bg-[var(--color-status-error)] text-white hover:bg-[var(--color-status-error)]'
                : 'bg-[var(--color-status-error)]/10 text-[var(--color-status-error)] hover:bg-[var(--color-status-error)]/20'
            }`}
            onClick={onRemove}
            type="button"
          >
            <Trash2 className="size-3.5" />
            {confirmingRemove ? 'Confirm removal' : 'Remove project'}
          </button>
          {confirmingRemove && (
            <button
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
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
        <h3 className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">{title}</h3>
        <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{description}</p>
      </div>
      {children}
    </div>
  );
}

function RescanButton({ onClick, label = 'Re-scan' }: { onClick: () => void; label?: string }) {
  return (
    <button
      className="flex items-center gap-1.5 rounded-lg bg-[var(--color-surface-3)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-text-primary)] transition-all duration-200 hover:bg-[var(--color-surface-3)]"
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
    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)]/20 px-5 py-8 text-center text-[12px] leading-relaxed text-[var(--color-text-muted)]">
      {children}
    </div>
  );
}
