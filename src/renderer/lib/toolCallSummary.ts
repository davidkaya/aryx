const MAX_SUMMARY_LENGTH = 80;

function truncateSummary(value: string): string {
  const firstLine = value.split('\n')[0] ?? '';
  const cleaned = firstLine.trim();
  if (cleaned.length <= MAX_SUMMARY_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_SUMMARY_LENGTH)}…`;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function summarizePath(args: Record<string, unknown>): string | undefined {
  const path = stringArg(args, 'path');
  if (!path) return undefined;
  const range = args['view_range'] ?? args['viewRange'];
  if (Array.isArray(range) && range.length === 2) {
    return truncateSummary(`${path}:${range[0]}-${range[1]}`);
  }
  return truncateSummary(path);
}

function summarizeGitHub(toolName: string, args: Record<string, unknown>): string | undefined {
  const owner = stringArg(args, 'owner');
  const repo = stringArg(args, 'repo');
  const query = stringArg(args, 'query');

  if (query) return truncateSummary(query);
  if (owner && repo) return truncateSummary(`${owner}/${repo}`);
  return undefined;
}

type SummaryExtractor = (args: Record<string, unknown>, toolName: string) => string | undefined;

const toolSummarizers: Record<string, SummaryExtractor> = {
  powershell: (args) => stringArg(args, 'command') ? truncateSummary(stringArg(args, 'command')!) : undefined,
  view: (args) => summarizePath(args),
  edit: (args) => summarizePath(args),
  create: (args) => summarizePath(args),
  grep: (args) => stringArg(args, 'pattern') ? truncateSummary(stringArg(args, 'pattern')!) : undefined,
  glob: (args) => stringArg(args, 'pattern') ? truncateSummary(stringArg(args, 'pattern')!) : undefined,
  lsp: (args) => {
    const op = stringArg(args, 'operation');
    const file = stringArg(args, 'file');
    if (op && file) return truncateSummary(`${op} ${file}`);
    return op ? truncateSummary(op) : undefined;
  },
  web_fetch: (args) => stringArg(args, 'url') ? truncateSummary(stringArg(args, 'url')!) : undefined,
  sql: (args) => stringArg(args, 'description') ? truncateSummary(stringArg(args, 'description')!) : undefined,
  task: (args) => stringArg(args, 'description') ? truncateSummary(stringArg(args, 'description')!) : undefined,
  ask_user: (args) => stringArg(args, 'question') ? truncateSummary(stringArg(args, 'question')!) : undefined,
  skill: (args) => stringArg(args, 'skill') ? truncateSummary(stringArg(args, 'skill')!) : undefined,
  report_intent: (args) => stringArg(args, 'intent') ? truncateSummary(stringArg(args, 'intent')!) : undefined,
};

function fallbackSummary(args: Record<string, unknown>): string | undefined {
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value.trim().length > 0 && value !== '[truncated]') {
      return truncateSummary(value);
    }
  }
  return undefined;
}

export function formatToolCallSummary(
  toolName: string | undefined,
  toolArguments: Record<string, unknown> | undefined,
): string | undefined {
  if (!toolName || !toolArguments || Object.keys(toolArguments).length === 0) {
    return undefined;
  }

  // Check for GitHub tools (github-*)
  if (toolName.startsWith('github-')) {
    return summarizeGitHub(toolName, toolArguments);
  }

  const summarizer = toolSummarizers[toolName];
  if (summarizer) {
    return summarizer(toolArguments, toolName);
  }

  return fallbackSummary(toolArguments);
}

export function formatToolArgumentValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Keys that are redundant with the label itself or too noisy to display inline. */
const HIDDEN_ARGUMENT_KEYS = new Set([
  'description', // often duplicates the summary
]);

export function getDisplayableArguments(
  toolArguments: Record<string, unknown> | undefined,
): Array<[string, unknown]> {
  if (!toolArguments) return [];

  return Object.entries(toolArguments).filter(
    ([key, value]) =>
      !HIDDEN_ARGUMENT_KEYS.has(key)
      && value !== null
      && value !== undefined
      && value !== '',
  );
}
