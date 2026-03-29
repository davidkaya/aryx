import { ToggleSwitch } from './ToggleSwitch';

export interface PopoverToggleRowProps {
  label: string;
  detail?: string;
  enabled: boolean;
  onToggle: () => void;
}

export function PopoverToggleRow({ label, detail, enabled, onToggle }: PopoverToggleRowProps) {
  return (
    <button
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-all duration-150 hover:bg-[var(--color-surface-2)]"
      onClick={onToggle}
      type="button"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-[var(--color-text-primary)]">{label}</div>
        {detail && <div className="truncate text-[10px] text-[var(--color-text-muted)]">{detail}</div>}
      </div>
      <ToggleSwitch enabled={enabled} size="sm" />
    </button>
  );
}
