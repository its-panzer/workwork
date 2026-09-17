const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function dataRoot() {
  return process.env.WORKWORK_HOME || path.join(os.homedir(), '.workwork');
}
function atomicJSON(file, value, { beforeCommit } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    if (beforeCommit) beforeCommit();
    fs.renameSync(tmp, file);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeEvent(event, root = dataRoot()) {
  const dir = path.join(root, 'events');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Bound offline accumulation; the companion normally drains this folder every second.
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const old of files.slice(0, Math.max(0, files.length - 1999))) {
    try {
      fs.unlinkSync(path.join(dir, old));
    } catch {}
  }
  atomicJSON(path.join(dir, `${event.time}-${crypto.randomUUID()}.json`), event);
}
function drainEvents(root = dataRoot()) {
  const dir = path.join(root, 'events');
  let files;
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .slice(0, 2000);
  } catch {
    return [];
  }
  const events = [];
  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const info = fs.lstatSync(full);
      if (info.isFile() && !info.isSymbolicLink() && info.size < 8192) {
        const event = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (event && typeof event === 'object' && !Array.isArray(event)) events.push(event);
      }
    } catch {
    } finally {
      try {
        fs.unlinkSync(full);
      } catch {}
    }
  }
  return events.sort((a, b) => a.time - b.time);
}
module.exports = { dataRoot, atomicJSON, readJSON, writeEvent, drainEvents };
