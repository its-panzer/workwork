const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GuideChat } = require('../src/guide-chat.cjs');
function fixture(t, fetcher) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workwork-chat-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'guide.json');
  const guide = {
    search: async (query) => ({
      entries: [
        { name: query, id: 42, type: 'item', url: 'https://www.wowhead.com/forever/item=42' },
      ],
    }),
    detail: async (type, id) => ({
      name: 'Blade',
      text: '+5 Agility',
      type,
      id,
      url: `https://www.wowhead.com/forever/${type}=${id}`,
    }),
  };
  // Test codec only. Production injects Electron safeStorage.
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value.split('').reverse().join('')),
    decryptString: (value) => value.toString().split('').reverse().join(''),
  };
  const chat = new GuideChat({ file, encryption, guide, fetcher });
  return { chat, file, encryption };
}
const config = { provider: 'openai', model: 'test-model', key: 'test-secret-key-123' };
const openaiResponse = (text) =>
  new Response(
    JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }),
  );
test('keys stay out of status, missing secure storage refuses saving, removal clears disk', (t) => {
  const { chat, file, encryption } = fixture(t);
  assert.equal(chat.status().configured, false);
  encryption.isEncryptionAvailable = () => false;
  assert.throws(() => chat.save(config), /Secure key storage/);
  assert.equal(fs.existsSync(file), false);
  encryption.isEncryptionAvailable = () => true;
  chat.save(config);
  assert.equal(JSON.stringify(chat.status()).includes(config.key), false);
  assert.equal(fs.readFileSync(file, 'utf8').includes(config.key), false);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.throws(() => chat.save({ ...config, provider: 'evil' }), /valid model/);
  chat.clear(true);
  assert.equal(fs.existsSync(file), false);
});
test('conversation retrieves evidence, cites sources, preserves followups and uses store:false', async (t) => {
  const calls = [];
  const { chat } = fixture(t, async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return openaiResponse(calls.length === 1 ? 'Blade' : 'It has +5 Agility [1].');
  });
  chat.save(config);
  const answer = await chat.ask('What stats does Blade have?');
  assert.equal(answer.sources[0].text, '+5 Agility');
  assert.equal(answer.searchQuery, 'Blade');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.store, false);
  assert.match(calls[1].body.input[0].content, /Retrieved Forever evidence/);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${config.key}`);
  await chat.ask('What about agility?', { type: 'item', id: 42 });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].body.input.length, 3);
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
  await assert.rejects(chat.ask('Question'), /Set up a model/);
  chat.save(config);
  await assert.rejects(chat.ask('Question', { type: 'item', id: 42 }), /HTTP 401/);
  assert.equal(chat.busy, false);
  assert.deepEqual(chat.history, []);
  await assert.rejects(chat.ask('x'.repeat(2001)), /2,000/);
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
