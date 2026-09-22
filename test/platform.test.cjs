const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, execFile } = require('node:child_process');
const {
  windowsHook,
  windowsHookNode,
  nodeCandidates,
  windowsAppPaths,
} = require('../src/platform.cjs');
const { drainEvents, atomicJSON } = require('../src/storage.cjs');
test('Windows hook transport protects special characters and recognizes only exact owned commands', () => {
  const node = "C:\\Program Files\\Node's $runtime%\\node.exe";
  const script = "C:\\Users\\O'Brien & $env ! `name\\workwork\\hooks\\emit.cjs";
  const command = windowsHook(node, script, 'claude', 'SessionStart');
  assert.match(
    command,
    /^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand [A-Za-z0-9+/=]+$/,
  );
  assert.equal(windowsHookNode(command, script, 'claude', 'SessionStart'), node);
  assert.equal(windowsHookNode(command + ' && echo x', script, 'claude', 'SessionStart'), null);
  assert.equal(windowsHookNode(command, script, 'codex', 'SessionStart'), null);
  assert.equal(windowsHookNode(command, script + '.backup', 'claude', 'SessionStart'), null);
  assert.throws(() => windowsHook('bad\npath', script, 'claude', 'Stop'));
});
test('Windows Node and app discovery uses native install paths, with explicit Node override first', () => {
  const env = {
    WORKWORK_NODE: 'D:\\Node\\node.exe',
    ProgramFiles: 'C:\\Program Files',
    LOCALAPPDATA: 'C:\\Users\\Player\\AppData\\Local',
  };
  assert.deepEqual(nodeCandidates({ platform: 'win32', env, electron: true }), [
    'D:\\Node\\node.exe',
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Users\\Player\\AppData\\Local\\Programs\\nodejs\\node.exe',
  ]);
  assert.equal(windowsAppPaths('claude', env).length, 0);
  assert.equal(
    windowsAppPaths('cursor', env)[0],
    'C:\\Users\\Player\\AppData\\Local\\Programs\\Cursor\\Cursor.exe',
  );
});
test('Windows icon contains six correctly bounded PNG frames', () => {
  const ico = fs.readFileSync(path.resolve(__dirname, '../app/assets/workwork.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 6);
  for (let i = 0; i < 6; i++) {
    const offset = ico.readUInt32LE(6 + i * 16 + 12),
      size = ico.readUInt32LE(6 + i * 16 + 8);
    assert.ok(offset + size <= ico.length);
    assert.equal(ico.toString('ascii', offset + 1, offset + 4), 'PNG');
  }
});
test(
  'native Windows shells deliver Unicode JSON through installed hook commands',
  { skip: process.platform !== 'win32' },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ww O'Brien & $test % ! `-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const script = path.join(root, 'hook with spaces.cjs');
    fs.writeFileSync(
      script,
      `const fs=require('node:fs');const input=JSON.parse(fs.readFileSync(0,'utf8').replace(/^\\uFEFF/,'')); process.stdout.write(JSON.stringify(input));`,
    );
    const command = windowsHook(process.execPath, script, 'claude', 'SessionStart');
    const input = JSON.stringify({
      session_id: 'unicode-fixture',
      cwd: 'C:\\Projects\\Forêt 🗡️',
      text: "$env:PATH & %PATH% `literal'",
    });
    for (const shell of ['cmd.exe', 'powershell.exe']) {
      const args =
        shell === 'cmd.exe'
          ? ['/d', '/s', '/c', command]
          : ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command];
      const output = execFileSync(shell, args, {
        input,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
      });
      assert.deepEqual(JSON.parse(output.replace(/^\uFEFF/, '')), JSON.parse(input));
    }
    const bash =
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe');
    if (bash && fs.existsSync(bash))
      assert.deepEqual(
        JSON.parse(
          execFileSync(bash, ['-c', command], {
            input,
            encoding: 'utf8',
            windowsHide: true,
            timeout: 15000,
          }),
        ),
        JSON.parse(input),
      );
    const { hookPlan, isOurs } = require('../scripts/setup.cjs');
    for (const plan of hookPlan(root, process.execPath)) {
      const group = plan.additions[plan.provider === 'cursor' ? 'sessionStart' : 'SessionStart'][0];
      const command = group.command || group.hooks[0].command;
      assert.equal(isOurs(command), true);
      execFileSync('cmd.exe', ['/d', '/s', '/c', command], {
        input: JSON.stringify({ session_id: `shell-${plan.provider}`, cwd: 'C:\\Quest Log' }),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        env: { ...process.env, WORKWORK_HOME: root },
      });
      const [event] = drainEvents(root);
      assert.equal(event.provider, plan.provider);
      assert.equal(event.project, 'Quest Log');
    }
  },
);

test(
  'native Windows approval survives the PowerShell launcher and returns the explicit decision',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-win-approval-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    atomicJSON(path.join(root, 'heartbeat.json'), { pid: process.pid, time: Date.now() });
    const { pendingRequests, submitDecision } = require('../src/requests.cjs');
    const command = windowsHook(
      process.execPath,
      path.resolve(__dirname, '../hooks/request.cjs'),
      'claude',
      'PermissionRequest',
    );
    let child;
    const output = new Promise((resolve, reject) => {
      child = execFile(
        'cmd.exe',
        ['/d', '/s', '/c', command],
        { env: { ...process.env, WORKWORK_HOME: root }, windowsHide: true, timeout: 20000 },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
      child.stdin.on('error', reject);
      child.stdin.end(
        JSON.stringify({
          session_id: 'windows-approval',
          hook_event_name: 'PermissionRequest',
          tool_name: 'Bash',
          tool_input: { command: 'echo fixture-only' },
          cwd: 'C:\\Quest Log',
        }),
      );
    });
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    let request;
    for (let i = 0; i < 150; i++) {
      request = pendingRequests(root)[0];
      if (request) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!request) {
      await output;
      assert.fail('Windows hook never published a request');
    }
    submitDecision(request.id, { action: 'deny' }, root);
    const response = JSON.parse(await output);
    assert.equal(response.hookSpecificOutput.decision.behavior, 'deny');
    assert.equal(pendingRequests(root).length, 0);
  },
);
