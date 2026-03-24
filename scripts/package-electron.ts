import { constants } from 'node:fs';
import { access, chmod, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  macBundleIdentifier,
  productName,
  resolveReleaseTarget,
  type ReleaseTarget,
} from './releaseTarget';

interface PackageManifest {
  readonly name: string;
  readonly productName: string;
  readonly version: string;
  readonly description?: string;
  readonly main: string;
  readonly author?: string;
  readonly license?: string;
}

interface RootPackageJson {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly main: string;
  readonly author?: string;
  readonly license?: string;
  readonly dependencies?: Record<string, string>;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const assetDirectory = join(repositoryRoot, 'assets');
const genericIconPath = join(assetDirectory, 'icons', 'icon.png');
const windowsIconPath = join(assetDirectory, 'icons', 'windows', 'icon.ico');
const macosIconPath = join(assetDirectory, 'icons', 'macos', 'icon.icns');
const rendererBuildDirectory = join(repositoryRoot, 'dist');
const electronBuildDirectory = join(repositoryRoot, 'dist-electron');
const releaseTarget = resolveReleaseTarget(process.platform, process.arch);
const releaseRootDirectory = join(repositoryRoot, 'release');
const outputDirectory = join(releaseRootDirectory, releaseTarget.outputDirectoryName);
const electronDistributionDirectory = releaseTarget.platform === 'darwin'
  ? join(repositoryRoot, 'node_modules', 'electron', 'dist', 'Electron.app')
  : join(repositoryRoot, 'node_modules', 'electron', 'dist');
const publishedSidecarDirectory = join(repositoryRoot, 'dist-sidecar', releaseTarget.dotnetRuntime);

async function ensurePathExists(path: string, label: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch {
    throw new Error(`${label} was not found at ${path}.`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function collectRuntimeDependencies(): Promise<string[]> {
  const rootPackageJson = await readJson<RootPackageJson>(join(repositoryRoot, 'package.json'));
  const dependencies = new Set(Object.keys(rootPackageJson.dependencies ?? {}));
  const queue = [...dependencies];

  while (queue.length > 0) {
    const dependencyName = queue.shift();
    if (!dependencyName) {
      continue;
    }

    const dependencyPackageJsonPath = join(
      repositoryRoot,
      'node_modules',
      ...dependencyName.split('/'),
      'package.json',
    );
    if (!(await pathExists(dependencyPackageJsonPath))) {
      dependencies.delete(dependencyName);
      continue;
    }

    const dependencyPackageJson = await readJson<{
      readonly dependencies?: Record<string, string>;
      readonly optionalDependencies?: Record<string, string>;
    }>(dependencyPackageJsonPath);

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

async function copyRuntimeDependencies(
  packagedAppDirectory: string,
  dependencyNames: string[],
): Promise<void> {
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

async function writePackagedManifest(packagedAppDirectory: string): Promise<PackageManifest> {
  const sourcePackageJson = await readJson<RootPackageJson>(join(repositoryRoot, 'package.json'));
  const packagedManifest: PackageManifest = {
    name: sourcePackageJson.name,
    productName,
    version: sourcePackageJson.version,
    description: sourcePackageJson.description,
    main: sourcePackageJson.main,
    author: sourcePackageJson.author,
    license: sourcePackageJson.license,
  };

  await writeFile(
    join(packagedAppDirectory, 'package.json'),
    `${JSON.stringify(packagedManifest, null, 2)}\n`,
  );

  return packagedManifest;
}

async function copyApplicationPayload(
  packagedAppDirectory: string,
  outputResourcesDirectory: string,
  dependencyNames: string[],
): Promise<PackageManifest> {
  await mkdir(packagedAppDirectory, { recursive: true });

  const manifest = await writePackagedManifest(packagedAppDirectory);
  await Promise.all([
    cp(assetDirectory, join(packagedAppDirectory, 'assets'), { recursive: true }),
    cp(rendererBuildDirectory, join(packagedAppDirectory, 'dist'), { recursive: true }),
    cp(electronBuildDirectory, join(packagedAppDirectory, 'dist-electron'), { recursive: true }),
    cp(publishedSidecarDirectory, join(outputResourcesDirectory, 'sidecar'), { recursive: true }),
  ]);

  await copyRuntimeDependencies(packagedAppDirectory, dependencyNames);
  return manifest;
}

async function ensureExecutable(path: string, mode = 0o755): Promise<void> {
  await chmod(path, mode);
}

function replacePlistValue(plistContents: string, key: string, value: string): string {
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`);
  if (!pattern.test(plistContents)) {
    throw new Error(`Could not find ${key} in macOS Info.plist.`);
  }

  return plistContents.replace(pattern, `$1${value}$3`);
}

async function applyMacMetadata(appBundleDirectory: string, version: string): Promise<void> {
  const infoPlistPath = join(appBundleDirectory, 'Contents', 'Info.plist');
  let infoPlistContents = await readFile(infoPlistPath, 'utf8');
  infoPlistContents = replacePlistValue(infoPlistContents, 'CFBundleDisplayName', productName);
  infoPlistContents = replacePlistValue(infoPlistContents, 'CFBundleExecutable', productName);
  infoPlistContents = replacePlistValue(infoPlistContents, 'CFBundleIconFile', 'icon.icns');
  infoPlistContents = replacePlistValue(infoPlistContents, 'CFBundleIdentifier', macBundleIdentifier);
  infoPlistContents = replacePlistValue(infoPlistContents, 'CFBundleName', productName);
  infoPlistContents = replacePlistValue(infoPlistContents, 'CFBundleShortVersionString', version);
  infoPlistContents = replacePlistValue(infoPlistContents, 'CFBundleVersion', version);
  await writeFile(infoPlistPath, infoPlistContents);

  const sourceExecutablePath = join(appBundleDirectory, 'Contents', 'MacOS', 'Electron');
  const targetExecutablePath = join(appBundleDirectory, 'Contents', 'MacOS', productName);
  await rename(sourceExecutablePath, targetExecutablePath);
  await ensureExecutable(targetExecutablePath);
  await cp(macosIconPath, join(appBundleDirectory, 'Contents', 'Resources', 'icon.icns'));
}

async function packageWindows(dependencyNames: string[]): Promise<void> {
  const packagedExecutablePath = join(outputDirectory, `${productName}.exe`);
  const packagedAppDirectory = join(outputDirectory, 'resources', 'app');
  const outputResourcesDirectory = join(outputDirectory, 'resources');

  await cp(electronDistributionDirectory, outputDirectory, { recursive: true });
  await rename(join(outputDirectory, 'electron.exe'), packagedExecutablePath);
  await copyApplicationPayload(packagedAppDirectory, outputResourcesDirectory, dependencyNames);

  const { rcedit } = await import('rcedit');
  await rcedit(packagedExecutablePath, { icon: windowsIconPath });
}

async function packageMac(dependencyNames: string[]): Promise<void> {
  const appBundleName = releaseTarget.appBundleName;
  if (!appBundleName) {
    throw new Error('macOS packaging requires an app bundle name.');
  }

  const appBundleDirectory = join(outputDirectory, appBundleName);
  const packagedAppDirectory = join(appBundleDirectory, 'Contents', 'Resources', 'app');
  const outputResourcesDirectory = join(appBundleDirectory, 'Contents', 'Resources');

  await cp(electronDistributionDirectory, appBundleDirectory, { recursive: true });
  const manifest = await copyApplicationPayload(packagedAppDirectory, outputResourcesDirectory, dependencyNames);
  await applyMacMetadata(appBundleDirectory, manifest.version);
  await ensureExecutable(join(outputResourcesDirectory, 'sidecar', releaseTarget.sidecarExecutableName));
}

async function packageLinux(dependencyNames: string[]): Promise<void> {
  const packagedExecutableName = releaseTarget.packagedExecutableName;
  if (!packagedExecutableName) {
    throw new Error('Linux packaging requires a packaged executable name.');
  }

  const packagedExecutablePath = join(outputDirectory, packagedExecutableName);
  const packagedAppDirectory = join(outputDirectory, 'resources', 'app');
  const outputResourcesDirectory = join(outputDirectory, 'resources');
  const chromeSandboxPath = join(outputDirectory, 'chrome-sandbox');

  await cp(electronDistributionDirectory, outputDirectory, { recursive: true });
  await rename(join(outputDirectory, 'electron'), packagedExecutablePath);
  await ensureExecutable(packagedExecutablePath);
  await copyApplicationPayload(packagedAppDirectory, outputResourcesDirectory, dependencyNames);
  await ensureExecutable(join(outputResourcesDirectory, 'sidecar', releaseTarget.sidecarExecutableName));

  if (await pathExists(chromeSandboxPath)) {
    await chmod(chromeSandboxPath, 0o4755);
  }
}

async function packageCurrentPlatform(target: ReleaseTarget, dependencyNames: string[]): Promise<void> {
  switch (target.platform) {
    case 'win32':
      await packageWindows(dependencyNames);
      return;
    case 'darwin':
      await packageMac(dependencyNames);
      return;
    case 'linux':
      await packageLinux(dependencyNames);
      return;
  }
}

await Promise.all([
  ensurePathExists(assetDirectory, 'Application assets'),
  ensurePathExists(genericIconPath, 'Source application icon'),
  ensurePathExists(electronDistributionDirectory, 'Electron runtime'),
  ensurePathExists(rendererBuildDirectory, 'Renderer build output'),
  ensurePathExists(electronBuildDirectory, 'Electron build output'),
  ensurePathExists(publishedSidecarDirectory, 'Published sidecar output'),
]);

if (releaseTarget.platform === 'win32') {
  await ensurePathExists(windowsIconPath, 'Windows application icon');
}

if (releaseTarget.platform === 'darwin') {
  await ensurePathExists(macosIconPath, 'macOS application icon');
}

const runtimeDependencies = await collectRuntimeDependencies();

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(releaseRootDirectory, { recursive: true });
await packageCurrentPlatform(releaseTarget, runtimeDependencies);

console.log(`Packaged ${productName} for ${releaseTarget.platformLabel} to ${outputDirectory}`);
console.log(`Bundled ${runtimeDependencies.length} runtime dependencies and the self-contained .NET sidecar.`);
