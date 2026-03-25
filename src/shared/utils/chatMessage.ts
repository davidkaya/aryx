export function normalizeChatMessageLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function hasMeaningfulChatMessageContent(value: string): boolean {
  return normalizeChatMessageLineEndings(value).trim().length > 0;
}

export function prepareChatMessageContent(value: string): string | undefined {
  const normalized = normalizeChatMessageLineEndings(value);
  return normalized.trim().length > 0 ? normalized : undefined;
}
