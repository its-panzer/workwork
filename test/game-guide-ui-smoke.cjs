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
  assert.equal(await js(`document.querySelector('.guide-chat').hidden`), false);
  assert.equal(await js(`document.querySelector('.guide-plan-dialog').open`), false);
  assert.equal(
    await js(`window.workwork.guideStatus().then(result => result.ok && !result.value.configured)`),
    true,
  );
  await js(`document.querySelector('.guide-ask textarea').value = 'keep my question'`);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(await js(`document.querySelector('.guide-ask textarea').value`), 'keep my question');
  await js(
    `document.querySelector('.guide-ask textarea').value = '';new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );
  fs.writeFileSync(
    path.join(dir, 'game-chat-sign-in.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  await js(`document.querySelector('.guide-ask textarea').value = 'keep my question'`);
  // Exercise the actual view against deterministic service replies, without keys/network.
  await js(`window.guideTestCalls = [];
    window.guideTestStatus = {configured:true,provider:'openai',model:'fixture-model',api:{configured:true,provider:'openai',model:'fixture-model'},chatgpt:{connected:false,planEnabled:false,usageAcknowledged:false,accounts:[]}};
    window.guideFixture = window.createGameGuide({
      guideStatus: async () => ({ok:true,value:window.guideTestStatus}),
      guideChatGPTSignIn: async () => {
        window.guideTestStatus = {...window.guideTestStatus,provider:'chatgpt',configured:false,chatgpt:{connected:true,planEnabled:true,usageAcknowledged:false,email:'fixture@example.invalid',accountId:'fixture-account',accounts:[{id:'fixture-account',email:'fixture@example.invalid',connected:true}]}};
        return {ok:true,value:window.guideTestStatus};
      },
      guideChatGPTAcknowledge: async () => {
        window.guideTestStatus.chatgpt.usageAcknowledged = true;
        window.guideTestStatus.configured = true;
        return {ok:true,value:window.guideTestStatus};
      },
      guideChatGPTUsage: async () => {window.guideTestUsageOpened=true;return {ok:true}},
      guideChatGPTSignOut: async () => {
        window.guideTestStatus.configured = false;
        window.guideTestStatus.chatgpt.connected = false;
        window.guideTestStatus.chatgpt.planEnabled = false;
        return {ok:true,value:window.guideTestStatus};
      },
      guideSearch: async query => ({ok:true,value:{query,url:'https://www.wowhead.com/forever/search?q=blade',entries:[{id:42,type:'item',name:'Fixture blade',stats:['Requires level 10'],url:'https://www.wowhead.com/forever/item=42'}]}}),
      guideDetail: async (type,id) => ({ok:true,value:{type,id,name:'Fixture blade',text:'+5 Agility',url:'https://www.wowhead.com/forever/item=42'}}),
      guideAsk: async (question,context,includeCharacter) => {window.guideTestCalls.push({question,context,includeCharacter});return window.guideTestFailure || {ok:true,value:{answer:'It has +5 Agility [1].',provider:'Fixture',sources:[{name:'Fixture blade',url:'https://www.wowhead.com/forever/item=42'}]}}},
      guideClear: async () => ({ok:true,value:window.guideTestStatus}),
      guideCharacter: async () => ({ok:true,value:{name:'Fixture',realm:'Test Realm',level:20,class:'WARLOCK',zone:'Westfall',moneyCopper:12345,clientVersion:'1.60.1',savedAt:'2026-09-29T20:00:00.000Z',stats:{armor:{effective:340}},equipment:[{slot:1,itemId:42,name:'Blue Hat',stats:{ITEM_MOD_INTELLECT_SHORT:5}}]}}),
      guideInstallCharacterAddon: async () => ({ok:true,value:{installed:true}}),
      guideExportCharacter: async () => ({ok:true,value:{promptCopied:true}}),
      guideOpen: async url => {window.guideTestCalls.push({url});return {ok:true}}
    }); window.guideFixture.mount(document.querySelector('#detail'));
    Array.from(document.querySelectorAll('.guide-tabs button')).find(button => button.textContent === 'Lookup').click();
    document.querySelector('.guide-search input').value = 'blade';
    document.querySelector('.guide-search').requestSubmit();`);
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  await js(`document.querySelector('.guide-result').click()`);
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  assert.match(await js(`document.querySelector('.guide-entry').textContent`), /\+5 Agility/);
  assert.equal(await js(`document.querySelector('.guide-character-option input').checked`), false);
  await js(
    `document.querySelector('.guide-entry .secondary').click();document.querySelector('.guide-ask textarea').value='Which stat?';document.querySelector('.guide-ask').requestSubmit()`,
  );
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  assert.equal(
    await js(`document.querySelector('.guide-answer').textContent`),
    'It has +5 Agility [1].',
  );
  assert.deepEqual(await js(`window.guideTestCalls[0]`), {
    question: 'Which stat?',
    context: {
      type: 'item',
      id: 42,
      name: 'Fixture blade',
      text: '+5 Agility',
      url: 'https://www.wowhead.com/forever/item=42',
    },
    includeCharacter: false,
  });
  await js(`document.querySelector('.guide-citations button').click()`);
  assert.equal(await js(`window.guideTestCalls[1].url`), 'https://www.wowhead.com/forever/item=42');
  await js(`document.querySelector('.guide-context button').click();
    Array.from(document.querySelectorAll('.guide-tabs button')).find(button => button.textContent === 'Lookup').click();
    document.querySelector('.guide-entry .secondary').click();
    document.querySelector('.guide-character-option input').checked = true;
    document.querySelector('.guide-ask textarea').value = 'Explain it again';
    document.querySelector('.guide-ask').requestSubmit();`);
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  assert.deepEqual(await js(`window.guideTestCalls.at(-1)`), {
    question: 'Explain it again',
    context: {
      type: 'item',
      id: 42,
      name: 'Fixture blade',
      text: '+5 Agility',
      url: 'https://www.wowhead.com/forever/item=42',
    },
    includeCharacter: true,
  });
  await js(`document.querySelector('.guide-character-option input').checked = false`);
  await js(
    `document.querySelector('.guide-setup').open = true;document.querySelector('.chatgpt-sign-in').click()`,
  );
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  assert.equal(await js(`document.querySelector('.guide-plan-dialog').open`), true);
  assert.equal(await js(`document.querySelector('.guide-ask button').disabled`), true);
  await js(`document.querySelector('.guide-plan-dialog .primary').click()`);
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  assert.equal(await js(`document.querySelector('.guide-plan-dialog').open`), false);
  assert.match(
    await js(`document.querySelector('.guide-usage').textContent`),
    /Using ChatGPT plan/,
  );
  await js(`document.querySelector('.guide-setup').open = false;
    document.querySelector('.guide-starter').click();`);
  assert.match(
    await js(`document.querySelector('.guide-ask textarea').value`),
    /How do I complete/,
  );
  await js(`window.guideTestFailure = {ok:false,code:'usage_limit',error:'Plan limit reached'};
    document.querySelector('.guide-ask textarea').value = 'Where should I farm linen?';
    document.querySelector('.guide-ask').requestSubmit()`);
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  assert.equal(
    await js(`document.querySelector('.guide-ask textarea').value`),
    'Where should I farm linen?',
  );
  await js(`document.querySelector('.guide-turn .primary').click()`);
  assert.equal(await js(`window.guideTestUsageOpened`), true);
  await js(`window.guideTestFailure = null;document.querySelector('.guide-ask').requestSubmit()`);
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  assert.equal(await js(`document.querySelectorAll('.guide-turn').length`), 2);
  assert.equal(await js(`document.querySelector('.guide-chat-empty').hidden`), true);
  await js(`document.querySelector('.guide-setup').open = false;
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  fs.writeFileSync(
    path.join(dir, 'game-chat-fixture.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  await js(`document.querySelector('.guide-setup').open = true;
    Array.from(document.querySelectorAll('.guide-accounts button')).find(button => button.textContent === 'Sign out').click()`);
  await js(`new Promise(resolve => setTimeout(resolve, 30))`);
  assert.equal(await js(`document.querySelector('.guide-ask button').disabled`), true);
  assert.equal(await js(`window.guideTestStatus.provider`), 'chatgpt');
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
  assert.equal(await js(`document.querySelector('.guide-ask textarea').value`), 'keep my question');
  await js(`document.querySelector('[data-filter="all"]').click()`);
  assert.notEqual(
    await js(`getComputedStyle(document.querySelector('.task-list')).display`),
    'none',
  );
}
module.exports = { guideSmoke };
