#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stageApplication } = require('./stage-application.cjs');

async function packageWindows(
  root = path.resolve(__dirname, '..'),
  arch = process.platform === 'win32' ? process.arch : 'x64',
) {
  if (!['x64', 'arm64'].includes(arch)) throw Error('Choose --arch=x64 or --arch=arm64.');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'workwork-windows-'));
  try {
    stageApplication(root, staging);
    const { packager } = await import('@electron/packager');
    const [directory] = await packager({
      dir: staging,
      out: path.join(root, 'dist'),
      name: 'workwork',
      platform: 'win32',
      arch,
      electronVersion: require('../package.json').devDependencies.electron,
      icon: path.join(root, 'app/assets/workwork.ico'),
      win32metadata: {
        ProductName: 'workwork',
        FileDescription: 'workwork desktop companion',
        'requested-execution-level': 'asInvoker',
      },
      asar: false,
      prune: false,
      overwrite: true,
    });
    const executable = path.join(directory, 'workwork.exe');
    if (fs.readFileSync(executable).toString('ascii', 0, 2) !== 'MZ')
      throw Error('Missing Windows executable.');
    for (const license of ['LICENSE', 'LICENSES.chromium.html'])
      if (!fs.existsSync(path.join(directory, license)))
        throw Error(`Missing Electron notice: ${license}`);
    if (process.platform === 'win32' && arch === process.arch) {
      const versions = JSON.parse(
        execFileSync(executable, ['-p', 'JSON.stringify(process.versions)'], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          encoding: 'utf8',
          windowsHide: true,
          timeout: 15000,
        }),
      );
      if (versions.electron !== require('../package.json').devDependencies.electron)
        throw Error('Packaged runtime launch failed.');
      console.log('Packaged Windows runtime launch check passed.');
    } else
      console.log('Cross-build: launch verification requires Windows on the target architecture.');
    const archive = path.join(root, 'dist', `workwork-windows-${arch}.zip`);
    if (process.platform === 'win32') {
      execFileSync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath $env:WORKWORK_ZIP_SOURCE -DestinationPath $env:WORKWORK_ZIP_OUTPUT -Force",
        ],
        {
          env: { ...process.env, WORKWORK_ZIP_SOURCE: directory, WORKWORK_ZIP_OUTPUT: archive },
          windowsHide: true,
          stdio: 'pipe',
        },
      );
    } else if (process.platform === 'darwin') {
      execFileSync('/usr/bin/ditto', [
        '-c',
        '-k',
        '--norsrc',
        '--noextattr',
        '--noqtn',
        '--noacl',
        '--keepParent',
        directory,
        archive,
      ]);
    } else {
      fs.rmSync(archive, { force: true });
      execFileSync('zip', ['-q', '-r', archive, path.basename(directory)], {
        cwd: path.dirname(directory),
      });
    }
    console.log(
      `Built ${executable}\nArchived ${archive}\nUnsigned Windows build; no code-signing certificate is bundled.`,
    );
    return { directory, executable, archive };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => !/^--arch=(x64|arm64)$/.test(arg))) {
    console.error('Usage: npm run build:windows -- [--arch=x64|--arch=arm64]');
    process.exitCode = 1;
  } else
    packageWindows(undefined, args[0]?.slice('--arch='.length)).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { packageWindows };
