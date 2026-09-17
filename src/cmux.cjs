const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { projectName, compareTasks } = require('./task-model.cjs');
const run = promisify(execFile);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CLI = '/Applications/cmux.app/Contents/Resources/bin/cmux';
function terminalContext(env = process.env) {
  const workspace = env.CMUX_WORKSPACE_ID;
  const surface = env.CMUX_SURFACE_ID || env.CMUX_TAB_ID;
  return UUID.test(workspace || '') && UUID.test(surface || '')
    ? { kind: 'cmux', workspace, surface }
    : undefined;
}
function validTerminal(value) {
  return value?.kind === 'cmux' && UUID.test(value.workspace) && UUID.test(value.surface);
}
function sessionURL(terminal) {
  if (!validTerminal(terminal)) throw Error('The cmux pane could not be identified.');
  return `cmux://workspace/${terminal.workspace}/surface/${terminal.surface}`;
}
function processMap(text) {
  return new Map(
    text.split('\n').flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      return match ? [[Number(match[1]), path.basename(match[2]).toLowerCase()]] : [];
    }),
  );
}
function sessionRows(records, processes, now = Date.now()) {
  return records.flatMap((record) => {
    const provider = record.agent;
    const terminal = { kind: 'cmux', workspace: record.workspace_id, surface: record.surface_id };
    if (
      !['claude', 'codex'].includes(provider) ||
      !UUID.test(record.session_id || '') ||
      !validTerminal(terminal) ||
      !Number.isSafeInteger(record.pid) ||
      processes.get(record.pid) !== provider ||
      record.active_for_surface !== true
    )
      return [];
    const time = Number(record.updated_at_unix) * 1000;
    if (!Number.isFinite(time) || time <= 0 || time > now + 60000) return [];
    let status =
      { running: 'running', idle: 'idle', needsInput: 'attention', unknown: 'unknown' }[
        record.agent_lifecycle
      ] || 'unknown';
    if (['running', 'attention'].includes(status) && now - time > 15 * 60 * 1000)
      status = 'unknown';
    const details = {
      running: 'Working in cmux',
      idle: 'Session open in cmux',
      attention: 'Input requested in cmux',
      unknown: 'Session detected; waiting for a fresh activity signal',
    };
    const project = projectName(record.cwd, 'cmux session');
    return [
      {
        provider,
        sessionId: record.session_id,
        key: `${provider}:${record.session_id}`,
        project,
        status,
        detail: details[status],
        sourceEvent: 'CmuxSession',
        time,
        terminal,
        pid: record.pid,
      },
    ];
  });
}
function mergeSessions(tasks, sessions, requests = []) {
  const waiting = new Set(requests.map((request) => `${request.provider}:${request.sessionId}`));
  const result = new Map(tasks.map((task) => [task.key, task]));
  for (const session of sessions) {
    const task = result.get(session.key);
    const latest = task && (task.time >= session.time || waiting.has(session.key)) ? task : session;
    const row = { ...task, ...latest, terminal: session.terminal, sessionOpen: true };
    if (latest === session)
      for (const field of ['requestId', 'requestCreatedAt', 'requestState', 'requestReason'])
        delete row[field];
    result.set(session.key, row);
  }
  return [...result.values()].sort(compareTasks).slice(0, 80);
}
class CmuxSessions {
  constructor({ cli = CLI, execute = run } = {}) {
    this.cli = cli;
    this.execute = execute;
    this.sessions = [];
    this.error = null;
    this.checkedAt = 0;
    this.pending = false;
  }
  snapshot() {
    return {
      available: fs.existsSync(this.cli),
      sessions: this.sessions,
      error: this.error,
      checkedAt: this.checkedAt,
    };
  }
  async refresh() {
    if (this.pending || Date.now() - this.checkedAt < 5000) return;
    this.pending = true;
    try {
      if (!fs.existsSync(this.cli)) {
        this.sessions = [];
        return;
      }
      const outputs = await Promise.all([
        this.execute(this.cli, ['sessions', '--agent', 'claude', '--json', '--limit', '100'], {
          timeout: 3000,
          maxBuffer: 4 * 1024 * 1024,
        }),
        this.execute(this.cli, ['sessions', '--agent', 'codex', '--json', '--limit', '100'], {
          timeout: 3000,
          maxBuffer: 4 * 1024 * 1024,
        }),
        this.execute('/bin/ps', ['-axo', 'pid=,comm='], { timeout: 3000, maxBuffer: 1024 * 1024 }),
      ]);
      const records = outputs.slice(0, 2).flatMap((output) => {
        const parsed = JSON.parse(output.stdout);
        if (!Array.isArray(parsed.sessions)) throw Error('Unexpected session metadata');
        return parsed.sessions;
      });
      this.sessions = sessionRows(records, processMap(outputs[2].stdout));
      this.error = null;
    } catch {
      this.error = 'Could not read cmux sessions. Open cmux and try again.';
      this.sessions = [];
    } finally {
      this.checkedAt = Date.now();
      this.pending = false;
    }
  }
}
module.exports = {
  CmuxSessions,
  terminalContext,
  validTerminal,
  sessionURL,
  sessionRows,
  processMap,
  mergeSessions,
};
