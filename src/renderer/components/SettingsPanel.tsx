import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Code, Cpu, Info, Palette, Plus, Server, Trash, Workflow } from 'lucide-react';

import { CopilotStatusCard } from '@renderer/components/CopilotStatusCard';
import { PatternEditor } from '@renderer/components/PatternEditor';
import type { SidecarCapabilities } from '@shared/contracts/sidecar';
import type { ModelDefinition } from '@shared/domain/models';
import type { PatternDefinition } from '@shared/domain/pattern';
import {
  normalizeLspProfileDefinition,
  normalizeMcpServerDefinition,
  type AppearanceTheme,
  type LspProfileDefinition,
  type McpServerDefinition,
  type WorkspaceToolingSettings,
  validateLspProfileDefinition,
  validateMcpServerDefinition,
} from '@shared/domain/tooling';
import { nowIso } from '@shared/utils/ids';

interface SettingsPanelProps {
  availableModels: ReadonlyArray<ModelDefinition>;
  patterns: PatternDefinition[];
  sidecarCapabilities?: SidecarCapabilities;
  theme: AppearanceTheme;
  toolingSettings: WorkspaceToolingSettings;
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
}

type SettingsSection = 'appearance' | 'connection' | 'patterns' | 'mcp-servers' | 'lsp-profiles';

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
            {activeSection === 'lsp-profiles' && (
              <LspProfilesSection
                onEditProfile={(profile) => setEditingLspProfile(structuredClone(profile))}
                onNewProfile={() => setEditingLspProfile(onNewLspProfile())}
                profiles={toolingSettings.lspProfiles}
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
          Choose how Eryx looks on your device
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
          Eryx uses your installed GitHub Copilot CLI for AI capabilities
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

function McpServerEditor({
  server,
  onChange,
  onBack,
  onSave,
  onDelete,
}: {
  server: McpServerDefinition;
  onChange: (server: McpServerDefinition) => void;
  onBack: () => void;
  onSave: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const validationError = validateMcpServerDefinition(server);

  return (
    <ToolingEditorShell
      disableSave={Boolean(validationError)}
      error={validationError}
      onBack={onBack}
      onDelete={onDelete}
      onSave={onSave}
      subtitle="Machine-wide server definition"
      title={server.name || 'Untitled MCP Server'}
    >
      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          General
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" required>
            <TextInput
              onChange={(value) => onChange(updateMcpServer(server, { name: value }))}
              value={server.name}
            />
          </FormField>
          <FormField label="Transport" required>
            <SelectInput
              onChange={(value) => onChange(changeMcpTransport(server, value as McpServerDefinition['transport']))}
              options={[
                { value: 'local', label: 'Local process' },
                { value: 'http', label: 'HTTP' },
                { value: 'sse', label: 'SSE' },
              ]}
              value={server.transport}
            />
          </FormField>
        </div>
      </section>

      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          {server.transport === 'local' ? 'Process' : 'Endpoint'}
        </h4>
        {server.transport === 'local' ? (
          <>
            <FormField label="Command" required>
              <TextInput
                onChange={(value) => onChange(updateMcpServer(server, { command: value }))}
                placeholder="node"
                value={server.command}
              />
            </FormField>
            <FormField label="Arguments">
              <TextareaInput
                onChange={(value) => onChange(updateMcpServer(server, { args: splitMultiline(value) }))}
                placeholder="One argument per line"
                rows={3}
                value={joinMultiline(server.args)}
              />
            </FormField>
            <FormField label="Working directory">
              <TextInput
                onChange={(value) => onChange(updateMcpServer(server, { cwd: value || undefined }))}
                placeholder="Optional — defaults to project root"
                value={server.cwd ?? ''}
              />
            </FormField>
          </>
        ) : (
          <FormField label="Server URL" required>
            <TextInput
              onChange={(value) => onChange(updateMcpServer(server, { url: value }))}
              placeholder="https://example.com/mcp"
              value={server.url}
            />
          </FormField>
        )}
      </section>

      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          Advanced
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Allowed tools">
            <TextareaInput
              onChange={(value) => onChange(updateMcpServer(server, { tools: splitTokens(value) }))}
              placeholder="* for all, or one per line"
              rows={3}
              value={joinMultiline(server.tools)}
            />
          </FormField>
          <FormField label="Timeout (ms)">
            <TextInput
              inputMode="numeric"
              onChange={(value) =>
                onChange(
                  updateMcpServer(server, {
                    timeoutMs: value.trim() ? Number(value) : undefined,
                  }),
                )
              }
              placeholder="Optional"
              value={server.timeoutMs?.toString() ?? ''}
            />
          </FormField>
        </div>
      </section>

      <InfoCallout>
        Keep secrets out of this form. Use commands or endpoints that authenticate through the OS or external tooling.
      </InfoCallout>
    </ToolingEditorShell>
  );
}

function LspProfileEditor({
  profile,
  onChange,
  onBack,
  onSave,
  onDelete,
}: {
  profile: LspProfileDefinition;
  onChange: (profile: LspProfileDefinition) => void;
  onBack: () => void;
  onSave: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const validationError = validateLspProfileDefinition(profile);

  return (
    <ToolingEditorShell
      disableSave={Boolean(validationError)}
      error={validationError}
      onBack={onBack}
      onDelete={onDelete}
      onSave={onSave}
      subtitle="Machine-wide language server definition"
      title={profile.name || 'Untitled LSP Profile'}
    >
      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          General
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" required>
            <TextInput
              onChange={(value) => onChange(updateLspProfile(profile, { name: value }))}
              value={profile.name}
            />
          </FormField>
          <FormField label="Language ID" required>
            <TextInput
              onChange={(value) => onChange(updateLspProfile(profile, { languageId: value }))}
              placeholder="typescript"
              value={profile.languageId}
            />
          </FormField>
        </div>
      </section>

      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          Server
        </h4>
        <FormField label="Command" required>
          <TextInput
            onChange={(value) => onChange(updateLspProfile(profile, { command: value }))}
            placeholder="typescript-language-server"
            value={profile.command}
          />
        </FormField>
        <FormField label="Arguments">
          <TextareaInput
            onChange={(value) => onChange(updateLspProfile(profile, { args: splitMultiline(value) }))}
            placeholder="One argument per line"
            rows={3}
            value={joinMultiline(profile.args)}
          />
        </FormField>
      </section>

      <section className="space-y-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-500">
          File matching
        </h4>
        <FormField label="File extensions" required>
          <TextareaInput
            onChange={(value) => onChange(updateLspProfile(profile, { fileExtensions: splitTokens(value) }))}
            placeholder={'.ts\n.tsx'}
            rows={3}
            value={joinMultiline(profile.fileExtensions)}
          />
        </FormField>
      </section>

      <InfoCallout>
        Project root resolution comes from the active session's project, not from this definition.
      </InfoCallout>
    </ToolingEditorShell>
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

function ToolingEditorShell({
  title,
  subtitle,
  error,
  disableSave,
  onBack,
  onSave,
  onDelete,
  children,
}: {
  title: string;
  subtitle: string;
  error?: string;
  disableSave: boolean;
  onBack: () => void;
  onSave: () => Promise<void>;
  onDelete?: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="drag-region flex items-center justify-between border-b border-[var(--color-border)] px-5 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <button
            className="no-drag flex size-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onBack}
            type="button"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div>
            <h2 className="text-[13px] font-semibold text-zinc-100">{title}</h2>
            <p className="text-[12px] text-zinc-500">{subtitle}</p>
          </div>
        </div>
        <div className="no-drag flex items-center gap-2">
          {onDelete && (
            <button
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-red-400 transition hover:bg-red-500/10"
              onClick={() => void onDelete()}
              type="button"
            >
              <Trash className="size-3.5" />
              Delete
            </button>
          )}
          <button
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={disableSave}
            onClick={() => void onSave()}
            type="button"
          >
            Save
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-2xl space-y-8">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[13px] text-amber-300">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-zinc-400">
        {label}
        {required && <span className="ml-1 text-amber-400">*</span>}
      </span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <input
      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500/50"
      inputMode={inputMode}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      value={value}
    />
  );
}

function TextareaInput({
  value,
  onChange,
  placeholder,
  rows,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows: number;
}) {
  return (
    <textarea
      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500/50"
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      value={value}
    />
  );
}

function SelectInput({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-100 outline-none transition focus:border-indigo-500/50"
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function InfoCallout({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2.5 text-[12px] leading-relaxed text-zinc-500">
      <Info className="mt-0.5 size-3.5 shrink-0 text-zinc-600" />
      <span>{children}</span>
    </div>
  );
}

function updateMcpServer(
  server: McpServerDefinition,
  patch: Partial<McpServerDefinition>,
): McpServerDefinition;
function updateMcpServer<T extends McpServerDefinition>(server: T, patch: Partial<T>): T;
function updateMcpServer<T extends McpServerDefinition>(server: T, patch: Partial<T>): T {
  return {
    ...server,
    ...patch,
    updatedAt: nowIso(),
  };
}

function changeMcpTransport(
  server: McpServerDefinition,
  transport: McpServerDefinition['transport'],
): McpServerDefinition {
  if (transport === server.transport) {
    return server;
  }

  if (transport === 'local') {
    return {
      id: server.id,
      name: server.name,
      transport: 'local',
      command: '',
      args: [],
      cwd: undefined,
      tools: server.tools,
      timeoutMs: server.timeoutMs,
      createdAt: server.createdAt,
      updatedAt: nowIso(),
    };
  }

  return {
    id: server.id,
    name: server.name,
    transport,
    url: server.transport === 'local' ? '' : server.url,
    tools: server.tools,
    timeoutMs: server.timeoutMs,
    createdAt: server.createdAt,
    updatedAt: nowIso(),
  };
}

function updateLspProfile(
  profile: LspProfileDefinition,
  patch: Partial<LspProfileDefinition>,
): LspProfileDefinition {
  return {
    ...profile,
    ...patch,
    updatedAt: nowIso(),
  };
}

function splitMultiline(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function splitTokens(value: string): string[] {
  return value
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function joinMultiline(value: string[]): string {
  return value.join('\n');
}
