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

/* ── Verb-based primary labels ─────────────────────────────── */

function shortenPath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  return truncateSummary(fileName);
}

function pathWithRange(args: Record<string, unknown>): string | undefined {
  const path = stringArg(args, 'path');
  if (!path) return undefined;
  const name = shortenPath(path);
  const range = args['view_range'] ?? args['viewRange'];
  if (Array.isArray(range) && range.length === 2) {
    return `${name}:${range[0]}-${range[1]}`;
  }
  return name;
}

type VerbLabelExtractor = (args: Record<string, unknown>) => string;

const verbLabels: Record<string, VerbLabelExtractor> = {
  view: (args) => {
    const target = pathWithRange(args);
    return target ? `Viewed \`${target}\`` : 'Viewed a file';
  },
  edit: (args) => {
    const name = stringArg(args, 'path') ? shortenPath(stringArg(args, 'path')!) : undefined;
    return name ? `Edited \`${name}\`` : 'Edited a file';
  },
  create: (args) => {
    const name = stringArg(args, 'path') ? shortenPath(stringArg(args, 'path')!) : undefined;
    return name ? `Created \`${name}\`` : 'Created a file';
  },
  grep: (args) => {
    const pattern = stringArg(args, 'pattern');
    return pattern ? `Searched for \`${truncateSummary(pattern)}\`` : 'Searched files';
  },
  glob: (args) => {
    const pattern = stringArg(args, 'pattern');
    return pattern ? `Glob \`${truncateSummary(pattern)}\`` : 'Searched for files';
  },
  lsp: (args) => {
    const op = stringArg(args, 'operation');
    const file = stringArg(args, 'file') ? shortenPath(stringArg(args, 'file')!) : undefined;
    if (op && file) return `LSP ${op} \`${file}\``;
    return op ? `LSP ${op}` : 'LSP operation';
  },
  powershell: (args) => {
    const cmd = stringArg(args, 'command');
    return cmd ? `Ran \`${truncateSummary(cmd)}\`` : 'Ran a command';
  },
  web_fetch: (args) => {
    const url = stringArg(args, 'url');
    if (!url) return 'Fetched a URL';
    try {
      const hostname = new URL(url).hostname;
      return `Fetched \`${hostname}\``;
    } catch {
      return `Fetched \`${truncateSummary(url)}\``;
    }
  },
  web_search: (args) => {
    const query = stringArg(args, 'query');
    return query ? `Searched web: "${truncateSummary(query)}"` : 'Web search';
  },
  sql: (args) => {
    const desc = stringArg(args, 'description');
    return desc ? `SQL: ${truncateSummary(desc)}` : 'SQL query';
  },
  task: (args) => {
    const desc = stringArg(args, 'description');
    return desc ? `Launched agent: ${truncateSummary(desc)}` : 'Launched agent';
  },
  ask_user: (args) => {
    const q = stringArg(args, 'question');
    return q ? `Asked: "${truncateSummary(q)}"` : 'Asked a question';
  },
  skill: (args) => {
    const name = stringArg(args, 'skill');
    return name ? `Used skill \`${name}\`` : 'Used a skill';
  },
  store_memory: () => 'Stored a memory',
  report_intent: (args) => {
    const intent = stringArg(args, 'intent');
    return intent ? intent : 'Updated intent';
  },
};

/**
 * Produces a verb-based, context-rich label for a tool call.
 * E.g. "Viewed `ChatPane.tsx:148-250`", "Searched for `toolCall`".
 * Falls back to "Used <toolName>" when no specific formatter exists.
 */
export function formatToolCallPrimaryLabel(
  toolName: string | undefined,
  toolArguments: Record<string, unknown> | undefined,
): string {
  if (!toolName) return 'Tool call';

  const args = toolArguments ?? {};

  // GitHub MCP tools
  if (toolName.startsWith('github-')) {
    const detail = summarizeGitHub(toolName, args);
    const shortName = toolName.replace(/^github-mcp-server-/, '').replace(/_/g, ' ');
    return detail ? `GitHub: ${shortName} — ${detail}` : `GitHub: ${shortName}`;
  }

  const extractor = verbLabels[toolName];
  if (extractor) {
    return extractor(args);
  }

  // Unknown tool — try to extract something useful
  const detail = fallbackSummary(args);
  return detail ? `Used ${toolName}: ${detail}` : `Used ${toolName}`;
}

/**
 * Produces a compact group label for N consecutive calls of the same tool.
 * E.g. "Viewed 4 files", "Ran 3 commands", "Searched 5 patterns".
 */
export function formatToolGroupLabel(toolName: string, count: number): string {
  const n = count;
  switch (toolName) {
    case 'view': return `Viewed ${n} ${n === 1 ? 'file' : 'files'}`;
    case 'edit': return `Edited ${n} ${n === 1 ? 'file' : 'files'}`;
    case 'create': return `Created ${n} ${n === 1 ? 'file' : 'files'}`;
    case 'grep': return `Searched ${n} ${n === 1 ? 'pattern' : 'patterns'}`;
    case 'glob': return `Glob ${n} ${n === 1 ? 'pattern' : 'patterns'}`;
    case 'lsp': return `${n} LSP ${n === 1 ? 'operation' : 'operations'}`;
    case 'powershell': return `Ran ${n} ${n === 1 ? 'command' : 'commands'}`;
    case 'web_fetch': return `Fetched ${n} ${n === 1 ? 'URL' : 'URLs'}`;
    case 'sql': return `${n} SQL ${n === 1 ? 'query' : 'queries'}`;
    case 'task': return `Launched ${n} ${n === 1 ? 'agent' : 'agents'}`;
    default: return `${n} ${toolName} ${n === 1 ? 'call' : 'calls'}`;
  }
}

/**
 * Extracts a short contextual snippet for a tool call to show inside
 * a grouped row's detail list (e.g. the file path for view, the pattern for grep).
 */
export function extractToolCallSnippet(
  toolName: string,
  toolArguments: Record<string, unknown> | undefined,
): string | undefined {
  if (!toolArguments) return undefined;
  switch (toolName) {
    case 'view':
    case 'edit':
    case 'create':
      return pathWithRange(toolArguments) ?? stringArg(toolArguments, 'path');
    case 'grep':
    case 'glob':
      return stringArg(toolArguments, 'pattern');
    case 'powershell':
      return stringArg(toolArguments, 'command') ? truncateSummary(stringArg(toolArguments, 'command')!) : undefined;
    case 'lsp': {
      const op = stringArg(toolArguments, 'operation');
      const file = stringArg(toolArguments, 'file') ? shortenPath(stringArg(toolArguments, 'file')!) : undefined;
      if (op && file) return `${op} ${file}`;
      return op ?? undefined;
    }
    case 'web_fetch':
      return stringArg(toolArguments, 'url');
    case 'sql':
      return stringArg(toolArguments, 'description');
    case 'task':
      return stringArg(toolArguments, 'description');
    default:
      return undefined;
  }
}
