const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { APP_FILES, stageApplication } = require('../scripts/stage-application.cjs');
const { drainEvents } = require('../src/storage.cjs');
const { canSymlink } = require('./symlink-support.cjs');

test('packaged runtime excludes local files and its hooks run using external Node', (t) => {
  const root = path.resolve(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-package-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const destination = path.join(fixture, 'workwork.app/Contents/Resources/app');
  stageApplication(root, destination);
  assert.deepEqual(fs.readdirSync(destination).sort(), [
    'LICENSE',
    'NOTICE',
    'addons',
    'app',
    'hooks',
    'node_modules',
    'package.json',
    'scripts',
    'src',
  ]);
  assert.equal(
    APP_FILES.some((file) => /^(test|artifacts|node_modules|\.workwork)\//.test(file)),
    false,
  );
  assert.equal(fs.existsSync(path.join(destination, 'app/assets/workwork.icns')), true);
  assert.equal(fs.existsSync(path.join(destination, 'app/assets/workwork.ico')), true);
  assert.equal(
    fs.existsSync(path.join(destination, 'addons/WorkworkCharacter/WorkworkCharacter.toc')),
    true,
  );
  assert.match(fs.readFileSync(path.join(destination, 'LICENSE'), 'utf8'), /MIT License/);
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'package.json')));
  assert.equal(manifest.devDependencies, undefined);
  assert.deepEqual(manifest.dependencies, { jose: require('../package.json').dependencies.jose });
  assert.deepEqual(fs.readdirSync(path.join(destination, 'node_modules')), ['jose']);
  assert.deepEqual(fs.readdirSync(path.join(destination, 'node_modules/jose')).sort(), [
    'LICENSE.md',
    'dist',
    'package.json',
  ]);
  assert.deepEqual(fs.readdirSync(path.join(destination, 'node_modules/jose/dist')), ['webapi']);
  assert.match(
    fs.readFileSync(path.join(destination, 'node_modules/jose/LICENSE.md'), 'utf8'),
    /MIT License/,
  );
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { SignJWT, jwtVerify } from 'jose';
    const key = new Uint8Array(32).fill(7);
    const token = await new SignJWT({ sub: 'packaged-fixture' })
      .setProtectedHeader({ alg: 'HS256' }).sign(key);
    const { payload } = await jwtVerify(token, key);
    assert.equal(payload.sub, 'packaged-fixture');
  `,
    ],
    { cwd: destination, stdio: 'pipe' },
  );
  const { hookPlan } = require(path.join(destination, 'scripts/setup.cjs'));
  const generated = hookPlan(fixture, process.execPath)[0].additions.SessionStart[0].hooks[0]
    .command;
  const decoded =
    process.platform === 'win32'
      ? Buffer.from(generated.split(' ').at(-1), 'base64').toString('utf16le')
      : generated;
  assert.ok(decoded.includes(destination));
  const data = path.join(fixture, 'data');
  const output = execFileSync(
    process.execPath,
    [path.join(destination, 'hooks/emit.cjs'), 'claude', 'SessionStart'],
    {
      env: { ...process.env, WORKWORK_HOME: data },
      input: JSON.stringify({ session_id: 'packaged-fixture', cwd: '/demo/Quest Log' }),
      encoding: 'utf8',
    },
  );
  assert.deepEqual(JSON.parse(output), {});
  const [event] = drainEvents(data);
  assert.equal(event.sessionId, 'packaged-fixture');
  assert.equal(event.project, 'Quest Log');
});

test('packaging rejects a symlink in the runtime dependency', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-package-link-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  if (!canSymlink(t, fixture)) return;
  const root = path.join(fixture, 'source');
  stageApplication(path.resolve(__dirname, '..'), root);
  const runtimeFile = path.join(root, 'node_modules/jose/dist/webapi/index.js');
  fs.unlinkSync(runtimeFile);
  const privateFile = path.join(fixture, 'private.js');
  fs.writeFileSync(privateFile, 'must not be distributed');
  fs.symlinkSync(privateFile, runtimeFile);
  const destination = path.join(fixture, 'output');
  assert.throws(() => stageApplication(root, destination), /Refusing symbolic link/);
  assert.equal(
    fs.existsSync(path.join(destination, 'node_modules/jose/dist/webapi/index.js')),
    false,
  );
});
