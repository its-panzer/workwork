const test = require('node:test');
const assert = require('node:assert/strict');
const { ChatGPTProvider } = require('../src/chatgpt-provider.cjs');
const json = (value, options) => new Response(JSON.stringify(value), options);
const catalog = () =>
  json({
    models: [
      { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hide' },
      { slug: 'account-default', display_name: 'Account default', visibility: 'list' },
      { slug: 'other-model', display_name: 'Other', visibility: 'list' },
    ],
  });
const event = (type, fields = {}) => `data: ${JSON.stringify({ type, ...fields })}\r\n\r\n`;
const completed = event('response.completed', { response: { status: 'completed' } });
function streamed(text, { step = 7, onCancel = () => {} } = {}) {
  const bytes = Buffer.from(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) return controller.close();
        controller.enqueue(bytes.subarray(offset, offset + step));
        offset = Math.min(bytes.length, offset + step);
      },
      cancel: onCancel,
    }),
    { headers: { 'Content-Type': 'text/event-stream', 'x-request-id': 'req-fixture' } },
  );
}
function fixture(fetcher) {
  const state = {
    connected: true,
    planEnabled: true,
    usageAcknowledged: true,
    accountId: 'account-1',
    sessionId: 1,
  };
  const auth = {
    status: () => ({ ...state }),
    access: async () => {
      if (!state.connected || !state.planEnabled) throw Error('Reconnect ChatGPT.');
      return {
        accessToken: `fixture-token-${state.accountId}`,
        accountId: state.accountId,
        sessionId: state.sessionId,
      };
    },
  };
  return { provider: new ChatGPTProvider({ auth, fetcher }), state };
}
test('discovers visible account models and sends a compliant request, parsing split UTF-8 and SSE lines', async () => {
  const calls = [];
  const { provider } = fixture(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/models')) return catalog();
    return streamed(
      ': heartbeat\r\n\r\n' +
        event('response.output_text.delta', { delta: 'Find the café ' }) +
        event('response.output_text.delta', { delta: '[1].' }) +
        completed,
      { step: 1 },
    );
  });
  assert.equal(
    await provider.complete('Guide instructions', [{ role: 'user', content: 'Where?' }]),
    'Find the café [1].',
  );
  assert.equal(calls[0].url, 'https://api.openai.com/v1/models');
  assert.equal(calls[1].url, 'https://api.openai.com/v1/responses');
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers.Authorization, 'Bearer fixture-token-account-1');
    assert.equal(call.options.headers['ChatGPT-Account-Id'], undefined);
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    model: 'account-default',
    instructions: 'Guide instructions',
    input: [{ role: 'user', content: 'Where?' }],
    store: false,
    stream: true,
  });
  assert.equal(provider.status().modelName, 'Account default');
  assert.equal(JSON.stringify(provider.status()).includes('fixture-token'), false);
  await provider.complete('Guide instructions', []);
  assert.equal(calls.filter((call) => call.url.endsWith('/models')).length, 1);
});
test('model catalogs above 200 KB retain only display fields and allow inference', async () => {
  const models = [
    {
      slug: 'hidden-model',
      display_name: 'Hidden',
      visibility: 'hide',
      metadata: 'x'.repeat(200000),
    },
    {
      slug: 'account-default',
      display_name: 'Account default',
      visibility: 'list',
      metadata: 'y'.repeat(161056),
    },
    { slug: 'other-model', display_name: 'Other', visibility: 'list' },
  ];
  let inferenceCalls = 0;
  const { provider } = fixture(async (url, options) => {
    if (url.endsWith('/models')) return json({ models });
    inferenceCalls++;
    assert.equal(JSON.parse(options.body).model, 'account-default');
    return streamed(
      event('response.output_text.delta', { delta: 'Which level range?' }) + completed,
    );
  });
  assert.equal(
    await provider.complete('Guide', [
      { role: 'user', content: 'Where should I farm green weapons?' },
    ]),
    'Which level range?',
  );
  assert.equal(inferenceCalls, 1);
  assert.deepEqual(await provider.models(), [
    { slug: 'account-default', display_name: 'Account default' },
    { slug: 'other-model', display_name: 'Other' },
  ]);
});
test('model catalogs above 5 MiB cancel before inference with a catalog-specific error', async () => {
  let cancelled = false,
    inferenceCalls = 0,
    producedBytes = 0;
  const { provider } = fixture(async (url) => {
    if (!url.endsWith('/models')) {
      inferenceCalls++;
      throw Error('Unexpected inference');
    }
    return new Response(
      new ReadableStream({
        pull(controller) {
          producedBytes += 64 * 1024;
          controller.enqueue(new Uint8Array(64 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  });
  await assert.rejects(provider.complete('Guide', []), {
    code: 'response_too_large',
    message: /model list/,
  });
  assert.equal(cancelled, true);
  assert.ok(producedBytes > 5 * 1024 * 1024 && producedBytes <= 5 * 1024 * 1024 + 128 * 1024);
  assert.equal(inferenceCalls, 0);
  assert.equal(provider.status().model, '');
});
test('account switches refresh the catalog and invalidate in-flight replies', async () => {
  let discoveries = 0,
    switchDuringResponse = false;
  const { provider, state } = fixture(async (url) => {
    if (url.endsWith('/models')) {
      discoveries++;
      return catalog();
    }
    if (switchDuringResponse) {
      state.accountId = 'account-3';
      state.sessionId++;
    }
    return streamed(event('response.output_text.delta', { delta: 'Answer' }) + completed);
  });
  await provider.complete('Instructions', []);
  state.accountId = 'account-2';
  state.sessionId++;
  assert.equal(provider.status().model, '');
  await provider.complete('Instructions', []);
  assert.equal(discoveries, 2);
  switchDuringResponse = true;
  await assert.rejects(provider.complete('Instructions', []), { code: 'reconnect' });
  const before = discoveries;
  await assert.rejects(
    provider.complete('Instructions', [], 12000, { accountId: 'account-1', sessionId: 1 }),
    { code: 'reconnect' },
  );
  assert.equal(discoveries, before);
});
test('partial answers require completion and stream failures keep safe recovery details', async () => {
  const prefix = event('response.output_text.delta', { delta: 'Partial answer' });
  for (const [suffix, code] of [
    ['', 'interrupted'],
    ['data: [DONE]\n\n', 'interrupted'],
    [event('response.incomplete'), 'incomplete'],
    [
      event('response.failed', {
        response: {
          error: {
            code: 'subscription_sharing_usage_limit_exceeded',
            message: 'sensitive provider text',
          },
        },
      }),
      'usage_limit',
    ],
    [
      event('error', {
        code: 'subscription_sharing_usage_unavailable',
        message: 'sensitive provider text',
      }),
      'unavailable',
    ],
  ]) {
    const { provider } = fixture(async (url) =>
      url.endsWith('/models') ? catalog() : streamed(prefix + suffix),
    );
    await assert.rejects(provider.complete('Instructions', []), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes('sensitive'), false);
      if (code === 'usage_limit') {
        assert.equal(error.providerCode, 'subscription_sharing_usage_limit_exceeded');
        assert.equal(error.requestId, 'req-fixture');
      }
      return true;
    });
  }
});
test('admission failures distinguish reconnect, restriction and usage without exposing response bodies', async () => {
  for (const [status, body, code] of [
    [401, { detail: 'private identity details' }, 'reconnect'],
    [403, { detail: 'private region details' }, 'permission'],
    [
      429,
      {
        error: {
          code: 'subscription_sharing_usage_limit_exceeded',
          message: 'private usage details',
        },
      },
      'usage_limit',
    ],
    [503, { error: { code: 'subscription_sharing_usage_unavailable' } }, 'unavailable'],
  ]) {
    const { provider, state } = fixture(async (url) =>
      url.endsWith('/models')
        ? catalog()
        : json(body, { status, headers: { 'x-request-id': 'req-failed' } }),
    );
    await assert.rejects(provider.complete('Instructions', []), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(error.requestId, 'req-failed');
      assert.equal(error.responseShape, body.error ? 'error' : 'detail');
      assert.equal(JSON.stringify(error).includes('private'), false);
      assert.equal(error.message.includes('private'), false);
      return true;
    });
    assert.equal(state.connected, true);
  }
});
test('oversized error bodies preserve HTTP recovery while network read errors propagate', async () => {
  for (const [status, code] of [
    [401, 'reconnect'],
    [429, 'usage_limit'],
  ]) {
    let cancelled = false;
    const { provider } = fixture(async (url) =>
      url.endsWith('/models')
        ? catalog()
        : new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(Buffer.from('private error details '.repeat(2000)));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { status, headers: { 'x-request-id': 'req-oversized' } },
          ),
    );
    await assert.rejects(provider.complete('Guide', []), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(error.requestId, 'req-oversized');
      assert.equal(error.responseShape, 'oversized');
      assert.equal(error.message.includes('private'), false);
      return true;
    });
    assert.equal(cancelled, true);
  }
  const networkError = new TypeError('Fixture connection interrupted');
  const { provider } = fixture(async (url) =>
    url.endsWith('/models')
      ? catalog()
      : new Response(
          new ReadableStream({
            start(controller) {
              controller.error(networkError);
            },
          }),
          { status: 401 },
        ),
  );
  await assert.rejects(provider.complete('Guide', []), (error) => error === networkError);
});
test('bounded output cancels the stream and never returns a truncated answer', async () => {
  let cancelled = false;
  const { provider } = fixture(async (url) =>
    url.endsWith('/models')
      ? catalog()
      : streamed(event('response.output_text.delta', { delta: 'x'.repeat(100) }) + completed, {
          onCancel: () => {
            cancelled = true;
          },
        }),
  );
  await assert.rejects(provider.complete('Instructions', [], 50), { code: 'output_limit' });
  assert.equal(cancelled, true);
});
test('plan acknowledgment and an available model are required before inference', async () => {
  const calls = [];
  const { provider, state } = fixture(async (url) => {
    calls.push(url);
    return json({ models: [] });
  });
  state.usageAcknowledged = false;
  await assert.rejects(provider.complete('Instructions', []), { code: 'usage_consent' });
  assert.deepEqual(calls, []);
  state.usageAcknowledged = true;
  await assert.rejects(provider.complete('Instructions', []), { code: 'model_unavailable' });
  assert.deepEqual(calls, ['https://api.openai.com/v1/models']);
});
