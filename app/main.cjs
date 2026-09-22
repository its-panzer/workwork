const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  screen,
  shell,
  clipboard,
  safeStorage,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { GameGuide, sourceURL } = require('../src/game-guide.cjs');
const { GuideChat } = require('../src/guide-chat.cjs');
const { windowsAppPaths } = require('../src/platform.cjs');
const { StatusStore, PROVIDERS } = require('../src/events.cjs');
const { demoData } = require('../src/demo.cjs');
const { dataRoot, readJSON, atomicJSON, drainEvents } = require('../src/storage.cjs');
const {
  pendingRequests,
  submitDecision,
  reconcileRequests,
  requestLifecycleEvent,
} = require('../src/requests.cjs');
const { Connections } = require('../src/connections.cjs');
const { CmuxSessions, mergeSessions, validTerminal, sessionURL } = require('../src/cmux.cjs');
const { windowPreferences, overlayBounds, sameBounds } = require('../src/window-state.cjs');

const demo = process.argv.includes('--demo') || process.argv.includes('--smoke');
const smoke = process.argv.includes('--smoke');
const presentationDemo = demo && !smoke;
const connectionSmoke = process.argv.includes('--connections-smoke');
if (smoke || connectionSmoke) {
  const fail = (error) => {
    console.error(error);
    app.exit(1);
  };
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);
  setTimeout(() => fail(Error('Desktop smoke timed out after 120 seconds.')), 120000).unref();
}
const root =
  demo || connectionSmoke ? fs.mkdtempSync(path.join(os.tmpdir(), 'workwork-demo-')) : dataRoot();
// Source and packaged launches share one live profile and instance lock.
app.setName('workwork');
if (process.platform === 'win32') app.setAppUserModelId('app.workwork.desktop');
app.setPath('userData', path.join(app.getPath('appData'), 'workwork'));
// Every preview gets its own profile and instance lock. Starting a demo must
// never hand off to the live overlay or expose real requests as sample tasks.
if (demo || connectionSmoke) app.setPath('userData', path.join(root, 'electron'));
const gameGuide = new GameGuide();
const guideChat = new GuideChat({
  file: path.join(root, 'game-guide.json'),
  encryption: safeStorage,
  guide: gameGuide,
});
const stateFile = path.join(root, 'state.json');
const prefsFile = path.join(root, 'preferences.json');
let preferences = windowPreferences(readJSON(prefsFile, {}));
if (presentationDemo) {
  preferences.gemTipDismissed = true;
  preferences.connectionsTipDismissed = true;
}
let demoNow;
let store = new StatusStore(readJSON(stateFile, []));
let win,
  tray,
  interval,
  expanded =
    app.isPackaged ||
    demo ||
    connectionSmoke ||
    process.argv.includes('--connections') ||
    !preferences.gemTipDismissed,
  quitting = false,
  demoRequests = [],
  shortcutOK = true;
const connectionManager = demo
  ? null
  : new Connections({
      root,
      ...(connectionSmoke ? { home: path.join(root, 'fixture-home') } : {}),
      onChange: () => broadcast(),
    });
