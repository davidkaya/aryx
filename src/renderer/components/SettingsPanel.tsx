import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, CircleCheck, Code, Cpu, FolderOpen, Palette, Plus, RefreshCw, Server, TriangleAlert, UserCircle, Workflow, Wrench } from 'lucide-react';

import { CopilotStatusCard } from '@renderer/components/CopilotStatusCard';
import { PatternEditor } from '@renderer/components/PatternEditor';
import { ToggleSwitch } from '@renderer/components/ui';
import { LspProfileEditor } from '@renderer/components/settings/LspProfileEditor';
import { McpServerEditor } from '@renderer/components/settings/McpServerEditor';
import { WorkspaceAgentEditor } from '@renderer/components/settings/WorkspaceAgentEditor';
import type { SidecarCapabilities, QuotaSnapshot } from '@shared/contracts/sidecar';
import type { DiscoveredMcpServer, DiscoveredToolingState } from '@shared/domain/discoveredTooling';
import { listAcceptedDiscoveredMcpServers, listPendingDiscoveredMcpServers } from '@shared/domain/discoveredTooling';
import type { ModelDefinition } from '@shared/domain/models';
import type { PatternDefinition } from '@shared/domain/pattern';
import type { UpdateStatus, UpdateStatusState } from '@shared/contracts/ipc';
import {
  normalizeLspProfileDefinition,
  normalizeMcpServerDefinition,
  type AppearanceTheme,
  type LspProfileDefinition,
  type McpServerDefinition,
  type WorkspaceToolingSettings,
} from '@shared/domain/tooling';
import { normalizeWorkspaceAgentDefinition, findWorkspaceAgentUsages, type WorkspaceAgentDefinition } from '@shared/domain/workspaceAgent';

interface SettingsPanelProps {
  availableModels: ReadonlyArray<ModelDefinition>;
  patterns: PatternDefinition[];
  sidecarCapabilities?: SidecarCapabilities;
  theme: AppearanceTheme;
  toolingSettings: WorkspaceToolingSettings;
  discoveredUserTooling: DiscoveredToolingState;
  isRefreshingCapabilities: boolean;
  initialSection?: SettingsSection;
  onRefreshCapabilities: () => void;
  onClose: () => void;
  onSavePattern: (pattern: PatternDefinition) => Promise<void>;
  onDeletePattern: (patternId: string) => Promise<void>;
  onNewPattern: () => PatternDefinition;
  onSaveMcpServer: (server: McpServerDefinition) => Promise<void>;
  onDeleteMcpServer: (serverId: string) => Promise<void>;
  onNewMcpServer: () => McpServerDefinition;
  onSaveLspProfile: (profile: LspProfileDefinition) => Promise<void>;
  onDeleteLspProfile: (profileId: string) => Promise<void>;
  onNewLspProfile: () => LspProfileDefinition;
  onSaveWorkspaceAgent: (agent: WorkspaceAgentDefinition) => Promise<void>;
  onDeleteWorkspaceAgent: (agentId: string) => Promise<void>;
  onNewWorkspaceAgent: () => WorkspaceAgentDefinition;
  workspaceAgents: WorkspaceAgentDefinition[];
  onSetTheme: (theme: AppearanceTheme) => void;
  notificationsEnabled: boolean;
  onSetNotificationsEnabled: (enabled: boolean) => void;
  minimizeToTray: boolean;
  onSetMinimizeToTray: (enabled: boolean) => void;
  gitAutoRefreshEnabled: boolean;
  onSetGitAutoRefreshEnabled: (enabled: boolean) => void;
  onOpenAppDataFolder: () => void;
  onResetLocalWorkspace: () => Promise<void>;
  onResolveUserDiscoveredTooling?: (serverIds: string[], resolution: 'accept' | 'dismiss') => void;
  onGetQuota?: () => Promise<Record<string, QuotaSnapshot>>;
}

