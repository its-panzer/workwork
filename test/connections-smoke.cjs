const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { resolveNode } = require('../src/connections.cjs');
const { writeEvent } = require('../src/storage.cjs');
const { normalize } = require('../src/events.cjs');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function smokeTest(win, dir, _setExpanded, snapshot, root) {
  fs.mkdirSync(dir, { recursive: true });
  const js = (code) => win.webContents.executeJavaScript(code);
  const click = (label, provider) =>
    js(
      `{const scope=${provider ? `document.querySelector('[data-provider="${provider}"]')` : 'document'}; const b=[...scope.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}); if(!b)throw Error('Missing button'); b.click();}`,
    );
  const until = async (predicate) => {
    for (let attempt = 0; attempt < 70; attempt++) {
      if (await predicate()) return;
      await wait(100);
    }
    throw Error('UI did not settle');
  };
  await wait(500);
  assert.equal(snapshot().demo, false);
  assert.deepEqual(snapshot().tasks, []);
  assert.deepEqual(snapshot().requests, []);
  assert.equal(snapshot().waiting, 0);
  assert.equal(
    snapshot().connections.some((connection) => connection.installed),
    false,
  );
  assert.equal(fs.existsSync(path.join(root, 'fixture-home')), false);
  assert.equal(snapshot().showGemTip, true);
  await js(`document.querySelector('#connections-button').click()`);
  await js(`document.querySelector('#gem').click()`);
  await until(() => !snapshot().expanded && !snapshot().showGemTip);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, 'preferences.json'))).gemTipDismissed,
    true,
  );
  await js(`document.querySelector('#gem').click()`);
  await until(() => snapshot().expanded);
  await until(() => js(`!document.querySelector('#connections-tip').hidden`));
  await click('Open Connections');
  await until(() => !snapshot().showConnectionsTip);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, 'preferences.json'))).connectionsTipDismissed,
    true,
  );
  await js(`location.reload()`);
  await until(() =>
    js(
      `!!document.querySelector('#gem-tip') && document.querySelector('#gem-tip').hidden && document.querySelector('#detail').textContent.includes('Your coding apps')`,
    ),
  );
  assert.equal(await js(`document.querySelector('#connections-tip').hidden`), true);
  assert.equal(snapshot().connections.filter((c) => c.installed).length, 0);
  assert.equal(await js(`document.body.textContent.includes('YOUR OTHER PARTY')`), false);
  await click('Connect all three');
  await until(() => snapshot().connections.every((c) => c.installed));
  assert.equal(
    await js(`[...document.querySelectorAll('.connection-guide')].every(e=>e.open)`),
    true,
  );
  assert.equal(
    await js(
      `document.querySelector('[data-provider="claude"] .connection-steps').textContent.includes('workspace trust')`,
    ),
    true,
  );
  assert.equal(
    await js(
      `document.querySelector('[data-provider="cursor"] .connection-steps').textContent.includes('Hooks reload automatically')`,
    ),
    true,
  );
  await until(() => js(`!document.querySelector('#detail button').disabled`));
  for (const provider of ['claude', 'codex', 'cursor']) {
    await click('Test local receiver', provider);
    await until(() => snapshot().connections.find((c) => c.provider === provider).lastCheck?.ok);
    await until(() => js(`![...document.querySelectorAll('#detail button')].some(b=>b.disabled)`));
  }
  assert.equal(snapshot().tasks.length, 0);
  assert.equal(
    snapshot().connections.every((c) => c.lastEvent === null),
    true,
  );
  assert.equal(
    await js(`document.querySelector('[data-provider="codex"] .connection-status').textContent`),
    'Awaiting Codex',
  );
  assert.equal(
    await js(
      `document.querySelector('[data-provider="codex"]').textContent.includes('Review and trust')`,
    ),
    true,
  );
  assert.equal(
    await js(
      `document.querySelector('[data-provider="codex"]').textContent.includes('No activity received from Codex yet.')`,
    ),
    true,
  );
  await js(`document.querySelector('[data-provider="codex"]').scrollIntoView({block:'start'});`);
  await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  fs.writeFileSync(
    path.join(dir, 'codex-setup.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  await click('Disconnect', 'cursor');
  await until(() => !snapshot().connections.find((c) => c.provider === 'cursor').installed);
  assert.equal(snapshot().connections.filter((c) => c.installed).length, 2);
  await until(() => js(`![...document.querySelectorAll('#detail button')].some(b=>b.disabled)`));
  await click('Connect', 'cursor');
  await until(() => snapshot().connections.every((c) => c.installed));
  await until(() => js(`![...document.querySelectorAll('#detail button')].some(b=>b.disabled)`));
  assert.equal(
    await js(
      `document.querySelector('[data-provider="cursor"] .action-review').textContent.includes('Using Cursor’s settings')`,
    ),
    true,
  );
  await click('Review every action', 'cursor');
  await until(() => snapshot().cursorReview);
  assert.equal(
    await js(
      `document.querySelector('[data-provider="cursor"] .action-review').textContent.includes('including actions Cursor would auto-run')`,
    ),
    true,
  );
  const child = spawn(
    resolveNode(),
    [path.resolve(__dirname, '../hooks/request.cjs'), 'cursor', 'beforeShellExecution'],
    { env: { ...process.env, WORKWORK_HOME: root } },
  );
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(Error('Hook failed'))));
  });
  child.stdin.end(
    JSON.stringify({
      conversation_id: 'cursor-ui-test',
      command: 'echo fixture-only',
      cwd: '/fixture',
    }),
  );
  try {
    await until(() => snapshot().requests.length === 1);
    await js(`document.querySelector('[data-filter="attention"]').click()`);
    await until(() =>
      js(`document.querySelector('.request-label')?.textContent === 'Action review'`),
    );
    assert.equal(
      await js(`document.querySelector('.command-block .request-preview').textContent`),
      'echo fixture-only',
    );
    assert.match(
      await js(`document.querySelector('#request-countdown').textContent`),
      /Returns to Cursor in (10:00|9:\d\d)/,
    );
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    fs.writeFileSync(
      path.join(dir, 'cursor-approval.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    // Freeze only this fixture waiter to distinguish queueing from acknowledgement.
    if (process.platform !== 'win32') child.kill('SIGSTOP');
    await click('Allow once');
    if (process.platform !== 'win32') {
      await until(() =>
        snapshot().tasks.some(
          (task) => task.sessionId === 'cursor-ui-test' && task.requestState === 'submitted',
        ),
      );
      assert.equal(
        await js(`document.querySelector('#feedback').textContent.includes('Response queued')`),
        true,
      );
      child.kill('SIGCONT');
    }
    await exited;
    assert.deepEqual(JSON.parse(output), { permission: 'allow' });
    await until(() => snapshot().requests.length === 0);
    await until(() =>
      snapshot().tasks.some(
        (task) => task.sessionId === 'cursor-ui-test' && task.requestState === 'responded',
      ),
    );
  } finally {
    if (child.exitCode === null) {
      if (process.platform !== 'win32') child.kill('SIGCONT');
      child.kill();
    }
  }
  // Reproduce the old orphaned attention event from an expired Cursor hook.
  writeEvent(
    normalize('cursor', {
      conversation_id: 'expired-ui-test',
      cwd: '/fixture-expired',
      hook_event_name: 'beforeShellExecution',
    }),
    root,
  );
  await until(() => snapshot().tasks.some((t) => t.project === 'fixture-expired'));
  await js(`document.querySelector('[data-filter="all"]').click()`);
  await until(() =>
    js(
      `[...document.querySelectorAll('.task-row')].some(e=>e.textContent.includes('fixture-expired'))`,
    ),
  );
  await js(
    `[...document.querySelectorAll('.task-row')].find(e=>e.textContent.includes('fixture-expired')).click()`,
  );
  assert.equal(
    await js(
      `document.querySelector('#detail').textContent.includes('The connection to this review ended.')`,
    ),
    true,
  );
  assert.equal(
    await js(
      `document.querySelector('#detail').textContent.includes('Its answer controls are not available here')`,
    ),
    false,
  );
  assert.equal(snapshot().waiting, 0);
  await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  fs.writeFileSync(
    path.join(dir, 'cursor-ended.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  const question = spawn(
    resolveNode(),
    [path.resolve(__dirname, '../hooks/request.cjs'), 'claude', 'Elicitation'],
    { env: { ...process.env, WORKWORK_HOME: root } },
  );
  let answer = '';
  question.stdout.on('data', (chunk) => (answer += chunk));
  const answered = new Promise((resolve, reject) => {
    question.on('error', reject);
    question.on('exit', (code) => (code === 0 ? resolve() : reject(Error('Question hook failed'))));
  });
  question.stdin.end(
    JSON.stringify({
      session_id: 'question-ui-test',
      cwd: '/fixture-question',
      requested_schema: {
        type: 'object',
        properties: {
          note: { type: 'string' },
          enabled: { type: 'boolean', enum: [true, false] },
          disabled: { type: 'boolean', enum: [true, false] },
          ['__proto__']: { type: 'string' },
        },
        required: ['note', 'enabled', 'disabled', '__proto__'],
      },
    }),
  );
  try {
    await until(() => snapshot().requests.length === 1);
    await js(`document.querySelector('[data-filter="attention"]').click()`);
    await until(() => js(`!!document.querySelector('#detail form input')`));
    assert.equal(
      await js(
        `[...document.querySelectorAll('#detail form select')].every(input => input.required)`,
      ),
      true,
    );
    assert.equal(await js(`document.querySelector('#detail form').checkValidity()`), false);
    await js(
      `window.fixtureField=document.querySelector('#detail form input'); window.fixtureCountdown=document.querySelector('#request-countdown').textContent; window.fixtureAge=document.querySelector('.last-seen').textContent; window.fixtureField.value='Preserve this answer'; window.fixtureField.focus();`,
    );
    await until(() =>
      js(`document.querySelector('#request-countdown').textContent !== window.fixtureCountdown`),
    );
    await until(() => js(`document.querySelector('.last-seen').textContent !== window.fixtureAge`));
    assert.equal(
      await js(
        `document.querySelector('#detail form input') === window.fixtureField && window.fixtureField.value === 'Preserve this answer'`,
      ),
      true,
    );
    await js(
      `{const form=document.querySelector('#detail form'); const choices=form.querySelectorAll('select'); choices[0].value='0'; choices[1].value='1'; form.querySelectorAll('input')[1].value='Preserve this key';}`,
    );
    assert.equal(await js(`document.querySelector('#detail form').checkValidity()`), true);
    await js(`document.querySelector('#detail form').requestSubmit()`);
    await answered;
    const content = JSON.parse(answer).hookSpecificOutput.content;
    assert.equal(content.note, 'Preserve this answer');
    assert.equal(content.enabled, true);
    assert.equal(content.disabled, false);
    assert.equal(Object.hasOwn(content, '__proto__'), true);
    assert.equal(content.__proto__, 'Preserve this key');
  } finally {
    if (question.exitCode === null) question.kill();
  }
  const claudeQuestion = spawn(
    resolveNode(),
    [path.resolve(__dirname, '../hooks/request.cjs'), 'claude', 'PreToolUse'],
    { env: { ...process.env, WORKWORK_HOME: root } },
  );
  let claudeAnswer = '';
  claudeQuestion.stdout.on('data', (chunk) => (claudeAnswer += chunk));
  const claudeAnswered = new Promise((resolve, reject) => {
    claudeQuestion.on('error', reject);
    claudeQuestion.on('exit', (code) =>
      code === 0 ? resolve() : reject(Error('Claude question hook failed')),
    );
  });
  claudeQuestion.stdin.end(
    JSON.stringify({
      session_id: 'claude-question-key-test',
      cwd: '/fixture-question',
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [
          { question: '__proto__', options: [{ label: 'Preserved' }], multiSelect: false },
        ],
      },
    }),
  );
  try {
    await until(() =>
      snapshot().requests.some((request) => request.sessionId === 'claude-question-key-test'),
    );
    await js(`document.querySelector('[data-filter="attention"]').click()`);
    await until(() => js(`!!document.querySelector('#detail form input[type="radio"]')`));
    await js(
      `document.querySelector('#detail form input[type="radio"]').checked=true; document.querySelector('#detail form').requestSubmit()`,
    );
    await claudeAnswered;
    const answers = JSON.parse(claudeAnswer).hookSpecificOutput.updatedInput.answers;
    assert.equal(Object.hasOwn(answers, '__proto__'), true);
    assert.equal(answers.__proto__, 'Preserved');
  } finally {
    if (claudeQuestion.exitCode === null) claudeQuestion.kill();
  }
  await js(`document.querySelector('#connections-button').click()`);
  await click('Use Cursor’s settings', 'cursor');
  await until(() => !snapshot().cursorReview);
  assert.equal(
    await js(
      `document.querySelector('[data-provider="cursor"] .action-review').textContent.includes('Cursor’s session settings decide what runs automatically')`,
    ),
    true,
  );
  await js(`document.querySelector('#detail').scrollTop=0`);
  await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'connections.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  return {
    passed: true,
    mode: 'isolated live setup with fixture settings',
    checks: [
      'connect all three from UI',
      'real hook subprocess delivery for each app',
      'checks never invent app activity or tasks',
      'disconnect one provider',
      'reconnect one provider',
      'Cursor review opt-in and disable',
      'Cursor approval through real hook and UI',
      'queued decision is not acknowledged until the fixture hook consumes it',
      'ten-minute Cursor countdown',
      'expired Cursor review explains the ended connection',
      'live countdown and last-seen age preserve a typed question answer',
      'required boolean enum choices preserve true and false',
      'form and Claude question answers preserve prototype-named keys',
    ],
  };
}
module.exports = { smokeTest };
