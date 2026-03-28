import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Code, Cpu, FolderOpen, Palette, Plus, Server, TriangleAlert, Workflow, Wrench } from 'lucide-react';

import { CopilotStatusCard } from '@renderer/components/CopilotStatusCard';
import { PatternEditor } from '@renderer/components/PatternEditor';
import { LspProfileEditor } from '@renderer/components/settings/LspProfileEditor';
import { McpServerEditor } from '@renderer/components/settings/McpServerEditor';
import type { SidecarCapabilities } from '@shared/contracts/sidecar';
import type { DiscoveredMcpServer, DiscoveredToolingState } from '@shared/domain/discoveredTooling';
import { listAcceptedDiscoveredMcpServers, listPendingDiscoveredMcpServers } from '@shared/domain/discoveredTooling';
import type { ModelDefinition } from '@shared/domain/models';
import type { PatternDefinition } from '@shared/domain/pattern';
import {
  normalizeLspProfileDefinition,
  normalizeMcpServerDefinition,
  type AppearanceTheme,
  type LspProfileDefinition,
  type McpServerDefinition,
  type WorkspaceToolingSettings,
} from '@shared/domain/tooling';

interface SettingsPanelProps {
  availableModels: ReadonlyArray<ModelDefinition>;
  patterns: PatternDefinition[];
  sidecarCapabilities?: SidecarCapabilities;
  theme: AppearanceTheme;
  toolingSettings: WorkspaceToolingSettings;
  discoveredUserTooling: DiscoveredToolingState;
  isRefreshingCapabilities: boolean;
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
  onSetTheme: (theme: AppearanceTheme) => void;
  onOpenAppDataFolder: () => void;
  onResetLocalWorkspace: () => Promise<void>;
  onResolveUserDiscoveredTooling?: (serverIds: string[], resolution: 'accept' | 'dismiss') => void;
}

type SettingsSection = 'appearance' | 'connection' | 'patterns' | 'mcp-servers' | 'lsp-profiles' | 'troubleshooting';

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
    label: 'Orchestration',
    items: [
      { id: 'patterns', label: 'Patterns', icon: <Workflow className="size-3.5" /> },
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
  if (pattern.availability === 'unavailable') return 'bg-amber-500/10 text-amber-400';
  return 'bg-zinc-800 text-zinc-400';
}

export function SettingsPanel({
  availableModels,
  patterns,
  sidecarCapabilities,
  theme,
  toolingSettings,
  discoveredUserTooling,
  isRefreshingCapabilities,
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
  onSetTheme,
  onOpenAppDataFolder,
  onResetLocalWorkspace,
  onResolveUserDiscoveredTooling,
}: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('appearance');
  const [editingPattern, setEditingPattern] = useState<PatternDefinition | null>(null);
  const [editingMcpServer, setEditingMcpServer] = useState<McpServerDefinition | null>(null);
  const [editingLspProfile, setEditingLspProfile] = useState<LspProfileDefinition | null>(null);

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
            isBuiltin
              ? undefined
              : async () => {
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-surface-0)]">
      <div className="drag-region flex items-center gap-3 border-b border-[var(--color-border)] px-5 pb-3 pt-3">
        <button
          className="no-drag flex size-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          onClick={onClose}
          type="button"
        >
          <ChevronLeft className="size-4" />
        </button>
        <h2 className="text-[13px] font-semibold text-zinc-100">Settings</h2>
      </div>

      <div className="flex min-h-0 flex-1">
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
                    return (
                      <button
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition ${
                          isActive
                            ? 'bg-zinc-800 font-medium text-zinc-100'
                            : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
                        }`}
                        key={item.id}
                        onClick={() => setActiveSection(item.id)}
                        type="button"
                      >
                        <span className={isActive ? 'text-zinc-300' : 'text-zinc-500'}>{item.icon}</span>
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
              <AppearanceSection theme={theme} onSetTheme={onSetTheme} />
            )}
            {activeSection === 'connection' && (
              <ConnectionSection
                connection={sidecarCapabilities?.connection}
                isRefreshing={isRefreshingCapabilities}
                modelCount={sidecarCapabilities?.models.length ?? 0}
                onRefresh={onRefreshCapabilities}
              />
            )}
            {activeSection === 'patterns' && (
              <PatternsSection
                onEditPattern={(pattern) => setEditingPattern(structuredClone(pattern))}
                onNewPattern={() => setEditingPattern(onNewPattern())}
                patterns={patterns}
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
}: {
  theme: AppearanceTheme;
  onSetTheme: (theme: AppearanceTheme) => void;
}) {
  return (
    <div>
      <div className="mb-1">
        <h3 className="text-[13px] font-semibold text-zinc-200">Appearance</h3>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          Choose how Aryx looks on your device
        </p>
      </div>

      <div className="mt-5 space-y-1.5">
        {themeOptions.map((option) => {
          const isSelected = option.value === theme;
          return (
            <button
              className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                isSelected
                  ? 'border-indigo-500/50 bg-indigo-500/10'
                  : 'border-[var(--color-border)] hover:border-zinc-600 hover:bg-zinc-800/40'
              }`}
              key={option.value}
              onClick={() => onSetTheme(option.value)}
              type="button"
            >
              <div
                className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition ${
                  isSelected ? 'border-indigo-500' : 'border-zinc-600'
                }`}
              >
                {isSelected && <div className="size-2 rounded-full bg-indigo-500" />}
              </div>
              <div>
                <span className={`text-[13px] font-medium ${isSelected ? 'text-zinc-100' : 'text-zinc-300'}`}>
                  {option.label}
                </span>
                <p className="text-[12px] text-zinc-500">{option.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConnectionSection({
  connection,
  modelCount,
  isRefreshing,
  onRefresh,
}: {
  connection?: SidecarCapabilities['connection'];
  modelCount: number;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div>
      <div className="mb-1">
        <h3 className="text-[13px] font-semibold text-zinc-200">GitHub Copilot</h3>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          Aryx uses your installed GitHub Copilot CLI for AI capabilities
        </p>
      </div>
      <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-zinc-900/30 p-4">
        <CopilotStatusCard
          connection={connection}
          isRefreshing={isRefreshing}
          modelCount={modelCount}
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
        title="Orchestration Patterns"
      >
        <SectionAction label="New Pattern" onClick={onNewPattern} />
      </SectionHeader>

      <div className="space-y-1">
        {patterns.map((pattern) => (
          <button
            className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-4 py-3 text-left transition hover:border-zinc-800 hover:bg-zinc-900"
            key={pattern.id}
            onClick={() => onEditPattern(pattern)}
            type="button"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-zinc-200">{pattern.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${modeBadgeClasses(pattern)}`}>
                  {pattern.mode}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-zinc-500">{pattern.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-zinc-600">
                {pattern.agents.length} agent{pattern.agents.length === 1 ? '' : 's'}
              </span>
              <ChevronRight className="size-4 text-zinc-700 transition group-hover:text-zinc-500" />
            </div>
          </button>
        ))}
      </div>
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
        <h3 className="text-[13px] font-semibold text-zinc-200">{title}</h3>
        <p className="mt-0.5 text-[12px] text-zinc-500">{description}</p>
      </div>
      {children}
    </div>
  );
}

function SectionAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-[13px] font-medium text-zinc-200 transition hover:bg-zinc-700"
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
      className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-4 py-3 text-left transition hover:border-zinc-800 hover:bg-zinc-900"
      onClick={onClick}
      type="button"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-zinc-200">{label}</span>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            {meta}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-zinc-500">{detail}</p>
      </div>
      <ChevronRight className="size-4 text-zinc-700 transition group-hover:text-zinc-500" />
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
          <span className="text-[12px] font-medium text-zinc-300">{label}</span>
          <p className="text-[11px] text-zinc-600">{description}</p>
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
    ? 'bg-emerald-500/10 text-emerald-400'
    : 'bg-amber-500/10 text-amber-400';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-transparent px-4 py-3 hover:border-zinc-800 hover:bg-zinc-900">
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

function TroubleshootingSection({
  onOpenAppDataFolder,
  onResetLocalWorkspace,
}: {
  onOpenAppDataFolder: () => void;
  onResetLocalWorkspace: () => Promise<void>;
}) {
  const [isResetting, setIsResetting] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  async function handleReset() {
    setIsResetting(true);
    try {
      await onResetLocalWorkspace();
    } finally {
      setIsResetting(false);
      setConfirmingReset(false);
    }
  }

  return (
    <div>
      <SectionHeader
        description="Diagnose issues and manage local application data"
        title="Troubleshooting"
      />

      <div className="space-y-2">
        <TroubleshootingAction
          description="Reveal the folder where Aryx stores workspace data, scratchpad files, and configuration."
          icon={<FolderOpen className="size-4" />}
          label="Open App Data Folder"
          onClick={onOpenAppDataFolder}
        />
      </div>

      <div className="mt-8 rounded-xl border border-red-500/20 bg-red-500/5 p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-400" />
          <div className="min-w-0 flex-1">
            <h4 className="text-[13px] font-semibold text-red-300">Reset Local Workspace</h4>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
              Restore Aryx to its initial state. This permanently removes all sessions, custom patterns,
              MCP server definitions, LSP profiles, and scratchpad contents. Your GitHub Copilot sign-in
              is not affected.
            </p>

            {!confirmingReset ? (
              <button
                className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-1.5 text-[13px] font-medium text-red-300 transition hover:border-red-500/50 hover:bg-red-500/20"
                onClick={() => setConfirmingReset(true)}
                type="button"
              >
                Reset workspace…
              </button>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="rounded-lg bg-red-600 px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
                  disabled={isResetting}
                  onClick={() => void handleReset()}
                  type="button"
                >
                  {isResetting ? 'Resetting…' : 'Confirm reset'}
                </button>
                <button
                  className="rounded-lg border border-[var(--color-border)] px-3.5 py-1.5 text-[13px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
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
      className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-4 py-3 text-left transition hover:border-zinc-800 hover:bg-zinc-900"
      onClick={onClick}
      type="button"
    >
      <span className="text-zinc-500 transition group-hover:text-zinc-300">{icon}</span>
      <div className="min-w-0 flex-1">
        <span className="text-[13px] font-medium text-zinc-200">{label}</span>
        <p className="mt-0.5 text-[12px] text-zinc-500">{description}</p>
      </div>
      <ChevronRight className="size-4 text-zinc-700 transition group-hover:text-zinc-500" />
    </button>
  );
}
