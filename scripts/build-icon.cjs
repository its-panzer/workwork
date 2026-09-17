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
    return output;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) console.log(buildIcon());
module.exports = { buildIcon };
