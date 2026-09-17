const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  makeRequest,
  fieldsFor,
  validateDecision,
  hookResponse,
  pendingRequests,
  submitDecision,
  requestLifecycleEvent,
  reconcileRequests,
  RESPONSE_GRACE_MS,
} = require('../src/requests.cjs');
const { StatusStore, normalize } = require('../src/events.cjs');
const { atomicJSON, drainEvents } = require('../src/storage.cjs');
const base = {
  session_id: 'request-test',
  cwd: '/test/project',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'echo fixture-only' },
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let n = 0; n < 80; n++) {
    const value = fn();
    if (value) return value;
    await wait(25);
  }
  throw new Error('Timed out waiting for fixture');
}
function runHook(root, provider, payload) {
  const child = spawn(
    process.execPath,
    [path.resolve(__dirname, '../hooks/request.cjs'), provider],
    { env: { ...process.env, WORKWORK_HOME: root } },
  );
  let out = '',
    err = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (err += chunk));
  const result = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err || `exit ${code}`)),
    );
  });
  child.stdin.end(JSON.stringify(payload));
  return { child, result };
}
for (const provider of ['claude', 'codex'])
  test(`${provider}: a real hook process accepts one explicit answer and deletes its request`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-request-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    atomicJSON(path.join(root, 'heartbeat.json'), { pid: process.pid, time: Date.now() });
    const { child, result } = runHook(root, provider, base);
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    const request = await until(() => pendingRequests(root)[0]);
    assert.equal(request.preview, JSON.stringify(base.tool_input, null, 2));
    submitDecision(request.id, { action: 'allow' }, root);
    assert.throws(() => submitDecision(request.id, { action: 'allow' }, root));
    assert.deepEqual(await result, {
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
    assert.equal(pendingRequests(root).length, 0);
    const events = drainEvents(root);
    assert.equal(events[0].requestState, 'pending');
    assert.equal(events.at(-1).requestState, 'responded');
    assert.equal(events.at(-1).requestId, request.id);
    assert.equal(JSON.stringify(events).includes('fixture-only'), false);
  });
test('without the companion, approval falls back to the source app', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-fallback-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { result } = runHook(root, 'codex', base);
  assert.deepEqual(await result, {});
  assert.equal(pendingRequests(root).length, 0);
  const events = drainEvents(root),
    store = new StatusStore();
  assert.equal(events.length, 1);
  assert.equal(events[0].requestState, 'returned');
  store.apply(events[0]);
  assert.equal(store.snapshot()[0].requestReason, 'unavailable');
});
test('closing the companion cannot approve a request', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-close-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const heartbeat = path.join(root, 'heartbeat.json');
  atomicJSON(heartbeat, { pid: process.pid, time: Date.now() });
  const { child, result } = runHook(root, 'claude', base);
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  await until(() => pendingRequests(root)[0]);
  fs.unlinkSync(heartbeat);
  assert.deepEqual(await result, {});
  assert.equal(drainEvents(root).at(-1).requestReason, 'unavailable');
});
test('incomplete approval payloads return to the source app without offering a decision', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-incomplete-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  atomicJSON(path.join(root, 'heartbeat.json'), { pid: process.pid, time: Date.now() });
  for (const provider of ['claude', 'codex']) {
    for (const changed of [
      { tool_name: undefined },
      { tool_name: ' ' },
      { tool_input: undefined },
      { tool_input: null },
      { tool_input: [] },
    ])
      assert.equal(makeRequest(provider, { ...base, ...changed }), null);
    assert.ok(makeRequest(provider, { ...base, tool_input: {} }));
    assert.deepEqual(await runHook(root, provider, { ...base, tool_input: undefined }).result, {});
    assert.deepEqual(pendingRequests(root), []);
  }
});
test('malformed persisted requests are removed before reaching the dashboard', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-malformed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const approval = makeRequest('claude', base);
  const question = makeRequest('claude', {
    ...base,
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question: 'Choose a color', options: [{ label: 'Blue' }] }] },
  });
  const form = makeRequest('claude', {
    ...base,
    hook_event_name: 'Elicitation',
    requested_schema: { type: 'object', properties: { name: { type: 'string' } } },
  });
  for (const request of [
    { ...approval, kind: 'unknown' },
    { ...approval, tool: null },
    { ...approval, preview: '[]' },
    { ...question, questions: null },
    { ...question, originalInput: null },
    { ...form, fields: null },
    { ...form, schema: null },
    { ...form, provider: 'codex' },
  ]) {
    const file = path.join(root, 'requests', request.id + '.json');
    atomicJSON(file, request);
    assert.deepEqual(pendingRequests(root), []);
    assert.equal(fs.existsSync(file), false);
  }
  for (const request of [approval, question, form])
    atomicJSON(path.join(root, 'requests', request.id + '.json'), request);
  assert.equal(pendingRequests(root).length, 3);
});
test('expired responses and malformed answers are rejected', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-expire-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = makeRequest('codex', base, Date.now() - 130000, -1);
  atomicJSON(path.join(root, 'requests', `${request.id}.json`), request);
  assert.throws(() => submitDecision(request.id, { action: 'allow' }, root));
  assert.deepEqual(hookResponse(request, { action: 'allow-all' }), {});
  assert.equal(drainEvents(root).at(-1).requestReason, 'timeout');
});
test('review duration matches the provider and retains Cursor generation identity', () => {
  const cursor = makeRequest(
    'cursor',
    {
      conversation_id: 'fixture',
      generation_id: 'turn-2',
      hook_event_name: 'beforeShellExecution',
      command: 'echo fixture',
    },
    1000,
  );
  assert.equal(cursor.expiresAt - cursor.createdAt, 600000);
  assert.equal(cursor.turnId, 'turn-2');
  assert.equal(makeRequest('codex', base, 1000).expiresAt, 121000);
  assert.equal(makeRequest('claude', base, 1000).expiresAt, 121000);
});
test('late review completion never replaces newer activity or a different pending review', () => {
  const store = new StatusStore(),
    first = makeRequest('codex', base, 1000),
    second = makeRequest('codex', base, 2000);
  store.apply(requestLifecycleEvent(first, 'pending', null, 1000));
  store.apply(requestLifecycleEvent(second, 'pending', null, 2000));
  assert.equal(store.apply(requestLifecycleEvent(first, 'returned', 'timeout', 3000)), null);
  store.apply(normalize('codex', { ...base, hook_event_name: 'PostToolUse' }, 4000));
  assert.equal(store.apply(requestLifecycleEvent(second, 'responded', null, 5000)), null);
  assert.equal(store.snapshot(5000)[0].status, 'running');
  const tasks = reconcileRequests(store.snapshot(5000), [first, second]);
  assert.equal(tasks[0].requestId, first.id);
  assert.equal(tasks[0].status, 'attention');
  assert.equal(tasks[0].time, 4000);
  assert.equal(reconcileRequests(tasks, [second])[0].requestId, second.id);
});
test('expiry cannot delete a response already accepted by a living waiter', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = makeRequest('codex', base);
  atomicJSON(path.join(root, 'requests', `${request.id}.json`), request);
  submitDecision(request.id, { action: 'allow' }, root);
  assert.equal(pendingRequests(root, request.expiresAt + 1).length, 0);
  assert.equal(fs.existsSync(path.join(root, 'responses', `${request.id}.json`)), true);
  const store = new StatusStore();
  store.apply(requestLifecycleEvent(request, 'responded', null, request.expiresAt + 2));
  assert.equal(
    store.apply(requestLifecycleEvent(request, 'ended', 'timeout', request.expiresAt + 3)),
    null,
  );
  assert.equal(store.snapshot(request.expiresAt + 4)[0].requestState, 'responded');
});
test('orphan pending requests are visible, and disconnected review rows stop claiming to wait', () => {
  const request = makeRequest('codex', base, 1000);
  const tasks = reconcileRequests([], [request]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].project, 'project');
  assert.equal(reconcileRequests(tasks, [])[0].requestState, 'ended');
  const newerCmuxTask = { ...tasks[0], sourceEvent: 'CmuxSession', status: 'running', time: 2000 };
  assert.equal(reconcileRequests([newerCmuxTask], [])[0].status, 'running');
  const legacy = normalize(
    'cursor',
    { conversation_id: 'fixture', hook_event_name: 'beforeShellExecution' },
    1000,
  );
  assert.equal(reconcileRequests([{ ...legacy, key: 'cursor:fixture' }], [])[0].status, 'unknown');
});
test('dead waiters are cleaned up with a correlated end event', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-dead-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = makeRequest('codex', base, Date.now(), -1);
  atomicJSON(path.join(root, 'requests', `${request.id}.json`), request);
  assert.equal(pendingRequests(root).length, 0);
  const event = drainEvents(root)[0];
  assert.equal(event.requestId, request.id);
  assert.equal(event.requestReason, 'disconnected');
  assert.equal(fs.existsSync(path.join(root, 'requests', `${request.id}.json`)), false);
});
test('Claude question answers preserve original questions and tool inputs', () => {
  const questions = [
    {
      question: 'Choose layout',
      options: [
        { label: 'Compact', description: 'Small' },
        { label: 'Full', description: 'Large' },
      ],
      multiSelect: false,
    },
  ];
  const input = { questions, metadata: { source: 'fixture' } };
  const request = makeRequest('claude', {
    ...base,
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: input,
  });
  assert.equal(validateDecision(request, { action: 'answer', answers: {} }), false);
  const response = hookResponse(request, {
    action: 'answer',
    answers: { 'Choose layout': 'Compact' },
  });
  assert.deepEqual(response.hookSpecificOutput.updatedInput, {
    ...input,
    answers: { 'Choose layout': 'Compact' },
  });
  assert.equal(response.hookSpecificOutput.permissionDecision, 'allow');
});
test('MCP form answers are schema checked and unsupported forms stay native', () => {
  const raw = {
    ...base,
    hook_event_name: 'Elicitation',
    requested_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, choice: { type: 'string', enum: ['a', 'b'] } },
      required: ['name', 'choice'],
    },
  };
  const request = makeRequest('claude', raw);
  assert.equal(
    validateDecision(request, { action: 'answer', content: { name: 'yes', choice: 'c' } }),
    false,
  );
  assert.equal(
    validateDecision(request, {
      action: 'answer',
      content: { name: 'yes', choice: 'a', unexpected: true },
    }),
    false,
  );
  assert.deepEqual(
    hookResponse(request, { action: 'answer', content: { name: 'ok', choice: 'a' } })
      .hookSpecificOutput.content,
    { name: 'ok', choice: 'a' },
  );
  assert.equal(makeRequest('claude', { ...raw, mode: 'url' }), null);
  assert.equal(
    makeRequest('claude', {
      ...raw,
      requested_schema: { type: 'object', properties: { data: { type: 'array' } } },
    }),
    null,
  );
  assert.equal(
    makeRequest('claude', { ...raw, requested_schema: { ...raw.requested_schema, oneOf: [] } }),
    null,
  );
});
test('MCP form schemas and answers use own keys, including arbitrary property names', () => {
  assert.equal(fieldsFor({ type: 'object', properties: {}, required: ['constructor'] }), null);
  assert.equal(fieldsFor({ type: 'object', properties: {}, required: [7] }), null);
  assert.equal(fieldsFor({ type: 'object', properties: [] }), null);
  assert.equal(fieldsFor({ type: 'object', properties: {}, required: '' }), null);
  const schema = JSON.parse(
    '{"type":"object","properties":{"__proto__":{"type":"string"},"constructor":{"type":"string"}},"required":["__proto__","constructor"]}',
  );
  const request = makeRequest('claude', {
    ...base,
    hook_event_name: 'Elicitation',
    requested_schema: schema,
  });
  assert.ok(request);
  assert.equal(validateDecision(request, { action: 'answer', content: {} }), false);
  assert.equal(
    validateDecision(request, {
      action: 'answer',
      content: Object.create({ constructor: 'inherited' }),
    }),
    false,
  );
  const content = Object.assign(
    Object.create(null),
    JSON.parse('{"__proto__":"own answer","constructor":"another answer"}'),
  );
  assert.equal(validateDecision(request, { action: 'answer', content }), true);
  const response = JSON.parse(JSON.stringify(hookResponse(request, { action: 'answer', content })));
  assert.equal(Object.hasOwn(response.hookSpecificOutput.content, '__proto__'), true);
  assert.equal(response.hookSpecificOutput.content.__proto__, 'own answer');
});
test('Claude questions require own answer keys and reject malformed option objects', () => {
  const raw = {
    ...base,
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: {
      questions: [{ question: '__proto__', options: [{ label: 'One' }, { label: 'Two' }] }],
    },
  };
  const request = makeRequest('claude', raw);
  const answers = Object.create(null);
  answers.__proto__ = 'One';
  assert.equal(validateDecision(request, { action: 'answer', answers }), true);
  assert.equal(
    validateDecision(request, { action: 'answer', answers: Object.create({ __proto__: 'One' }) }),
    false,
  );
  assert.equal(makeRequest('claude', { ...raw, tool_input: { questions: [null] } }), null);
  assert.equal(
    makeRequest('claude', {
      ...raw,
      tool_input: { questions: [{ question: 'Choose', options: [null] }] },
    }),
    null,
  );
});
test('Cursor MCP reviews require complete identity and an object input', () => {
  const raw = {
    conversation_id: 'fixture',
    hook_event_name: 'beforeMCPExecution',
    tool_name: 'search',
    mcp_server_name: 'fixture',
    tool_input: '{"query":"fixture"}',
  };
  assert.ok(makeRequest('cursor', raw));
  assert.ok(makeRequest('cursor', { ...raw, tool_input: { query: 'fixture' } }));
  for (const field of ['tool_name', 'mcp_server_name', 'tool_input']) {
    const missing = { ...raw };
    delete missing[field];
    assert.equal(makeRequest('cursor', missing), null, field);
  }
  for (const tool_input of ['not JSON', 'null', '[]', '3', null, []])
    assert.equal(makeRequest('cursor', { ...raw, tool_input }), null);
  assert.equal(makeRequest('cursor', { ...raw, tool_name: ' ' }), null);
  assert.equal(makeRequest('cursor', { ...raw, mcp_server_name: ' ' }), null);
});
test('a malformed Cursor MCP event falls back without offering an approval', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-incomplete-mcp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  atomicJSON(path.join(root, 'heartbeat.json'), { pid: process.pid, time: Date.now() });
  const { result } = runHook(root, 'cursor', {
    conversation_id: 'fixture',
    hook_event_name: 'beforeMCPExecution',
  });
  assert.deepEqual(await result, { permission: 'ask' });
  assert.deepEqual(pendingRequests(root), []);
  assert.equal(
    drainEvents(root).some((event) => event.requestState === 'pending'),
    false,
  );
});
test('submission remains queued if the waiter finishes before the response is written', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-submit-race-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = makeRequest('codex', base),
    requestFile = path.join(root, 'requests', `${request.id}.json`);
  atomicJSON(requestFile, request);
  const dir = path.join(root, 'responses'),
    mkdir = fs.mkdirSync;
  t.mock.method(fs, 'mkdirSync', (file, ...args) => {
    if (file === dir) fs.unlinkSync(requestFile);
    return mkdir(file, ...args);
  });
  assert.equal(submitDecision(request.id, { action: 'allow' }, root), true);
  assert.equal(fs.existsSync(requestFile), false);
  assert.deepEqual(drainEvents(root), []);
  const submitted = requestLifecycleEvent(request, 'submitted', 'decision');
  assert.equal(submitted.requestState, 'submitted');
  assert.equal(submitted.detail, 'Response queued; waiting for the hook');
  assert.equal(submitted.status, 'idle');
  const responseFile = path.join(dir, `${request.id}.json`),
    createdAt = fs.statSync(responseFile).mtimeMs;
  pendingRequests(root, createdAt + RESPONSE_GRACE_MS - 1);
  assert.equal(fs.existsSync(responseFile), true);
  pendingRequests(root, createdAt + RESPONSE_GRACE_MS + 1);
  assert.equal(fs.existsSync(responseFile), false);
});
test('orphan cleanup preserves responses still owned by a living request', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-owned-response-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const request = makeRequest('codex', base),
    requestFile = path.join(root, 'requests', `${request.id}.json`);
  atomicJSON(requestFile, request);
  submitDecision(request.id, { action: 'allow' }, root);
  const responseFile = path.join(root, 'responses', `${request.id}.json`);
  const createdAt = fs.statSync(responseFile).mtimeMs;
  pendingRequests(root, createdAt + RESPONSE_GRACE_MS + 1);
  assert.equal(fs.existsSync(responseFile), true);
});
for (const kind of ['clarifying question', 'MCP form'])
  test(`${kind}: answer travels through a real hook subprocess`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-answer-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    atomicJSON(path.join(root, 'heartbeat.json'), { pid: process.pid, time: Date.now() });
    const raw =
      kind === 'clarifying question'
        ? {
            ...base,
            hook_event_name: 'PreToolUse',
            tool_name: 'AskUserQuestion',
            tool_input: {
              questions: [
                {
                  question: 'Which mode?',
                  options: [{ label: 'Quiet' }, { label: 'Sound' }],
                  multiSelect: false,
                },
              ],
            },
          }
        : {
            ...base,
            hook_event_name: 'Elicitation',
            requested_schema: {
              type: 'object',
              properties: { mode: { type: 'string', enum: ['Quiet', 'Sound'] } },
              required: ['mode'],
            },
          };
    const decision =
      kind === 'clarifying question'
        ? { action: 'answer', answers: { 'Which mode?': 'Quiet' } }
        : { action: 'answer', content: { mode: 'Quiet' } };
    const { child, result } = runHook(root, 'claude', raw);
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    const request = await until(() => pendingRequests(root)[0]);
    submitDecision(request.id, decision, root);
    const response = await result;
    if (kind === 'clarifying question')
      assert.equal(response.hookSpecificOutput.updatedInput.answers['Which mode?'], 'Quiet');
    else assert.equal(response.hookSpecificOutput.content.mode, 'Quiet');
    assert.equal(pendingRequests(root).length, 0);
  });