export type SettingsSection = 'appearance' | 'connection' | 'patterns' | 'agents' | 'mcp-servers' | 'lsp-profiles' | 'troubleshooting';

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'General',
    items: [
      { id: 'appearance', label: 'Appearance', icon: <Palette className="size-3.5" /> },
    ],
  },
  {
    label: 'AI Provider',
    items: [
      { id: 'connection', label: 'Connection', icon: <Cpu className="size-3.5" /> },
    ],
  },
  {
    label: 'Workflows',
    items: [
      { id: 'patterns', label: 'Patterns', icon: <Workflow className="size-3.5" /> },
      { id: 'agents', label: 'Agents', icon: <UserCircle className="size-3.5" /> },
    ],
  },
  {
    label: 'Tooling',
    items: [
      { id: 'mcp-servers', label: 'MCP Servers', icon: <Server className="size-3.5" /> },
      { id: 'lsp-profiles', label: 'LSP Profiles', icon: <Code className="size-3.5" /> },
    ],
  },
  {
    label: 'Support',
    items: [
      { id: 'troubleshooting', label: 'Troubleshooting', icon: <Wrench className="size-3.5" /> },
    ],
  },
];

function modeBadgeClasses(pattern: PatternDefinition) {
  if (pattern.availability === 'unavailable') return 'bg-[var(--color-status-warning)]/10 text-[var(--color-status-warning)]';
  return 'bg-[var(--color-surface-3)] text-[var(--color-text-secondary)]';
}

