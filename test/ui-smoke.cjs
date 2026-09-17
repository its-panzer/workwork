const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, screen } = require('electron');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function smokeTest(win, dir, setExpanded, snapshot, _root, routeLaunch) {
  const js = (code) => win.webContents.executeJavaScript(code);
  const until = async (predicate) => {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await predicate()) return;
      await wait(100);
    }
    throw Error('UI did not settle');
  };
  const click = (label) =>
    js(
      `{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing button');b.click();}`,
    );
  const capture = async (file) =>
    fs.writeFileSync(path.join(dir, file), (await win.webContents.capturePage()).toPNG());
  const gemGesture = async (dx, dy) => {
    await js(`{const gem=document.querySelector('#gem');
      const base={bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true,button:0};
      gem.dispatchEvent(new PointerEvent('pointerdown',{...base,buttons:1,screenX:1000,screenY:500}));
      gem.dispatchEvent(new PointerEvent('pointermove',{...base,buttons:1,screenX:1000+${dx},screenY:500+${dy}}));
      gem.dispatchEvent(new PointerEvent('pointerup',{...base,buttons:0,screenX:1000+${dx},screenY:500+${dy}}));
      gem.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0,detail:1}));}`);
    await wait(100);
  };
  fs.mkdirSync(dir, { recursive: true });
  await wait(500);
  assert.equal(await js(`document.querySelectorAll('.task-row').length`), 4);
  assert.equal(await js(`document.querySelector('#badge').textContent`), '2');
  assert.equal(win.isAlwaysOnTop(), true);
  assert.equal(await js(`document.querySelectorAll('#lock, #hide, .window-controls').length`), 0);
  assert.equal(await js(`document.querySelector('#gem-tip').hidden`), false);
  assert.equal(await js(`document.querySelector('#connections-tip').hidden`), true);
  await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await capture('jewel-tip.png');
  await click('Got it');
  await wait(80);
  assert.equal(snapshot().showGemTip, false);
  assert.equal(await js(`document.querySelector('#gem-tip').hidden`), true);
  assert.equal(snapshot().showConnectionsTip, true);
  assert.equal(await js(`document.querySelector('#connections-tip').hidden`), false);
  assert.equal(
    await js(
      `{const tip=document.querySelector('#connections-tip').getBoundingClientRect(), b=document.querySelector('#connections-button').getBoundingClientRect(); tip.bottom < b.top && tip.left <= b.left && tip.right >= b.right;}`,
    ),
    true,
  );
  await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await capture('connections-tip.png');
  await click('Not now');
  await wait(80);
  assert.equal(snapshot().showConnectionsTip, false);
  assert.equal(await js(`document.querySelector('#connections-tip').hidden`), true);
  const expandedPosition = win.getBounds();
  await gemGesture(-24, 0);
  assert.equal(win.getBounds().x, expandedPosition.x - 24);
  assert.equal(snapshot().expanded, true);
  assert.equal(
    await js(
      `{ const gem=document.querySelector('#gem').getBoundingClientRect(); [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).getPropertyValue('-webkit-app-region') === 'drag').every(e => { const r=e.getBoundingClientRect(); return r.width === 0 || r.height === 0 || r.right <= gem.left || r.left >= gem.right || r.bottom <= gem.top || r.top >= gem.bottom; }); }`,
    ),
    true,
  );
  assert.equal(
    await js(
      `['.gem-art', '.wordmark'].every(selector => { const image = document.querySelector(selector); return image.complete && image.naturalWidth > 0; })`,
    ),
    true,
  );
  assert.equal(
    await js(`document.querySelector('.command-block .request-preview').textContent`),
    'npm test',
  );
  await js(`document.querySelector('.full-input').open = true`);
  assert.equal(
    await js(`JSON.parse(document.querySelector('.full-input pre').textContent).command`),
    'npm test',
  );
  await js(`document.querySelector('.full-input').open = false`);
  const dashboardBounds = win.getBounds();
  for (const height of new Set([dashboardBounds.height, 720, 719, 640, 600])) {
    win.setSize(dashboardBounds.width, height);
    await until(() => js(`innerHeight === ${win.getContentBounds().height}`));
    await js(`document.querySelector('#detail').scrollTop = 0`);
    await js(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const layout = await js(`{const d=document.querySelector('#detail'),
      b=[...d.querySelectorAll('button')].find(e=>e.textContent==='Continue in the app');
      ({height:innerHeight,buttonTop:b.getBoundingClientRect().top,buttonBottom:b.getBoundingClientRect().bottom,
        paneTop:d.getBoundingClientRect().top,paneBottom:d.getBoundingClientRect().bottom});}`);
    if (height === 600) await capture('dashboard-compact.png');
    assert.ok(
      layout.buttonTop >= layout.paneTop && layout.buttonBottom <= layout.paneBottom,
      JSON.stringify(layout),
    );
  }
  win.setBounds(dashboardBounds);
  await until(() => js(`innerHeight === ${win.getContentBounds().height}`));
  await capture('dashboard.png');
  await click('Allow once');
  await wait(120);
  assert.equal(snapshot().requests.length, 1);
  assert.equal(snapshot().waiting, 1);
  assert.equal(await js(`document.querySelector('#badge').textContent`), '1');
  await js(`document.querySelectorAll('.task-row')[0].click()`);
  await wait(50);
  assert.equal(await js(`document.querySelectorAll('#detail select').length`), 1);
  await capture('question.png');
  await js(
    `document.querySelector('#detail select').value='0'; document.querySelector('#detail input').value='Keep it quiet during raids'; document.querySelector('#detail form').requestSubmit()`,
  );
  await wait(120);
  assert.equal(snapshot().requests.length, 0);
  assert.equal(snapshot().waiting, 0);
  assert.equal(await js(`document.querySelector('#badge').hidden`), true);
  await js(`document.querySelector('[data-filter="running"]').click()`);
  assert.equal(await js(`document.querySelectorAll('.task-row').length`), 1);
  assert.equal(
    await js(`document.querySelector('#detail').textContent.includes('Open Codex')`),
    true,
  );
  assert.equal(
    await js(`document.querySelector('#detail').textContent.includes('Open cmux session')`),
    false,
  );
  await js(`document.querySelector('[data-filter="cmux"]').click()`);
  assert.equal(await js(`document.querySelectorAll('.task-row').length`), 1);
  assert.equal(
    await js(`document.querySelector('#detail').textContent.includes('Open cmux session')`),
    true,
  );
  await js(
    `document.querySelector('.follow-up').open=true; const input=document.querySelector('.follow-up textarea'); input.value='Please check the edge cases'; input.dispatchEvent(new Event('input'));`,
  );
  await click('Copy and open session');
  await wait(80);
  assert.equal(
    await js(
      `document.querySelector('#feedback').textContent.includes('No text was copied or sent')`,
    ),
    true,
  );
  await js(`document.querySelector('[data-filter="attention"]').click()`);
  assert.equal(await js(`document.querySelectorAll('.task-row').length`), 0);
  await js(`document.querySelector('#connections-button').click()`);
  assert.equal(
    await js(`document.querySelector('#detail').innerText.includes('Questions stay in Cursor')`),
    true,
  );
  await js(`document.querySelector('#reset-demo').click()`);
  await wait(80);
  await js(`document.querySelector('#gem').click()`);
  await wait(100);
  assert.equal(snapshot().expanded, false);
  assert.equal(await js(`document.querySelector('#panel').hidden`), true);
  assert.equal(win.getBounds().width, 84);
  assert.equal(win.isFocusable(), true);
  await capture('gem.png');
  const collapsedPosition = win.getBounds();
  await gemGesture(-24, 0);
  assert.equal(win.getBounds().x, collapsedPosition.x - 24);
  assert.equal(snapshot().expanded, false);
  // Real mouse input exercises focus defaults that synthetic pointer events skip.
  app.focus({ steal: true });
  win.focus();
  await until(() => win.isFocused());
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await js(`document.querySelector('#gem').focus()`);
  await until(() => js(`document.querySelector('#gem').matches(':focus-visible')`));
  const noGoldAtWindowEdges = async () => {
    const image = await win.webContents.capturePage();
    const pixels = image.toBitmap();
    const { width, height } = image.getSize();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
        const i = (y * width + x) * 4;
        const [blue, green, red, alpha] = pixels.subarray(i, i + 4);
        assert.ok(
          !(alpha > 100 && red > 150 && green > 100 && red > blue * 1.2),
          'Gold focus outline clipped at window edge',
        );
      }
    }
  };
  await wait(80);
  await noGoldAtWindowEdges();
  await capture('gem-keyboard-focus.png');
  const mouseOrigin = win.getBounds();
  win.webContents.sendInputEvent({
    type: 'mouseDown',
    x: 42,
    y: 42,
    globalX: mouseOrigin.x + 42,
    globalY: mouseOrigin.y + 42,
    button: 'left',
    clickCount: 1,
  });
  win.webContents.sendInputEvent({
    type: 'mouseMove',
    x: 26,
    y: 42,
    globalX: mouseOrigin.x + 26,
    globalY: mouseOrigin.y + 42,
    movementX: -16,
    movementY: 0,
    modifiers: ['leftButtonDown'],
  });
  await until(() => js(`document.querySelector('#gem').classList.contains('dragging')`));
  await noGoldAtWindowEdges();
  await capture('gem-dragging.png');
  win.webContents.sendInputEvent({
    type: 'mouseUp',
    x: 42,
    y: 42,
    globalX: mouseOrigin.x + 26,
    globalY: mouseOrigin.y + 42,
    button: 'left',
    clickCount: 1,
  });
  await until(() => js(`!document.querySelector('#gem').classList.contains('dragging')`));
  assert.equal(snapshot().expanded, false);
  // A full mouse click must stay clean while pressed and after resizing back
  // to the collapsed jewel, including repeated open/close cycles.
  for (let click = 0; click < 4; click++) {
    const wasExpanded = snapshot().expanded;
    const bounds = win.getBounds();
    const mouse = {
      x: bounds.width - 42,
      y: 42,
      globalX: bounds.x + bounds.width - 42,
      globalY: bounds.y + 42,
      button: 'left',
      clickCount: 1,
    };
    win.webContents.sendInputEvent({ type: 'mouseDown', ...mouse });
    await until(() => js(`document.querySelector('#gem').matches(':active')`));
    if (!wasExpanded) {
      await noGoldAtWindowEdges();
      await capture('gem-pressed.png');
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', ...mouse });
    await until(() => snapshot().expanded !== wasExpanded);
    await until(() => js(`document.querySelector('#panel').hidden === ${wasExpanded}`));
    if (wasExpanded) {
      await noGoldAtWindowEdges();
      await capture('gem-after-click.png');
    }
  }
  const stationaryGemRight = win.getBounds().x + win.getBounds().width;
  await gemGesture(2, 1);
  assert.equal(snapshot().expanded, true);
  assert.equal(win.getBounds().x + win.getBounds().width, stationaryGemRight);
  assert.equal(await js(`document.querySelector('#panel').hidden`), false);
  const mouseModes = [];
  const originalMouseMode = win.setIgnoreMouseEvents.bind(win);
  win.setIgnoreMouseEvents = (value) => {
    mouseModes.push(value);
    originalMouseMode(value);
  };
  setExpanded(false);
  setExpanded(true);
  setExpanded(false);
  assert.deepEqual(mouseModes, [false, false, false]);
  await gemGesture(0, 0);
  assert.equal(snapshot().expanded, true);
  assert.equal(snapshot().showGemTip, false);
  win.focus();
  await until(() => win.isFocused());
  setExpanded(false);
  await until(() => !win.isFocused());
  assert.equal(win.isFocusable(), true);
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  win.setPosition(area.x + 12, area.y + area.height - 96);
  await wait(100);
  const edgePosition = win.getBounds();
  setExpanded(true);
  await wait(100);
  assert.notEqual(win.getBounds().y, edgePosition.y);
  // A click on the expanded jewel must not save its clamped pane position.
  await gemGesture(0, 0);
  assert.deepEqual(win.getBounds(), edgePosition);
  await gemGesture(0, 0);
  await js(`document.querySelector('[data-filter="all"]').click()`);
  assert.equal(
    await js(`document.querySelector('#connections-button').getAttribute('aria-pressed')`),
    'false',
  );
  routeLaunch(['electron', '.', '--connections']);
  await until(() =>
    js(`document.querySelector('#connections-button').getAttribute('aria-pressed') === 'true'`),
  );
  await js(`document.querySelector('[data-filter="all"]').click()`);
  routeLaunch(['electron', '.', '--connections']);
  await until(() =>
    js(`document.querySelector('#detail').textContent.includes('Your coding apps')`),
  );
  const report = {
    passed: true,
    checks: [
      'native always-on-top window',
      'four task rows',
      'header controls removed',
      'first-run jewel tip appears and dismisses',
      'gem does not overlap native drag regions',
      'gem drags the expanded pane without toggling',
      'gem drags while collapsed without opening',
      'focused, pressed, clicked, and dragged jewel has no clipped gold outline',
      'small pointer movement still counts as a click',
      'medallion and wordmark images load',
      'exact command and full input remain readable',
      'approval handoff visible without scrolling at 600px and taller',
      'approval response reduces badge',
      'question form responds and clears badge',
      'working and attention filters',
      'connection limitations visible',
      'gem click closes and reopens pane',
      'collapse to 84px gem',
      'collapsing never enables click-through',
      'collapse releases native focus and leaves gem clickable',
      'screen-edge expansion restores the saved gem position',
      'repeated second-instance connections routing',
    ],
    mode: 'synthetic demo',
    inGameTested: false,
    actualAgentSessionTested: false,
  };
  fs.writeFileSync(path.join(dir, 'smoke.json'), JSON.stringify(report, null, 2));
  return report;
}
module.exports = { smokeTest };
