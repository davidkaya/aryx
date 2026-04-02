import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

type MarkdownLinkResolutionContext = {
  projectPath: string;
  allowedRootPath: string;
  sourceFilePath: string;
  seenPaths: Set<string>;
  ancestry: readonly string[];
};

export async function expandMarkdownFileLinks(
  content: string,
  options: {
    projectPath: string;
    allowedRootPath: string;
    sourceFilePath: string;
  },
): Promise<string> {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return trimmedContent;
  }

  return expandMarkdownFileLinksRecursive(trimmedContent, {
    ...options,
    seenPaths: new Set<string>(),
    ancestry: [options.sourceFilePath],
  });
}

async function expandMarkdownFileLinksRecursive(
  content: string,
  context: MarkdownLinkResolutionContext,
): Promise<string> {
  const referencedBlocks: string[] = [];

  for (const linkTarget of collectLocalMarkdownLinkTargets(content)) {
    const resolvedPath = resolveMarkdownLinkTarget(context.sourceFilePath, linkTarget);
    if (!resolvedPath) {
      continue;
    }

    if (!isPathInsideRoot(resolvedPath, context.allowedRootPath)) {
      console.warn(
        `[aryx customization] Ignoring linked file outside the allowed customization root: ${resolvedPath}`,
      );
      continue;
    }

    if (context.seenPaths.has(resolvedPath)) {
      continue;
    }

    if (context.ancestry.includes(resolvedPath)) {
      console.warn(`[aryx customization] Ignoring circular Markdown link reference to ${resolvedPath}.`);
      continue;
    }

    const linkedContent = await readLinkedFile(resolvedPath);
    if (linkedContent === undefined) {
      continue;
    }

    context.seenPaths.add(resolvedPath);
    const expandedLinkedContent = isMarkdownLikePath(resolvedPath)
      ? await expandMarkdownFileLinksRecursive(linkedContent, {
          ...context,
          sourceFilePath: resolvedPath,
          ancestry: [...context.ancestry, resolvedPath],
        })
      : linkedContent.trim();

    referencedBlocks.push(
      formatReferencedFileBlock(
        toProjectSourcePath(context.projectPath, resolvedPath),
        expandedLinkedContent,
      ),
    );
  }

  if (referencedBlocks.length === 0) {
    return content.trim();
  }

  return `${content.trim()}\n\nReferenced file context:\n\n${referencedBlocks.join('\n\n')}`.trim();
}

function collectLocalMarkdownLinkTargets(content: string): string[] {
  const targets: string[] = [];
  const seenTargets = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = markdownLinkPattern.exec(content))) {
    const target = match[1]?.trim();
    if (!target || seenTargets.has(target)) {
      continue;
    }

    seenTargets.add(target);
    targets.push(target);
  }

  markdownLinkPattern.lastIndex = 0;
  return targets;
}

function resolveMarkdownLinkTarget(sourceFilePath: string, rawTarget: string): string | undefined {
  const target = extractMarkdownLinkDestination(rawTarget);
  if (!target) {
    return undefined;
  }

  return resolve(dirname(sourceFilePath), target);
}

function extractMarkdownLinkDestination(rawTarget: string): string | undefined {
  let target = rawTarget.trim();
  if (!target) {
    return undefined;
  }

  if (target.startsWith('<') && target.endsWith('>')) {
    target = target.slice(1, -1).trim();
  } else {
    const whitespaceIndex = target.search(/\s/);
    if (whitespaceIndex >= 0) {
      target = target.slice(0, whitespaceIndex);
    }
  }

  const hashIndex = target.indexOf('#');
  if (hashIndex >= 0) {
    target = target.slice(0, hashIndex);
  }

  if (!target) {
    return undefined;
  }

  const normalizedTarget = target.toLowerCase();
  if (
    target.startsWith('#')
    || isAbsolute(target)
    || normalizedTarget.startsWith('http://')
    || normalizedTarget.startsWith('https://')
    || normalizedTarget.startsWith('mailto:')
    || normalizedTarget.startsWith('vscode:')
    || normalizedTarget.startsWith('command:')
    || normalizedTarget.startsWith('data:')
  ) {
    return undefined;
  }

  return target;
}

async function readLinkedFile(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, 'utf8');
    if (content.includes('\0')) {
      console.warn(`[aryx customization] Ignoring binary-linked file ${filePath}.`);
      return undefined;
    }

    return content.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`[aryx customization] Linked file not found: ${filePath}`);
      return undefined;
    }

    console.warn(`[aryx customization] Failed to read linked file ${filePath}:`, error);
    return undefined;
  }
}

function formatReferencedFileBlock(sourcePath: string, content: string): string {
  return [
    `Source: ${sourcePath}`,
    'Contents:',
    content.trim() || '[empty file]',
  ].join('\n');
}

function isMarkdownLikePath(filePath: string): boolean {
  const normalizedPath = filePath.toLowerCase();
  return normalizedPath.endsWith('.md') || normalizedPath.endsWith('.markdown');
}

function isPathInsideRoot(filePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, filePath);
  return relativePath.length === 0
    || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function toProjectSourcePath(projectPath: string, filePath: string): string {
  const relativePath = relative(projectPath, filePath).trim();
  return relativePath ? relativePath.replaceAll('/', '\\') : basename(filePath);
}
