export function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5" aria-label="Thinking">
      <span className="thinking-dot size-2 rounded-full bg-[var(--color-accent)]" />
      <span className="thinking-dot size-2 rounded-full bg-[var(--color-accent-sky)]" />
      <span className="thinking-dot size-2 rounded-full bg-[var(--color-accent-purple)]" />
    </div>
  );
}