export function SettingsPanel({
  availableModels,
  patterns,
  sidecarCapabilities,
  theme,
  toolingSettings,
  discoveredUserTooling,
  isRefreshingCapabilities,
  initialSection,
  onRefreshCapabilities,
  onClose,
  onSavePattern,
  onDeletePattern,
  onNewPattern,
  onSaveMcpServer,
  onDeleteMcpServer,
  onNewMcpServer,
  onSaveLspProfile,
  onDeleteLspProfile,
  onNewLspProfile,
  onSaveWorkspaceAgent,
  onDeleteWorkspaceAgent,
  onNewWorkspaceAgent,
  workspaceAgents,
  onSetTheme,
  notificationsEnabled,
  onSetNotificationsEnabled,
  minimizeToTray,
  onSetMinimizeToTray,
  gitAutoRefreshEnabled,
  onSetGitAutoRefreshEnabled,
  onOpenAppDataFolder,
  onResetLocalWorkspace,
  onResolveUserDiscoveredTooling,
  onGetQuota,
}: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? 'appearance');
  const [editingPattern, setEditingPattern] = useState<PatternDefinition | null>(null);
  const [editingMcpServer, setEditingMcpServer] = useState<McpServerDefinition | null>(null);
  const [editingLspProfile, setEditingLspProfile] = useState<LspProfileDefinition | null>(null);
  const [editingWorkspaceAgent, setEditingWorkspaceAgent] = useState<WorkspaceAgentDefinition | null>(null);

  if (editingPattern) {
    const isBuiltin = editingPattern.id.startsWith('pattern-');
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface-0)]">
        <PatternEditor
          availableModels={availableModels}
          isBuiltin={isBuiltin}
          onBack={() => setEditingPattern(null)}
          onChange={setEditingPattern}
          onDelete={
            async () => {
              await onDeletePattern(editingPattern.id);
              setEditingPattern(null);
            }
          }
          onSave={async () => {
            await onSavePattern(editingPattern);
            setEditingPattern(null);
          }}
          pattern={editingPattern}
          runtimeTools={sidecarCapabilities?.runtimeTools}
          toolingSettings={toolingSettings}
          workspaceAgents={workspaceAgents}
          onSaveWorkspaceAgent={onSaveWorkspaceAgent}
        />
      </div>
    );
  }

  if (editingMcpServer) {
    const exists = toolingSettings.mcpServers.some((server) => server.id === editingMcpServer.id);
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface-0)]">
        <McpServerEditor
          onBack={() => setEditingMcpServer(null)}
          onChange={setEditingMcpServer}
          onDelete={
            exists
              ? async () => {
                  await onDeleteMcpServer(editingMcpServer.id);
                  setEditingMcpServer(null);
                }
              : undefined
          }
          onSave={async () => {
            await onSaveMcpServer(normalizeMcpServerDefinition(editingMcpServer));
            setEditingMcpServer(null);
          }}
          server={editingMcpServer}
        />
      </div>
    );
  }

  if (editingLspProfile) {
    const exists = toolingSettings.lspProfiles.some((profile) => profile.id === editingLspProfile.id);
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface-0)]">
        <LspProfileEditor
          onBack={() => setEditingLspProfile(null)}
          onChange={setEditingLspProfile}
          onDelete={
            exists
              ? async () => {
                  await onDeleteLspProfile(editingLspProfile.id);
                  setEditingLspProfile(null);
                }
              : undefined
          }
          onSave={async () => {
            await onSaveLspProfile(normalizeLspProfileDefinition(editingLspProfile));
            setEditingLspProfile(null);
          }}
          profile={editingLspProfile}
        />
      </div>
    );
  }

  if (editingWorkspaceAgent) {
    const exists = workspaceAgents.some((a) => a.id === editingWorkspaceAgent.id);
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface-0)]">
        <WorkspaceAgentEditor
          agent={editingWorkspaceAgent}
          availableModels={availableModels}
          onBack={() => setEditingWorkspaceAgent(null)}
          onChange={setEditingWorkspaceAgent}
          onDelete={
            exists
              ? async () => {
                  await onDeleteWorkspaceAgent(editingWorkspaceAgent.id);
                  setEditingWorkspaceAgent(null);
                }
              : undefined
          }
          onSave={async () => {
            await onSaveWorkspaceAgent(normalizeWorkspaceAgentDefinition(editingWorkspaceAgent));
            setEditingWorkspaceAgent(null);
          }}
          patterns={patterns}
        />
      </div>
    );
  }

  return (
    <div className="overlay-slide-enter fixed inset-0 z-50 flex flex-col bg-[var(--color-surface-0)]">
      <div className="drag-region flex items-center gap-3 border-b border-[var(--color-border)] px-5 pb-3 pt-3">
        <button
          className="no-drag flex size-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
          onClick={onClose}
          type="button"
        >
          <ChevronLeft className="size-4" />
        </button>
        <h2 className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">Settings</h2>
      </div>

      <div className="flex min-h-0 flex-1">
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
                    return (
                      <button
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-all duration-200 ${
                          isActive
                            ? 'bg-[var(--color-surface-3)] font-medium text-[var(--color-text-primary)]'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]/50 hover:text-[var(--color-text-secondary)]'
                        }`}
                        key={item.id}
                        onClick={() => setActiveSection(item.id)}
                        type="button"
                      >
                        <span className={isActive ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}>{item.icon}</span>
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-6">
            {activeSection === 'appearance' && (
              <AppearanceSection
                theme={theme}
                onSetTheme={onSetTheme}
                notificationsEnabled={notificationsEnabled}
                onSetNotificationsEnabled={onSetNotificationsEnabled}
                minimizeToTray={minimizeToTray}
                onSetMinimizeToTray={onSetMinimizeToTray}
                gitAutoRefreshEnabled={gitAutoRefreshEnabled}
                onSetGitAutoRefreshEnabled={onSetGitAutoRefreshEnabled}
              />
            )}
            {activeSection === 'connection' && (
              <ConnectionSection
                connection={sidecarCapabilities?.connection}
                isRefreshing={isRefreshingCapabilities}
                modelCount={sidecarCapabilities?.models.length ?? 0}
                onRefresh={onRefreshCapabilities}
                onGetQuota={onGetQuota}
              />
            )}
            {activeSection === 'patterns' && (
              <PatternsSection
                onEditPattern={(pattern) => setEditingPattern(structuredClone(pattern))}
                onNewPattern={() => setEditingPattern(onNewPattern())}
                patterns={patterns}
              />
            )}
            {activeSection === 'agents' && (
              <WorkspaceAgentsSection
                agents={workspaceAgents}
                patterns={patterns}
                onEditAgent={(agent) => setEditingWorkspaceAgent(structuredClone(agent))}
                onNewAgent={() => setEditingWorkspaceAgent(onNewWorkspaceAgent())}
              />
            )}
            {activeSection === 'mcp-servers' && (
              <McpServersSection
                onEditServer={(server) => setEditingMcpServer(structuredClone(server))}
                onNewServer={() => setEditingMcpServer(onNewMcpServer())}
                servers={toolingSettings.mcpServers}
              />
            )}
            {activeSection === 'mcp-servers' && (
              <DiscoveredMcpSection
                discoveredUserTooling={discoveredUserTooling}
                onResolveUserDiscoveredTooling={onResolveUserDiscoveredTooling}
              />
            )}
            {activeSection === 'lsp-profiles' && (
              <LspProfilesSection
                onEditProfile={(profile) => setEditingLspProfile(structuredClone(profile))}
                onNewProfile={() => setEditingLspProfile(onNewLspProfile())}
                profiles={toolingSettings.lspProfiles}
              />
            )}
            {activeSection === 'troubleshooting' && (
              <TroubleshootingSection
                onOpenAppDataFolder={onOpenAppDataFolder}
                onResetLocalWorkspace={onResetLocalWorkspace}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const themeOptions: { value: AppearanceTheme; label: string; description: string }[] = [
  { value: 'dark', label: 'Dark', description: 'Dark background with light text' },
  { value: 'light', label: 'Light', description: 'Light background with dark text' },
  { value: 'system', label: 'System', description: 'Follow your operating system setting' },
];

function AppearanceSection({
  theme,
  onSetTheme,
  notificationsEnabled,
  onSetNotificationsEnabled,
  minimizeToTray,
  onSetMinimizeToTray,
  gitAutoRefreshEnabled,
  onSetGitAutoRefreshEnabled,
}: {
  theme: AppearanceTheme;
  onSetTheme: (theme: AppearanceTheme) => void;
  notificationsEnabled: boolean;
  onSetNotificationsEnabled: (enabled: boolean) => void;
  minimizeToTray: boolean;
  onSetMinimizeToTray: (enabled: boolean) => void;
  gitAutoRefreshEnabled: boolean;
  onSetGitAutoRefreshEnabled: (enabled: boolean) => void;
}){
  return (
    <div>
      <div className="mb-1">
        <h3 className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">Appearance</h3>
        <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
          Choose how Aryx looks on your device
        </p>
      </div>

      <div className="mt-5 space-y-1.5">
        {themeOptions.map((option) => {
          const isSelected = option.value === theme;
          return (
            <button
              className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all duration-200 ${
                isSelected
                  ? 'border-[var(--color-border-glow)] bg-[var(--color-accent-muted)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-3)]/40'
              }`}
              key={option.value}
              onClick={() => onSetTheme(option.value)}
              type="button"
            >
              <div
                className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 ${
                  isSelected ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
                }`}
              >
                {isSelected && <div className="size-2 rounded-full bg-[var(--color-accent)]" />}
              </div>
              <div>
                <span className={`text-[13px] font-medium ${isSelected ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>
                  {option.label}
                </span>
                <p className="text-[12px] text-[var(--color-text-muted)]">{option.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Notifications */}
      <div className="mt-8 mb-1">
        <h3 className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">Notifications</h3>
        <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
          Control when Aryx sends desktop notifications
        </p>
      </div>

      <button
        className="mt-4 flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3 text-left transition hover:bg-[var(--color-surface-3)]/40"
        onClick={() => onSetNotificationsEnabled(!notificationsEnabled)}
        type="button"
      >
        <div>
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
            Run completion alerts
          </span>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Notify when a session run completes, fails, or needs approval while the app is unfocused
          </p>
        </div>
        <ToggleSwitch enabled={notificationsEnabled} />
      </button>

      {/* System Tray */}
      <div className="mt-8 mb-1">
        <h3 className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">System Tray</h3>
        <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
          Control how Aryx behaves when you close the window
        </p>
      </div>

      <button
        className="mt-4 flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3 text-left transition hover:bg-[var(--color-surface-3)]/40"
        onClick={() => onSetMinimizeToTray(!minimizeToTray)}
        type="button"
      >
        <div>
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
            Minimize to tray on close
          </span>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Keep Aryx running in the system tray when you close the window instead of quitting
          </p>
        </div>
        <ToggleSwitch enabled={minimizeToTray} />
      </button>

      {/* Git */}
      <div className="mt-8 mb-1">
        <h3 className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">Git</h3>
        <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
          Control how Aryx monitors your repositories
        </p>
      </div>

      <button
        className="mt-4 flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] px-4 py-3 text-left transition hover:bg-[var(--color-surface-3)]/40"
        onClick={() => onSetGitAutoRefreshEnabled(!gitAutoRefreshEnabled)}
        type="button"
      >
        <div>
          <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
            Auto-refresh git status
          </span>
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Periodically poll repository status in the background and refresh on window focus
          </p>
        </div>
        <ToggleSwitch enabled={gitAutoRefreshEnabled} />
      </button>
    </div>
  );
}

