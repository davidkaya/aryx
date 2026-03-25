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
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-zinc-800"
      onClick={onToggle}
      type="button"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-zinc-300">{label}</div>
        {detail && <div className="truncate text-[10px] text-zinc-600">{detail}</div>}
      </div>
      <ToggleSwitch enabled={enabled} size="sm" />
    </button>
  );
}
