const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Connections, inspectConnections, supportedNode } = require('../src/connections.cjs');
const { configure } = require('../scripts/setup.cjs');
const { atomicJSON, drainEvents } = require('../src/storage.cjs');
const { makeRequest, pendingRequests, submitDecision } = require('../src/requests.cjs');
const { normalize, StatusStore } = require('../src/events.cjs');
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-connections-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, root: path.join(home, '.workwork'), node: fs.realpathSync(process.execPath) };
}
test('inspect detects external removal, incomplete hooks, disabled hooks, and malformed settings', (t) => {
  const options = fixture(t);
  assert.equal(inspectConnections(options).filter((c) => c.installed).length, 0);
  configure({ ...options, install: true });
  assert.equal(inspectConnections(options).filter((c) => c.installed).length, 3);
  const file = path.join(options.home, '.claude/settings.json');
  const settings = JSON.parse(fs.readFileSync(file));
  delete settings.hooks.PermissionRequest;
  fs.writeFileSync(file, JSON.stringify(settings));
  let claude = inspectConnections(options)[0];
  assert.equal(claude.installed, false);
  assert.equal(claude.partial, true);
  configure({ ...options, install: true, provider: 'claude' });
  const disabled = JSON.parse(fs.readFileSync(file));
  disabled.disableAllHooks = true;
  fs.writeFileSync(file, JSON.stringify(disabled));
  assert.match(inspectConnections(options)[0].error, /disabled/);
  fs.writeFileSync(file, '{');
  assert.match(inspectConnections(options)[0].error, /Could not read/);
  fs.unlinkSync(file);
  assert.equal(inspectConnections(options)[0].installed, false);
});
test('per-app disconnect preserves other providers and repeated install makes no new backup', (t) => {
  const options = fixture(t);
  configure({ ...options, install: true });
  configure({ ...options, install: true });
  assert.deepEqual(fs.readdirSync(path.join(options.home, '.claude')), ['settings.json']);
  configure({ ...options, remove: true, provider: 'cursor' });
  assert.deepEqual(
    inspectConnections(options).map((c) => c.installed),
    [true, true, false],
  );
  assert.throws(() => configure({ ...options, remove: true, provider: 'unknown' }), /Unknown/);
});
test('local checks traverse the hook subprocess and event spool without creating tasks or claiming app activity', async (t) => {
  const options = fixture(t);
  const connections = new Connections(options);
  const store = new StatusStore();
  connections.configure();
  const timer = setInterval(() => {
    for (const event of drainEvents(options.root))
      if (!connections.observe(event)) store.apply(event);
  }, 30);
  t.after(() => clearInterval(timer));
  for (const provider of ['claude', 'codex', 'cursor'])
    assert.equal((await connections.test(provider)).ok, true);
  assert.equal(store.snapshot().length, 0);
  assert.equal(
    connections.snapshot().every((c) => c.lastCheck.ok && c.lastEvent === null),
    true,
  );
  const event = normalize('claude', {
    session_id: 'real-session',
    hook_event_name: 'SessionStart',
    cwd: '/project',
  });
  assert.equal(connections.observe(event), false);
  assert.equal(connections.snapshot()[0].lastEvent, event.time);
  assert.equal(new Connections(options).snapshot()[0].lastEvent, event.time);
});
test('Claude idle reminder does not invent a pending question', () => {
  assert.equal(
    normalize('claude', {
      session_id: 's',
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
    }),
    null,
  );
  for (const notification_type of ['agent_needs_input', 'elicitation_url_dialog']) {
    assert.equal(
      normalize('claude', { session_id: 's', hook_event_name: 'Notification', notification_type })
        .status,
      'attention',
    );
  }
});
test('disconnect still works when the Node runtime is unavailable', (t) => {
  const options = fixture(t);
  const connections = new Connections(options);
  connections.configure();
  connections.runtime = () => {
    throw Error('Node removed');
  };
  connections.configure('claude', true);
  assert.equal(inspectConnections(options)[0].installed, false);
});
test('Cursor review opt-in installs bounded fail-closed gates and disabling removes only gates', (t) => {
  const options = fixture(t);
  const connections = new Connections(options);
  connections.configure();
  assert.equal(connections.cursorReview(), false);
  connections.setCursorReview(true);
  let hooks = JSON.parse(fs.readFileSync(path.join(options.home, '.cursor/hooks.json'))).hooks;
  assert.equal(hooks.beforeShellExecution[0].timeout, 620);
  assert.equal(hooks.beforeMCPExecution[0].failClosed, true);
  assert.equal(connections.snapshot().find((c) => c.provider === 'cursor').installed, true);
  connections.setCursorReview(false);
  hooks = JSON.parse(fs.readFileSync(path.join(options.home, '.cursor/hooks.json'))).hooks;
  assert.equal(hooks.beforeShellExecution, undefined);
  assert.ok(hooks.postToolUse);
});

