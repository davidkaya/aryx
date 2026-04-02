import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProjectCustomizationScanner } from '@main/services/customizationScanner';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aryx-customization-scanner-'));
  temporaryPaths.push(directory);
  return directory;
}

describe('ProjectCustomizationScanner', () => {
  test('discovers recursive instruction, agent, and prompt files with metadata', async () => {
    const projectPath = await createTempDirectory();
    await mkdir(join(projectPath, '.claude', 'rules'), { recursive: true });
    await mkdir(join(projectPath, '.github', 'agents', 'docs'), { recursive: true });
    await mkdir(join(projectPath, '.github', 'instructions', 'frontend'), { recursive: true });
    await mkdir(join(projectPath, '.github', 'instructions', 'tasks'), { recursive: true });
    await mkdir(join(projectPath, '.github', 'prompts', 'docs'), { recursive: true });

    await writeFile(
      join(projectPath, '.github', 'copilot-instructions.md'),
      `---
applyTo: "**"
---
# Repo instructions
Use TypeScript.
`,
      'utf8',
    );
    await writeFile(
      join(projectPath, 'AGENTS.md'),
      '# Agent guidance\nPrefer clear tests.\n',
      'utf8',
    );
    await writeFile(
      join(projectPath, '.claude', 'CLAUDE.md'),
      '# Claude guidance\nPrefer cohesive designs.\n',
      'utf8',
    );
    await writeFile(
      join(projectPath, '.claude', 'rules', 'typescript.md'),
      `---
name: Claude TypeScript Rules
description: Claude-format TypeScript rules
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
---
Always use strict TypeScript settings.
`,
      'utf8',
    );
    await writeFile(
      join(projectPath, '.github', 'instructions', 'frontend', 'react.instructions.md'),
      `---
name: React Standards
description: React file conventions
applyTo: "**/*.tsx"
---
Apply the [shared standards](./shared-standards.md).

Use hooks and keep components focused.
`,
      'utf8',
    );
    await writeFile(
      join(projectPath, '.github', 'instructions', 'frontend', 'shared-standards.md'),
      '# Shared Standards\nPrefer explicit props and accessible interactions.\n',
      'utf8',
    );
    await writeFile(
      join(projectPath, '.github', 'instructions', 'tasks', 'planning.instructions.md'),
      `---
description: Planning workflows
---
Create phased plans before implementation.
`,
      'utf8',
    );
    await writeFile(
      join(projectPath, '.github', 'instructions', 'manual.instructions.md'),
      'Only attach manually.',
      'utf8',
    );
    await writeFile(
      join(projectPath, '.github', 'agents', 'docs', 'readme-specialist.agent.md'),
      `---
name: readme-specialist
description: README specialist
tools:
  - read
  - edit
infer: true
mcp-servers:
  docs-mcp:
    type: local
    command: node
    args:
      - docs-server.js
---
Focus on repository documentation only.
`,
      'utf8',
    );
    await writeFile(
      join(projectPath, '.github', 'prompts', 'docs', 'explain-code.prompt.md'),
      `---
name: explain-selected-code
agent: agent
model: Claude Sonnet 4.5
argument-hint: Paste code or describe the area you want explained
description: Generate a clear explanation
tools:
  - view
  - glob
---
Explain the following code:
\${input:code:Paste your code here}
Audience: \${input:audience:Who is this for?}

Follow the [shared explanation rubric](./explanation-rubric.md)
`,
      'utf8',
    );
    await writeFile(
      join(projectPath, '.github', 'prompts', 'docs', 'explanation-rubric.md'),
      '# Explanation rubric\n- Start with a summary.\n- Call out edge cases.\n',
      'utf8',
    );

    const scanned = await new ProjectCustomizationScanner().scanProject(projectPath);

    expect(scanned.instructions).toEqual([
      {
        id: expect.any(String),
        sourcePath: '.claude\\CLAUDE.md',
        content: '# Claude guidance\nPrefer cohesive designs.',
        applicationMode: 'always',
      },
      {
        id: expect.any(String),
        sourcePath: '.claude\\rules\\typescript.md',
        name: 'Claude TypeScript Rules',
        description: 'Claude-format TypeScript rules',
        applyTo: 'src/**/*.ts,src/**/*.tsx',
        content: 'Always use strict TypeScript settings.',
        applicationMode: 'file',
      },
      {
        id: expect.any(String),
        sourcePath: '.github\\copilot-instructions.md',
        content: '# Repo instructions\nUse TypeScript.',
        applyTo: '**',
        applicationMode: 'always',
      },
      {
        id: expect.any(String),
        sourcePath: '.github\\instructions\\frontend\\react.instructions.md',
        name: 'React Standards',
        description: 'React file conventions',
        applyTo: '**/*.tsx',
        content:
          'Apply the [shared standards](./shared-standards.md).\n\n'
          + 'Use hooks and keep components focused.\n\n'
          + 'Referenced file context:\n\n'
          + 'Source: .github\\instructions\\frontend\\shared-standards.md\n'
          + 'Contents:\n'
          + '# Shared Standards\nPrefer explicit props and accessible interactions.',
        applicationMode: 'file',
      },
      {
        id: expect.any(String),
        sourcePath: '.github\\instructions\\manual.instructions.md',
        content: 'Only attach manually.',
        applicationMode: 'manual',
      },
      {
        id: expect.any(String),
        sourcePath: '.github\\instructions\\tasks\\planning.instructions.md',
        description: 'Planning workflows',
        content: 'Create phased plans before implementation.',
        applicationMode: 'task',
      },
      {
        id: expect.any(String),
        sourcePath: 'AGENTS.md',
        content: '# Agent guidance\nPrefer clear tests.',
        applicationMode: 'always',
      },
    ]);
    expect(scanned.agentProfiles).toEqual([
      {
        id: expect.any(String),
        name: 'readme-specialist',
        description: 'README specialist',
        tools: ['read', 'edit'],
        prompt: 'Focus on repository documentation only.',
        infer: true,
        mcpServers: {
          'docs-mcp': {
            args: ['docs-server.js'],
            command: 'node',
            type: 'local',
          },
        },
        sourcePath: '.github\\agents\\docs\\readme-specialist.agent.md',
        enabled: true,
      },
    ]);
    expect(scanned.promptFiles).toEqual([
      {
        id: expect.any(String),
        name: 'explain-selected-code',
        description: 'Generate a clear explanation',
        argumentHint: 'Paste code or describe the area you want explained',
        agent: 'agent',
        model: 'Claude Sonnet 4.5',
        tools: ['view', 'glob'],
        template:
          'Explain the following code:\n'
          + '${input:code:Paste your code here}\n'
          + 'Audience: ${input:audience:Who is this for?}\n\n'
          + 'Follow the [shared explanation rubric](./explanation-rubric.md)\n\n'
          + 'Referenced file context:\n\n'
          + 'Source: .github\\prompts\\docs\\explanation-rubric.md\n'
          + 'Contents:\n'
          + '# Explanation rubric\n- Start with a summary.\n- Call out edge cases.',
        variables: [
          { name: 'code', placeholder: 'Paste your code here' },
          { name: 'audience', placeholder: 'Who is this for?' },
        ],
        sourcePath: '.github\\prompts\\docs\\explain-code.prompt.md',
      },
    ]);
    expect(scanned.lastScannedAt).toEqual(expect.any(String));
  });

  test('discovers customization files from parent repository roots', async () => {
    const repoRoot = await createTempDirectory();
    const projectPath = join(repoRoot, 'packages', 'frontend');
    await mkdir(join(repoRoot, '.git'), { recursive: true });
    await mkdir(join(projectPath, 'src'), { recursive: true });
    await mkdir(join(repoRoot, '.github', 'prompts'), { recursive: true });
    await mkdir(join(repoRoot, '.claude', 'rules'), { recursive: true });
    await mkdir(join(repoRoot, 'docs'), { recursive: true });

    await writeFile(
      join(repoRoot, '.github', 'prompts', 'repo-review.prompt.md'),
      `---
name: repo-review
model: GPT-5.4
---
Review the repo using the [checklist](../../docs/review-checklist.md).
`,
      'utf8',
    );
    await writeFile(
      join(repoRoot, '.claude', 'rules', 'global.md'),
      'Use the monorepo release process.',
      'utf8',
    );
    await writeFile(
      join(repoRoot, 'docs', 'review-checklist.md'),
      '# Checklist\n- Confirm changelog updates.\n- Check release notes.\n',
      'utf8',
    );

    const scanned = await new ProjectCustomizationScanner().scanProject(projectPath);

    expect(scanned.instructions).toEqual([
      {
        id: expect.any(String),
        sourcePath: '..\\..\\.claude\\rules\\global.md',
        applyTo: '**',
        content: 'Use the monorepo release process.',
        applicationMode: 'always',
      },
    ]);
    expect(scanned.promptFiles).toEqual([
      {
        id: expect.any(String),
        name: 'repo-review',
        model: 'GPT-5.4',
        template:
          'Review the repo using the [checklist](../../docs/review-checklist.md).\n\n'
          + 'Referenced file context:\n\n'
          + 'Source: ..\\..\\docs\\review-checklist.md\n'
          + 'Contents:\n'
          + '# Checklist\n- Confirm changelog updates.\n- Check release notes.',
        variables: [],
        sourcePath: '..\\..\\.github\\prompts\\repo-review.prompt.md',
      },
    ]);
  });

  test('retains the previous parsed agent profile when frontmatter becomes malformed', async () => {
    const projectPath = await createTempDirectory();
    await mkdir(join(projectPath, '.github', 'agents'), { recursive: true });
    const filePath = join(projectPath, '.github', 'agents', 'reviewer.agent.md');

    await writeFile(
      filePath,
      `---
name: reviewer
description: Review specialist
tools: [read, search]
---
Review code changes carefully.
`,
      'utf8',
    );

    const scanner = new ProjectCustomizationScanner();
    const firstScan = await scanner.scanProject(projectPath);
    const previousState = {
      ...firstScan,
      agentProfiles: firstScan.agentProfiles.map((profile) => ({ ...profile, enabled: false })),
    };

    await writeFile(
      filePath,
      `---
name: [reviewer
description: broken yaml
---
This should not replace the previous state.
`,
      'utf8',
    );

    const secondScan = await scanner.scanProject(projectPath, previousState);

    expect(secondScan.agentProfiles).toEqual(previousState.agentProfiles);
  });
});
