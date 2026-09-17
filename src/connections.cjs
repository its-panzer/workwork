const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');
const { hookPlan, configure, isOurs } = require('../scripts/setup.cjs');
const { atomicJSON, readJSON } = require('./storage.cjs');
const { validEvent } = require('./events.cjs');
const { pendingRequests, submitDecision } = require('./requests.cjs');
const ROOT = path.resolve(__dirname, '..');
const CHECK_PREFIX = 'workwork-check-';
function resolveNode() {
  const candidates = [
    !process.versions.electron && process.execPath,
    process.env.WORKWORK_NODE,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
  ];
  try {
    candidates.push(
      execFileSync('node', ['-p', 'process.execPath'], { encoding: 'utf8', timeout: 3000 }).trim(),
    );
  } catch {}
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const real = fs.realpathSync(candidate);
      const version = execFileSync(real, ['-p', 'process.versions.node'], {
        encoding: 'utf8',
        timeout: 3000,
      }).trim();
      if (supportedNode(version)) return real;
    } catch {}
  }
  throw new Error(
    'Node.js 22.12.0 or newer could not be found. Install Node, then reopen workwork.',
  );
}

function supportedNode(version) {
  const [major, minor] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}

function inspectConnections({ home = os.homedir(), node, health = {}, cursorReview = false } = {}) {
  return hookPlan(home, node, { cursorReview }).map((plan) => {
    let installed = false,
      partial = false,
      error = null;
    try {
      const config = fs.existsSync(plan.file) ? JSON.parse(fs.readFileSync(plan.file, 'utf8')) : {};
      if (!config || typeof config !== 'object' || Array.isArray(config))
        throw Error('Settings must be a JSON object.');
      if (config.hooks != null && (typeof config.hooks !== 'object' || Array.isArray(config.hooks)))
        throw Error('Unexpected hooks settings.');
      const entries = Object.entries(config.hooks || {});
      for (const [, groups] of entries)
        if (!Array.isArray(groups)) throw Error('Unexpected hook entries.');
      partial = entries.some(([, groups]) =>
        groups.some(
          (group) => isOurs(group?.command) || group?.hooks?.some((h) => isOurs(h?.command)),
        ),
      );
      installed = Object.entries(plan.additions).every(([event, expected]) =>
        expected.every((group) =>
          (config.hooks?.[event] || []).some((actual) => {
            if (plan.provider === 'cursor')
              return (
                actual.command === group.command &&
                (!group.failClosed ||
                  (actual.failClosed === true && actual.timeout === group.timeout))
              );
            return (
              (actual.matcher || '') === (group.matcher || '') &&
              group.hooks.every((hook) =>
                actual.hooks?.some(
                  (h) =>
                    h.command === hook.command &&
                    h.type === 'command' &&
                    h.timeout === hook.timeout,
                ),
              )
            );
          }),
        ),
      );
      if (config.disableAllHooks === true)
        error = 'Hooks are disabled in this app’s settings. Enable them in the app.';
    } catch (cause) {
      error = `Could not read settings: ${cause.message}`;
    }
    return {
      provider: plan.provider,
      installed,
      partial,
      error,
      file: plan.file,
      lastEvent: health[plan.provider]?.lastEvent || null,
      lastCheck: health[plan.provider]?.lastCheck || null,
    };
  });
}

