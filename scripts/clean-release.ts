import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const releaseDirectory = resolve(repositoryRoot, 'release');

await rm(releaseDirectory, { recursive: true, force: true });