test('disabling Cursor reviews returns a waiting hook to Cursor without approving it', async (t) => {
  const options = fixture(t);
  const connections = new Connections(options);
  connections.setCursorReview(true);
  atomicJSON(path.join(options.root, 'heartbeat.json'), { pid: process.pid, time: Date.now() });
  const child = spawn(
    process.execPath,
    [path.resolve(__dirname, '../hooks/request.cjs'), 'cursor'],
    {
      env: { ...process.env, WORKWORK_HOME: options.root },
    },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  let stdout = '',
    stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const result = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(JSON.parse(stdout)) : reject(Error(stderr || `exit ${code}`)),
    );
  });
  const raw = {
    conversation_id: 'cursor-fixture',
    hook_event_name: 'beforeShellExecution',
    command: 'echo fixture-only',
  };
  child.stdin.end(JSON.stringify(raw));
  let active;
  for (let attempt = 0; attempt < 80; attempt++) {
    active = pendingRequests(options.root)[0];
    if (active) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(active, 'fixture hook should be waiting');
  const queued = makeRequest('cursor', { ...raw, conversation_id: 'already-answered-fixture' });
  atomicJSON(path.join(options.root, 'requests', `${queued.id}.json`), queued);
  submitDecision(queued.id, { action: 'deny' }, options.root);
  const queuedFile = path.join(options.root, 'responses', `${queued.id}.json`);
  const queuedBefore = fs.readFileSync(queuedFile, 'utf8');
  const claude = makeRequest('claude', {
    session_id: 'claude-fixture',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: {},
  });
  const claudeFile = path.join(options.root, 'requests', `${claude.id}.json`);
  atomicJSON(claudeFile, claude);
  const claudeBefore = fs.readFileSync(claudeFile, 'utf8');

  connections.setCursorReview(false);

  assert.equal(connections.cursorReview(), false);
  assert.deepEqual(await result, { permission: 'ask' });
  const events = drainEvents(options.root).filter((event) => event.requestId === active.id);
  assert.equal(events.at(-1).requestState, 'returned');
  assert.equal(
    events.some((event) => event.requestState === 'responded'),
    false,
  );
  assert.equal(fs.readFileSync(queuedFile, 'utf8'), queuedBefore);
  assert.equal(fs.readFileSync(claudeFile, 'utf8'), claudeBefore);
  assert.equal(fs.existsSync(path.join(options.root, 'responses', `${claude.id}.json`)), false);
});

test('disabling and reconnecting preserve foreign Cursor hooks and session policy settings', (t) => {
  const options = fixture(t);
  const file = path.join(options.home, '.cursor', 'hooks.json');
  const foreign = { command: '/fixture/foreign-hook', timeout: 17, failClosed: true };
  const sessionPolicy = { autoRun: 'session', approvalMode: 'existing-choice' };
  atomicJSON(file, {
    version: 1,
    sessionPolicy,
    hooks: { beforeShellExecution: [foreign], beforeMCPExecution: [foreign] },
  });
  const settingsFile = path.join(options.home, '.cursor', 'settings.json');
  const settings = '{\n  "sessionPolicy": "leave this exact fixture unchanged"\n}\n';
  fs.writeFileSync(settingsFile, settings);
  atomicJSON(path.join(options.root, 'controls.json'), {
    cursorReview: false,
    unrelated: { keep: true },
  });
  const connections = new Connections(options);
  connections.setCursorReview(true);
  connections.setCursorReview(false);
  connections.configure('cursor');
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(current.sessionPolicy, sessionPolicy);
  assert.deepEqual(current.hooks.beforeShellExecution, [foreign]);
  assert.deepEqual(current.hooks.beforeMCPExecution, [foreign]);
  assert.ok(current.hooks.postToolUse);
  assert.equal(connections.cursorReview(), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(options.root, 'controls.json'), 'utf8')), {
    cursorReview: false,
    unrelated: { keep: true },
  });
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), settings);
});

test('disabling tolerates a review ending or a user response winning during handoff', (t) => {
  const options = fixture(t);
  const connections = new Connections(options);
  connections.setCursorReview(true);
  const raw = {
    conversation_id: 'race-fixture',
    hook_event_name: 'beforeShellExecution',
    command: 'echo fixture-only',
  };
  const ended = makeRequest('cursor', raw),
    endedFile = path.join(options.root, 'requests', `${ended.id}.json`);
  atomicJSON(endedFile, ended);
  const read = fs.readFileSync;
  let reads = 0;
  const readMock = t.mock.method(fs, 'readFileSync', (file, ...args) => {
    if (file === endedFile && ++reads === 2) fs.unlinkSync(endedFile);
    return read(file, ...args);
  });
  assert.doesNotThrow(() => connections.setCursorReview(false));
  readMock.mock.restore();
  assert.equal(fs.existsSync(path.join(options.root, 'responses', `${ended.id}.json`)), false);

  const raced = makeRequest('cursor', raw),
    responseDir = path.join(options.root, 'responses');
  atomicJSON(path.join(options.root, 'requests', `${raced.id}.json`), raced);
  const responseFile = path.join(responseDir, `${raced.id}.json`),
    mkdir = fs.mkdirSync;
  t.mock.method(fs, 'mkdirSync', (file, ...args) => {
    const result = mkdir(file, ...args);
    if (file === responseDir) fs.writeFileSync(responseFile, '{"action":"deny"}', { flag: 'wx' });
    return result;
  });
  assert.doesNotThrow(() => connections.setCursorReview(false));
  assert.equal(fs.readFileSync(responseFile, 'utf8'), '{"action":"deny"}');
  assert.equal(connections.cursorReview(), false);
});

test('Node requirement matches the locked Electron dependencies', () => {
  for (const version of ['20.20.0', '22.11.0', 'invalid'])
    assert.equal(supportedNode(version), false);
  for (const version of ['22.12.0', '22.13.0', '24.0.0'])
    assert.equal(supportedNode(version), true);
});
