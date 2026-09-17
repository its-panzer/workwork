#!/usr/bin/env node
const { normalize } = require('../src/events.cjs');
const { writeEvent } = require('../src/storage.cjs');
const { terminalContext } = require('../src/cmux.cjs');
const provider = process.argv[2];
const eventOverride = process.argv[3];
let bytes = 0;
const chunks = [];
// This observer never rejects a tool, submits a prompt or approves an action.
function finish() {
  if (provider === 'cursor' && eventOverride === 'beforeSubmitPrompt')
    process.stdout.write('{"continue":true}\n');
  else if (provider !== 'cursor') process.stdout.write('{}\n');
}
const timeout = setTimeout(() => {
  finish();
  process.exit(0);
}, 1200);
process.stdin.on('data', (chunk) => {
  bytes += chunk.length;
  if (bytes <= 2 * 1024 * 1024) chunks.push(chunk);
});
process.stdin.on('end', () => {
  try {
    if (bytes <= 2 * 1024 * 1024) {
      const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (provider === 'claude' && typeof raw.cursor_version === 'string' && raw.cursor_version)
        process.exit(0);
      if (eventOverride) raw.hook_event_name = eventOverride;
      const event = normalize(provider, raw, Date.now(), terminalContext());
      if (event) writeEvent(event);
    }
  } catch {
  } finally {
    clearTimeout(timeout);
    finish();
  }
});
process.stdin.on('error', () => {
  clearTimeout(timeout);
  finish();
});
