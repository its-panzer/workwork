#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { APP_FILES, stageApplication } = require('./stage-application.cjs');
const { buildIcon } = require('./build-icon.cjs');

async function packageMac(root = path.resolve(__dirname, '..'), arch = process.arch) {
  if (process.platform !== 'darwin') throw Error('Build the macOS app on a Mac.');
  if (!['arm64', 'x64'].includes(arch)) throw Error('Choose --arch=arm64 or --arch=x64.');
  const icon = buildIcon(root);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'workwork-app-'));
  try {
    stageApplication(root, staging);
    const { packager } = await import('@electron/packager');
    const [output] = await packager({
      dir: staging,
      out: path.join(root, 'dist'),
      name: 'workwork',
      appBundleId: 'app.workwork.desktop',
      appCategoryType: 'public.app-category.developer-tools',
      platform: 'darwin',
      arch,
      electronVersion: require('../package.json').devDependencies.electron,
      afterExtract: [
        ({ buildPath }) => {
          // Electron downloads lazily. Read notices from the target runtime
          // Packager just extracted, before it copies and signs our app.
          const licenses = path.join(staging, 'licenses');
          fs.mkdirSync(licenses);
          for (const file of ['LICENSE', 'LICENSES.chromium.html'])
            fs.copyFileSync(path.join(buildPath, file), path.join(licenses, file));
        },
      ],
      icon,
      // External Node runs our hook scripts and their relative imports.
      asar: false,
      prune: false,
      overwrite: true,
      darwinDarkModeSupport: true,
      osxSign: {
        identity: '-',
        identityValidation: false,
        // Local ad-hoc identities have no Team ID for hardened library validation.
        // Developer ID distribution needs a separate hardened/notarized build.
        optionsForFile: () => ({ hardenedRuntime: false }),
      },
    });
    const bundle = path.join(output, 'workwork.app');
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    if (arch === process.arch) {
      // Signature verification alone misses dyld/Team ID failures. Load the
      // packaged Electron framework before distributing a locally built app.
      const versions = JSON.parse(
        execFileSync(
          path.join(bundle, 'Contents/MacOS/workwork'),
          ['-p', 'JSON.stringify(process.versions)'],
          { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' },
        ),
      );
      if (versions.electron !== require('../package.json').devDependencies.electron)
        throw Error('The packaged Electron runtime did not start correctly.');
      console.log('Packaged runtime launch check passed.');
    } else
      console.log('Cross-build: launch verification requires a Mac with the target architecture.');
    const archive = path.join(root, 'dist', `workwork-mac-${arch}.zip`);
    execFileSync('/usr/bin/ditto', [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      bundle,
      archive,
    ]);
    console.log(
      `Built ${bundle}\nArchived ${archive}\nLocal ad-hoc signature verified. This build is not Apple-notarized.`,
    );
    return { bundle, archive };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !/^--arch=(arm64|x64)$/.test(arg)) || args.length > 1) {
    console.error('Usage: npm run build:mac -- [--arch=arm64|--arch=x64]');
    process.exitCode = 1;
  } else {
    packageMac(undefined, args[0]?.slice('--arch='.length)).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
module.exports = { APP_FILES, stageApplication, packageMac };
