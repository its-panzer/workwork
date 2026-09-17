const { makeRequest } = require('./requests.cjs');

function demoData(now = Date.now()) {
  const tasks = [
    {
      provider: 'claude',
      sessionId: 'demo-claude',
      runId: '1',
      project: 'Quest Log',
      status: 'attention',
      detail: 'Permission needed',
      time: now - 8000,
      sourceEvent: 'PermissionRequest',
    },
    {
      provider: 'codex',
      sessionId: 'demo-codex',
      runId: '2',
      project: 'Raid Planner',
      status: 'running',
      detail: 'Running the calendar tests',
      time: now - 26000,
      sourceEvent: 'PreToolUse',
    },
    {
      provider: 'cursor',
      sessionId: 'demo-cursor',
      runId: '3',
      project: 'Companion',
      status: 'finished',
      detail: 'Turn ended',
      time: now - 72000,
      sourceEvent: 'stop',
    },
    {
      provider: 'claude',
      sessionId: 'demo-question',
      runId: '4',
      project: 'Guild Tools',
      status: 'attention',
      detail: 'Your input is needed',
      time: now - 15000,
      sourceEvent: 'Elicitation',
      terminal: {
        kind: 'cmux',
        workspace: '11111111-1111-1111-1111-111111111111',
        surface: '22222222-2222-2222-2222-222222222222',
      },
    },
  ];
  const requests = [
    makeRequest(
      'claude',
      {
        session_id: 'demo-claude',
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        cwd: '/demo/Quest Log',
        tool_input: {
          command: 'npm test',
          description: 'Run the tests for the new quest filters.',
        },
      },
      now,
    ),
    makeRequest(
      'claude',
      {
        session_id: 'demo-question',
        hook_event_name: 'Elicitation',
        mcp_server_name: 'Project setup',
        cwd: '/demo/Guild Tools',
        message: 'How should the roster organize guild members?',
        requested_schema: {
          type: 'object',
          properties: {
            style: {
              type: 'string',
              title: 'Group members by',
              enum: ['Class and role', 'Raid team'],
            },
            note: { type: 'string', title: 'Anything else?' },
          },
          required: ['style'],
        },
      },
      now,
    ),
  ].map((r) => ({ ...r, expiresAt: now + 86400000 }));
  return { tasks, requests };
}

module.exports = { demoData };
