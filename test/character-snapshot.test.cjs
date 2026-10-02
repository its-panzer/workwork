const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { canSymlink } = require('./symlink-support.cjs');
const {
  parseSnapshot,
  readLatestCharacter,
  exportForGamingBot,
  installCharacterAddon,
} = require('../src/character-snapshot.cjs');

const sample =
  'WorkworkCharacterSnapshot = "WW1;character|Fixture|Test%20Realm|20|WARLOCK|Human|Affliction|Westfall|12345|1790712000|1.60.1;stat|armor|340|300;stat|intellect|45;equipment|1|123|Blue%20Hat|%7Ccffa%7CHitem%3A123%7Ch%5BBlue%20Hat%5D%7Ch%7Cr|ITEM_MOD_INTELLECT_SHORT%3D5%2CITEM_MOD_SPIRIT_SHORT%3D-2"\n';

test('parses addon SavedVariables as bounded data, never as executable Lua', () => {
  const data = parseSnapshot(sample);
  assert.equal(data.name, 'Fixture');
  assert.equal(data.stats.armor.effective, 340);
  assert.equal(data.stats.intellect.base, null);
  assert.equal(data.equipment[0].name, 'Blue Hat');
  assert.equal(data.equipment[0].stats.ITEM_MOD_INTELLECT_SHORT, 5);
  assert.equal(data.equipment[0].stats.ITEM_MOD_SPIRIT_SHORT, -2);
  assert.throws(
    () => parseSnapshot('WorkworkCharacterSnapshot = os.execute("bad")'),
    /No Workwork/,
  );
  assert.throws(
    () => parseSnapshot(sample.replace('|20|WARLOCK|', '|oops|WARLOCK|')),
    /invalid number/,
  );
});

test('discovers the latest per-character file and exports only on request', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workwork-character-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'WTF', 'Account', 'account', 'server', 'character', 'SavedVariables');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(readLatestCharacter([root]), null);
  fs.writeFileSync(path.join(dir, 'WorkworkCharacter.lua'), sample);
  const data = readLatestCharacter([root]);
  assert.equal(data.realm, 'Test Realm');
  const output = path.join(root, 'private', 'character.json');
  exportForGamingBot(data, output);
  const exported = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.match(exported.note, /not live game state/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(output).mode & 0o777, 0o600);
});

test('addon installation refuses to overwrite differing files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workwork-addon-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const game = path.join(root, 'game');
  fs.mkdirSync(source);
  fs.mkdirSync(path.join(game, 'Interface', 'AddOns'), { recursive: true });
  for (const name of ['WorkworkCharacter.toc', 'WorkworkCharacter.lua'])
    fs.writeFileSync(path.join(source, name), name);
  installCharacterAddon(source, [game]);
  installCharacterAddon(source, [game]);
  fs.writeFileSync(path.join(source, 'WorkworkCharacter.lua'), 'different');
  assert.throws(() => installCharacterAddon(source, [game]), /differs/);
});

test('addon installation refuses a symlinked destination directory', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workwork-addon-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (!canSymlink(t, root)) return;
  const source = path.join(root, 'source');
  const game = path.join(root, 'game');
  const outside = path.join(root, 'outside');
  const addons = path.join(game, 'Interface', 'AddOns');
  fs.mkdirSync(source);
  fs.mkdirSync(outside);
  fs.mkdirSync(addons, { recursive: true });
  for (const name of ['WorkworkCharacter.toc', 'WorkworkCharacter.lua'])
    fs.writeFileSync(path.join(source, name), name);
  fs.symlinkSync(outside, path.join(addons, 'WorkworkCharacter'), 'dir');
  assert.throws(() => installCharacterAddon(source, [game]), /symbolic link/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
