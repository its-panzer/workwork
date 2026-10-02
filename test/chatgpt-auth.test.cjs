const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  generateKeyPairSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} = require('node:crypto');
const { ChatGPTAuth } = require('../src/chatgpt-auth.cjs');

const issuer = 'https://auth.openai.com';
const direct = 'chatgpt.tokens.use.direct';
const scopes = `openid profile email offline_access resource.invoke ${direct}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'fixture-key',
  use: 'sig',
  alg: 'RS256',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workwork-chatgpt-auth-'));
  const file = path.join(root, 'auth.enc');
  const key = randomBytes(32);
  // Test-only encrypted codec. Electron safeStorage is injected by the application.
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const payload = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), payload]);
    },
    decryptString(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString();
    },
  };
  const state = { opened: deferred(), calls: [], subject: 'fixture-subject', ...options };
  const openExternal = async (url) => {
    state.url = new URL(url);
    state.opened.resolve(state.url);
  };
  const fetchImpl = async (url, request) => {
    state.calls.push({ url, request });
    assert.equal(request.redirect, 'error');
    if (url.endsWith('/openid-configuration'))
      return json({
        issuer,
        authorization_endpoint: `${issuer}/api/accounts/authorize`,
        token_endpoint: `${issuer}/api/accounts/oauth/token`,
        revocation_endpoint: `${issuer}/api/accounts/oauth/revoke`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
      });
    if (url.endsWith('/jwks.json')) return json({ keys: [jwk] });
    if (url.endsWith('/revoke')) return new Response(null, { status: state.revokeStatus || 200 });
    assert.equal(url, `${issuer}/api/accounts/oauth/token`);
    const form = request.body;
    assert.equal(form.get('resource'), 'https://api.openai.com/v1');
    assert.equal(form.has('client_secret'), false);
    if (form.get('grant_type') === 'refresh_token') {
      state.refreshCount = (state.refreshCount || 0) + 1;
      if (state.refreshWait) await state.refreshWait.promise;
      if (state.refreshError) return json({ error: state.refreshError }, 400);
      return json({
        access_token: 'fixture-access-rotated',
        refresh_token: 'fixture-refresh-rotated',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: state.refreshScope ?? scopes,
      });
    }
    assert.equal(form.get('redirect_uri'), state.url.searchParams.get('redirect_uri'));
    assert.equal(
      createHash('sha256').update(form.get('code_verifier')).digest('base64url'),
      state.url.searchParams.get('code_challenge'),
    );
    state.exchangeStarted?.resolve();
    if (state.exchangeWait) await state.exchangeWait.promise;
    if (state.exchangeNetworkFailure) throw Error('Fixture network failure.');
    if (state.exchangeError) return json({ error: state.exchangeError }, 400);
    const { SignJWT } = await import('jose');
    let idToken = await new SignJWT({
      sub: state.subject,
      email: 'fixture@example.test',
      nonce: state.url.searchParams.get('nonce'),
      iss: issuer,
      aud: form.get('client_id'),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...state.claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
      .sign(privateKey);
    if (state.badSignature) {
      const parts = idToken.split('.');
      const signature = Buffer.from(parts[2], 'base64url');
      signature[0] ^= 255;
      parts[2] = signature.toString('base64url');
      idToken = parts.join('.');
    }
    return json({
      id_token: idToken,
      ...(state.identityOnly
        ? {}
        : {
            access_token: 'fixture-access-token',
            ...(state.noRefresh ? {} : { refresh_token: 'fixture-refresh-token' }),
            expires_in: state.expiresIn ?? 3600,
            token_type: 'Bearer',
          }),
      scope: state.identityOnly
        ? 'openid profile email'
        : state.noRefresh
          ? scopes.replace('offline_access ', '')
          : scopes,
    });
  };
  const create = () =>
    new ChatGPTAuth({
      file,
      encryption,
      openExternal,
      fetchImpl,
      timeoutMs: options.timeoutMs || 5000,
    });
  const auth = create();
  t.after(() => {
    auth.cancelSignIn();
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function begin(options, client = auth) {
    state.opened = deferred();
    const promise = client.signIn(options);
    promise.catch(() => {});
    const url = await state.opened.promise;
    return { promise, url };
  }
  async function callback(attempt, parameters = {}) {
    const url = new URL(attempt.url.searchParams.get('redirect_uri'));
    url.search = new URLSearchParams({
      code: 'fixture-authorization-code',
      state: attempt.url.searchParams.get('state'),
      client_id:
        attempt.url.searchParams.get('client_id') === 'dynamic_agent_client'
          ? state.clientId || 'oaiapp_fixture'
          : attempt.url.searchParams.get('client_id'),
      ...parameters,
    });
    return fetch(url);
  }
  async function signIn(options) {
    const attempt = await begin(options);
    await callback(attempt);
    return attempt.promise;
  }
  return { auth, state, file, encryption, create, begin, callback, signIn };
}

test('PKCE loopback sign-in verifies identity and stores encrypted credentials without exposing tokens', async (t) => {
  const f = fixture(t);
  const status = await f.signIn();
  const originalHost = f.state.url.searchParams.get('ext_agent_host_id');
  assert.equal(status.connected, true);
  assert.equal(status.planEnabled, true);
  assert.equal(status.usageAcknowledged, false);
  assert.equal(f.state.url.origin + f.state.url.pathname, `${issuer}/api/accounts/authorize`);
  assert.equal(f.state.url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(f.state.url.searchParams.get('agent_name_hint'), 'WorkWork');
  assert.match(
    f.state.url.searchParams.get('redirect_uri'),
    /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/,
  );
  assert.equal(f.state.url.searchParams.get('scope'), scopes);
  assert.equal(JSON.stringify(status).includes('fixture-access'), false);
  assert.equal(fs.readFileSync(f.file).includes(Buffer.from('fixture-access-token')), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.equal((await f.auth.access()).accessToken, 'fixture-access-token');
  f.auth.acknowledgePlanUsage();
  const reloaded = f.create();
  assert.equal(reloaded.status().usageAcknowledged, true);
  assert.equal((await reloaded.access()).accountId, status.accountId);
  const again = await f.begin();
  assert.equal(again.url.searchParams.get('client_id'), 'oaiapp_fixture');
  assert.equal(again.url.searchParams.has('agent_name_hint'), false);
  assert.ok(again.url.searchParams.get('id_token_hint'));
  assert.equal(again.url.searchParams.get('ext_agent_host_id'), originalHost);
  await f.callback(again);
  await again.promise;
  const decrypt = f.encryption.decryptString;
  f.encryption.decryptString = () => {
    throw Error('Fixture locked credential store.');
  };
  const locked = f.create();
  assert.match(locked.status().error, /could not be opened securely/);
  f.encryption.decryptString = decrypt;
  assert.equal(locked.status().error, '');
  assert.equal(locked.status().connected, true);
  assert.equal(locked.acknowledgePlanUsage().usageAcknowledged, true);
});

test('an issued registration survives exchange failure and restart without trusting an identity', async (t) => {
  const f = fixture(t, { exchangeNetworkFailure: true });
  const attempt = await f.begin();
  const host = attempt.url.searchParams.get('ext_agent_host_id');
  await f.callback(attempt);
  await assert.rejects(attempt.promise, /Could not reach ChatGPT/);
  const restarted = f.create();
  assert.equal(restarted.status().connected, false);
  assert.equal(restarted.status().registrationPending, true);
  assert.deepEqual(restarted.status().accounts, []);
  const disk = JSON.parse(f.encryption.decryptString(fs.readFileSync(f.file)));
  assert.deepEqual(disk.pendingRegistration, { clientId: 'oaiapp_fixture' });
  f.state.exchangeNetworkFailure = false;
  const retry = await f.begin({}, restarted);
  assert.equal(retry.url.searchParams.get('client_id'), 'oaiapp_fixture');
  assert.equal(retry.url.searchParams.get('ext_agent_host_id'), host);
  assert.equal(retry.url.searchParams.has('agent_name_hint'), false);
  await f.callback(retry);
  assert.equal((await retry.promise).connected, true);
  assert.equal(restarted.status().registrationPending, false);
});

test('an unfinished added account has explicit retry and never replaces selected-account reauthorization', async (t) => {
  const f = fixture(t);
  const first = await f.signIn();
  f.state.clientId = 'oaiapp_unfinished';
  f.state.exchangeNetworkFailure = true;
  const failed = await f.begin({ addAccount: true });
  await f.callback(failed);
  await assert.rejects(failed.promise, /Could not reach ChatGPT/);
  assert.equal(f.auth.status().accountId, first.accountId);
  assert.equal(f.auth.status().registrationPending, true);
  for (const [options, expected] of [
    [{}, 'oaiapp_fixture'],
    [{ retryRegistration: true }, 'oaiapp_unfinished'],
    [{ addAccount: true }, 'dynamic_agent_client'],
  ]) {
    const attempt = await f.begin(options);
    assert.equal(attempt.url.searchParams.get('client_id'), expected);
    f.auth.cancelSignIn();
    await assert.rejects(attempt.promise, /canceled/);
  }
  assert.equal(f.auth.status().registrationPending, false);
});

test('a nonrenewable expired session exposes sign-in recovery and retains its registration', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = fixture(t, { expiresIn: 1, noRefresh: true });
  await f.signIn();
  assert.equal((await f.auth.access()).accessToken, 'fixture-access-token');
  t.mock.timers.tick(2000);
  assert.equal(f.auth.status().connected, false);
  await assert.rejects(f.auth.access(), { code: 'reconnect' });
  const retry = await f.begin();
  assert.equal(retry.url.searchParams.get('client_id'), 'oaiapp_fixture');
  f.auth.cancelSignIn();
  await assert.rejects(retry.promise, /canceled/);
});

test('identity-only sign-in remains connected but cannot use plan inference', async (t) => {
  const f = fixture(t, { identityOnly: true });
  const status = await f.signIn();
  assert.equal(status.connected, true);
  assert.equal(status.planEnabled, false);
  await assert.rejects(f.auth.access(), /Enable ChatGPT plan usage/);
  assert.throws(() => f.auth.acknowledgePlanUsage(), /Enable ChatGPT plan/);
  const attempt = await f.begin({ enablePlan: true });
  assert.equal(attempt.url.searchParams.get('prompt'), 'consent');
  assert.equal(attempt.url.searchParams.get('scope'), scopes);
  f.auth.cancelSignIn();
  await assert.rejects(attempt.promise, /canceled/);
  assert.equal(f.auth.status().connected, true);
});

test('invalid state and denied consent never exchange a code', async (t) => {
  for (const parameters of [{ state: 'incorrect-state' }, { error: 'access_denied' }]) {
    const f = fixture(t);
    const attempt = await f.begin();
    await f.callback(attempt, parameters);
    await assert.rejects(attempt.promise, /verified|declined/);
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.auth.status().connected, false);
  }
});

test('invalid JWT signature, issuer, audience, expiry and nonce cannot establish a session', async (t) => {
  for (const options of [
    { badSignature: true },
    { claims: { iss: 'https://untrusted.example' } },
    { claims: { aud: 'oaiapp_other' } },
    { claims: { exp: 1 } },
    { claims: { nonce: 'incorrect-nonce' } },
  ]) {
    const f = fixture(t, options);
    const attempt = await f.begin();
    await f.callback(attempt);
    await assert.rejects(attempt.promise, /identity could not be verified/);
    assert.equal(f.auth.status().connected, false);
  }
});

test('multiple registrations remain distinct and reauthorization cannot change verified identity', async (t) => {
  const f = fixture(t);
  const first = await f.signIn();
  f.state.subject = 'another-subject';
  const wrong = await f.begin();
  await f.callback(wrong);
  await assert.rejects(wrong.promise, /different account/);
  assert.equal(f.auth.status().accountId, first.accountId);
  f.state.clientId = 'oaiapp_second';
  const second = await f.signIn({ addAccount: true });
  assert.notEqual(first.accountId, second.accountId);
  assert.equal(second.accounts.length, 2);
  assert.notEqual(second.accounts[0].label, second.accounts[1].label);
  f.auth.selectAccount(first.accountId);
  assert.equal(f.auth.status().accountId, first.accountId);
  const mismatch = await f.begin();
  const count = f.state.calls.length;
  await f.callback(mismatch, { client_id: 'oaiapp_wrong' });
  await assert.rejects(mismatch.promise, /different account registration/);
  assert.equal(f.state.calls.length, count);
});

test('refresh is serialized and rotating tokens are saved together across restarts', async (t) => {
  const f = fixture(t, { expiresIn: 1 });
  await f.signIn();
  const sessionId = f.auth.status().sessionId;
  const results = await Promise.all([f.auth.access(), f.auth.access(), f.auth.access()]);
  assert.equal(f.state.refreshCount, 1);
  assert.ok(results.every((result) => result.accessToken === 'fixture-access-rotated'));
  assert.equal(f.auth.status().sessionId, sessionId);
  const disk = JSON.parse(f.encryption.decryptString(fs.readFileSync(f.file)));
  assert.equal(disk.accounts[0].tokens.refreshToken, 'fixture-refresh-rotated');
  assert.equal((await f.create().access()).accessToken, 'fixture-access-rotated');
  const refresh = f.state.calls.find(
    (call) => call.request.body?.get('grant_type') === 'refresh_token',
  );
  assert.equal(refresh.request.body.get('client_id'), 'oaiapp_fixture');
  assert.equal(refresh.request.body.has('scope'), false);
});

test('terminal refresh errors clear tokens but retain registration; transient errors preserve credentials', async (t) => {
  for (const code of ['invalid_grant', 'temporary_failure']) {
    const f = fixture(t, { expiresIn: 1, refreshError: code });
    const initial = await f.signIn();
    await assert.rejects(f.auth.access(), /session has ended|authentication failed/);
    if (code === 'invalid_grant') await assert.rejects(f.auth.access(), { code: 'reconnect' });
    assert.equal(f.auth.status().connected, code !== 'invalid_grant');
    assert.equal(f.auth.status().accountId, initial.accountId);
    assert.equal(f.auth.status().accounts.length, 1);
  }
});

test('refresh cannot restore plan permission omitted from the new grant', async (t) => {
  const f = fixture(t, { expiresIn: 1, refreshScope: 'openid profile email' });
  await f.signIn();
  await assert.rejects(f.auth.access(), /plan usage is no longer enabled/);
  assert.equal(f.auth.status().connected, true);
  assert.equal(f.auth.status().planEnabled, false);
});

test('switching accounts during refresh preserves rotation for the original registration', async (t) => {
  const f = fixture(t, { expiresIn: 1, refreshWait: deferred() });
  const first = await f.signIn();
  f.state.clientId = 'oaiapp_second';
  f.state.subject = 'second-subject';
  const second = await f.signIn({ addAccount: true });
  f.auth.selectAccount(first.accountId);
  const access = f.auth.access();
  access.catch(() => {});
  f.auth.selectAccount(second.accountId);
  f.state.refreshWait.resolve();
  await assert.rejects(access, /account changed/);
  f.auth.selectAccount(first.accountId);
  assert.equal((await f.auth.access()).accessToken, 'fixture-access-rotated');
  assert.equal(f.state.refreshCount, 1);
});

test('signout cannot be undone by a pending refresh and retains host/account mapping', async (t) => {
  const f = fixture(t, { expiresIn: 1, refreshWait: deferred() });
  await f.signIn();
  const host = f.state.url.searchParams.get('ext_agent_host_id');
  const access = f.auth.access();
  access.catch(() => {});
  const signOut = f.auth.signOut();
  assert.equal(f.auth.status().connected, false);
  f.state.refreshWait.resolve();
  await signOut;
  await assert.rejects(access, /account changed/);
  assert.equal(f.auth.status().connected, false);
  assert.equal(f.create().status().connected, false);
  const revoke = f.state.calls.find((call) => call.url.endsWith('/revoke'));
  assert.equal(revoke.request.body.get('token'), 'fixture-refresh-rotated');
  const again = await f.begin();
  assert.equal(again.url.searchParams.get('client_id'), 'oaiapp_fixture');
  assert.equal(again.url.searchParams.get('ext_agent_host_id'), host);
  assert.equal(again.url.searchParams.has('id_token_hint'), false);
  f.auth.cancelSignIn();
  await assert.rejects(again.promise, /canceled/);
});

test('signout reports unconfirmed remote revocation while clearing local tokens', async (t) => {
  const f = fixture(t, { revokeStatus: 503 });
  await f.signIn();
  const status = await f.auth.signOut();
  assert.equal(status.connected, false);
  assert.equal(status.revocationUnconfirmed, true);
  assert.equal(f.state.calls.filter((call) => call.url.endsWith('/revoke')).length, 2);
});

test('signout during a code exchange cannot resurrect a canceled sign-in', async (t) => {
  const f = fixture(t, { exchangeWait: deferred(), exchangeStarted: deferred() });
  const attempt = await f.begin();
  const callback = f.callback(attempt).catch(() => {});
  await f.state.exchangeStarted.promise;
  await f.auth.signOut();
  f.state.exchangeWait.resolve();
  await assert.rejects(attempt.promise, /canceled/);
  await callback;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.auth.status().connected, false);
  assert.equal(f.create().status().connected, false);
});

test('timeouts and explicit cancel close the listener; insecure storage never starts OAuth', async (t) => {
  const f = fixture(t, { timeoutMs: 50 });
  const attempt = await f.begin();
  await assert.rejects(attempt.promise, /timed out/);
  await assert.rejects(fetch(attempt.url.searchParams.get('redirect_uri')));
  f.encryption.isEncryptionAvailable = () => false;
  await assert.rejects(f.auth.signIn(), /Secure ChatGPT credential storage/);
  f.encryption.isEncryptionAvailable = () => true;
  f.encryption.getSelectedStorageBackend = () => 'basic_text';
  await assert.rejects(f.auth.signIn(), /Secure ChatGPT credential storage/);
});
