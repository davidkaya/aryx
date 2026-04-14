import { Bot, FunctionSquare, GitBranch, Link2, Play, Radio, Square } from 'lucide-react';

import type { WorkflowNodeKind } from '@shared/domain/workflow';
import type { WorkspaceAgentDefinition } from '@shared/domain/workspaceAgent';

interface WorkflowNodePaletteProps {
  onAddNode: (kind: WorkflowNodeKind) => void;
  onAddWorkspaceAgentNode: (agentId: string) => void;
  workspaceAgents: ReadonlyArray<WorkspaceAgentDefinition>;
  disabledKinds?: ReadonlySet<WorkflowNodeKind>;
}

interface PaletteItem {
  kind: WorkflowNodeKind;
  label: string;
  icon: typeof Bot;
  color: string;
}

interface PaletteGroup {
  label: string;
  items: PaletteItem[];
}

const paletteGroups: PaletteGroup[] = [
  {
    label: 'Flow Control',
    items: [
      { kind: 'start', label: 'Start', icon: Play, color: 'text-emerald-400' },
      { kind: 'end', label: 'End', icon: Square, color: 'text-rose-400' },
    ],
  },
  {
    label: 'Agents',
    items: [
      { kind: 'agent', label: 'New Agent', icon: Bot, color: 'text-[var(--color-accent)]' },
    ],
  },
  {
    label: 'Processing',
    items: [
      { kind: 'invoke-function', label: 'Function Tool', icon: FunctionSquare, color: 'text-violet-400' },
    ],
  },
  {
    label: 'Integration',
    items: [
      { kind: 'sub-workflow', label: 'Sub-Workflow', icon: GitBranch, color: 'text-amber-400' },
      { kind: 'request-port', label: 'Port', icon: Radio, color: 'text-teal-400' },
    ],
  },
];

export function WorkflowNodePalette({ onAddNode, onAddWorkspaceAgentNode, workspaceAgents, disabledKinds }: WorkflowNodePaletteProps) {
  return (
    <div className="space-y-4 p-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        Nodes
      </h4>
      {paletteGroups.map((group) => (
        <div key={group.label}>
          <span className="mb-1 block text-[10px] font-medium text-[var(--color-text-muted)]">
            {group.label}
          </span>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const disabled = disabledKinds?.has(item.kind) ?? false;
              return (
                <button
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-all duration-200 ${
                    disabled
                      ? 'cursor-not-allowed text-[var(--color-text-muted)] opacity-40'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]'
                  }`}
                  disabled={disabled}
                  key={item.kind}
                  onClick={() => onAddNode(item.kind)}
                  title={disabled ? `${item.label} node already exists` : undefined}
                  type="button"
                >
                  <Icon className={`size-3.5 ${item.color}`} />
                  {item.label}
                </button>
              );
            })}

            {/* Saved workspace agents in the Agents group */}
            {group.label === 'Agents' && workspaceAgents.length > 0 && (
              <>
                <div className="mx-1 my-1.5 border-t border-[var(--color-border)]" />
                {workspaceAgents.map((agent) => (
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
                    key={agent.id}
                    onClick={() => onAddWorkspaceAgentNode(agent.id)}
                    title={agent.description || agent.name}
                    type="button"
                  >
                    <Link2 className="size-3.5 text-[var(--color-accent)]" />
                    <span className="truncate">{agent.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
