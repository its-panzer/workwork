const api = window.workwork;
const $ = (selector) => document.querySelector(selector);
const names = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' };
const states = {
  attention: 'Needs you',
  running: 'Working',
  finished: 'Turn ended',
  error: 'Error',
  interrupted: 'Interrupted',
  idle: 'Idle',
  closed: 'Closed',
  unknown: 'No recent signal',
};
const marks = { claude: '✳', codex: '⎔', cursor: '⌁' };
let data,
  selected,
  filter = 'all',
  connections = false,
  connectionBusy = false,
  initialized = false,
  taskSignature = '',
  detailSignature = '',
  detailTaskKey;
let connectionsRequest = 0;
const followupDrafts = new Map();
const guideOpen = new Map();

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(text, className, handler) {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', handler);
  return b;
}
function feedback(message) {
  $('#feedback').textContent = message;
  $('#feedback').hidden = !message;
}
function ago(time) {
  const s = Math.max(0, Math.floor(((data?.demoNow ?? Date.now()) - time) / 1000));
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.floor(s / 60)}m ago`
      : `${Math.floor(s / 3600)}h ago`;
}
function taskState(task) {
  const state = el('span', `task-state ${task.status}`);
  state.append(el('i', 'status-mark'), document.createTextNode(states[task.status]));
  return state;
}
function requestFor(task) {
  return data.requests.find((r) => r.provider === task.provider && r.sessionId === task.sessionId);
}
function render(next) {
  data = next;
  document.querySelectorAll('[data-filter]').forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (!initialized) {
    connections = Boolean(data.showConnections);
    initialized = true;
  }
  if (data.connectionsRequest > connectionsRequest) {
    connectionsRequest = data.connectionsRequest;
    connections = true;
    $('#detail').scrollTop = 0;
  }
  $('.workspace').classList.toggle('show-connections', connections);
  $('#connections-button').setAttribute('aria-pressed', String(connections));
  document.body.classList.toggle('has-requests', data.waiting > 0);
  document.body.classList.toggle('expanded', data.expanded);
  $('#panel').hidden = !data.expanded;
  $('#badge').hidden = data.waiting === 0;
  $('#badge').textContent = data.waiting > 99 ? '99+' : String(data.waiting);
  $('#gem').setAttribute('aria-expanded', String(data.expanded));
  $('#gem').setAttribute(
    'aria-label',
    `${data.expanded ? 'Collapse' : 'Open'} workwork; ${data.waiting} tasks need you`,
  );
  $('#gem').title =
    `Click to ${data.expanded ? 'close' : 'open'} · Drag to move · ${data.waiting} tasks need you`;
  $('#gem-tip').hidden = !data.expanded || !data.showGemTip;
  if (data.expanded && data.showGemTip) $('#gem').setAttribute('aria-describedby', 'gem-tip-text');
  else $('#gem').removeAttribute('aria-describedby');
  const showConnectionsTip = data.expanded && data.showConnectionsTip && !connections;
  $('#connections-tip').hidden = !showConnectionsTip;
  $('#connections-button').classList.toggle('tip-target', Boolean(showConnectionsTip));
  if (showConnectionsTip)
    $('#connections-button').setAttribute('aria-describedby', 'connections-tip-text');
  else $('#connections-button').removeAttribute('aria-describedby');
  $('#demo-banner').hidden = !data.demo;
  $('#shortcut').textContent = data.demo
    ? 'Click the jewel to open or close'
    : data.shortcutOK
      ? `${data.shortcut} to toggle`
      : 'Use the menu bar to toggle';
  $('#all-count').textContent = data.tasks.length;
  $('#attention-count').textContent = data.waiting;
  $('#running-count').textContent = data.tasks.filter((t) => t.status === 'running').length;
  $('#cmux-count').textContent = data.tasks.filter((t) => t.terminal?.kind === 'cmux').length;
  $('#connection-count').textContent = data.demo
    ? 'Preview'
    : `${data.connections.filter((c) => c.installed && !c.error).length} / 3 installed`;
  const visible = data.tasks.filter(
    (t) =>
      filter === 'all' ||
      t.status === filter ||
      (filter === 'attention' && requestFor(t)) ||
      (filter === 'cmux' && t.terminal?.kind === 'cmux'),
  );
  if (!selected || !visible.some((t) => t.key === selected)) selected = visible[0]?.key;
  const nextTaskSignature = JSON.stringify([visible, selected, filter]);
  if (nextTaskSignature !== taskSignature) {
    taskSignature = nextTaskSignature;
    const fragment = document.createDocumentFragment();
    for (const task of visible) {
      const row = button('', `task-row ${task.key === selected ? 'selected' : ''}`, () => {
        selected = task.key;
        connections = false;
        render(data);
      });
      row.setAttribute('aria-pressed', String(task.key === selected));
      const source = el('span', 'task-source');
      const mark = el('span', `provider-mark ${task.provider}`, marks[task.provider]);
      mark.setAttribute('aria-hidden', 'true');
      source.append(mark, el('span', 'task-provider', names[task.provider]));
      row.append(source, el('span', 'task-name', task.project), taskState(task));
      if (task.terminal?.kind === 'cmux')
        row.append(el('span', 'task-session', `cmux · ${task.sessionId.slice(0, 8)}`));
      fragment.append(row);
    }
    if (!visible.length) {
      const empty = el('div', 'empty');
      empty.append(
        el(
          'strong',
          'empty-title',
          filter === 'all' ? 'Your party is quiet.' : 'Nothing here right now.',
        ),
        document.createTextNode(
          filter === 'all'
            ? 'Connect your apps to see new task activity here.'
            : 'Other tasks are under All activity.',
        ),
      );
      fragment.append(empty);
    }
    $('#tasks').replaceChildren(fragment);
  }
  const task = visible.find((t) => t.key === selected);
  const request = task && requestFor(task);
  const showWelcome =
    filter === 'all' &&
    !data.tasks.length &&
    !data.demo &&
    !data.connections.some((c) => c.installed);
  const connectionSignature = data.connections.map(({ lastEvent, ...connection }) => ({
    ...connection,
    lastMinute: lastEvent ? Math.floor(lastEvent / 60000) : null,
    receiving: Boolean(lastEvent && Date.now() - lastEvent < 15 * 60 * 1000),
  }));
  const signature = JSON.stringify(
    connections
      ? [connections, connectionSignature, connectionBusy, data.demo, data.cmux, data.cursorReview]
      : request
        ? [task?.key, request.id, connections]
        : [task, connections, data.cursorReview, showWelcome],
  );
  const typingFollowup =
    !connections &&
    !request &&
    task?.key === detailTaskKey &&
    $('#detail .follow-up')?.contains(document.activeElement);
  if (signature !== detailSignature && !typingFollowup) {
    detailSignature = signature;
    detailTaskKey = task?.key;
    if (connections) renderConnections();
    else if (task) renderTask(task, request);
    else if (showWelcome) renderWelcome();
    else $('#detail').replaceChildren();
  }
  // Update time without rebuilding forms or losing a partially typed answer.
  const lastSeen = $('#detail .last-seen');
  if (lastSeen && task && !connections) lastSeen.textContent = ago(task.time);
  const countdown = $('#request-countdown');
  if (countdown && request) {
    const seconds = Math.max(0, Math.ceil((request.expiresAt - Date.now()) / 1000));
    countdown.textContent = seconds
      ? `Returns to ${names[request.provider]} in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      : `Returning to ${names[request.provider]}…`;
  }
}
function renderWelcome() {
  const d = $('#detail');
  d.replaceChildren();
  d.append(
    el('div', 'eyebrow', 'KEEP PLAYING'),
    el('h2', '', 'Work stays in sight.'),
    el(
      'p',
      '',
      'The gem counts tasks waiting for your response. Open it to see activity, approve a request, or answer a supported question.',
    ),
  );
  d.append(button('Connect apps', 'primary', openConnections));
  d.append(el('p', '', 'Drag the jewel to move it. Click it to open or close the pane.'));
}
async function connectionAction(action, pending) {
  if (connectionBusy) return;
  connectionBusy = true;
  feedback(pending);
  render(data);
  try {
    const result = await action();
    feedback(result.message);
  } catch {
    feedback('Could not update this connection. Try again.');
  } finally {
    connectionBusy = false;
    render(await api.snapshot());
  }
}
function openConnections() {
  connections = true;
  $('#detail').scrollTop = 0;
  render(data);
  api.dismissConnectionsTip();
}
function connectionGuide(provider, installed, lastEvent) {
  const guide = setupGuides[provider];
  const details = el('details', 'connection-guide');
  details.open = guideOpen.get(provider) ?? Boolean(installed && !lastEvent);
  const summary = el('summary', '', 'Setup steps & troubleshooting');
  summary.addEventListener('click', () => guideOpen.set(provider, !details.open));
  details.append(summary);
  const steps = el('ol', 'connection-steps');
  for (const step of guide.steps) steps.append(el('li', '', step));
  details.append(steps, el('p', 'connection-note', guide.help));
  return details;
}
function renderConnections() {
  const d = $('#detail');
  d.replaceChildren(el('div', 'eyebrow', 'CONNECTIONS'), el('h2', '', 'Your coding apps'));
  if (data.demo) {
    d.append(
      el(
        'p',
        '',
        'Connect your apps to replace these sample tasks with live activity. Setup saves backups of your existing settings.',
      ),
    );
    d.append(button('Start live setup', 'primary', () => api.goLive()));
    for (const [provider, text] of Object.entries({
      claude: 'Approvals, questions, and activity.',
      codex: 'Approvals and activity. Questions stay in Codex.',
      cursor: 'Activity, with optional shell and MCP action reviews. Questions stay in Cursor.',
    })) {
      const item = el('div', 'connection');
      item.append(el('strong', '', names[provider]), el('p', '', text));
      d.append(item);
    }
    return;
  }
  const allInstalled = data.connections.every((c) => c.installed && !c.error);
  d.append(
    el(
      'p',
      '',
      'Choose the agents you use. Connect installs local hooks and backs up existing settings. Then follow each app’s setup steps. No API keys needed.',
    ),
  );
  d.append(
    el(
      'p',
      'connection-note',
      'Receiving activity confirms a real event from an agent. Test local receiver checks delivery inside workwork only.',
    ),
  );
  if (!allInstalled) {
    const connect = button('Connect all three', 'primary', () =>
      connectionAction(() => api.connect(), 'Installing hooks…'),
    );
    connect.disabled = connectionBusy;
    d.append(connect);
  }
  for (const connection of data.connections) {
    const { provider, installed, error, partial, lastEvent, lastCheck } = connection;
    const receiving = installed && !error && lastEvent && Date.now() - lastEvent < 15 * 60 * 1000;
    const awaitingCodex = provider === 'codex' && installed && !error && !lastEvent;
    const item = el('section', 'connection');
    item.dataset.provider = provider;
    const top = el('div', 'connection-heading');
    const name = el('strong');
    name.append(
      el('span', `provider-mark ${provider}`, marks[provider]),
      document.createTextNode(names[provider]),
    );
    const status = error
      ? 'Settings error'
      : receiving
        ? 'Receiving activity'
        : awaitingCodex
          ? 'Awaiting Codex'
          : installed
            ? 'Hooks installed'
            : partial
              ? 'Needs repair'
              : 'Not connected';
    top.append(
      name,
      el(
        'span',
        `connection-status ${error ? 'error' : receiving ? 'running' : awaitingCodex ? 'attention' : installed ? 'finished' : 'attention'}`,
        status,
      ),
    );
    item.append(top, el('p', '', setupGuides[provider].description));
    if (error) item.append(el('p', 'error', error));
    const health = lastEvent
      ? `Last app signal: ${new Date(lastEvent).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Waiting for the first app signal';
    item.append(el('div', 'connection-health', health));
    if (lastCheck)
      item.append(
        el(
          'div',
          `connection-health ${lastCheck.ok ? '' : 'error'}`,
          lastCheck.ok
            ? awaitingCodex
              ? 'Local receiver passed. No activity received from Codex yet.'
              : 'Local connection check passed'
            : 'Local connection check failed',
        ),
      );
    const actions = el('div', 'connection-actions');
    actions.append(
      button(
        installed ? 'Reconnect' : partial ? 'Repair' : 'Connect',
        installed ? 'text-button' : 'secondary',
        () => connectionAction(() => api.connect(provider), `Connecting ${names[provider]}…`),
      ),
    );
    if (installed) {
      if (!error)
        actions.append(
          button('Test local receiver', 'secondary', () =>
            connectionAction(
              () => api.testConnection(provider),
              `Testing the local receiver for ${names[provider]}…`,
            ),
          ),
        );
      if (provider !== 'claude')
        actions.append(
          button(`Open ${names[provider]}`, 'text-button', async () =>
            feedback((await api.openApp(provider)).message),
          ),
        );
    }
    if (installed || partial) {
      actions.append(
        button('Disconnect', 'text-button', () =>
          connectionAction(() => api.connect(provider, true), `Disconnecting ${names[provider]}…`),
        ),
      );
    }
    actions.querySelectorAll('button').forEach((b) => (b.disabled = connectionBusy));
    item.append(actions, connectionGuide(provider, installed, lastEvent));
    d.append(item);
    if (provider === 'cursor') {
      const review = el('div', 'action-review');
      review.append(
        el('strong', '', data.cursorReview ? 'Extra reviews enabled' : 'Using Cursor’s settings'),
        el(
          'p',
          '',
          data.cursorReview
            ? 'Workwork pauses every shell command and MCP action, including actions Cursor would auto-run. Turn this off to use Cursor’s own approval settings.'
            : 'Cursor’s session settings decide what runs automatically. Workwork tracks activity; approvals and questions that Cursor requires stay in Cursor.',
        ),
      );
      const toggle = button(
        data.cursorReview ? 'Use Cursor’s settings' : 'Review every action',
        'secondary',
        () =>
          connectionAction(
            () => api.setCursorReview(!data.cursorReview),
            'Updating Cursor approval mode…',
          ),
      );
      toggle.disabled = connectionBusy;
      toggle.setAttribute('aria-pressed', String(data.cursorReview));
      review.append(toggle);
      item.append(review);
    }
  }
  const terminal = el('section', 'connection');
  terminal.append(
    el('strong', '', 'Claude Code and Codex in cmux'),
    el(
      'p',
      '',
      data.cmux?.error ||
        (data.cmux?.available
          ? `${data.cmux.claude} Claude Code · ${data.cmux.codex} Codex sessions open. Standalone Codex connects separately through its own hooks.`
          : 'Open cmux to discover Claude Code and Codex sessions. Standalone Codex connects separately.'),
    ),
  );
  const cmuxSteps = el('ol', 'connection-steps');
  for (const step of [
    'Complete the Claude Code or Codex setup above.',
    'Open cmux and start that agent in a terminal pane.',
    'Return to workwork’s cmux tab. Recognized live sessions appear automatically.',
  ])
    cmuxSteps.append(el('li', '', step));
  terminal.append(cmuxSteps);
  terminal.append(
    el(
      'p',
      '',
      'Open session jumps to the exact pane. Direct send and interrupt are not implemented. Copy a follow-up and paste it in the session.',
    ),
  );
  d.append(terminal);
  d.append(
    el(
      'p',
      'connection-note',
      'Keep workwork running to receive new activity and answer supported requests. Cursor action reviews wait for ten minutes; Claude Code and Codex requests wait for two.',
    ),
  );
}
function renderTask(task, request) {
  const d = $('#detail');
  d.replaceChildren();
  const topline = el('div', 'detail-topline');
  const origin = el('span', 'detail-source');
  const mark = el('span', `provider-mark ${task.provider}`, marks[task.provider]);
  mark.setAttribute('aria-hidden', 'true');
  origin.append(mark, document.createTextNode(names[task.provider]));
  topline.append(origin, el('span', 'last-seen', ago(task.time)));
  d.append(topline, el('h2', '', task.project));
  if (task.terminal?.kind === 'cmux')
    d.append(
      el(
        'div',
        'session-location',
        `cmux · session ${task.sessionId.slice(0, 8)} · pane ${task.terminal.surface.slice(0, 8).toLowerCase()}`,
      ),
    );
  if (request) {
    const label = el('div', 'request-label');
    label.append(
      el('i', 'status-mark'),
      document.createTextNode(
        request.review
          ? 'Action review'
          : request.kind === 'approval'
            ? 'Permission requested'
            : 'A question for you',
      ),
    );
    d.append(label);
    d.append(
      el(
        'div',
        'tool-label',
        request.kind === 'approval' ? `TOOL / ${request.tool}` : request.tool,
      ),
    );
    if (request.kind === 'approval') renderApproval(d, request);
    else if (request.kind === 'claude-question') renderClaudeQuestion(d, request);
    else renderFormQuestion(d, request);
    d.append(
      button('Continue in the app', 'text-button', async () => {
        const result = await api.decide(request.id, { action: 'native' });
        feedback(result.message);
        if (result.ok) {
          const opened = await api.openApp(task.provider, task.key);
          if (!opened.ok) feedback(opened.message);
        }
      }),
    );
    if (!data.demo) {
      const countdown = el('p', 'request-countdown');
      countdown.id = 'request-countdown';
      d.append(countdown);
    }
  } else {
    d.append(taskState(task), el('p', '', task.detail));
    if (['returned', 'ended'].includes(task.requestState)) {
      const reason =
        task.requestReason === 'timeout'
          ? 'Workwork’s review window expired.'
          : task.requestReason === 'unavailable'
            ? 'Workwork was unavailable when this review needed a response.'
            : task.requestState === 'returned'
              ? 'This review was handed back to the app.'
              : 'The connection to this review ended.';
      d.append(
        el(
          'p',
          '',
          `${reason} Open ${names[task.provider]} to continue. A new supported request will show its controls here.`,
        ),
      );
    } else if (task.status === 'attention')
      d.append(el('p', '', `This request needs a response in ${names[task.provider]}.`));
    if (task.provider === 'cursor' && !['returned', 'ended'].includes(task.requestState))
      d.append(
        el(
          'p',
          '',
          data.cursorReview
            ? 'Extra reviews are enabled for every shell and MCP action, including actions Cursor would auto-run. Questions stay in Cursor.'
            : 'Cursor’s own settings control auto-run and approvals. Workwork tracks activity; required approvals and questions stay in Cursor.',
        ),
      );
    const actions = el('div', 'actions');
    actions.append(
      button(
        task.terminal?.kind === 'cmux' ? 'Open cmux session' : `Open ${names[task.provider]}`,
        'secondary',
        async () => feedback((await api.openApp(task.provider, task.key)).message),
      ),
    );
    if (
      !task.sessionOpen &&
      ['finished', 'closed', 'idle', 'interrupted', 'error', 'unknown'].includes(task.status)
    )
      actions.append(button('Dismiss', 'text-button', () => api.dismiss(task.key)));
    d.append(actions);
    const draft = followupDrafts.get(task.key) || { text: '', open: false };
    const followup = el('details', 'follow-up');
    followup.open = draft.open;
    followup.append(el('summary', '', 'Write a follow-up'));
    const label = el('label', 'field');
    label.append(el('span', '', 'Message'));
    const input = el('textarea');
    input.maxLength = 10000;
    input.value = draft.text;
    input.addEventListener('input', () => {
      draft.text = input.value;
      followupDrafts.set(task.key, draft);
    });
    followup.addEventListener('toggle', () => {
      draft.open = followup.open;
      followupDrafts.set(task.key, draft);
    });
    label.append(input);
    followup.append(label);
    followup.append(
      button('Copy and open session', 'secondary', async () =>
        feedback((await api.copyFollowup(task.key, input.value)).message),
      ),
      el('p', '', 'Paste the copied message into the session to send it.'),
    );
    d.append(followup);
  }
}
async function decide(request, decision, container) {
  const buttons = [...container.querySelectorAll('button')];
  buttons.forEach((b) => (b.disabled = true));
  try {
    const result = await api.decide(request.id, decision);
    feedback(result.message);
    if (!result.ok) buttons.forEach((b) => (b.disabled = false));
  } catch {
    feedback('The response could not be sent. Check the source app.');
    buttons.forEach((b) => (b.disabled = false));
  }
}
function renderApproval(d, request) {
  let input;
  try {
    input = JSON.parse(request.preview);
  } catch {}
  const command = typeof input?.command === 'string' ? input.command : null;
  if (command !== null) {
    if (typeof input.description === 'string' && input.description)
      d.append(el('p', 'request-description', input.description));
    const terminal = el('div', 'command-block');
    const commandHeader = el('div', 'command-header');
    commandHeader.append(el('span', '', 'COMMAND'), el('span', 'command-prompt', '>_'));
    terminal.append(commandHeader, el('pre', 'request-preview', command));
    d.append(terminal);
    const full = el('details', 'full-input');
    full.append(
      el('summary', '', 'Full tool input'),
      el('pre', 'request-preview', request.preview),
    );
    d.append(full);
  } else d.append(el('pre', 'request-preview', request.preview));
  const location = el('div', 'workspace-path');
  location.append(el('span', 'path-label', 'WORKSPACE'), el('div', 'cwd', request.cwd));
  d.append(location);
  const actions = el('div', 'actions');
  actions.append(
    button('Allow once', 'primary', () => decide(request, { action: 'allow' }, d)),
    button('Decline', 'secondary', () => decide(request, { action: 'deny' }, d)),
  );
  d.append(actions);
}
function renderFormQuestion(d, request) {
  d.append(el('p', '', request.preview));
  const form = el('form');
  const inputs = [];
  for (const field of request.fields) {
    const label = el('label', 'field');
    label.append(el('span', '', `${field.label}${field.required ? ' *' : ''}`));
    if (field.description) label.append(el('small', '', field.description));
    let input;
    if (field.options) {
      input = el('select');
      input.append(new Option('Choose…', ''));
      field.options.forEach((option, index) =>
        input.append(new Option(String(option), String(index))),
      );
    } else {
      input = el('input');
      input.type =
        field.type === 'boolean'
          ? 'checkbox'
          : ['number', 'integer'].includes(field.type)
            ? 'number'
            : 'text';
      if (input.type === 'number') input.step = field.type === 'integer' ? '1' : 'any';
    }
    input.required = field.required && (Boolean(field.options) || field.type !== 'boolean');
    label.append(input);
    form.append(label);
    inputs.push({ field, input });
  }
  const actions = el('div', 'actions');
  const submit = el('button', 'primary', 'Send answer');
  submit.type = 'submit';
  actions.append(
    submit,
    button('Decline', 'secondary', () => decide(request, { action: 'decline' }, d)),
  );
  form.append(actions);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const content = Object.create(null);
    for (const { field, input } of inputs) {
      if (field.options) {
        if (input.value !== '') content[field.key] = field.options[Number(input.value)];
      } else if (field.type === 'boolean') content[field.key] = input.checked;
      else if (input.value !== '')
        content[field.key] = ['number', 'integer'].includes(field.type)
          ? Number(input.value)
          : input.value;
    }
    decide(request, { action: 'answer', content }, d);
  });
  d.append(form);
}
function renderClaudeQuestion(d, request) {
  const form = el('form');
  const inputs = [];
  request.questions.forEach((question, index) => {
    const fieldset = el('fieldset', 'field question-group');
    fieldset.append(el('legend', '', question.question));
    const options = [];
    for (const option of question.options) {
      const label = el('label', 'choice');
      const input = el('input');
      input.type = question.multiSelect ? 'checkbox' : 'radio';
      input.name = `question-${index}`;
      input.value = option.label;
      const text = el('span', '', option.label);
      if (option.description) text.append(el('small', '', option.description));
      label.append(input, text);
      fieldset.append(label);
      options.push(input);
    }
    const customLabel = el('label', 'field');
    customLabel.append(el('span', '', 'Or write an answer'));
    const custom = el('textarea');
    custom.maxLength = 9000;
    customLabel.append(custom);
    fieldset.append(customLabel);
    form.append(fieldset);
    inputs.push({ question, options, custom });
  });
  const submit = el('button', 'primary', 'Send answers');
  submit.type = 'submit';
  form.append(submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const answers = Object.create(null);
    for (const { question, options, custom } of inputs)
      answers[question.question] =
        custom.value.trim() ||
        options
          .filter((input) => input.checked)
          .map((input) => input.value)
          .join(', ');
    decide(request, { action: 'answer', answers }, d);
  });
  d.append(form);
}
const gem = $('#gem');
let gemGesture = null;
let suppressGemClick = false;
gem.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary) return;
  suppressGemClick = false;
  gemGesture = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, dragging: false };
  try {
    gem.setPointerCapture(event.pointerId);
  } catch {}
  api.gemPointer({ phase: 'start' });
});
function moveGem(event) {
  if (!gemGesture || event.pointerId !== gemGesture.pointerId) return;
  const dx = event.screenX - gemGesture.x,
    dy = event.screenY - gemGesture.y;
  if (!gemGesture.dragging && Math.hypot(dx, dy) < 5) return;
  gemGesture.dragging = true;
  suppressGemClick = true;
  gem.classList.add('dragging');
  api.gemPointer({ phase: 'move', dx, dy });
}
function finishGem(event) {
  if (!gemGesture || event.pointerId !== gemGesture.pointerId) return;
  if (event.type === 'pointerup') moveGem(event);
  const pointerId = gemGesture.pointerId;
  gemGesture = null;
  gem.classList.remove('dragging');
  api.gemPointer({ phase: 'end' });
  if (gem.hasPointerCapture(pointerId)) gem.releasePointerCapture(pointerId);
}
gem.addEventListener('pointermove', moveGem);
gem.addEventListener('pointerup', finishGem);
gem.addEventListener('pointercancel', finishGem);
gem.addEventListener('lostpointercapture', finishGem);
gem.addEventListener('dragstart', (event) => event.preventDefault());
gem.addEventListener('click', (event) => {
  if (suppressGemClick && event.detail !== 0) {
    suppressGemClick = false;
    event.preventDefault();
    return;
  }
  api.toggle();
});
$('#dismiss-gem-tip').addEventListener('click', () => api.dismissGemTip());
$('#open-connections-tip').addEventListener('click', openConnections);
$('#dismiss-connections-tip').addEventListener('click', () => {
  api.dismissConnectionsTip();
  $('#connections-button').focus();
});
$('#connections-button').addEventListener('click', () => {
  if (connections) {
    connections = false;
    render(data);
  } else openConnections();
});
$('#reset-demo').addEventListener('click', () => {
  filter = 'all';
  connections = false;
  selected = null;
  followupDrafts.clear();
  detailSignature = '';
  taskSignature = '';
  feedback('');
  $('#detail').scrollTop = 0;
  api.resetDemo();
});
document.querySelectorAll('[data-filter]').forEach((b) =>
  b.addEventListener('click', () => {
    filter = b.dataset.filter;
    connections = false;
    render(data);
  }),
);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && data?.expanded) api.toggle();
});
api.subscribe(render);
api.snapshot().then(render);