class Connections {
  constructor({ root, home = os.homedir(), node, onChange = () => {} }) {
    this.root = root;
    this.home = home;
    this.node = node;
    this.file = path.join(root, 'connections.json');
    const health = readJSON(this.file, {});
    this.health = health && typeof health === 'object' && !Array.isArray(health) ? health : {};
    this.checks = new Map();
    this.onChange = onChange;
  }
  runtime() {
    if (this.node) return this.node;
    if (this.runtimeError) throw this.runtimeError;
    try {
      return (this.node = resolveNode());
    } catch (error) {
      this.runtimeError = error;
      throw error;
    }
  }
  snapshot() {
    let runtimeError;
    try {
      this.runtime();
    } catch (error) {
      runtimeError = error.message;
    }
    return inspectConnections({
      home: this.home,
      node: this.node,
      health: this.health,
      cursorReview: this.cursorReview(),
    }).map((item) => ({ ...item, error: item.error || runtimeError || null }));
  }
  configure(provider, remove = false) {
    const results = configure({
      install: !remove,
      remove,
      provider,
      home: this.home,
      node: remove ? this.node : this.runtime(),
      cursorReview: this.cursorReview(),
    });
    this.onChange();
    return results;
  }
  cursorReview() {
    return readJSON(path.join(this.root, 'controls.json'), {})?.cursorReview === true;
  }
  setCursorReview(enabled) {
    if (typeof enabled !== 'boolean') throw Error('Choose whether to review Cursor actions.');
    configure({
      install: true,
      provider: 'cursor',
      home: this.home,
      node: this.runtime(),
      cursorReview: enabled,
    });
    const controlsFile = path.join(this.root, 'controls.json');
    const controls = readJSON(controlsFile, {});
    const current =
      controls && typeof controls === 'object' && !Array.isArray(controls) ? controls : {};
    atomicJSON(controlsFile, { ...current, cursorReview: enabled });
    if (!enabled) {
      for (const request of pendingRequests(this.root)) {
        if (request.provider !== 'cursor' || request.review !== true) continue;
        try {
          submitDecision(request.id, { action: 'native' }, this.root);
        } catch (error) {
          // The waiter may finish, or a user choice may win, while settings save.
          if (error.code !== 'EEXIST' && !error.message.startsWith('This request has ended.')) {
            this.onChange();
            throw error;
          }
        }
      }
    }
    this.onChange();
  }
  observe(event) {
    if (!validEvent(event)) return false;
    if (event.sessionId.startsWith(CHECK_PREFIX)) {
      const check = this.checks.get(event.sessionId);
      if (check && check.provider === event.provider) check.finish(true);
      return true;
    }
    this.health[event.provider] = { ...this.health[event.provider], lastEvent: event.time };
    atomicJSON(this.file, this.health);
    return false;
  }
  test(provider) {
    const connection = this.snapshot().find((item) => item.provider === provider);
    if (!connection) throw Error('Unknown app');
    if (connection.error || !connection.installed)
      throw Error(connection.error || 'Connect this app before checking it.');
    if ([...this.checks.values()].some((check) => check.provider === provider))
      throw Error('A check is already running.');
    const sessionId = `${CHECK_PREFIX}${crypto.randomUUID()}`;
    const event = provider === 'cursor' ? 'sessionStart' : 'SessionStart';
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.checks.delete(sessionId);
        this.health[provider] = { ...this.health[provider], lastCheck: { time: Date.now(), ok } };
        atomicJSON(this.file, this.health);
        this.onChange();
        resolve({
          ok,
          message: ok
            ? provider === 'codex'
              ? 'Local receiver passed. Codex must load and trust the hooks before it can send activity.'
              : 'Local check passed. Waiting for activity from the app.'
            : 'No signal received. Reconnect this app and try again.',
        });
      };
      const timer = setTimeout(() => finish(false), 5000);
      this.checks.set(sessionId, { provider, finish });
      const child = execFile(
        this.runtime(),
        [path.join(ROOT, 'hooks', 'emit.cjs'), provider, event],
        { env: { ...process.env, WORKWORK_HOME: this.root }, timeout: 3000 },
        (error) => {
          if (error) finish(false);
        },
      );
      child.stdin.on('error', () => finish(false));
      child.stdin.end(
        JSON.stringify({ session_id: sessionId, conversation_id: sessionId, cwd: ROOT }),
      );
    });
  }
}
module.exports = { Connections, inspectConnections, resolveNode, supportedNode };