const cmux = demo || connectionSmoke || process.platform !== 'darwin' ? null : new CmuxSessions();
let anchor;
let gemDrag = null;
let programmaticBounds = null;
let settingBounds = false;
let connectionsRequest = connectionSmoke || process.argv.includes('--connections') ? 1 : 0;
const shortcut = 'CommandOrControl+Shift+Space';
const labels = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor' };
function seedDemo() {
  demoNow = Date.now();
  const { tasks, requests } = demoData(demoNow);
  store = new StatusStore(tasks);
  demoRequests = requests;
}
if (demo) seedDemo();
function snapshot() {
  const cmuxState = cmux?.snapshot() || { available: false, sessions: [], error: null };
  const requests = demo ? demoRequests : pendingRequests(root);
  const tasks = reconcileRequests(
    mergeSessions(store.snapshot(demo ? demoNow : Date.now()), cmuxState.sessions, requests),
    requests,
  );
  // A request may also have a native-only attention signal; count each session once.
  const waitingKeys = new Set(tasks.filter((t) => t.status === 'attention').map((t) => t.key));
  for (const request of requests) waitingKeys.add(`${request.provider}:${request.sessionId}`);
  return {
    tasks,
    requests,
    waiting: waitingKeys.size,
    expanded,
    showGemTip: !preferences.gemTipDismissed,
    showConnectionsTip: Boolean(
      preferences.gemTipDismissed && !preferences.connectionsTipDismissed,
    ),
    demo,
    demoNow: demo ? demoNow : null,
    shortcutOK,
    shortcut: process.platform === 'darwin' ? '⌘ ⇧ Space' : 'Ctrl Shift Space',
    connections: connectionManager?.snapshot() || [],
    cmux: {
      available: cmuxState.available,
      error: cmuxState.error,
      claude: cmuxState.sessions.filter((s) => s.provider === 'claude').length,
      codex: cmuxState.sessions.filter((s) => s.provider === 'codex').length,
    },
    cursorReview: connectionManager?.cursorReview() || false,
    showConnections: connectionsRequest > 0,
    connectionsRequest,
    platform: process.platform,
  };
}
function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('snapshot', snapshot());
}
function persist() {
  if (!demo) atomicJSON(stateFile, store.serialize());
}
function bounds() {
  const area = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y }).workArea;
  return overlayBounds(anchor, expanded, area);
}
function endGemDrag() {
  if (!gemDrag) return;
  const { moved, anchor: originalAnchor } = gemDrag;
  gemDrag = null;
  if (!moved) {
    anchor = originalAnchor;
    return;
  }
  const position = win.getBounds();
  anchor = { x: position.x + position.width, y: position.y };
  preferences.anchor = anchor;
  if (!demo) atomicJSON(prefsFile, preferences);
}
function setExpanded(value) {
  endGemDrag();
  expanded = value;
  // The gem is the way back into the pane, so it must always accept clicks.
  win.setIgnoreMouseEvents(false);
  win.setFocusable(true);
  programmaticBounds = bounds();
  settingBounds = true;
  try {
    win.setBounds(programmaticBounds);
  } finally {
    settingBounds = false;
  }
  if (expanded) {
    win.show();
    win.focus();
  } else {
    win.blur();
    win.showInactive();
  }
  broadcast();
}
function routeLaunch(commandLine = []) {
  if (commandLine.includes('--connections')) connectionsRequest += 1;
  if (win) setExpanded(true);
  else expanded = true;
}
function dismissGemTip() {
  preferences.gemTipDismissed = true;
  if (!demo) atomicJSON(prefsFile, preferences);
}
function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  anchor = preferences.anchor || { x: area.x + area.width - 26, y: area.y + 90 };
  programmaticBounds = bounds();
  win = new BrowserWindow({
    ...programmaticBounds,
    icon: path.join(
      __dirname,
      'assets',
      process.platform === 'win32' ? 'workwork.ico' : 'workwork-icon.png',
    ),
    title: presentationDemo ? 'workwork — Demo' : 'workwork',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: !app.isPackaged,
    focusable: true,
    acceptFirstMouse: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  if (presentationDemo) win.on('page-title-updated', (event) => event.preventDefault());
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('move', () => {
    const b = win.getBounds();
    // Resizing the pane can clamp it away from the saved jewel position.
    // Only user movement replaces that position; closing restores it.
    if (settingBounds || gemDrag || sameBounds(b, programmaticBounds)) return;
    programmaticBounds = null;
    anchor = { x: b.x + b.width, y: b.y };
    preferences.anchor = anchor;
    if (!demo && !gemDrag) atomicJSON(prefsFile, preferences);
  });
  win.on('hide', endGemDrag);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    if (presentationDemo) {
      win.show();
      win.focus();
    } else win.showInactive();
    broadcast();
  });
}
function createTray() {
  const size = 18,
    buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (Math.abs(x - 8.5) + Math.abs(y - 8.5) < 7) {
        const i = (y * size + x) * 4;
        buffer[i] = 180;
        buffer[i + 1] = 151;
        buffer[i + 2] = 93;
        buffer[i + 3] = 255;
      }
  const icon =
    process.platform === 'win32'
      ? nativeImage.createFromPath(path.join(__dirname, 'assets/workwork.ico'))
      : nativeImage.createFromBitmap(buffer, { width: size, height: size, scaleFactor: 1 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('workwork');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open workwork', click: () => setExpanded(true) },
      { label: 'Collapse to gem', click: () => setExpanded(false) },
      { label: 'Hide overlay', click: () => win.hide() },
      { type: 'separator' },
      { label: 'Quit workwork', click: () => app.quit() },
    ]),
  );
}
async function openApp(provider, key) {
  if (!PROVIDERS.includes(provider)) throw new Error('Unknown app');
  if (demo) return { ok: true, message: 'Demo only. No app was opened.' };
  const task = snapshot().tasks.find((task) => task.key === key && task.provider === provider);
  if (task && validTerminal(task.terminal)) {
    await cmux?.refresh();
    const session = cmux?.snapshot().sessions.find((session) => session.key === task.key);
    if (session) {
      try {
        await shell.openExternal(sessionURL(session.terminal));
        return { ok: true, message: 'Opened the cmux session.' };
      } catch {
        return { ok: false, message: 'Could not open this cmux session.' };
      }
    }
    if (process.platform === 'darwin')
      return new Promise((resolve) =>
        execFile('/usr/bin/open', ['-a', 'cmux'], (error) =>
          resolve({ ok: !error, message: 'This session is no longer listed as open. Check cmux.' }),
        ),
      );
  }
  if (process.platform === 'win32') {
    for (const candidate of windowsAppPaths(provider)) {
      if (!fs.existsSync(candidate)) continue;
      const error = await shell.openPath(candidate);
      if (!error) return { ok: true, message: `Opened ${labels[provider]}. Select this task.` };
    }
  }
  if (process.platform !== 'darwin')
    return { ok: false, message: `Switch to ${labels[provider]} to continue.` };
  const appName = { codex: 'Codex', cursor: 'Cursor', claude: 'Terminal' }[provider];
  return new Promise((resolve) =>
    execFile('/usr/bin/open', ['-a', appName], (error) =>
      resolve({
        ok: !error,
        message: error
          ? `Switch to ${labels[provider]} to continue.`
          : provider === 'claude'
            ? 'Opened Terminal. Select your Claude Code session.'
            : `Opened ${appName}. Select this task.`,
      }),
    ),
  );
}
function registerIPC() {
  const guideHandler = (name, action) =>
    ipcMain.handle(name, async (event, ...args) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        return { ok: false, error: 'Untrusted guide request.' };
      try {
        return { ok: true, value: await action(...args) };
      } catch (error) {
        return { ok: false, error: error.message || 'The guide is unavailable.' };
      }
    });
  guideHandler('guide-search', (query) => gameGuide.search(query));
  guideHandler('guide-detail', (type, id) => gameGuide.detail(type, id));
  guideHandler('guide-open', (url) => shell.openExternal(sourceURL(url)));
  guideHandler('guide-status', () => guideChat.status());
  guideHandler('guide-configure', (config) => guideChat.save(config));
  guideHandler('guide-ask', (question, context) => guideChat.ask(question, context));
  guideHandler('guide-clear', (removeKey) => {
    if (typeof removeKey !== 'boolean') throw Error('Invalid conversation action.');
    return guideChat.clear(removeKey);
  });
  ipcMain.on('gem-pointer', (event, gesture) => {
    if (event.sender !== win.webContents || !gesture || typeof gesture !== 'object') return;
    if (gesture.phase === 'start') {
      endGemDrag();
      gemDrag = { bounds: win.getBounds(), anchor: { ...anchor }, expanded, moved: false };
    } else if (gesture.phase === 'move' && gemDrag && gemDrag.expanded === expanded) {
      const { dx, dy } = gesture;
      if (
        !Number.isFinite(dx) ||
        !Number.isFinite(dy) ||
        Math.abs(dx) > 100000 ||
        Math.abs(dy) > 100000
      )
        return;
      const origin = gemDrag.bounds;
      anchor = { x: origin.x + origin.width + dx, y: origin.y + dy };
      const next = bounds();
      gemDrag.moved ||= next.x !== origin.x || next.y !== origin.y;
      programmaticBounds = next;
      win.setPosition(next.x, next.y, false);
    } else if (gesture.phase === 'end') endGemDrag();
  });
  ipcMain.handle('snapshot', () => snapshot());
  ipcMain.handle('toggle', () => {
    dismissGemTip();
    setExpanded(!expanded);
    return snapshot();
  });
  ipcMain.handle('dismiss-gem-tip', () => {
    dismissGemTip();
    broadcast();
  });
  ipcMain.handle('dismiss-connections-tip', () => {
    preferences.gemTipDismissed = true;
    preferences.connectionsTipDismissed = true;
    if (!demo) atomicJSON(prefsFile, preferences);
    broadcast();
  });
  ipcMain.handle('dismiss', (_event, key) => {
    store.dismiss(key);
    persist();
    broadcast();
  });
  ipcMain.handle('open-app', (_event, provider, key) => openApp(provider, key));
  ipcMain.handle('copy-followup', async (_event, key, text) => {
    const task = snapshot().tasks.find((task) => task.key === key);
    if (!task || typeof text !== 'string' || !text.trim() || text.length > 10000)
      return { ok: false, message: 'Write a follow-up first.' };
    if (demo) return { ok: true, message: 'Demo only. No text was copied or sent.' };
    clipboard.writeText(text);
    const result = await openApp(task.provider, task.key);
    return {
      ok: result.ok,
      message: result.ok
        ? 'Follow-up copied. Paste it into the session to send.'
        : `Follow-up copied. ${result.message}`,
    };
  });
  ipcMain.handle('reset-demo', () => {
    if (demo) {
      seedDemo();
      broadcast();
    }
  });
  ipcMain.handle('go-live', () => {
    if (!demo || smoke || connectionSmoke) return;
    app.relaunch({
      args: [...process.argv.slice(1).filter((arg) => arg !== '--demo'), '--connections'],
    });
    app.quit();
  });
  ipcMain.handle('connect', (_event, provider, remove = false) => {
    if (demo)
      return {
        ok: false,
        message: 'Demo mode does not change app settings. Launch the live version to connect.',
      };
    try {
      const results = connectionManager.configure(provider, remove === true);
      return {
        ok: true,
        message: remove
          ? `${labels[provider]} disconnected. Existing hooks are preserved.`
          : 'Hooks installed. Follow the app steps below, then watch for its first activity.',
        results,
      };
    } catch (error) {
      broadcast();
      return { ok: false, message: `Could not update connections: ${error.message}` };
    }
  });
  ipcMain.handle('test-connection', async (_event, provider) => {
    try {
      return demo
        ? { ok: false, message: 'Start live setup to check a connection.' }
        : await connectionManager.test(provider);
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });
  ipcMain.handle('cursor-review', (_event, enabled) => {
    if (demo) return { ok: false, message: 'Start live setup to enable action reviews.' };
    try {
      connectionManager.setCursorReview(enabled);
      return {
        ok: true,
        message: enabled
          ? 'Extra reviews enabled: every Cursor shell and MCP action will wait here, including actions it would auto-run.'
          : 'Using Cursor’s own approval settings. Activity tracking stays connected; waiting reviews return to Cursor.',
      };
    } catch (error) {
      broadcast();
      return { ok: false, message: error.message };
    }
  });
  ipcMain.handle('decide', (_event, id, decision) => {
    try {
      const request = (demo ? demoRequests : pendingRequests(root)).find((r) => r.id === id);
      if (!request) throw new Error('This request has ended.');
      const queued = demo
        ? null
        : requestLifecycleEvent(
            request,
            'submitted',
            decision.action === 'native' ? 'native' : 'decision',
          );
      if (demo) {
        const { validateDecision } = require('../src/requests.cjs');
        if (!validateDecision(request, decision)) throw new Error('Complete the required fields.');
        demoRequests = demoRequests.filter((r) => r.id !== id);
      } else submitDecision(id, decision, root);
      const key = `${request.provider}:${request.sessionId}`;
      const old = store.rows.get(key);
      if (old)
        store.apply({
          ...old,
          ...(queued ||
            requestLifecycleEvent(
              request,
              decision.action === 'native' ? 'returned' : 'responded',
              'native',
            )),
        });
      persist();
      broadcast();
      return {
        ok: true,
        message: demo
          ? 'Demo response received. No agent action was approved.'
          : 'Response queued; waiting for the hook.',
      };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });
}
function tick() {
  if (cmux) cmux.refresh().then(broadcast);
  if (!demo) {
    atomicJSON(path.join(root, 'heartbeat.json'), { pid: process.pid, time: Date.now() });
    const events = drainEvents(root);
    for (const event of events) if (!connectionManager.observe(event)) store.apply(event);
    if (events.length) persist();
  }
  broadcast();
}
if (!app.requestSingleInstanceLock({ demo })) app.quit();
else {
  app.on('second-instance', (_event, commandLine) => routeLaunch(commandLine));
  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && !app.isPackaged) app.dock.hide();
    registerIPC();
    createWindow();
    createTray();
    if (smoke || connectionSmoke) console.log(`Starting desktop smoke on ${process.platform}.`);
    shortcutOK =
      smoke ||
      connectionSmoke ||
      presentationDemo ||
      globalShortcut.register(shortcut, () => {
        if (!win.isVisible()) setExpanded(true);
        else setExpanded(!expanded);
      });
    interval = setInterval(tick, 1000);
    tick();
    if (smoke || connectionSmoke) {
      win.webContents.once('did-finish-load', async () => {
        try {
          const { smokeTest } = require(
            connectionSmoke ? '../test/connections-smoke.cjs' : '../test/ui-smoke.cjs',
          );
          console.log(
            JSON.stringify(
              await smokeTest(
                win,
                path.join(__dirname, '..', 'artifacts'),
                setExpanded,
                snapshot,
                root,
                routeLaunch,
              ),
            ),
          );
          app.quit();
        } catch (error) {
          console.error(error);
          app.exit(1);
        }
      });
    }
  });
  app.on('before-quit', () => {
    quitting = true;
    clearInterval(interval);
    globalShortcut.unregisterAll();
    persist();
    try {
      fs.unlinkSync(path.join(root, 'heartbeat.json'));
    } catch {}
    if (demo || connectionSmoke) {
      // Windows keeps Chromium profile files open until the process exits.
      // Best-effort temp cleanup must never interrupt quitting the app.
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Temporary preview profile cleanup: ${error.code}`);
      }
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (win) setExpanded(true);
  });
}
