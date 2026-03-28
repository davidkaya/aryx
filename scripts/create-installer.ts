import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import {
  access,
  cp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { productName, resolveReleaseTarget } from './releaseTarget';

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
    });

    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      if (signal) {
        rejectPromise(new Error(`${command} exited because of signal ${signal}.`));
        return;
      }

      rejectPromise(new Error(`${command} exited with code ${code ?? 'unknown'}.`));
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const releaseTarget = resolveReleaseTarget(process.platform, process.arch);
const releaseRootDirectory = join(repositoryRoot, 'release');
const packagedAppDirectory = join(releaseRootDirectory, releaseTarget.outputDirectoryName);
const installerOutputPath = join(releaseRootDirectory, releaseTarget.installerAssetName);
const installerAssetsDirectory = join(repositoryRoot, 'assets', 'installer');

async function readVersion(): Promise<string> {
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, 'package.json'), 'utf8'),
  ) as { version: string };
  return packageJson.version;
}

// --- Windows: Inno Setup installer ---

async function resolveInnoSetupCompilerPath(): Promise<string> {
  const candidates = [
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
    'iscc',
  ];

  for (const candidate of candidates) {
    if (candidate.includes('\\') && (await pathExists(candidate))) {
      return candidate;
    }
  }

  return 'iscc';
}

async function createWindowsInstaller(version: string): Promise<void> {
  const issScript = join(installerAssetsDirectory, 'windows.iss');
  const isccPath = await resolveInnoSetupCompilerPath();
  const outputFilename = releaseTarget.installerAssetName.replace(/\.exe$/, '');
  const iconPath = join(repositoryRoot, 'assets', 'icons', 'windows', 'icon.ico');

  process.env.ARYX_BUILD_VERSION = version;
  process.env.ARYX_BUILD_SOURCE_DIR = packagedAppDirectory;
  process.env.ARYX_BUILD_OUTPUT_DIR = releaseRootDirectory;
  process.env.ARYX_BUILD_OUTPUT_FILENAME = outputFilename;
  process.env.ARYX_BUILD_ICON_PATH = iconPath;

  await runCommand(isccPath, [issScript], repositoryRoot);
}

// --- macOS: DMG disk image ---

async function createMacInstaller(): Promise<void> {
  const appBundleName = releaseTarget.appBundleName;
  if (!appBundleName) {
    throw new Error('macOS installer requires an app bundle name.');
  }

  const appBundlePath = join(packagedAppDirectory, appBundleName);
  // Use macOS's native disk image tooling so packaging does not depend on
  // create-dmg's native node-gyp install path on CI runners.
  await runCommand(
    'hdiutil',
    [
      'create',
      '-volname',
      productName,
      '-srcfolder',
      appBundlePath,
      '-ov',
      '-format',
      'UDZO',
      installerOutputPath,
    ],
    repositoryRoot,
  );
}

// --- Linux: .deb package ---

const linuxIconSizes = ['16x16', '32x32', '48x48', '64x64', '128x128', '256x256', '512x512'];

async function createLinuxInstaller(version: string): Promise<void> {
  const stagingDirectory = join(releaseRootDirectory, 'deb-staging');
  const debianDirectory = join(stagingDirectory, 'DEBIAN');
  const optDirectory = join(stagingDirectory, 'opt', 'aryx');
  const binDirectory = join(stagingDirectory, 'usr', 'bin');
  const applicationsDirectory = join(stagingDirectory, 'usr', 'share', 'applications');

  await mkdir(debianDirectory, { recursive: true });
  await mkdir(binDirectory, { recursive: true });
  await mkdir(applicationsDirectory, { recursive: true });

  // Copy packaged app into /opt/aryx/
  await cp(packagedAppDirectory, optDirectory, { recursive: true });

  // Create symlink /usr/bin/aryx -> /opt/aryx/Aryx
  await symlink('/opt/aryx/Aryx', join(binDirectory, 'aryx'));

  // Copy desktop entry
  await cp(
    join(installerAssetsDirectory, 'linux', 'aryx.desktop'),
    join(applicationsDirectory, 'aryx.desktop'),
  );

  // Install icons into hicolor theme
  const sourceIconsDirectory = join(repositoryRoot, 'assets', 'icons', 'linux', 'icons');
  for (const size of linuxIconSizes) {
    const sourceIcon = join(sourceIconsDirectory, `${size}.png`);
    if (!(await pathExists(sourceIcon))) {
      continue;
    }

    const targetIconDirectory = join(
      stagingDirectory, 'usr', 'share', 'icons', 'hicolor', size, 'apps',
    );
    await mkdir(targetIconDirectory, { recursive: true });
    await cp(sourceIcon, join(targetIconDirectory, 'aryx.png'));
  }

  // Determine installed size (in KB)
  const { stdout } = await new Promise<{ stdout: string }>((resolvePromise, rejectPromise) => {
    const child = spawn('du', ['-sk', optDirectory], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (data: Buffer) => { out += data.toString(); });
    child.on('error', rejectPromise);
    child.on('exit', () => resolvePromise({ stdout: out }));
  });
  const installedSizeKb = parseInt(stdout.split('\t')[0] ?? '0', 10);

  const debArch = releaseTarget.arch === 'x64' ? 'amd64' : 'arm64';

  // Write DEBIAN/control
  const controlContent = [
    `Package: aryx`,
    `Version: ${version}`,
    `Section: devel`,
    `Priority: optional`,
    `Architecture: ${debArch}`,
    `Installed-Size: ${installedSizeKb}`,
    `Depends: libsecret-1-0`,
    `Maintainer: David Kaya`,
    `Description: ${productName} — Copilot-powered agent workflow orchestrator`,
    `  Electron desktop app for orchestrating Copilot-driven agent workflows`,
    `  across multiple projects.`,
    '',
  ].join('\n');

  await writeFile(join(debianDirectory, 'control'), controlContent);

  // Build the .deb
  await runCommand(
    'dpkg-deb',
    ['--build', '--root-owner-group', stagingDirectory, installerOutputPath],
    repositoryRoot,
  );
}

// --- Entry point ---

if (!(await pathExists(packagedAppDirectory))) {
  throw new Error(
    `Packaged app not found at ${packagedAppDirectory}. Run "bun run package" first.`,
  );
}

const version = await readVersion();

switch (releaseTarget.platform) {
  case 'win32':
    await createWindowsInstaller(version);
    break;
  case 'darwin':
    await createMacInstaller();
    break;
  case 'linux':
    await createLinuxInstaller(version);
    break;
}

console.log(`Created installer: ${installerOutputPath}`);
