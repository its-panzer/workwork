const { PROVIDERS, STATES, projectName, compareTasks } = require('./task-model.cjs');
const { validTerminal } = require('./cmux.cjs');
const clean = (value, max = 160) =>
  typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, max) : '';

// Only retain identity and status. Prompts, commands, code and transcripts never enter the spool.
function normalize(provider, raw, now = Date.now(), terminal) {
  if (!PROVIDERS.includes(provider) || !raw || typeof raw !== 'object') return null;
  // Cursor also imports Claude settings. Its native hook already reports this event.
  if (provider === 'claude' && typeof raw.cursor_version === 'string' && raw.cursor_version)
    return null;
  const event = raw.hook_event_name || raw.event;
  let id = raw.session_id || raw.conversation_id || raw.thread_id;
  if (typeof id !== 'string' || !id.length || id.length > 200) return null;
  let status, detail;
  if (provider === 'cursor') {
    if (event === 'sessionStart') [status, detail] = ['idle', 'Session opened'];
    if (event === 'beforeSubmitPrompt') [status, detail] = ['running', 'Working'];
    if (['beforeShellExecution', 'beforeMCPExecution'].includes(event))
      [status, detail] = ['attention', 'Action review in workwork'];
    if (event === 'postToolUse') [status, detail] = ['running', 'Tool finished; agent is working'];
    if (event === 'postToolUseFailure')
      [status, detail] = ['running', 'A tool failed; agent may recover'];
    if (event === 'stop') {
      if (raw.status === 'completed') [status, detail] = ['finished', 'Turn finished'];
      if (raw.status === 'aborted') [status, detail] = ['interrupted', 'Turn interrupted'];
      if (raw.status === 'error') [status, detail] = ['error', 'Turn ended with an error'];
    }
    if (event === 'sessionEnd') [status, detail] = ['closed', 'Session closed'];
  } else {
    if (event === 'SessionStart' && raw.source === 'compact') return null;
    if (event === 'SessionStart') [status, detail] = ['idle', 'Session opened'];
    if (event === 'UserPromptSubmit') [status, detail] = ['running', 'Working'];
    if (event === 'PreToolUse')
      [status, detail] = ['running', `Using ${clean(raw.tool_name, 60) || 'a tool'}`];
    if (event === 'PreToolUse' && ['AskUserQuestion', 'request_user_input'].includes(raw.tool_name))
      [status, detail] = ['attention', 'Your input is needed'];
    if (event === 'PostToolUse') [status, detail] = ['running', 'Tool finished; agent is working'];
    if (event === 'PostToolUseFailure')
      [status, detail] = ['running', 'A tool failed; agent may recover'];
    if (event === 'PermissionRequest') [status, detail] = ['attention', 'Permission needed'];
    if (event === 'Elicitation') [status, detail] = ['attention', 'Your input is needed'];
    if (
      event === 'Notification' &&
      [
        'permission_prompt',
        'elicitation_dialog',
        'elicitation_url_dialog',
        'agent_needs_input',
      ].includes(raw.notification_type)
    ) {
      [status, detail] = [
        'attention',
        raw.notification_type === 'permission_prompt'
          ? 'Permission needed'
          : 'Your input is needed',
      ];
    }
    if (event === 'Stop')
      [status, detail] = [
        'finished',
        raw.background_tasks?.length ? 'Turn ended; background tasks may remain' : 'Turn ended',
      ];
    if (event === 'Interrupt') [status, detail] = ['interrupted', 'Turn interrupted'];
    if (event === 'StopFailure') [status, detail] = ['error', 'Turn ended with an error'];
    if (event === 'SessionEnd') [status, detail] = ['closed', 'Session closed'];
  }
  if (!status) return null;
  return {
    provider,
    sessionId: clean(id, 200),
    runId: clean(raw.prompt_id || raw.generation_id || raw.turn_id, 200),
    project: projectName(raw.cwd || raw.workspace_roots?.[0]),
    status,
    detail,
    time: now,
    sourceEvent: clean(event, 64),
    ...(['claude', 'codex'].includes(provider) && validTerminal(terminal) ? { terminal } : {}),
  };
}

function validEvent(e) {
  return (
    e &&
    PROVIDERS.includes(e.provider) &&
    STATES.includes(e.status) &&
    typeof e.sessionId === 'string' &&
    e.sessionId.length > 0 &&
    e.sessionId.length <= 200 &&
    typeof e.project === 'string' &&
    e.project.length <= 70 &&
    typeof e.detail === 'string' &&
    e.detail.length <= 160 &&
    typeof e.sourceEvent === 'string' &&
    e.sourceEvent.length <= 64 &&
    Number.isFinite(e.time) &&
    e.time > 0
  );
}

const STALE_MS = 15 * 60 * 1000;
const RETAIN_MS = 24 * 60 * 60 * 1000;
class StatusStore {
  constructor(rows = []) {
    this.rows = new Map(
      (Array.isArray(rows) ? rows : [])
        .filter(validEvent)
        .map((row) => [`${row.provider}:${row.sessionId}`, row]),
    );
  }
  apply(event) {
    if (!validEvent(event)) return null;
    const key = `${event.provider}:${event.sessionId}`;
    const previous = this.rows.get(key);
    // A queued decision is not an acknowledgement. A late UI update cannot
    // replace the hook's authoritative completion, even with a newer timestamp.
    if (
      event.requestId &&
      previous?.requestId === event.requestId &&
      event.requestState === 'submitted' &&
      ['responded', 'returned', 'ended'].includes(previous.requestState)
    )
      return null;
    if (
      previous?.requestId === event.requestId &&
      event.requestId &&
      event.requestState === 'ended' &&
      ['returned', 'responded'].includes(previous.requestState)
    )
      return null;
    // A late completion must not replace activity or another request that began later.
    if (
      event.requestId &&
      event.requestState !== 'pending' &&
      previous &&
      previous.requestId !== event.requestId &&
      (!Number.isFinite(event.requestCreatedAt) || previous.time >= event.requestCreatedAt)
    )
      return null;
    if (previous && previous.time > event.time) return null;
    const row = {
      ...event,
      ...(event.terminal ? {} : previous?.terminal ? { terminal: previous.terminal } : {}),
      dismissed: false,
    };
    this.rows.set(key, row);
    return { row, changed: !previous || previous.status !== row.status, previous };
  }
  dismiss(key) {
    const row = this.rows.get(key);
    if (row) row.dismissed = true;
  }
  snapshot(now = Date.now()) {
    for (const [key, row] of this.rows) if (now - row.time > RETAIN_MS) this.rows.delete(key);
    return [...this.rows.entries()]
      .filter(([, r]) => !r.dismissed)
      .map(([key, r]) => ({
        ...r,
        key,
        status:
          ['running', 'attention'].includes(r.status) && now - r.time > STALE_MS
            ? 'unknown'
            : r.status,
        detail:
          ['running', 'attention'].includes(r.status) && now - r.time > STALE_MS
            ? 'No recent signal; check the app'
            : r.detail,
      }))
      .sort(compareTasks)
      .slice(0, 40);
  }
  serialize() {
    return [...this.rows.values()];
  }
}
module.exports = { PROVIDERS, STATES, normalize, validEvent, StatusStore, STALE_MS, RETAIN_MS };
