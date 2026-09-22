const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { APP_FILES, stageApplication } = require('../scripts/stage-application.cjs');
const { drainEvents } = require('../src/storage.cjs');

test('packaged runtime excludes local files and its hooks run using external Node', (t) => {
  const root = path.resolve(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-package-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const destination = path.join(fixture, 'workwork.app/Contents/Resources/app');
  stageApplication(root, destination);
  assert.deepEqual(fs.readdirSync(destination).sort(), [
    'LICENSE',
    'NOTICE',
    'app',
    'hooks',
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
  assert.match(fs.readFileSync(path.join(destination, 'LICENSE'), 'utf8'), /MIT License/);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(destination, 'package.json'))).devDependencies,
    undefined,
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
