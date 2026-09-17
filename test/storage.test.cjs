const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicJSON, drainEvents } = require('../src/storage.cjs');

test('atomic writes remove temporary files if the commit cannot complete', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  fs.writeFileSync(file, '{"original":true}');
  assert.throws(
    () =>
      atomicJSON(
        file,
        { replacement: true },
        {
          beforeCommit: () => {
            throw Error('changed');
          },
        },
      ),
    /changed/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), '{"original":true}');
  assert.deepEqual(fs.readdirSync(root), ['settings.json']);
  const directory = path.join(root, 'directory');
  fs.mkdirSync(directory);
  assert.throws(() => atomicJSON(directory, {}));
  assert.equal(
    fs.readdirSync(root).some((name) => name.endsWith('.tmp')),
    false,
  );
});

test('event draining ignores malformed and nonobject payloads', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-spool-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'events');
  fs.mkdirSync(dir);
  ['null', '7', 'false', '"text"', '[]', '{broken', '{"time":2}', '{"time":1}'].forEach(
    (value, index) => fs.writeFileSync(path.join(dir, `${index}.json`), value),
  );
  assert.deepEqual(drainEvents(root), [{ time: 1 }, { time: 2 }]);
  assert.deepEqual(fs.readdirSync(dir), []);
});
