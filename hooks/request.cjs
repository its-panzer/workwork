#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('../src/events.cjs');
const { atomicJSON, readJSON, writeEvent, dataRoot } = require('../src/storage.cjs');
const {
  companionAlive,
  makeRequest,
  validateDecision,
  hookResponse,
  requestLifecycleEvent,
} = require('../src/requests.cjs');
const { terminalContext } = require('../src/cmux.cjs');
const provider = process.argv[2];
const override = process.argv[3];
const root = dataRoot();
let size = 0,
  chunks = [],
  request,
  timer,
  ended = false,
  terminal;
function finish(
  decision = { action: 'native' },
  reason = decision.action === 'native' ? 'native' : 'decision',
) {
  if (ended) return;
  ended = true;
  clearInterval(timer);
  if (request) {
    try {
      writeEvent(
        {
          ...requestLifecycleEvent(
            request,
            decision.action === 'native' ? 'returned' : 'responded',
            reason,
          ),
          ...(terminal ? { terminal } : {}),
        },
        root,
      );
    } catch {}
    for (const folder of ['requests', 'responses']) {
      try {
        fs.unlinkSync(path.join(root, folder, `${request.id}.json`));
      } catch {}
    }
  }
  process.stdout.write(
    JSON.stringify(
      request
        ? hookResponse(request, decision)
        : provider === 'cursor'
          ? { permission: 'ask' }
          : {},
    ) + '\n',
  );
}
process.stdin.on('data', (chunk) => {
  size += chunk.length;
  if (size <= 2 * 1024 * 1024) chunks.push(chunk);
});
process.stdin.on('error', () => finish());
process.on('SIGTERM', () => {
  finish({ action: 'native' }, 'interrupted');
  process.exit(0);
});
process.on('SIGINT', () => {
  finish({ action: 'native' }, 'interrupted');
  process.exit(0);
});
process.stdin.on('end', () => {
  try {
    if (size > 2 * 1024 * 1024) return finish();
    const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (provider === 'claude' && typeof raw.cursor_version === 'string' && raw.cursor_version)
      process.exit(0);
    if (override) raw.hook_event_name = override;
    terminal = terminalContext();
    request = makeRequest(provider, raw);
    if (!request) {
      const event = normalize(provider, raw, Date.now(), terminal);
      if (event) writeEvent({ ...event, detail: 'This request needs the source app' }, root);
      return finish();
    }
    if (!companionAlive(root)) return finish({ action: 'native' }, 'unavailable');
    atomicJSON(path.join(root, 'requests', `${request.id}.json`), request);
    writeEvent(
      {
        ...requestLifecycleEvent(request, 'pending', null, request.createdAt),
        ...(terminal ? { terminal } : {}),
      },
      root,
    );
    timer = setInterval(() => {
      const decision = readJSON(path.join(root, 'responses', `${request.id}.json`), null);
      if (decision && validateDecision(request, decision)) return finish(decision);
      if (Date.now() >= request.expiresAt) return finish({ action: 'native' }, 'timeout');
      if (!companionAlive(root)) return finish({ action: 'native' }, 'unavailable');
    }, 150);
  } catch {
    finish();
  }
});
