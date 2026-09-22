#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function buildIcon(root = path.resolve(__dirname, '..')) {
  if (process.platform !== 'darwin') throw Error('Build the macOS icon on a Mac.');
  const source = path.join(root, 'app/assets/workwork-icon.png');
  const output = path.join(root, 'app/assets/workwork.icns');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'workwork-icon-'));
  try {
    const iconset = path.join(staging, 'workwork.iconset');
    fs.mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        execFileSync(
          '/usr/bin/sips',
          [
            '-z',
            String(size * scale),
            String(size * scale),
            source,
            '--out',
            path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
          ],
          { stdio: 'pipe' },
        );
      }
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', output]);
    // ICO can contain PNG frames. Reuse the same original icon on Windows.
    const sizes = [16, 32, 48, 64, 128, 256];
    const frames = sizes.map((size) => {
      const file = path.join(staging, `windows-${size}.png`);
      execFileSync('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', file], {
        stdio: 'pipe',
      });
      return fs.readFileSync(file);
    });
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    frames.forEach((frame, index) => {
      const entry = 6 + index * 16,
        size = sizes[index];
      header[entry] = header[entry + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(frame.length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += frame.length;
    });
    fs.writeFileSync(
      path.join(root, 'app/assets/workwork.ico'),
      Buffer.concat([header, ...frames]),
    );
    return output;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) console.log(buildIcon());
module.exports = { buildIcon };
