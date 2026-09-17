const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { SOURCE_FILES, sourceFiles, createSourceArchive } = require('../scripts/source-archive.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workwork-archive-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, content = 'fixture\n') => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  for (const file of SOURCE_FILES) write(file);
  return { root, write };
}

test('source archive includes the manifest and optional license but excludes local files', (t) => {
  const { root, write } = fixture(t);
  write('LICENSE', 'Fixture license\n');
  for (const file of [
    '.env',
    '.impeccable.md',
    'personal.md',
    'docs/private.md',
    'app/assets/private.png',
    'src/settings.json',
    'node_modules/private.js',
    'artifacts/screenshot.png',
    'artifacts/workwork-source.tar.gz',
  ])
    write(file, 'must not be distributed\n');
  const { output, files } = createSourceArchive(root);
  assert.equal(output, path.join(root, 'artifacts', 'workwork-source.tar.gz'));
  const entries = execFileSync('tar', ['-tzf', output], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((entry) => !entry.endsWith('/'))
    .sort();
  assert.deepEqual(entries, files.map((file) => `workwork/${file}`).sort());
  assert.ok(files.includes('package-lock.json'));
  assert.ok(files.includes('LICENSE'));
  const tar = zlib.gunzipSync(fs.readFileSync(output));
  for (let offset = 0; offset < tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) => header.toString('utf8', start, start + length).split('\0')[0];
    assert.equal(parseInt(field(108, 8), 8), 0);
    assert.equal(parseInt(field(116, 8), 8), 0);
    assert.ok(['', 'root'].includes(field(265, 32)));
    assert.ok(['', 'root'].includes(field(297, 32)));
    offset += 512 + Math.ceil(parseInt(field(124, 12), 8) / 512) * 512;
  }
  const unpacked = path.join(root, 'unpacked');
  fs.mkdirSync(unpacked);
  execFileSync('tar', ['-xzf', output, '-C', unpacked]);
  assert.equal(
    fs.readFileSync(path.join(unpacked, 'workwork/LICENSE'), 'utf8'),
    'Fixture license\n',
  );
  assert.ok(fs.statSync(path.join(unpacked, 'workwork/Launch workwork.command')).mode & 0o111);
});

test('source archive fails for missing required files and never follows source symlinks', (t) => {
  const { root } = fixture(t);
  const source = path.join(root, 'app/main.cjs');
  fs.unlinkSync(source);
  assert.throws(() => sourceFiles(root), { code: 'ENOENT' });
  fs.symlinkSync(path.join(root, 'README.md'), source);
  assert.throws(() => sourceFiles(root), /refuses symbolic links/);
  fs.unlinkSync(source);
  fs.writeFileSync(source, 'fixture\n');
  fs.renameSync(path.join(root, 'app/assets'), path.join(root, 'private-assets'));
  fs.symlinkSync(path.join(root, 'private-assets'), path.join(root, 'app/assets'));
  assert.throws(() => sourceFiles(root), /refuses symbolic links/);
});
