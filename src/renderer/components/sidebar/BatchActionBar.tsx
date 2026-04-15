import { Archive, ArchiveRestore, CheckSquare, Square, Trash2, X } from 'lucide-react';

interface BatchActionBarProps {
  selectedCount: number;
  allSelectedArchived: boolean;
  onArchive: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCancel: () => void;
  allSelected: boolean;
}

export function BatchActionBar({
  selectedCount,
  allSelectedArchived,
  onArchive,
  onDelete,
  onSelectAll,
  onDeselectAll,
  onCancel,
  allSelected,
}: BatchActionBarProps) {
  const archiveLabel = allSelectedArchived ? 'Restore' : 'Archive';
  const ArchiveIcon = allSelectedArchived ? ArchiveRestore : Archive;

  return (
    <div
      className="batch-action-bar-enter border-t border-[var(--color-border)] bg-[var(--color-surface-1)]/95 px-3 py-2.5 backdrop-blur-md"
      role="toolbar"
      aria-label="Batch session actions"
    >
      {/* Top row — selection count + select all/none */}
      <div className="mb-2 flex items-center justify-between">
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)]/15 px-2.5 py-1 text-[11px] font-semibold text-[var(--color-accent)]"
          aria-live="polite"
        >
          {selectedCount} selected
        </span>
        <button
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
          onClick={allSelected ? onDeselectAll : onSelectAll}
          type="button"
        >
          {allSelected ? (
            <>
              <Square className="size-3" />
              None
            </>
          ) : (
            <>
              <CheckSquare className="size-3" />
              All
            </>
          )}
        </button>
      </div>

      {/* Bottom row — action buttons */}
      <div className="flex items-center gap-1.5">
        <button
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-surface-2)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-primary)] transition-all duration-150 hover:bg-[var(--color-surface-3)]"
          onClick={onArchive}
          type="button"
          title={`${archiveLabel} ${selectedCount} session${selectedCount === 1 ? '' : 's'}`}
        >
          <ArchiveIcon className="size-3.5" />
          {archiveLabel}
        </button>
        <button
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-status-error)]/10 px-3 py-1.5 text-[12px] font-medium text-[var(--color-status-error)] transition-all duration-150 hover:bg-[var(--color-status-error)]/20"
          onClick={onDelete}
          type="button"
          title={`Delete ${selectedCount} session${selectedCount === 1 ? '' : 's'}`}
        >
          <Trash2 className="size-3.5" />
          Delete
        </button>
        <button
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-all duration-150 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
          onClick={onCancel}
          type="button"
          aria-label="Exit multi-select"
          title="Exit multi-select (Esc)"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