for (const hook_event_name of ['beforeShellExecution', 'beforeMCPExecution'])
  test(`Cursor ${hook_event_name}: explicit decisions traverse the hook; shutdown asks in Cursor`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-cursor-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const heartbeat = path.join(root, 'heartbeat.json');
    atomicJSON(heartbeat, { pid: process.pid, time: Date.now() });
    const raw = {
      conversation_id: 'cursor-test',
      hook_event_name,
      command: 'echo fixture-only',
      tool_name: 'search',
      mcp_server_name: 'fixture',
      tool_input: '{"query":"fixture"}',
    };
    const { child, result } = runHook(root, 'cursor', raw);
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    const request = await until(() => pendingRequests(root)[0]);
    assert.equal(request.review, true);
    assert.equal(request.hookEvent, hook_event_name);
    assert.deepEqual(hookResponse(request, { action: 'native' }), { permission: 'ask' });
    assert.equal(hookResponse(request, { action: 'deny' }).permission, 'deny');
    assert.equal(hookResponse(request, { action: 'allow-all' }).permission, 'ask');
    submitDecision(request.id, { action: 'allow' }, root);
    assert.deepEqual(await result, { permission: 'allow' });
    const next = runHook(root, 'cursor', raw);
    t.after(() => {
      if (next.child.exitCode === null) next.child.kill();
    });
    await until(() => pendingRequests(root)[0]);
    fs.unlinkSync(heartbeat);
    assert.deepEqual(await next.result, { permission: 'ask' });
    assert.equal(drainEvents(root).at(-1).requestState, 'returned');
  });
for (const action of ['deny', 'native'])
  test(`Cursor ${action}: the exact decision reaches the hook and ends its review`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-decision-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    atomicJSON(path.join(root, 'heartbeat.json'), { pid: process.pid, time: Date.now() });
    const { child, result } = runHook(root, 'cursor', {
      conversation_id: 'fixture',
      hook_event_name: 'beforeShellExecution',
      command: 'echo fixture',
    });
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    const request = await until(() => pendingRequests(root)[0]);
    submitDecision(request.id, { action }, root);
    assert.equal((await result).permission, action === 'native' ? 'ask' : 'deny');
    assert.equal(
      drainEvents(root).at(-1).requestState,
      action === 'native' ? 'returned' : 'responded',
    );
  });
