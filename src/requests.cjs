const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { readJSON, dataRoot, writeEvent } = require('./storage.cjs');
const { PROVIDERS, projectName, compareTasks } = require('./task-model.cjs');
const RESPONSE_GRACE_MS = 5000;
const REQUEST_FILE = /^[a-f0-9-]{36}\.json$/;
const plainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const nonemptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const validQuestions = (questions) =>
  Array.isArray(questions) &&
  questions.length > 0 &&
  questions.length <= 4 &&
  questions.every(
    (q) =>
      plainObject(q) &&
      nonemptyString(q.question) &&
      Array.isArray(q.options) &&
      q.options.every((o) => plainObject(o) && typeof o.label === 'string'),
  ) &&
  new Set(questions.map((q) => q.question)).size === questions.length;

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function companionAlive(root = dataRoot()) {
  const heartbeat = readJSON(path.join(root, 'heartbeat.json'), null);
  return heartbeat && Date.now() - heartbeat.time < 5000 && processAlive(heartbeat.pid);
}
function fieldsFor(schema) {
  if (
    !plainObject(schema) ||
    schema.type !== 'object' ||
    !plainObject(schema.properties) ||
    (schema.additionalProperties !== undefined && schema.additionalProperties !== false)
  )
    return null;
  if (
    Object.keys(schema).some(
      (key) =>
        ![
          'type',
          'properties',
          'required',
          'additionalProperties',
          'title',
          'description',
          '$schema',
        ].includes(key),
    )
  )
    return null;
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) ||
      schema.required.some(
        (key) => typeof key !== 'string' || !Object.hasOwn(schema.properties, key),
      ))
  )
    return null;
  const entries = Object.entries(schema.properties);
  if (entries.length > 20) return null;
  const fields = [];
  for (const [key, spec] of entries) {
    // Unsupported schemas stay in the original app, where the full renderer exists.
    if (!plainObject(spec) || !['string', 'boolean', 'number', 'integer'].includes(spec.type))
      return null;
    const supported = ['type', 'title', 'description', 'enum', 'default'];
    if (Object.keys(spec).some((k) => !supported.includes(k))) return null;
    if (
      spec.enum !== undefined &&
      (!Array.isArray(spec.enum) ||
        !spec.enum.length ||
        spec.enum.some(
          (v) =>
            typeof v !== (spec.type === 'integer' ? 'number' : spec.type) ||
            (spec.type === 'integer' && !Number.isInteger(v)) ||
            (spec.type === 'number' && !Number.isFinite(v)),
        ))
    )
      return null;
    if (
      ['title', 'description'].some(
        (key) => spec[key] !== undefined && typeof spec[key] !== 'string',
      )
    )
      return null;
    fields.push({
      key,
      type: spec.type,
      label: spec.title || key,
      description: spec.description || '',
      required: (schema.required || []).includes(key),
      ...(spec.enum === undefined ? {} : { options: spec.enum }),
    });
  }
  return fields;
}
function makeRequest(provider, raw, now = Date.now(), pid = process.pid) {
  if (!plainObject(raw)) return null;
  const event = raw.hook_event_name;
  const sessionId = raw.session_id || raw.conversation_id;
  if (
    !PROVIDERS.includes(provider) ||
    typeof sessionId !== 'string' ||
    !sessionId.length ||
    sessionId.length > 200
  )
    return null;
  let kind, preview, fields, questions;
  const cursorAction =
    provider === 'cursor' && ['beforeShellExecution', 'beforeMCPExecution'].includes(event);
  if (cursorAction) {
    kind = 'approval';
    if (event === 'beforeShellExecution' && !nonemptyString(raw.command)) return null;
    if (event === 'beforeMCPExecution') {
      if (!nonemptyString(raw.tool_name) || !nonemptyString(raw.mcp_server_name)) return null;
      try {
        if (
          !plainObject(
            typeof raw.tool_input === 'string' ? JSON.parse(raw.tool_input) : raw.tool_input,
          )
        )
          return null;
      } catch {
        return null;
      }
    }
    const input =
      event === 'beforeShellExecution'
        ? { command: raw.command, cwd: raw.cwd, sandbox: raw.sandbox }
        : { server: raw.mcp_server_name, tool: raw.tool_name, input: raw.tool_input };
    preview = JSON.stringify(input, null, 2);
    if (preview.length > 64000) return null;
  } else if (event === 'PermissionRequest' && provider !== 'cursor') {
    if (!nonemptyString(raw.tool_name) || !plainObject(raw.tool_input)) return null;
    kind = 'approval';
    preview = JSON.stringify(raw.tool_input, null, 2);
    if (preview.length > 64000) return null;
  } else if (
    event === 'PreToolUse' &&
    provider === 'claude' &&
    raw.tool_name === 'AskUserQuestion'
  ) {
    kind = 'claude-question';
    questions = raw.tool_input?.questions;
    if (!validQuestions(questions)) return null;
    preview = 'Claude Code has a question before continuing.';
  } else if (
    event === 'Elicitation' &&
    provider === 'claude' &&
    (!raw.mode || raw.mode === 'form')
  ) {
    kind = 'question';
    fields = fieldsFor(raw.requested_schema);
    if (!fields) return null;
    preview = raw.message || 'This tool needs your input.';
  } else return null;
  return {
    id: crypto.randomUUID(),
    provider,
    sessionId,
    turnId: raw.turn_id || raw.prompt_id || raw.generation_id || '',
    hookEvent: event,
    kind,
    tool: String(
      raw.tool_name || raw.mcp_server_name || (event === 'beforeShellExecution' ? 'Shell' : 'Tool'),
    ),
    cwd: String(raw.cwd || raw.workspace_roots?.[0] || ''),
    ...(cursorAction ? { review: true } : {}),
    preview,
    fields,
    questions,
    originalInput: kind === 'claude-question' ? raw.tool_input : undefined,
    schema: kind === 'question' ? raw.requested_schema : undefined,
    createdAt: now,
    expiresAt: now + (cursorAction ? 600000 : 120000),
    pid,
  };
}
function requestLifecycleEvent(request, state, reason, now = Date.now()) {
  const names = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' };
  const detail =
    state === 'pending'
      ? request.review
        ? 'Action review in workwork'
        : request.kind === 'approval'
          ? 'Permission needed'
          : 'Your input is needed'
      : state === 'submitted'
        ? 'Response queued; waiting for the hook'
        : state === 'responded'
          ? 'Response sent; awaiting the next signal'
          : state === 'returned'
            ? `Review returned to ${names[request.provider]}`
            : 'The waiting request ended; check the source app';
  return {
    provider: request.provider,
    sessionId: request.sessionId,
    runId: String(request.turnId || '').slice(0, 200),
    project: projectName(request.cwd),
    status: ['submitted', 'responded'].includes(state)
      ? 'idle'
      : state === 'ended'
        ? 'unknown'
        : 'attention',
    detail,
    time: now,
    sourceEvent: 'WorkworkRequest',
    requestId: request.id,
    requestCreatedAt: request.createdAt,
    requestState: state,
    requestReason: reason || null,
  };
}
function reconcileRequests(tasks, requests) {
  const rows = new Map(tasks.map((task) => [task.key, task]));
  const live = new Set();
  for (const request of requests) {
    const key = `${request.provider}:${request.sessionId}`;
    if (live.has(key)) continue;
    live.add(key);
    const task = rows.get(key);
    rows.set(key, {
      ...task,
      ...requestLifecycleEvent(request, 'pending', null, request.createdAt),
      key,
      ...(task ? { project: task.project, runId: task.runId, time: task.time } : {}),
    });
  }
  // Old versions left a review event behind after its waiter disappeared.
  for (const [key, task] of rows) {
    if (
      !live.has(key) &&
      ((task.sourceEvent === 'WorkworkRequest' && task.requestState === 'pending') ||
        (task.provider === 'cursor' &&
          ['beforeShellExecution', 'beforeMCPExecution'].includes(task.sourceEvent)))
    ) {
      rows.set(key, {
        ...task,
        status: 'unknown',
        requestState: 'ended',
        requestReason: 'disconnected',
        detail: 'This review is no longer waiting in workwork',
      });
    }
  }
  return [...rows.values()].sort(compareTasks);
}
function validateDecision(request, decision) {
  if (!plainObject(decision)) return false;
  if (decision.action === 'native') return true;
  if (request.kind === 'approval') return ['allow', 'deny'].includes(decision.action);
  if (request.kind === 'claude-question') {
    return (
      decision.action === 'answer' &&
      plainObject(decision.answers) &&
      Object.keys(decision.answers).length === request.questions.length &&
      request.questions.every(
        (q) =>
          Object.hasOwn(decision.answers, q.question) &&
          typeof decision.answers[q.question] === 'string' &&
          decision.answers[q.question].trim().length > 0 &&
          decision.answers[q.question].length < 10000,
      )
    );
  }
  if (decision.action === 'decline' || decision.action === 'cancel') return true;
  if (decision.action !== 'answer' || !plainObject(decision.content)) return false;
  const fields = fieldsFor(request.schema);
  if (!fields || Object.keys(decision.content).some((k) => !fields.some((f) => f.key === k)))
    return false;
  return fields.every((f) => {
    if (!Object.hasOwn(decision.content, f.key)) return !f.required;
    const value = decision.content[f.key];
    if (typeof value !== (['integer', 'number'].includes(f.type) ? 'number' : f.type)) return false;
    if (f.type === 'integer' && !Number.isInteger(value)) return false;
    if (f.type === 'number' && !Number.isFinite(value)) return false;
    return !f.options || f.options.includes(value);
  });
}
function hookResponse(request, decision) {
  if (request.provider === 'cursor') {
    const permission =
      validateDecision(request, decision) && ['allow', 'deny'].includes(decision.action)
        ? decision.action
        : 'ask';
    return {
      permission,
      ...(permission === 'deny'
        ? {
            user_message: 'Declined in workwork.',
            agent_message: 'The user declined this action in workwork.',
          }
        : {}),
    };
  }
  if (!validateDecision(request, decision) || decision.action === 'native') return {};
  if (request.kind === 'approval')
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision:
          decision.action === 'allow'
            ? { behavior: 'allow' }
            : { behavior: 'deny', message: 'Declined by the user in workwork.' },
      },
    };
  if (request.kind === 'claude-question')
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: {
          ...request.originalInput,
          questions: request.questions,
          answers: decision.answers,
        },
      },
    };
  return {
    hookSpecificOutput: {
      hookEventName: 'Elicitation',
      action: decision.action === 'answer' ? 'accept' : decision.action,
      ...(decision.action === 'answer' ? { content: decision.content } : {}),
    },
  };
}
function pruneOrphanResponses(root, now) {
  const dir = path.join(root, 'responses');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names.filter((name) => REQUEST_FILE.test(name))) {
    const file = path.join(dir, name);
    try {
      const info = fs.lstatSync(file);
      if (
        now - info.mtimeMs >= RESPONSE_GRACE_MS &&
        !fs.existsSync(path.join(root, 'requests', name))
      )
        fs.unlinkSync(file);
    } catch {}
  }
}
function validRequestContent(request) {
  if (!nonemptyString(request.tool) || typeof request.preview !== 'string') return false;
  if (request.kind === 'approval') {
    const supportedEvent =
      request.provider === 'cursor'
        ? ['beforeShellExecution', 'beforeMCPExecution'].includes(request.hookEvent)
        : request.hookEvent === 'PermissionRequest';
    try {
      return (
        supportedEvent &&
        request.preview.length <= 64000 &&
        plainObject(JSON.parse(request.preview))
      );
    } catch {
      return false;
    }
  }
  if (request.provider !== 'claude') return false;
  if (request.kind === 'claude-question')
    return (
      request.hookEvent === 'PreToolUse' &&
      validQuestions(request.questions) &&
      plainObject(request.originalInput) &&
      isDeepStrictEqual(request.questions, request.originalInput.questions)
    );
  if (request.kind === 'question') {
    const fields = fieldsFor(request.schema);
    return (
      request.hookEvent === 'Elicitation' &&
      fields !== null &&
      isDeepStrictEqual(request.fields, fields)
    );
  }
  return false;
}
function pendingRequests(root = dataRoot(), now = Date.now()) {
  pruneOrphanResponses(root, now);
  const dir = path.join(root, 'requests');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const pending = [];
  for (const name of names.filter((n) => REQUEST_FILE.test(n)).slice(0, 200)) {
    const request = readJSON(path.join(dir, name), null);
    const valid =
      request &&
      request.id + '.json' === name &&
      PROVIDERS.includes(request.provider) &&
      typeof request.sessionId === 'string' &&
      request.sessionId.length > 0 &&
      request.sessionId.length <= 200 &&
      Number.isFinite(request.createdAt) &&
      Number.isFinite(request.expiresAt) &&
      validRequestContent(request);
    if (!valid || !processAlive(request.pid)) {
      if (valid) {
        try {
          writeEvent(
            requestLifecycleEvent(
              request,
              'ended',
              request.expiresAt <= now ? 'timeout' : 'disconnected',
              now,
            ),
            root,
          );
        } catch {}
      }
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {}
      try {
        fs.unlinkSync(path.join(root, 'responses', name));
      } catch {}
      continue;
    }
    // The living waiter owns expiry and consumes an already accepted response first.
    // Deleting it here at the deadline could lose a choice made just before expiry.
    if (request.expiresAt > now && !fs.existsSync(path.join(root, 'responses', name)))
      pending.push(request);
  }
  return pending.sort((a, b) => a.createdAt - b.createdAt);
}
function submitDecision(id, decision, root = dataRoot()) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid request');
  const request = pendingRequests(root).find((r) => r.id === id);
  if (!request) throw new Error('This request has ended. Check the source app.');
  if (!validateDecision(request, decision))
    throw new Error('Please complete the requested fields.');
  const dir = path.join(root, 'responses');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // This only queues the choice. The waiter may finish concurrently, so only its
  // lifecycle event confirms receipt; orphaned response files are pruned later.
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(decision), {
    flag: 'wx',
    mode: 0o600,
  });
  return true;
}
module.exports = {
  companionAlive,
  makeRequest,
  fieldsFor,
  validateDecision,
  hookResponse,
  pendingRequests,
  submitDecision,
  requestLifecycleEvent,
  reconcileRequests,
  RESPONSE_GRACE_MS,
};