function ConnectionSection({
  connection,
  modelCount,
  isRefreshing,
  onRefresh,
  onGetQuota,
}: {
  connection?: SidecarCapabilities['connection'];
  modelCount: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  onGetQuota?: () => Promise<Record<string, QuotaSnapshot>>;
}) {
  return (
    <div>
      <div className="mb-1">
        <h3 className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">GitHub Copilot</h3>
        <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
          Aryx uses your installed GitHub Copilot CLI for AI capabilities
        </p>
      </div>
      <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass)] p-4">
        <CopilotStatusCard
          connection={connection}
          isRefreshing={isRefreshing}
          modelCount={modelCount}
          onGetQuota={onGetQuota}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
}

function PatternsSection({
  patterns,
  onEditPattern,
  onNewPattern,
}: {
  patterns: PatternDefinition[];
  onEditPattern: (pattern: PatternDefinition) => void;
  onNewPattern: () => void;
}) {
  return (
    <div>
      <SectionHeader
        description="Define reusable agent configurations for your sessions"
        title="Workflow Patterns"
      >
        <SectionAction label="New Pattern" onClick={onNewPattern} />
      </SectionHeader>

      <div className="space-y-1">
        {patterns.map((pattern) => (
          <button
            className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-4 py-3 text-left transition-all duration-200 hover:border-[var(--color-border)] hover:bg-[var(--color-surface-1)]"
            key={pattern.id}
            onClick={() => onEditPattern(pattern)}
            type="button"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{pattern.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${modeBadgeClasses(pattern)}`}>
                  {pattern.mode}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{pattern.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-[var(--color-text-muted)]">
                {pattern.agents.length} agent{pattern.agents.length === 1 ? '' : 's'}
              </span>
              <ChevronRight className="size-4 text-[var(--color-text-muted)] transition-all duration-200 group-hover:text-[var(--color-text-muted)]" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspaceAgentsSection({
  agents,
  patterns,
  onEditAgent,
  onNewAgent,
}: {
  agents: WorkspaceAgentDefinition[];
  patterns: PatternDefinition[];
  onEditAgent: (agent: WorkspaceAgentDefinition) => void;
  onNewAgent: () => void;
}) {
  return (
    <div>
      <SectionHeader
        description="Define reusable agents that can be shared across multiple patterns"
        title="Workspace Agents"
      >
        <SectionAction label="New Agent" onClick={onNewAgent} />
      </SectionHeader>

      {agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-border)] px-6 py-10 text-center">
          <UserCircle className="mx-auto size-8 text-[var(--color-text-muted)]" />
          <p className="mt-3 text-[13px] font-medium text-[var(--color-text-secondary)]">
            No workspace agents yet
          </p>
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            Create agents here and reference them in multiple patterns.
            Changes to a workspace agent automatically propagate to all linked patterns.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {agents.map((agent) => {
            const usageCount = findWorkspaceAgentUsages(agent.id, patterns).length;
            return (
              <button
                className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-4 py-3 text-left transition-all duration-200 hover:border-[var(--color-border)] hover:bg-[var(--color-surface-1)]"
                key={agent.id}
                onClick={() => onEditAgent(agent)}
                type="button"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{agent.name}</span>
                    <span className="rounded-full bg-[var(--color-surface-3)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
                      {agent.model}
                    </span>
                  </div>
                  {agent.description && (
                    <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{agent.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {usageCount > 0 && (
                    <span className="text-[12px] text-[var(--color-text-muted)]">
                      {usageCount} pattern{usageCount === 1 ? '' : 's'}
                    </span>
                  )}
                  <ChevronRight className="size-4 text-[var(--color-text-muted)]" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function McpServersSection({
  servers,
  onEditServer,
  onNewServer,
}: {
  servers: McpServerDefinition[];
  onEditServer: (server: McpServerDefinition) => void;
  onNewServer: () => void;
}) {
  return (
    <div>
      <SectionHeader
        description="Define machine-wide MCP servers that sessions can enable from the Activity panel."
        title="MCP Servers"
      >
        <SectionAction label="New MCP Server" onClick={onNewServer} />
      </SectionHeader>

      <div className="space-y-1">
        {servers.length === 0 && (
          <EmptyState>
            No MCP servers configured yet. Add one here, then enable it per session from the Activity panel.
          </EmptyState>
        )}
        {servers.map((server) => (
          <ToolingListButton
            detail={
              server.transport === 'local'
                ? server.command || 'No command set'
                : server.url || 'No URL set'
            }
            key={server.id}
            label={server.name}
            meta={server.transport.toUpperCase()}
            onClick={() => onEditServer(server)}
          />
        ))}
      </div>
    </div>
  );
}

function LspProfilesSection({
  profiles,
  onEditProfile,
  onNewProfile,
}: {
  profiles: LspProfileDefinition[];
  onEditProfile: (profile: LspProfileDefinition) => void;
  onNewProfile: () => void;
}) {
  return (
    <div>
      <SectionHeader
        description="Define machine-wide LSP commands that sessions can enable from the Activity panel."
        title="LSP Profiles"
      >
        <SectionAction label="New LSP Profile" onClick={onNewProfile} />
      </SectionHeader>

      <div className="space-y-1">
        {profiles.length === 0 && (
          <EmptyState>
            No LSP profiles configured yet. Add one here, then enable it per session from the Activity panel.
          </EmptyState>
        )}
        {profiles.map((profile) => (
          <ToolingListButton
            detail={profile.command || 'No command set'}
            key={profile.id}
            label={profile.name}
            meta={profile.languageId}
            onClick={() => onEditProfile(profile)}
          />
        ))}
      </div>
    </div>
  );
}

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

function SectionAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-1.5 rounded-lg bg-[var(--color-surface-3)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-text-primary)] transition-all duration-200 hover:bg-[var(--color-surface-3)]"
      onClick={onClick}
      type="button"
    >
      <Plus className="size-3.5" />
      {label}
    </button>
  );
}

function ToolingListButton({
  label,
  detail,
  meta,
  onClick,
}: {
  label: string;
  detail: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-4 py-3 text-left transition-all duration-200 hover:border-[var(--color-border)] hover:bg-[var(--color-surface-1)]"
      onClick={onClick}
      type="button"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-[var(--color-text-primary)]">{label}</span>
          <span className="rounded-full bg-[var(--color-surface-3)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
            {meta}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{detail}</p>
      </div>
      <ChevronRight className="size-4 text-[var(--color-text-muted)] transition-all duration-200 group-hover:text-[var(--color-text-muted)]" />
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

/* ── Discovered MCP section ────────────────────────────────── */

function DiscoveredMcpSection({
  discoveredUserTooling,
  onResolveUserDiscoveredTooling,
}: {
  discoveredUserTooling: DiscoveredToolingState;
  onResolveUserDiscoveredTooling?: (serverIds: string[], resolution: 'accept' | 'dismiss') => void;
}) {
  const acceptedUser = listAcceptedDiscoveredMcpServers(discoveredUserTooling);
  const pendingUser = listPendingDiscoveredMcpServers(discoveredUserTooling);

  const hasAny = acceptedUser.length + pendingUser.length > 0;

  if (!hasAny) return null;

  return (
    <div className="mt-8">
      <SectionHeader
        description="MCP servers discovered from user config files. Accepted servers are available for session tooling."
        title="Discovered MCP Servers"
      />

      <DiscoveredSubSection
        label="User-level"
        description="From ~/.copilot/mcp.json"
        accepted={acceptedUser}
        pending={pendingUser}
        onResolve={onResolveUserDiscoveredTooling}
      />
    </div>
  );
}

function DiscoveredSubSection({
  label,
  description,
  accepted,
  pending,
  onResolve,
}: {
  label: string;
  description: string;
  accepted: DiscoveredMcpServer[];
  pending: DiscoveredMcpServer[];
  onResolve?: (serverIds: string[], resolution: 'accept' | 'dismiss') => void;
}) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</span>
          <p className="text-[11px] text-[var(--color-text-muted)]">{description}</p>
        </div>
      </div>
      <div className="space-y-1">
        {accepted.map((server) => (
          <DiscoveredServerRow
            key={server.id}
            onDismiss={onResolve ? () => onResolve([server.id], 'dismiss') : undefined}
            server={server}
            status="accepted"
          />
        ))}
        {pending.map((server) => (
          <DiscoveredServerRow
            key={server.id}
            onAccept={onResolve ? () => onResolve([server.id], 'accept') : undefined}
            onDismiss={onResolve ? () => onResolve([server.id], 'dismiss') : undefined}
            server={server}
            status="pending"
          />
        ))}
      </div>
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

function TroubleshootingSection({
  onOpenAppDataFolder,
  onResetLocalWorkspace,
}: {
  onOpenAppDataFolder: () => void;
  onResetLocalWorkspace: () => Promise<void>;
}) {
  const [isResetting, setIsResetting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [isCheckingManually, setIsCheckingManually] = useState(false);

  useEffect(() => {
    const unsubscribe = window.aryxApi.onUpdateStatus((status) => {
      setUpdateStatus(status);
      if (status.state !== 'checking') setIsCheckingManually(false);
    });
    return unsubscribe;
  }, []);

  async function handleCheckForUpdates() {
    setIsCheckingManually(true);
    try {
      const status = await window.aryxApi.checkForUpdates();
      setUpdateStatus(status);
    } finally {
      setIsCheckingManually(false);
    }
  }

  async function handleInstallUpdate() {
    await window.aryxApi.installUpdate();
  }

  async function handleReset() {
    setIsResetting(true);
    try {
      await onResetLocalWorkspace();
    } finally {
      setIsResetting(false);
      setConfirmingReset(false);
    }
  }

  const isChecking = isCheckingManually || updateStatus.state === 'checking';

  function getUpdateLabel(): string {
    switch (updateStatus.state) {
      case 'checking':
        return 'Checking for updates…';
      case 'up-to-date':
        return 'Up to date';
      case 'available':
        return `Update available: v${updateStatus.version ?? 'unknown'}`;
      case 'downloading':
        return `Downloading update${updateStatus.downloadProgress ? ` (${Math.round(updateStatus.downloadProgress.percent)}%)` : '…'}`;
      case 'downloaded':
        return `Update ready: v${updateStatus.version ?? 'unknown'}`;
      case 'error':
        return 'Update check failed';
      default:
        return 'Check for updates';
    }
  }

  function getUpdateDescription(): string {
    switch (updateStatus.state) {
      case 'checking':
        return 'Contacting the update server…';
      case 'up-to-date':
        return 'You are running the latest version of Aryx.';
      case 'available':
      case 'downloading':
        return 'A new version is being downloaded and will be installed automatically.';
      case 'downloaded':
        return 'Restart Aryx to apply the update.';
      case 'error':
        return updateStatus.error ?? 'Could not reach the update server. Try again later.';
      default:
        return 'Manually check whether a newer version of Aryx is available.';
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
        <SectionHeader
          description="Diagnose issues and manage local application data"
          title="Troubleshooting"
        />

        <div className="space-y-2">
          {/* Check for updates */}
          {updateStatus.state === 'downloaded' ? (
            <button
              className="group flex w-full items-center gap-3 rounded-xl border border-[var(--color-status-success)]/20 bg-[var(--color-status-success)]/5 px-4 py-3 text-left transition-all duration-200 hover:border-[var(--color-status-success)]/40 hover:bg-[var(--color-status-success)]/10"
              onClick={() => void handleInstallUpdate()}
              type="button"
            >
              <span className="text-[var(--color-status-success)]">
                <RefreshCw className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-[13px] font-medium text-[var(--color-status-success)]">{getUpdateLabel()}</span>
                <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{getUpdateDescription()}</p>
              </div>
              <span className="rounded-lg bg-[var(--color-status-success)]/15 px-2.5 py-1 text-[11px] font-semibold text-[var(--color-status-success)]">
                Restart
              </span>
            </button>
          ) : (
            <button
              className={`group flex w-full items-center gap-3 rounded-xl border border-transparent px-4 py-3 text-left transition-all duration-200 hover:border-[var(--color-border)] hover:bg-[var(--color-surface-1)] ${isChecking ? 'pointer-events-none opacity-70' : ''}`}
              disabled={isChecking}
              onClick={() => void handleCheckForUpdates()}
              type="button"
            >
              <span className={`transition-all duration-200 ${updateStatus.state === 'up-to-date' ? 'text-[var(--color-status-success)]' : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]'}`}>
                {updateStatus.state === 'up-to-date'
                  ? <CircleCheck className="size-4" />
                  : <RefreshCw className={`size-4 ${isChecking ? 'animate-spin' : ''}`} />}
              </span>
              <div className="min-w-0 flex-1">
                <span className={`text-[13px] font-medium ${updateStatus.state === 'error' ? 'text-[var(--color-status-error)]' : updateStatus.state === 'up-to-date' ? 'text-[var(--color-status-success)]' : 'text-[var(--color-text-primary)]'}`}>
                  {getUpdateLabel()}
                </span>
                <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{getUpdateDescription()}</p>
              </div>
              <ChevronRight className="size-4 text-[var(--color-text-muted)] transition-all duration-200 group-hover:text-[var(--color-text-muted)]" />
            </button>
          )}

          <TroubleshootingAction
            description="Reveal the folder where Aryx stores workspace data, scratchpad files, and configuration."
            icon={<FolderOpen className="size-4" />}
            label="Open App Data Folder"
            onClick={onOpenAppDataFolder}
          />
        </div>

        <div className="mt-8 rounded-xl border border-[var(--color-status-error)]/20 bg-[var(--color-status-error)]/5 p-5">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-status-error)]" />
            <div className="min-w-0 flex-1">
              <h4 className="text-[13px] font-semibold text-[var(--color-status-error)]">Reset Local Workspace</h4>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
                Restore Aryx to its initial state. This permanently removes all sessions, custom patterns,
                MCP server definitions, LSP profiles, and scratchpad contents. Your GitHub Copilot sign-in
                is not affected.
              </p>

              {!confirmingReset ? (
                <button
                  className="mt-3 rounded-lg border border-[var(--color-status-error)]/30 bg-[var(--color-status-error)]/10 px-3.5 py-1.5 text-[13px] font-medium text-[var(--color-status-error)] transition-all duration-200 hover:border-[var(--color-status-error)]/50 hover:bg-[var(--color-status-error)]/20"
                  onClick={() => setConfirmingReset(true)}
                  type="button"
                >
                  Reset workspace…
                </button>
              ) : (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    className="rounded-lg bg-[var(--color-status-error)] px-3.5 py-1.5 text-[13px] font-medium text-white transition-all duration-200 hover:bg-[var(--color-status-error)] disabled:opacity-50"
                    disabled={isResetting}
                    onClick={() => void handleReset()}
                    type="button"
                  >
                    {isResetting ? 'Resetting…' : 'Confirm reset'}
                  </button>
                  <button
                    className="rounded-lg border border-[var(--color-border)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
                    disabled={isResetting}
                    onClick={() => setConfirmingReset(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Attribution footer */}
      <div className="mt-12 flex items-center justify-center gap-1.5 pb-2 text-[11px] text-[var(--color-text-muted)]">
        <span>Built with</span>
        <svg aria-hidden="true" className="size-3 text-[var(--color-status-error)]" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
        <span>by Dávid Kaya</span>
      </div>
    </div>
  );
}

function TroubleshootingAction({
  icon,
  label,
  description,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-4 py-3 text-left transition-all duration-200 hover:border-[var(--color-border)] hover:bg-[var(--color-surface-1)]"
      onClick={onClick}
      type="button"
    >
      <span className="text-[var(--color-text-muted)] transition-all duration-200 group-hover:text-[var(--color-text-secondary)]">{icon}</span>
      <div className="min-w-0 flex-1">
        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{label}</span>
        <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{description}</p>
      </div>
      <ChevronRight className="size-4 text-[var(--color-text-muted)] transition-all duration-200 group-hover:text-[var(--color-text-muted)]" />
    </button>
  );
}
