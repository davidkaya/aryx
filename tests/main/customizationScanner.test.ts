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
  test('discovers project instructions, custom agents, and prompt files', async () => {
    const projectPath = await createTempDirectory();
    await mkdir(join(projectPath, '.github', 'agents'), { recursive: true });
    await mkdir(join(projectPath, '.github', 'prompts'), { recursive: true });

    await writeFile(
      join(projectPath, '.github', 'copilot-instructions.md'),
      '# Repo instructions\nUse TypeScript.\n',
      'utf8',
    );
    await writeFile(
      join(projectPath, 'AGENTS.md'),
      '# Agent guidance\nPrefer clear tests.\n',
      'utf8',
    );
    await writeFile(
      join(projectPath, '.github', 'agents', 'readme-specialist.agent.md'),
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
      join(projectPath, '.github', 'prompts', 'explain-code.prompt.md'),
      `---
agent: agent
description: Generate a clear explanation
---
Explain the following code:
\${input:code:Paste your code here}
Audience: \${input:audience:Who is this for?}
`,
      'utf8',
    );

    const scanned = await new ProjectCustomizationScanner().scanProject(projectPath);

    expect(scanned.instructions).toEqual([
      {
        id: expect.any(String),
        sourcePath: '.github\\copilot-instructions.md',
        content: '# Repo instructions\nUse TypeScript.',
      },
      {
        id: expect.any(String),
        sourcePath: 'AGENTS.md',
        content: '# Agent guidance\nPrefer clear tests.',
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
        sourcePath: '.github\\agents\\readme-specialist.agent.md',
        enabled: true,
      },
    ]);
    expect(scanned.promptFiles).toEqual([
      {
        id: expect.any(String),
        name: 'explain-code',
        description: 'Generate a clear explanation',
        agent: 'agent',
        template: 'Explain the following code:\n${input:code:Paste your code here}\nAudience: ${input:audience:Who is this for?}',
        variables: [
          { name: 'code', placeholder: 'Paste your code here' },
          { name: 'audience', placeholder: 'Who is this for?' },
        ],
        sourcePath: '.github\\prompts\\explain-code.prompt.md',
      },
    ]);
    expect(scanned.lastScannedAt).toEqual(expect.any(String));
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
