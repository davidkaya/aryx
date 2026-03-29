export interface ToggleSwitchProps {
  enabled: boolean;
  size?: 'sm' | 'md';
}

export function ToggleSwitch({ enabled, size = 'md' }: ToggleSwitchProps) {
  const trackSize = size === 'sm' ? 'h-[14px] w-[24px]' : 'h-[18px] w-[32px]';
  const thumbSize = size === 'sm' ? 'size-[10px]' : 'size-[14px]';
  const translateOn = size === 'sm' ? 'translate-x-[12px]' : 'translate-x-[16px]';

  return (
    <span
      className={`relative inline-flex ${trackSize} shrink-0 items-center rounded-full transition-all duration-200 ${
        enabled ? 'brand-gradient-bg shadow-[0_0_8px_rgba(36,92,249,0.3)]' : 'bg-[var(--color-surface-3)]'
      }`}
    >
      <span
        className={`inline-block ${thumbSize} rounded-full bg-white shadow-sm transition-transform ${
          enabled ? translateOn : 'translate-x-[2px]'
        }`}
      />
    </span>
  );
}
