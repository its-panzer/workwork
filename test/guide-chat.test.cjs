const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GuideChat } = require('../src/guide-chat.cjs');
function fixture(t, fetcher, chatgpt, character) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workwork-chat-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'guide.json');
  // Test codec only. Production injects Electron safeStorage.
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value.split('').reverse().join('')),
    decryptString: (value) => value.toString().split('').reverse().join(''),
  };
  const chat = new GuideChat({ file, encryption, fetcher, chatgpt, character });
  return { chat, file, encryption };
}
const config = { provider: 'openai', model: 'test-model', key: 'test-secret-key-123' };
const openaiResponse = (text) =>
  new Response(
    JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }),
  );
test('keys stay out of status, missing secure storage refuses saving, removal forgets the key', (t) => {
  const { chat, file, encryption } = fixture(t);
  assert.equal(chat.status().configured, false);
  encryption.isEncryptionAvailable = () => false;
  assert.throws(() => chat.save(config), /Secure key storage/);
  assert.equal(fs.existsSync(file), false);
  encryption.isEncryptionAvailable = () => true;
  chat.save(config);
  assert.equal(JSON.stringify(chat.status()).includes(config.key), false);
  assert.equal(fs.readFileSync(file, 'utf8').includes(config.key), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.throws(() => chat.save({ ...config, provider: 'evil' }), /valid model/);
  chat.clear(true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).key, undefined);
  assert.equal(chat.status().configured, false);
  assert.equal(chat.status().provider, 'openai');
});
test('direct conversation uses one model call, optional selected context and followups without fetching Wowhead', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw Error('Unexpected remote lookup');
  });
  const calls = [];
  const { chat } = fixture(t, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    calls.push({ url, options, body: JSON.parse(options.body) });
    return openaiResponse(
      calls.length === 1 ? 'Farm enemies near your level.' : 'It has +5 Agility [1].',
    );
  });
  chat.save(config);
  const answer = await chat.ask('Where should I farm green weapons?');
  assert.deepEqual(answer.sources, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.store, false);
  assert.equal(calls[0].body.input[0].content, 'Where should I farm green weapons?');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${config.key}`);
  const selected = await chat.ask('What about this weapon?', {
    type: 'item',
    id: 42,
    name: 'Blade',
    text: '+5 Agility',
  });
  assert.equal(selected.sources[0].text, '+5 Agility');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.input.length, 3);
  assert.match(calls[1].body.input[2].content, /Selected game entry/);
  assert.match(calls[1].body.input[2].content, /\+5 Agility/);
  chat.clear();
  assert.deepEqual(chat.history, []);
});
test('Anthropic request format and source-less answers are handled', async (t) => {
  let body;
  const { chat } = fixture(t, async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(options.headers['anthropic-version'], '2023-06-01');
    body = JSON.parse(options.body);
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'A sourced answer [1].' }] }),
    );
  });
  chat.save({ ...config, provider: 'anthropic' });
  assert.equal((await chat.ask('Stats?', { type: 'item', id: 42 })).provider, 'Anthropic');
  assert.equal(body.max_tokens, 1400);
  assert.ok(body.system);
  assert.equal(body.messages.length, 1);
});
test('provider errors never echo raw bodies, history remains retryable and unconfigured calls fail', async (t) => {
  const { chat } = fixture(t, async () => new Response('private response body', { status: 401 }));
  await assert.rejects(chat.ask('Question'), /Connect ChatGPT/);
  chat.save(config);
  await assert.rejects(chat.ask('Question', { type: 'item', id: 42 }), /HTTP 401/);
  assert.equal(chat.busy, false);
  assert.deepEqual(chat.history, []);
  await assert.rejects(chat.ask('x'.repeat(2001)), /2,000/);
});

test('selected context is bounded and projects only public entry fields with a validated source URL', async (t) => {
  let body;
  const { chat } = fixture(t, async (url, options) => {
    body = JSON.parse(options.body);
    return openaiResponse('Selected item [1].');
  });
  chat.save(config);
  const result = await chat.ask('Explain this item', {
    type: 'item',
    id: 42,
    name: 'n'.repeat(200),
    text: 't'.repeat(6000),
    stats: [...Array(25).fill('s'.repeat(200)), { private: 'private-extra' }],
    url: 'https://evil.test/private-extra',
    privatePath: '/private-extra',
  });
  assert.deepEqual(result.sources[0], {
    type: 'item',
    id: 42,
    name: 'n'.repeat(180),
    text: 't'.repeat(5000),
    stats: Array(20).fill('s'.repeat(150)),
    url: 'https://www.wowhead.com/forever/item=42',
    citation: 1,
  });
  assert.equal(JSON.stringify(body).includes('private-extra'), false);
  await assert.rejects(chat.ask('Bad entry', { type: 'file', id: 42 }), /valid game entry/);
  assert.equal(chat.busy, false);
});

test('character context is opt-in, excludes identity and paths, and is not retained as raw conversation history', async (t) => {
  let reads = 0;
  const calls = [];
  const { chat } = fixture(
    t,
    async (url, options) => {
      calls.push(JSON.parse(options.body));
      return openaiResponse('A useful answer.');
    },
    undefined,
    () => {
      reads++;
      return {
        name: 'private-name',
        realm: 'private-realm',
        moneyCopper: 543210,
        path: '/private-character-path',
        level: 20,
        class: 'WARLOCK',
        race: 'Human',
        specialization: 'Affliction',
        zone: 'Westfall',
        clientVersion: '1.60.1',
        capturedAt: 1790712000,
        savedAt: '2026-09-29T20:00:00.000Z',
        stats: { armor: { effective: 340, base: 300 } },
        equipment: [
          {
            slot: 1,
            itemId: 42,
            name: 'Fixture Hat',
            link: 'private-item-link',
            stats: { ITEM_MOD_INTELLECT_SHORT: 5 },
          },
        ],
      };
    },
  );
  chat.save(config);
  await chat.ask('Where should I farm?');
  assert.equal(reads, 0);
  await chat.ask('Use my character context', null, true);
  assert.equal(reads, 1);
  const request = JSON.stringify(calls[1]);
  assert.match(request, /Fixture Hat/);
  assert.match(request, /Westfall/);
  assert.match(request, /340/);
  assert.match(calls[1].input.at(-1).content, /"level":20/);
  assert.match(request, /dated data/);
  for (const omitted of [
    'private-name',
    'private-realm',
    '543210',
    'private-character-path',
    'private-item-link',
  ])
    assert.equal(request.includes(omitted), false, omitted);
  assert.equal(JSON.stringify(chat.history).includes('Fixture Hat'), false);
  await chat.ask('Continue without the snapshot', null, false);
  assert.equal(reads, 1);
  assert.equal(JSON.stringify(calls[2]).includes('Fixture Hat'), false);
  assert.equal(JSON.stringify(calls[2]).includes('saved character snapshot'), false);
});

test('missing or unreadable optional character context still allows a normal answer without raw errors', async (t) => {
  for (const [character, expected] of [
    [() => null, /No saved character snapshot is available/],
    [
      () => {
        throw Error('/private-source-error');
      },
      /snapshot could not be read/,
    ],
  ]) {
    const { chat } = fixture(
      t,
      async (url, options) => {
        const body = JSON.parse(options.body);
        assert.match(body.input.at(-1).content, expected);
        assert.equal(JSON.stringify(body).includes('private-source-error'), false);
        return openaiResponse('You can start with enemies near your level.');
      },
      undefined,
      character,
    );
    chat.save(config);
    const result = await chat.ask('Where should I farm?', null, true);
    assert.match(result.answer, /enemies near your level/);
    assert.equal(chat.history.length, 2);
  }
});

test('ChatGPT selection preserves API setup without changing billing after errors or signout', async (t) => {
  let connected = true,
    planEnabled = true,
    usageAcknowledged = true,
    fail = false;
  const calls = [];
  const chatgpt = {
    status: () => ({ connected, planEnabled, usageAcknowledged, model: 'account-model' }),
    complete: async (instructions, messages) => {
      calls.push({ instructions, messages });
      if (fail) throw Object.assign(Error('Review ChatGPT usage.'), { code: 'usage_limit' });
      return 'Use the quest item [1].';
    },
  };
  let apiCalls = 0;
  const { chat, file } = fixture(
    t,
    async () => {
      apiCalls++;
      return openaiResponse('API answer [1].');
    },
    chatgpt,
  );
  assert.equal(chat.status().provider, 'chatgpt');
  chat.save(config);
  chat.useChatGPT();
  assert.equal(chat.status().api.configured, true);
  assert.equal(chat.status().provider, 'chatgpt');
  assert.equal((await chat.ask('How do I finish?', { type: 'quest', id: 42 })).provider, 'ChatGPT');
  const history = structuredClone(chat.history);
  fail = true;
  await assert.rejects(chat.ask('Where next?', { type: 'quest', id: 42 }), { code: 'usage_limit' });
  assert.deepEqual(chat.history, history);
  assert.equal(chat.busy, false);
  connected = false;
  assert.equal(chat.status().configured, false);
  assert.equal(chat.status().provider, 'chatgpt');
  await assert.rejects(chat.ask('Where next?'), /Connect ChatGPT/);
  assert.equal(apiCalls, 0);
  connected = true;
  planEnabled = false;
  assert.equal(chat.status().configured, false);
  planEnabled = true;
  usageAcknowledged = false;
  assert.equal(chat.status().configured, false);
  usageAcknowledged = true;
  fail = false;
  await chat.ask('Where next?', { type: 'quest', id: 42 });
  assert.equal(calls.at(-1).messages.length, 3);
  chat.useAPI();
  assert.deepEqual(chat.history, []);
  assert.equal((await chat.ask('Stats?', { type: 'item', id: 42 })).provider, 'OpenAI');
  assert.equal(apiCalls, 1);
  chat.clear(true);
  assert.equal(chat.status().provider, 'openai');
  assert.equal(chat.status().configured, false);
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))).includes('key'), false);
});

test('citations remain stable when comparing different entries across turns', async (t) => {
  let turn = 0;
  const { chat } = fixture(t, async () =>
    openaiResponse(++turn === 1 ? 'First item [1].' : 'Compare the first [1] with the second [2].'),
  );
  chat.save(config);
  const first = await chat.ask('First item?', { type: 'item', id: 41 });
  const second = await chat.ask('Compare the second?', { type: 'item', id: 42 });
  assert.equal(first.sources[0].citation, 1);
  assert.deepEqual(
    second.sources.map((source) => [source.id, source.citation]),
    [
      [41, 1],
      [42, 2],
    ],
  );
  chat.clear();
  assert.equal(chat.references.size, 0);
  assert.equal(chat.nextCitation, 1);
});
