import type { ReactNode } from 'react';

export function FormField({
  label,
  required,
  description,
  children,
}: {
  label: string;
  required?: boolean;
  description?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-[var(--color-text-secondary)]">
        {label}
        {required && <span className="ml-1 text-[var(--color-status-warning)]">*</span>}
      </span>
      {children}
      {description && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{description}</p>
      )}
    </label>
  );
}
