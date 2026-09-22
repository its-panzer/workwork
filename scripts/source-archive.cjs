#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');

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
  'app/assets/workwork.ico',
  'hooks/emit.cjs',
  'hooks/request.cjs',
  'scripts/setup.cjs',
  'scripts/source-archive.cjs',
  'scripts/build-icon.cjs',
  'scripts/package-mac.cjs',
  'scripts/stage-application.cjs',
  'scripts/package-windows.cjs',
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
  'src/platform.cjs',
  'test/platform.test.cjs',
  'test/symlink-support.cjs',
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
  const output = path.join(root, 'artifacts', 'workwork-source.tar.gz');
  // Write portable ustar headers explicitly: Windows has no POSIX chmod/uid,
  // and host tar implementations disagree on ownership/extended attributes.
  const records = [];
  for (const file of files) {
    const name = `workwork/${file}`;
    if (Buffer.byteLength(name) > 100) throw Error(`Archive path is too long: ${file}`);
    const content = fs.readFileSync(path.join(root, file));
    const header = Buffer.alloc(512);
    const octal = (value, offset, size) =>
      header.write(value.toString(8).padStart(size - 1, '0') + '\0', offset, size, 'ascii');
    header.write(name, 0, 100, 'utf8');
    octal(file.endsWith('.command') ? 0o755 : 0o644, 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(content.length, 124, 12);
    octal(0, 136, 12);
    header.fill(32, 148, 156);
    header[156] = 48;
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    header.write('root', 265, 32, 'ascii');
    header.write('root', 297, 32, 'ascii');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    records.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  records.push(Buffer.alloc(1024));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, gzipSync(Buffer.concat(records)));
  return { output, files };
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
