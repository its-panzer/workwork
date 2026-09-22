const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { canSymlink } = require('./symlink-support.cjs');
const os = require('node:os');
const path = require('node:path');
const { hookPlan, mergeHooks, configure, isOurs } = require('../scripts/setup.cjs');
test('install is idempotent and remove preserves every pre-existing hook', () => {
  for (const plan of hookPlan('/fixture-home')) {
    const original = {
      customSetting: 42,
      ...(plan.provider === 'cursor' ? { version: 1 } : {}),
      hooks: {
        [plan.events[0]]:
          plan.provider === 'cursor'
            ? [{ command: 'existing-command' }]
            : [{ matcher: 'custom', hooks: [{ type: 'command', command: 'existing-command' }] }],
      },
    };
    const installed = mergeHooks(original, plan, true);
    assert.deepEqual(mergeHooks(installed, plan, true), installed);
    assert.deepEqual(mergeHooks(installed, plan, false), original);
  }
});
test('disconnecting an unconfigured agent leaves missing and existing settings untouched', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-empty-remove-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  configure({ remove: true, home: root });
  assert.deepEqual(fs.readdirSync(root), []);
  const [plan] = hookPlan(root);
  fs.mkdirSync(path.dirname(plan.file));
  for (const current of [
    { custom: true },
    { hooks: { Stop: [], SessionStart: [{ hooks: [] }] } },
  ]) {
    const source = JSON.stringify(current, null, 4) + '\n';
    fs.writeFileSync(plan.file, source);
    configure({ remove: true, home: root, provider: plan.provider });
    assert.equal(fs.readFileSync(plan.file, 'utf8'), source);
    assert.deepEqual(fs.readdirSync(path.dirname(plan.file)), [path.basename(plan.file)]);
  }
});
test('all configs are parsed before writes, and malformed settings are preserved', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.claude'));
  fs.mkdirSync(path.join(root, '.cursor'));
  const claude = path.join(root, '.claude', 'settings.json');
  fs.writeFileSync(claude, '{"custom":true}');
  fs.writeFileSync(path.join(root, '.cursor', 'hooks.json'), 'bad JSON');
  assert.throws(() => configure({ install: true, home: root }));
  assert.equal(fs.readFileSync(claude, 'utf8'), '{"custom":true}');
  assert.equal(fs.existsSync(path.join(root, '.codex', 'hooks.json')), false);
});
test('configuration installation keeps exact backups and uninstall removes only our hooks', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.claude'));
  const file = path.join(root, '.claude', 'settings.json');
  const original = '{\n  "custom": true\n}\n';
  fs.writeFileSync(file, original);
  const result = configure({ install: true, home: root });
  assert.equal(fs.readFileSync(result[0].backup, 'utf8'), original);
  configure({ remove: true, home: root });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).custom, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).hooks, {});
});
test('ownership recognizes only generated hook invocations, including an older Node path', () => {
  const plan = hookPlan(
    '/fixture-home',
    process.platform === 'win32'
      ? "C:\\older\\runtime's\\node.exe"
      : "/older/runtime's/bin/custom-node",
    {
      cursorReview: true,
    },
  )[0];
  const command = plan.additions.SessionStart[0].hooks[0].command;
  assert.equal(isOurs(command), true);
  const script = path.resolve(__dirname, '../hooks/emit.cjs');
  const foreign = [
    `echo '${script}'`,
    `echo '${script}.backup'`,
    `${command} && echo done`,
    `echo ${command}`,
    ...(process.platform === 'win32'
      ? [command.slice(0, -4) + 'AAAA']
      : [
          command.replace('SessionStart', 'DifferentEvent'),
          command.replace('emit.cjs', 'emit.cjs.backup'),
        ]),
  ];
  for (const command of foreign) assert.equal(isOurs(command), false, command);
  const original = {
    hooks: { Stop: [{ hooks: foreign.map((command) => ({ type: 'command', command })) }] },
  };
  assert.deepEqual(mergeHooks(original, plan, false), original);
});
test('install and remove preserve a symlinked settings file and update its target', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-linked-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.claude'));
  const target = path.join(root, 'managed-settings.json'),
    file = path.join(root, '.claude', 'settings.json');
  const original = '{\n  "custom": true\n}\n';
  fs.writeFileSync(target, original);
  if (!canSymlink(t, root)) return;
  fs.symlinkSync('../managed-settings.json', file);
  const [result] = configure({ install: true, provider: 'claude', home: root });
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(file), path.normalize('../managed-settings.json'));
  assert.equal(fs.readFileSync(result.backup, 'utf8'), original);
  assert.ok(JSON.parse(fs.readFileSync(target, 'utf8')).hooks.SessionStart);
  configure({ remove: true, provider: 'claude', home: root });
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { custom: true, hooks: {} });
});
test('dangling settings symlinks are rejected before any provider is changed', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-dangling-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.claude'));
  fs.mkdirSync(path.join(root, '.cursor'));
  const claude = path.join(root, '.claude', 'settings.json'),
    cursor = path.join(root, '.cursor', 'hooks.json');
  fs.writeFileSync(claude, '{"custom":true}');
  if (!canSymlink(t, root)) return;
  fs.symlinkSync('missing.json', cursor);
  assert.throws(() => configure({ install: true, home: root }), /dangling symlink/);
  assert.equal(fs.readFileSync(claude, 'utf8'), '{"custom":true}');
  assert.equal(fs.lstatSync(cursor).isSymbolicLink(), true);
  assert.equal(fs.existsSync(path.join(root, '.codex', 'hooks.json')), false);
});
test('symlink retargeting during setup cannot overwrite either target', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-retarget-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.claude'));
  const file = path.join(root, '.claude', 'settings.json'),
    first = path.join(root, 'first.json'),
    second = path.join(root, 'second.json');
  fs.writeFileSync(first, '{"custom":true}');
  fs.writeFileSync(second, '{"custom":true}');
  if (!canSymlink(t, root)) return;
  fs.symlinkSync(first, file);
  const copy = fs.copyFileSync;
  t.mock.method(fs, 'copyFileSync', (...args) => {
    copy(...args);
    fs.unlinkSync(file);
    fs.symlinkSync(second, file);
  });
  assert.throws(
    () => configure({ install: true, provider: 'claude', home: root }),
    /settings changed during setup/,
  );
  assert.equal(fs.readFileSync(first, 'utf8'), '{"custom":true}');
  assert.equal(fs.readFileSync(second, 'utf8'), '{"custom":true}');
  assert.equal(fs.realpathSync(file), fs.realpathSync(second));
  assert.equal(
    fs.readdirSync(root).some((name) => name.endsWith('.tmp')),
    false,
  );
});
