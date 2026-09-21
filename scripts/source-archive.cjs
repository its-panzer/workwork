#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Keep this list explicit: adding a local file must never silently publish it.
const SOURCE_FILES = [
  '.gitignore',
  '.prettierignore',
  '.prettierrc.json',
  '.github/workflows/ci.yml',
  'README.md',
  'docs/images/workwork-demo.png',
  'docs/images/workwork-jewel.png',
  'docs/images/workwork-dashboard-wow.jpg',
  'docs/images/workwork-jewel-wow.jpg',
  'docs/images/README.md',
  'package.json',
  'package-lock.json',
  'Launch workwork.command',
  'Preview workwork.command',
  'app/main.cjs',
  'app/preload.cjs',
  'app/renderer.js',
  'app/game-guide.js',
  'app/provider-guides.js',
  'app/index.html',
  'app/styles.css',
  'app/assets/README.md',
  'app/assets/compass-field.svg',
  'app/assets/frame-corner.svg',
  'app/assets/workwork-medallion.png',
  'app/assets/workwork-wordmark.png',
  'app/assets/workwork-icon.png',
  'app/assets/workwork.icns',
  'hooks/emit.cjs',
  'hooks/request.cjs',
  'scripts/setup.cjs',
  'scripts/source-archive.cjs',
  'scripts/build-icon.cjs',
  'scripts/package-mac.cjs',
  'src/game-guide.cjs',
  'src/guide-chat.cjs',
  'test/game-guide.test.cjs',
  'test/game-guide-ui-smoke.cjs',
  'test/guide-chat.test.cjs',
  'src/cmux.cjs',
  'src/connections.cjs',
  'src/demo.cjs',
  'src/events.cjs',
  'src/requests.cjs',
  'src/storage.cjs',
  'src/task-model.cjs',
  'src/window-state.cjs',
  'test/cmux.test.cjs',
  'test/connections.test.cjs',
  'test/connections-smoke.cjs',
  'test/events.test.cjs',
  'test/requests.test.cjs',
  'test/setup.test.cjs',
  'test/source-archive.test.cjs',
  'test/storage.test.cjs',
  'test/ui-smoke.cjs',
  'test/window-state.test.cjs',
  'test/packaging.test.cjs',
];
const OPTIONAL_FILES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'NOTICE',
  'NOTICE.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CHANGELOG.md',
  'docs/README.md',
  'docs/release-review.md',
];

function sourceFiles(root) {
  const files = [...SOURCE_FILES];
  for (const file of OPTIONAL_FILES) {
    try {
      fs.lstatSync(path.join(root, file));
      files.push(file);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const info = fs.lstatSync(path.join(root, ...parts.slice(0, i)));
      if (info.isSymbolicLink()) throw Error(`Source archive refuses symbolic links: ${file}`);
      if (i === parts.length && !info.isFile()) throw Error(`Not a source file: ${file}`);
    }
  }
  return files.sort();
}

function createSourceArchive(root = path.resolve(__dirname, '..')) {
  const files = sourceFiles(root);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'workwork-source-'));
  const output = path.join(root, 'artifacts', 'workwork-source.tar.gz');
  try {
    const source = path.join(staging, 'workwork');
    for (const file of files) {
      const destination = path.join(source, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
      fs.copyFileSync(path.join(root, file), destination);
      fs.chmodSync(destination, file.endsWith('.command') ? 0o755 : 0o644);
    }
    const version = execFileSync('tar', ['--version'], { encoding: 'utf8' });
    const ownerArgs = version.includes('bsdtar')
      ? ['--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root']
      : ['--owner=0', '--group=0', '--numeric-owner'];
    const temporaryArchive = path.join(staging, 'workwork-source.tar.gz');
    execFileSync(
      'tar',
      [
        ...ownerArgs,
        '--no-acls',
        '--no-xattrs',
        '-czf',
        temporaryArchive,
        '-C',
        staging,
        'workwork',
      ],
      { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'pipe' },
    );
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(temporaryArchive, output);
    return { output, files };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const { output, files } = createSourceArchive();
    console.log(`Created ${output} (${files.length} source files)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { SOURCE_FILES, OPTIONAL_FILES, sourceFiles, createSourceArchive };
