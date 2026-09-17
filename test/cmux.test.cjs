const test = require('node:test');
const assert = require('node:assert/strict');
const {
  terminalContext,
  sessionURL,
  sessionRows,
  mergeSessions,
  processMap,
} = require('../src/cmux.cjs');
const { normalize } = require('../src/events.cjs');
const workspace = '11111111-1111-1111-1111-111111111111';
const surface = '22222222-2222-2222-2222-222222222222';
const id = '33333333-3333-3333-3333-333333333333';
const record = {
  agent: 'claude',
  session_id: id,
  pid: 101,
  active_for_surface: true,
  workspace_id: workspace,
  surface_id: surface,
  updated_at_unix: 1000,
  cwd: '/private/project',
  agent_lifecycle: 'running',
};
test('Claude and Codex session discovery rejects dead, reused, and inactive panes', () => {
  const processes = processMap(
    ' 101 /Users/me/bin/claude\n 102 /usr/local/bin/codex\n 103 /bin/zsh',
  );
  const rows = sessionRows(
    [
      record,
      { ...record, agent: 'codex', pid: 102 },
      { ...record, pid: 999 },
      { ...record, pid: 103 },
      { ...record, active_for_surface: false },
    ],
    processes,
    1000001,
  );
  assert.deepEqual(
    rows.map((row) => row.provider),
    ['claude', 'codex'],
  );
  assert.equal(rows[0].project, 'project');
  assert.equal(
    sessionRows([{ ...record, agent_lifecycle: 'needsInput' }], processes, 2000000)[0].status,
    'unknown',
  );
});
test('discovery enriches a hook task without duplicating it or overriding a live approval', () => {
  const [session] = sessionRows([record], new Map([[101, 'claude']]), 1000001);
  const task = {
    ...session,
    status: 'attention',
    sourceEvent: 'PermissionRequest',
    terminal: undefined,
  };
  const merged = mergeSessions(
    [task],
    [{ ...session, time: session.time + 1 }],
    [{ provider: 'claude', sessionId: id }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'attention');
  assert.equal(merged[0].terminal.surface, surface);
  assert.equal(
    mergeSessions([{ ...task, status: 'finished' }], [{ ...session, time: session.time + 1 }])[0]
      .status,
    'running',
  );
  const resumed = mergeSessions(
    [{ ...task, requestId: 'old', requestState: 'returned', requestReason: 'timeout' }],
    [{ ...session, time: session.time + 1 }],
  )[0];
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.requestState, undefined);
});
test('terminal context allowlists identity and validates navigation links', () => {
  const terminal = terminalContext({
    CMUX_WORKSPACE_ID: workspace,
    CMUX_SURFACE_ID: surface,
    CMUX_SOCKET_PASSWORD: 'PRIVATE',
    CMUX_SOCKET_PATH: '/PRIVATE',
  });
  assert.equal(sessionURL(terminal), `cmux://workspace/${workspace}/surface/${surface}`);
  assert.equal(JSON.stringify(terminal).includes('PRIVATE'), false);
  assert.throws(() => sessionURL({ ...terminal, surface: 'invalid?command=oops' }));
  for (const provider of ['claude', 'codex']) {
    assert.deepEqual(
      normalize(provider, { session_id: id, hook_event_name: 'SessionStart' }, 1, terminal)
        .terminal,
      terminal,
    );
  }
});
