function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 0);
}

function shouldInsertNewlineBoundary(current: string, incoming: string): boolean {
  if (current.endsWith('\n')) {
    return false;
  }

  return /^(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)/.test(incoming.trimStart());
}

function shouldInsertSpaceBoundary(current: string, incoming: string): boolean {
  const lastChar = current.at(-1);
  const firstChar = incoming[0];
  if (!lastChar || !firstChar) {
    return false;
  }

  if (/\s/.test(lastChar) || /\s/.test(firstChar) || /[([{/"'`]/.test(lastChar)) {
    return false;
  }

  if (/^[.,!?;:%)\]}]/.test(firstChar)) {
    return false;
  }

  if (/^[*_`~\[]/.test(firstChar) || /^[A-Z0-9]/.test(firstChar)) {
    return true;
  }

  const currentTokens = tokenize(current);
  const incomingTokens = tokenize(incoming);
  const firstIncomingToken = incomingTokens[0] ?? '';

  return currentTokens.length >= 2 && incomingTokens.length >= 2 && firstIncomingToken.length >= 2;
}

function appendWithNaturalBoundary(current: string, incoming: string): string {
  if (shouldInsertNewlineBoundary(current, incoming)) {
    return `${current}\n${incoming}`;
  }

  if (shouldInsertSpaceBoundary(current, incoming)) {
    return `${current} ${incoming}`;
  }

  return current + incoming;
}

function computeSuffixPrefixOverlap(current: string, incoming: string): number {
  const maxOverlap = Math.min(current.length, incoming.length);
  for (let length = maxOverlap; length > 0; length -= 1) {
    if (current.slice(-length) === incoming.slice(0, length)) {
      return length;
    }
  }

  return 0;
}

function shouldReplaceWithSnapshot(current: string, incoming: string): boolean {
  if (incoming.length < Math.floor(current.length * 0.6)) {
    return false;
  }

  const currentTokens = new Set(tokenize(current));
  const incomingTokens = new Set(tokenize(incoming));
  if (currentTokens.size < 3 || incomingTokens.size < 3) {
    return false;
  }

  let shared = 0;
  for (const token of incomingTokens) {
    if (currentTokens.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.min(currentTokens.size, incomingTokens.size) >= 0.5;
}

export function mergeStreamingText(current: string, incoming: string): string {
  if (!current) {
    return incoming;
  }

  if (!incoming) {
    return current;
  }

  if (incoming.startsWith(current) || incoming.includes(current)) {
    return incoming;
  }

  if (current.includes(incoming)) {
    return current;
  }

  const overlap = computeSuffixPrefixOverlap(current, incoming);
  if (overlap > 0) {
    return current + incoming.slice(overlap);
  }

  if (shouldReplaceWithSnapshot(current, incoming)) {
    return incoming;
  }

  return appendWithNaturalBoundary(current, incoming);
}
