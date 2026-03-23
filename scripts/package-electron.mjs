import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rcedit } from 'rcedit';

const productName = 'Kopaya';
const sidecarRuntime = 'win-x64';
const outputDirectoryName = 'win-unpacked';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const assetDirectory = join(repositoryRoot, 'assets');
const sourceIconPath = join(assetDirectory, 'icons', 'icon.png');
const windowsIconPath = join(assetDirectory, 'icons', 'windows', 'icon.ico');
const electronDistributionDirectory = join(repositoryRoot, 'node_modules', 'electron', 'dist');
const rendererBuildDirectory = join(repositoryRoot, 'dist');
const electronBuildDirectory = join(repositoryRoot, 'dist-electron');
const publishedSidecarDirectory = join(repositoryRoot, 'dist-sidecar', sidecarRuntime);
const outputDirectory = join(repositoryRoot, 'release', outputDirectoryName);
const outputResourcesDirectory = join(outputDirectory, 'resources');
const packagedAppDirectory = join(outputResourcesDirectory, 'app');
const packagedExecutablePath = join(outputDirectory, `${productName}.exe`);

async function ensurePathExists(path, label) {
  try {
    await access(path, constants.F_OK);
  } catch {
    throw new Error(`${label} was not found at ${path}.`);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function collectRuntimeDependencies() {
  const rootPackageJson = await readJson(join(repositoryRoot, 'package.json'));
  const dependencies = new Set(Object.keys(rootPackageJson.dependencies ?? {}));
  const queue = [...dependencies];

  while (queue.length > 0) {
    const dependencyName = queue.shift();
    const dependencyPackageJson = await readJson(
      join(repositoryRoot, 'node_modules', ...dependencyName.split('/'), 'package.json'),
    );

    for (const transitiveDependency of Object.keys({
      ...(dependencyPackageJson.dependencies ?? {}),
      ...(dependencyPackageJson.optionalDependencies ?? {}),
    })) {
      if (!dependencies.has(transitiveDependency)) {
        dependencies.add(transitiveDependency);
        queue.push(transitiveDependency);
      }
    }
  }

  return [...dependencies].sort();
}

async function copyRuntimeDependencies(dependencyNames) {
  const packagedNodeModulesDirectory = join(packagedAppDirectory, 'node_modules');
  await mkdir(packagedNodeModulesDirectory, { recursive: true });

  for (const dependencyName of dependencyNames) {
    const dependencyPathParts = dependencyName.split('/');
    const sourceDirectory = join(repositoryRoot, 'node_modules', ...dependencyPathParts);
    const targetDirectory = join(packagedNodeModulesDirectory, ...dependencyPathParts);
    await mkdir(dirname(targetDirectory), { recursive: true });
    await cp(sourceDirectory, targetDirectory, { recursive: true });
  }
}

async function writePackagedManifest() {
  const sourcePackageJson = await readJson(join(repositoryRoot, 'package.json'));
  const packagedManifest = {
    name: sourcePackageJson.name,
    productName,
    version: sourcePackageJson.version,
    description: sourcePackageJson.description,
    main: sourcePackageJson.main,
    author: sourcePackageJson.author,
    license: sourcePackageJson.license,
  };

  await writeFile(join(packagedAppDirectory, 'package.json'), `${JSON.stringify(packagedManifest, null, 2)}\n`);
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('This packaging script currently targets Windows only.');
  }

  await Promise.all([
    ensurePathExists(assetDirectory, 'Application assets'),
    ensurePathExists(sourceIconPath, 'Source application icon'),
    ensurePathExists(windowsIconPath, 'Windows application icon'),
    ensurePathExists(electronDistributionDirectory, 'Electron runtime'),
    ensurePathExists(rendererBuildDirectory, 'Renderer build output'),
    ensurePathExists(electronBuildDirectory, 'Electron build output'),
    ensurePathExists(publishedSidecarDirectory, 'Published sidecar output'),
  ]);

  const runtimeDependencies = await collectRuntimeDependencies();

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await cp(electronDistributionDirectory, outputDirectory, { recursive: true });
  await rename(join(outputDirectory, 'electron.exe'), packagedExecutablePath);

  await mkdir(packagedAppDirectory, { recursive: true });
  await Promise.all([
    writePackagedManifest(),
    cp(assetDirectory, join(packagedAppDirectory, 'assets'), { recursive: true }),
    cp(rendererBuildDirectory, join(packagedAppDirectory, 'dist'), { recursive: true }),
    cp(electronBuildDirectory, join(packagedAppDirectory, 'dist-electron'), { recursive: true }),
    cp(publishedSidecarDirectory, join(outputResourcesDirectory, 'sidecar'), { recursive: true }),
  ]);
  await copyRuntimeDependencies(runtimeDependencies);
  await rcedit(packagedExecutablePath, { icon: windowsIconPath });

  console.log(`Packaged ${productName} to ${outputDirectory}`);
  console.log(`Bundled ${runtimeDependencies.length} runtime dependencies and the self-contained .NET sidecar.`);
}

await main();
