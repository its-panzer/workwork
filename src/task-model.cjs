const PROVIDERS = ['claude', 'codex', 'cursor'];
const STATES = [
  'running',
  'attention',
  'finished',
  'error',
  'interrupted',
  'idle',
  'closed',
  'unknown',
];
const PRIORITY = {
  attention: 0,
  error: 1,
  running: 2,
  unknown: 3,
  idle: 4,
  finished: 5,
  interrupted: 6,
  closed: 7,
};

function projectName(value, fallback = 'Untitled project') {
  return (
    String(value || '')
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1)
      ?.replace(/[\x00-\x1f\x7f]/g, '')
      .slice(0, 70) || fallback
  );
}

function compareTasks(a, b) {
  return PRIORITY[a.status] - PRIORITY[b.status] || b.time - a.time;
}

module.exports = { PROVIDERS, STATES, projectName, compareTasks };
