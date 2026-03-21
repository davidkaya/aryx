export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
