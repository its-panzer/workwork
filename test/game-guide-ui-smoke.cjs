const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
async function guideSmoke(win, dir) {
  const js = (code) => win.webContents.executeJavaScript(code);
  await js(`document.querySelector('#game-guide-button').click()`);
  assert.equal(
    await js(`document.querySelector('#game-guide-button').getAttribute('aria-pressed')`),
    'true',
  );
  assert.equal(await js(`getComputedStyle(document.querySelector('.task-list')).display`), 'none');
  assert.ok(await js(`document.querySelector('.wordmark').getBoundingClientRect().width <= 165`));
  assert.ok(
    await js(`document.querySelector('.panel-header').getBoundingClientRect().height <= 65`),
  );
  assert.equal(
    await js(`window.workwork.guideStatus().then(result => result.ok && !result.value.configured)`),
    true,
  );
  await js(`document.querySelector('.guide-search input').value = 'keep my search'`);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(await js(`document.querySelector('.guide-search input').value`), 'keep my search');
  // Exercise the actual view against deterministic service replies, without keys/network.
  await js(`window.guideTestCalls = [];
    window.guideFixture = window.createGameGuide({
      guideStatus: async () => ({ok:true,value:{configured:true,provider:'openai',model:'fixture-model'}}),
      guideSearch: async query => ({ok:true,value:{query,url:'https://www.wowhead.com/forever/search?q=blade',entries:[{id:42,type:'item',name:'Fixture blade',stats:['Requires level 10'],url:'https://www.wowhead.com/forever/item=42'}]}}),
      guideDetail: async (type,id) => ({ok:true,value:{type,id,name:'Fixture blade',text:'+5 Agility',url:'https://www.wowhead.com/forever/item=42'}}),
      guideAsk: async (question,context) => {window.guideTestCalls.push({question,context});return {ok:true,value:{answer:'It has +5 Agility [1].',provider:'Fixture',sources:[{name:'Fixture blade',url:'https://www.wowhead.com/forever/item=42'}]}}},
      guideClear: async () => ({ok:true,value:{configured:true,provider:'openai',model:'fixture-model'}}),
      guideCharacter: async () => ({ok:true,value:{name:'Fixture',realm:'Test Realm',level:20,class:'WARLOCK',zone:'Westfall',moneyCopper:12345,clientVersion:'1.60.1',savedAt:'2026-09-29T20:00:00.000Z',stats:{armor:{effective:340}},equipment:[{slot:1,itemId:42,name:'Blue Hat',stats:{ITEM_MOD_INTELLECT_SHORT:5}}]}}),
      guideInstallCharacterAddon: async () => ({ok:true,value:{installed:true}}),
      guideExportCharacter: async () => ({ok:true,value:{promptCopied:true}}),
      guideOpen: async url => {window.guideTestCalls.push({url});return {ok:true}}
    }); window.guideFixture.mount(document.querySelector('#detail'));
    document.querySelector('.guide-search input').value = 'blade';
    document.querySelector('.guide-search').requestSubmit();`);
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  await js(`document.querySelector('.guide-result').click()`);
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  assert.match(await js(`document.querySelector('.guide-entry').textContent`), /\+5 Agility/);
  await js(
    `document.querySelector('.guide-entry .secondary').click();document.querySelector('.guide-ask input').value='Which stat?';document.querySelector('.guide-ask').requestSubmit()`,
  );
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  assert.equal(
    await js(`document.querySelector('.guide-answer').textContent`),
    'It has +5 Agility [1].',
  );
  assert.deepEqual(await js(`window.guideTestCalls[0]`), {
    question: 'Which stat?',
    context: { type: 'item', id: 42 },
  });
  await js(`document.querySelector('.guide-citations button').click()`);
  assert.equal(await js(`window.guideTestCalls[1].url`), 'https://www.wowhead.com/forever/item=42');
  await js(
    `Array.from(document.querySelectorAll('.guide-tabs button')).find(button => button.textContent === 'Character').click()`,
  );
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  assert.match(
    await js(`document.querySelector('.guide-character-details').textContent`),
    /Fixture.*340.*Blue Hat/s,
  );
  fs.writeFileSync(
    path.join(dir, 'game-character-fixture.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  await js(
    `Array.from(document.querySelectorAll('.guide-tabs button')).find(button => button.textContent === 'Lookup').click()`,
  );
  fs.writeFileSync(
    path.join(dir, 'game-guide-fixture.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  await js(
    `document.querySelector('[data-filter="all"]').click();document.querySelector('#game-guide-button').click()`,
  );
  assert.equal(await js(`document.querySelector('.guide-search input').value`), 'keep my search');
  await js(`document.querySelector('[data-filter="all"]').click()`);
  assert.notEqual(
    await js(`getComputedStyle(document.querySelector('.task-list')).display`),
    'none',
  );
}
module.exports = { guideSmoke };
