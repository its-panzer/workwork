const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, StatusStore, STALE_MS, RETAIN_MS } = require('../src/events.cjs');
const raw = {
  session_id: 'one',
  cwd: '/work/fixture-project',
  hook_event_name: 'UserPromptSubmit',
};
test('Cursor imported Claude hooks do not duplicate native Cursor activity', () => {
  assert.equal(normalize('claude', { ...raw, cursor_version: '3.7.0' }), null);
  assert.equal(
    normalize('cursor', { ...raw, cursor_version: '3.7.0', hook_event_name: 'beforeSubmitPrompt' })
      .provider,
    'cursor',
  );
  assert.equal(normalize('claude', raw).provider, 'claude');
});
test('the stored event excludes prompt, tool input, transcript and absolute path', () => {
  const event = normalize(
    'claude',
    {
      ...raw,
      prompt: 'PRIVATE',
      tool_input: { command: 'PRIVATE' },
      transcript_path: '/PRIVATE',
      last_assistant_message: 'PRIVATE',
    },
    1000,
  );
  assert.equal(event.project, 'fixture-project');
  assert.ok(!JSON.stringify(event).includes('PRIVATE'));
  assert.ok(!JSON.stringify(event).includes('/work'));
});
test('multiple apps and sessions are independent; older events cannot overwrite new status', () => {
  const store = new StatusStore();
  store.apply(normalize('claude', raw, 1000));
  store.apply(normalize('codex', raw, 1001));
  store.apply(normalize('claude', { ...raw, session_id: 'two' }, 1002));
  store.apply(normalize('claude', { ...raw, hook_event_name: 'PermissionRequest' }, 2000));
  store.apply(normalize('claude', { ...raw, hook_event_name: 'PostToolUse' }, 1500));
  assert.equal(store.snapshot(2001).length, 3);
  assert.equal(store.snapshot(2001)[0].status, 'attention');
});
test('silence becomes unknown and never success or an invented permission request', () => {
  const store = new StatusStore([normalize('claude', raw, 1000)]);
  assert.equal(store.snapshot(1001 + STALE_MS)[0].status, 'unknown');
  assert.equal(store.snapshot(1001 + RETAIN_MS).length, 0);
});
test('compaction and recoverable tool failure do not close a task', () => {
  assert.equal(
    normalize('codex', { ...raw, hook_event_name: 'SessionStart', source: 'compact' }),
    null,
  );
  assert.equal(
    normalize('claude', { ...raw, hook_event_name: 'PostToolUseFailure' }).status,
    'running',
  );
  assert.equal(normalize('codex', { ...raw, hook_event_name: 'Interrupt' }).status, 'interrupted');
});
test('Cursor completion is explicit; cancelled or unknown endings are not success', () => {
  const input = {
    conversation_id: 'cursor-one',
    workspace_roots: ['C:\\work\\UI'],
    hook_event_name: 'stop',
  };
  assert.equal(normalize('cursor', input), null);
  assert.equal(normalize('cursor', { ...input, status: 'aborted' }).status, 'interrupted');
  assert.equal(normalize('cursor', { ...input, status: 'completed' }).status, 'finished');
  assert.equal(normalize('cursor', { ...input, status: 'error' }).project, 'UI');
});
test('a dismissed session reappears when it starts working again', () => {
  const store = new StatusStore([normalize('claude', raw, 1000)]);
  store.dismiss('claude:one');
  assert.equal(store.snapshot(1001).length, 0);
  store.apply(normalize('claude', raw, 1002));
  assert.equal(store.snapshot(1003).length, 1);
});
test('queued UI state cannot replace an acknowledged or ended request', () => {
  const { requestLifecycleEvent } = require('../src/requests.cjs');
  const request = {
    id: 'request-1',
    provider: 'claude',
    sessionId: 'one',
    cwd: '/fixture',
    createdAt: 1000,
  };
  for (const state of ['responded', 'returned', 'ended']) {
    const store = new StatusStore();
    store.apply(requestLifecycleEvent(request, state, null, 2000));
    assert.equal(store.apply(requestLifecycleEvent(request, 'submitted', null, 2100)), null);
    assert.equal(store.snapshot(2200)[0].requestState, state);
  }
});
