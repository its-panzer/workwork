const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomBytes, randomUUID, createHash } = require('node:crypto');

const ISSUER = 'https://auth.openai.com';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = 'https://api.openai.com/v1';
const DIRECT = 'chatgpt.tokens.use.direct';
const SCOPES = `openid profile email offline_access resource.invoke ${DIRECT}`;
const TERMINAL_REFRESH = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
]);
const random = () => randomBytes(32).toString('base64url');
const validClient = (value) =>
  typeof value === 'string' && /^[\w-]{1,200}$/.test(value) && value !== 'dynamic_agent_client';
const tokenString = (value) =>
  typeof value === 'string' && value.length > 0 && value.length < 32768;
const reconnect = (message) => Object.assign(Error(message), { code: 'reconnect' });
const connected = (account) =>
  Boolean(
    account?.tokens &&
    (!account.tokens.accessToken ||
      account.tokens.refreshToken ||
      account.tokens.expiresAt > Date.now()),
  );

class ChatGPTAuth {
  constructor({ file, encryption, openExternal, fetchImpl = fetch, timeoutMs = 300000 }) {
    this.file = file;
    this.encryption = encryption;
    this.openExternal = openExternal;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.data = { version: 1, hostId: `urn:uuid:${randomUUID()}`, accounts: [], activeId: null };
    this.loaded = false;
    this.sessionId = 0;
    this.pending = null;
    this.refreshes = new Map();
    this.revocationUnconfirmed = false;
  }

  storageAvailable() {
    return Boolean(
      this.encryption?.isEncryptionAvailable() &&
      this.encryption.getSelectedStorageBackend?.() !== 'basic_text',
    );
  }

  load() {
    if (this.loaded || !this.storageAvailable()) return;
    try {
      if (!fs.lstatSync(this.file).isFile()) throw Error('Invalid credential file.');
      const saved = JSON.parse(this.encryption.decryptString(fs.readFileSync(this.file)));
      if (
        saved.version !== 1 ||
        typeof saved.hostId !== 'string' ||
        !Array.isArray(saved.accounts) ||
        (saved.pendingRegistration && !validClient(saved.pendingRegistration.clientId)) ||
        saved.accounts.some(
          (account) => !account.id || !account.subject || !validClient(account.clientId),
        )
      )
        throw Error('Invalid credentials.');
      this.data = saved;
      this.loaded = true;
      this.storageError = '';
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.loaded = true;
        this.storageError = '';
      } else this.storageError = 'Saved ChatGPT credentials could not be opened securely.';
    }
  }

  save() {
    if (!this.storageAvailable()) throw Error('Secure ChatGPT credential storage is unavailable.');
    if (this.storageError) throw Error(this.storageError);
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, this.encryption.encryptString(JSON.stringify(this.data)), {
        flag: 'wx',
        mode: 0o600,
      });
      fs.renameSync(temporary, this.file);
      fs.chmodSync(this.file, 0o600);
    } catch {
      throw Error('ChatGPT credentials could not be saved securely.');
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }

  active() {
    return this.data.accounts.find((account) => account.id === this.data.activeId);
  }

  status() {
    this.load();
    const account = this.active();
    return {
      connected: connected(account),
      planEnabled: Boolean(account?.tokens?.scopes.includes(DIRECT)),
      accountId: account?.id || null,
      sessionId: this.sessionId,
      email: account?.email || '',
      usageAcknowledged: Boolean(account?.usageAcknowledged),
      accounts: this.data.accounts.map((saved, index) => ({
        id: saved.id,
        label: `${saved.email || 'ChatGPT account'} · ${index + 1}`,
        email: saved.email || '',
        connected: connected(saved),
      })),
      signingIn: Boolean(this.pending),
      registrationPending: Boolean(this.data.pendingRegistration),
      storageAvailable: this.storageAvailable(),
      error: this.storageError || '',
      revocationUnconfirmed: this.revocationUnconfirmed,
    };
  }

  async request(url, options = {}) {
    try {
      return await this.fetchImpl(url, {
        ...options,
        redirect: 'error',
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
    } catch {
      throw Error('Could not reach ChatGPT. Check your connection and try again.');
    }
  }

  async json(url, options) {
    const response = await this.request(url, options);
    let body;
    try {
      const text = await response.text();
      if (text.length > 200000) throw Error('Oversized response.');
      body = JSON.parse(text);
    } catch {
      throw Error('ChatGPT returned an unreadable authentication response.');
    }
    if (!response.ok) {
      const error = Error(
        `ChatGPT authentication failed (HTTP ${response.status}). Try signing in again.`,
      );
      const code = typeof body.error === 'string' ? body.error : body.error?.code;
      if (TERMINAL_REFRESH.has(code) || code === 'invalid_client') error.code = code;
      throw error;
    }
    return body;
  }

  async discovery(signal) {
    if (!this.configuration) {
      const configuration = await this.json(`${ISSUER}/.well-known/openid-configuration`, {
        signal,
      });
      if (
        configuration.issuer !== ISSUER ||
        configuration.authorization_endpoint !== AUTHORIZE ||
        configuration.token_endpoint !== TOKEN ||
        configuration.jwks_uri !== `${ISSUER}/.well-known/jwks.json` ||
        configuration.revocation_endpoint !== `${ISSUER}/api/accounts/oauth/revoke`
      )
        throw Error('ChatGPT authentication configuration could not be verified.');
      this.configuration = configuration;
    }
    return this.configuration;
  }

  async identity(token, clientId, nonce, signal) {
    if (!tokenString(token)) throw Error('ChatGPT did not return a valid identity token.');
    const configuration = await this.discovery(signal);
    const { createLocalJWKSet, jwtVerify } = await import('jose');
    const verify = async () => {
      if (!this.keys || this.keysExpire < Date.now()) {
        this.keys = createLocalJWKSet(await this.json(configuration.jwks_uri, { signal }));
        this.keysExpire = Date.now() + 3600000;
      }
      return jwtVerify(token, this.keys, {
        issuer: ISSUER,
        audience: clientId,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5,
      });
    };
    try {
      let verified;
      try {
        verified = await verify();
      } catch (error) {
        if (error.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw error;
        this.keys = null;
        verified = await verify();
      }
      const claims = verified.payload;
      if (
        typeof claims.sub !== 'string' ||
        !claims.sub ||
        claims.iat > Date.now() / 1000 + 5 ||
        (nonce !== undefined && claims.nonce !== nonce) ||
        (claims.azp !== undefined && claims.azp !== clientId) ||
        (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId)
      )
        throw Error('Invalid identity.');
      return claims;
    } catch {
      throw Error('The ChatGPT identity could not be verified. Sign in again.');
    }
  }

  tokenSet(body, previous) {
    const scopes =
      typeof body.scope === 'string'
        ? body.scope.split(/\s+/).filter(Boolean)
        : previous?.scopes || [];
    if (
      scopes.includes(DIRECT) &&
      (!tokenString(body.access_token) || body.token_type !== 'Bearer')
    )
      throw Error('ChatGPT did not return a usable plan access token.');
    if (body.access_token && (!Number.isFinite(body.expires_in) || body.expires_in <= 0))
      throw Error('ChatGPT did not return a valid token lifetime.');
    if (
      scopes.includes(DIRECT) &&
      scopes.includes('offline_access') &&
      !tokenString(body.refresh_token)
    )
      throw Error('ChatGPT did not return a renewable session.');
    return {
      accessToken: tokenString(body.access_token) ? body.access_token : null,
      refreshToken: tokenString(body.refresh_token) ? body.refresh_token : null,
      idToken: body.id_token || previous?.idToken || null,
      scopes,
      expiresAt: Date.now() + (body.expires_in || 0) * 1000,
    };
  }

  async exchange(parameters, signal) {
    return this.json(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ ...parameters, resource: RESOURCE }),
      signal,
    });
  }

  signIn({ accountId, addAccount = false, enablePlan = false, retryRegistration = false } = {}) {
    this.load();
    if (this.pending) return this.pending.promise;
    if (this.storageError) return Promise.reject(Error(this.storageError));
    if (!this.storageAvailable())
      return Promise.reject(Error('Secure ChatGPT credential storage is unavailable.'));
    if (retryRegistration && !this.data.pendingRegistration)
      return Promise.reject(Error('There is no unfinished ChatGPT registration to retry.'));
    const selected =
      addAccount || retryRegistration
        ? null
        : this.data.accounts.find((account) => account.id === (accountId || this.data.activeId));
    if (accountId && !selected) return Promise.reject(Error('Choose a saved ChatGPT account.'));
    if (addAccount) delete this.data.pendingRegistration;
    try {
      this.save();
    } catch (error) {
      return Promise.reject(error);
    }
    const attempt = {
      state: random(),
      nonce: random(),
      verifier: random(),
      controller: new AbortController(),
      sessionId: this.sessionId,
      clientId:
        selected?.clientId || this.data.pendingRegistration?.clientId || 'dynamic_agent_client',
    };
    let resolveAttempt;
    let rejectAttempt;
    attempt.promise = new Promise((resolve, reject) => {
      resolveAttempt = resolve;
      rejectAttempt = reject;
    });
    attempt.finish = (error) => {
      if (attempt.finished) return;
      attempt.finished = true;
      clearTimeout(attempt.timer);
      attempt.controller.abort();
      attempt.server.close();
      attempt.server.closeAllConnections();
      if (this.pending === attempt) this.pending = null;
      if (error) rejectAttempt(error);
      else resolveAttempt(this.status());
    };
    attempt.server = http.createServer(async (request, response) => {
      let url;
      try {
        url = new URL(request.url, 'http://127.0.0.1');
      } catch {
        response.writeHead(400).end('Invalid callback.');
        return;
      }
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Security-Policy', "default-src 'none'");
      if (request.method !== 'GET' || url.pathname !== '/auth/callback') {
        response.writeHead(404).end('Not found.');
        return;
      }
      if (attempt.consumed || attempt.finished) {
        response.writeHead(400).end('This sign-in attempt has ended.');
        return;
      }
      attempt.consumed = true;
      try {
        if (url.searchParams.get('state') !== attempt.state)
          throw Error('ChatGPT sign-in could not be verified. Try again.');
        if (url.searchParams.has('error')) throw Error('ChatGPT sign-in was declined or canceled.');
        const callbackClient = url.searchParams.get('client_id');
        if (attempt.clientId === 'dynamic_agent_client') {
          if (!validClient(callbackClient))
            throw Error('ChatGPT registration was incomplete. Try again.');
          attempt.clientId = callbackClient;
          this.data.pendingRegistration = { clientId: callbackClient };
          this.save();
        } else if (callbackClient && callbackClient !== attempt.clientId) {
          throw Error('ChatGPT returned a different account registration. Try again.');
        }
        const code = url.searchParams.get('code');
        if (!tokenString(code)) throw Error('ChatGPT did not return an authorization code.');
        const body = await this.exchange(
          {
            grant_type: 'authorization_code',
            client_id: attempt.clientId,
            code,
            code_verifier: attempt.verifier,
            redirect_uri: attempt.redirectUri,
          },
          attempt.controller.signal,
        );
        const identity = await this.identity(
          body.id_token,
          attempt.clientId,
          attempt.nonce,
          attempt.controller.signal,
        );
        if (selected && identity.sub !== selected.subject)
          throw Error('ChatGPT returned a different account. Add it as a new account instead.');
        const tokens = this.tokenSet(body);
        if (attempt.finished || attempt.sessionId !== this.sessionId) return;
        const account = {
          id: selected?.id || randomUUID(),
          clientId: attempt.clientId,
          subject: identity.sub,
          email: typeof identity.email === 'string' ? identity.email : '',
          usageAcknowledged: selected?.usageAcknowledged || false,
          tokens,
        };
        const previous = this.data;
        this.data = {
          ...previous,
          activeId: account.id,
          accounts: selected
            ? previous.accounts.map((saved) => (saved.id === account.id ? account : saved))
            : [...previous.accounts, account],
        };
        if (this.data.pendingRegistration?.clientId === attempt.clientId)
          delete this.data.pendingRegistration;
        try {
          this.save();
        } catch (error) {
          this.data = previous;
          throw error;
        }
        this.sessionId++;
        this.revocationUnconfirmed = false;
        response.end('ChatGPT is connected. You can close this tab and return to WorkWork.', () =>
          attempt.finish(),
        );
      } catch (error) {
        response
          .writeHead(400)
          .end('Sign-in could not be completed. Return to WorkWork to try again.', () =>
            attempt.finish(error),
          );
      }
    });
    this.pending = attempt;
    attempt.timer = setTimeout(
      () => attempt.finish(Error('ChatGPT sign-in timed out. Try again.')),
      this.timeoutMs,
    );
    attempt.server.on('error', () =>
      attempt.finish(Error('Could not start the ChatGPT sign-in callback.')),
    );
    attempt.server.listen(0, '127.0.0.1', async () => {
      if (attempt.finished) return;
      attempt.redirectUri = `http://127.0.0.1:${attempt.server.address().port}/auth/callback`;
      const url = new URL(AUTHORIZE);
      url.search = new URLSearchParams({
        client_id: attempt.clientId,
        ext_agent_host_id: this.data.hostId,
        response_type: 'code',
        redirect_uri: attempt.redirectUri,
        scope: SCOPES,
        resource: RESOURCE,
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url'),
        ...(attempt.clientId === 'dynamic_agent_client' ? { agent_name_hint: 'WorkWork' } : {}),
        ...(selected?.tokens?.idToken ? { id_token_hint: selected.tokens.idToken } : {}),
        ...(selected?.email ? { login_hint: selected.email } : {}),
        ...(enablePlan ? { prompt: 'consent' } : {}),
      });
      try {
        await this.openExternal(url.toString());
      } catch {
        attempt.finish(Error('Could not open the browser for ChatGPT sign-in.'));
      }
    });
    return attempt.promise;
  }

  cancelSignIn() {
    this.pending?.finish(Error('ChatGPT sign-in was canceled.'));
    return this.status();
  }

  selectAccount(id) {
    this.load();
    if (!this.data.accounts.some((account) => account.id === id))
      throw Error('Choose a saved ChatGPT account.');
    this.cancelSignIn();
    this.sessionId++;
    this.data.activeId = id;
    this.save();
    return this.status();
  }

  acknowledgePlanUsage() {
    const status = this.status();
    if (!status.connected || !status.planEnabled) throw Error('Enable ChatGPT plan usage first.');
    this.active().usageAcknowledged = true;
    this.save();
    return this.status();
  }

  async signOut() {
    this.load();
    this.cancelSignIn();
    this.sessionId++;
    const sessionId = this.sessionId;
    const account = this.active();
    let refreshToken = account?.tokens?.refreshToken;
    const inFlightRefresh = account && this.refreshes.get(account.id);
    if (account) {
      delete account.tokens;
      account.usageAcknowledged = false;
      this.save();
    }
    this.revocationUnconfirmed = false;
    if (inFlightRefresh) {
      await inFlightRefresh.promise.catch(() => {});
      refreshToken = inFlightRefresh.rotatedRefreshToken || refreshToken;
    }
    if (refreshToken) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const configuration = await this.discovery();
          const response = await this.request(configuration.revocation_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: refreshToken,
              token_type_hint: 'refresh_token',
              client_id: account.clientId,
            }),
          });
          await response.body?.cancel();
          if (response.status === 200) return this.status();
          if (response.status < 500) break;
        } catch {}
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (sessionId === this.sessionId) this.revocationUnconfirmed = true;
    }
    return this.status();
  }

  async access() {
    const status = this.status();
    if (!status.connected) throw reconnect('Continue with ChatGPT to ask the game guide.');
    if (!status.planEnabled) throw Error('Enable ChatGPT plan usage to ask the game guide.');
    const account = this.active();
    if (account.tokens.expiresAt <= Date.now() + 60000 && account.tokens.refreshToken) {
      if (!this.refreshes.has(account.id)) {
        const refresh = { account };
        refresh.promise = this.refresh(account, refresh).finally(() => {
          if (this.refreshes.get(account.id) === refresh) this.refreshes.delete(account.id);
        });
        this.refreshes.set(account.id, refresh);
      }
      await this.refreshes.get(account.id).promise;
    }
    if (this.sessionId !== status.sessionId || !account.tokens)
      throw Error('The active ChatGPT account changed. Try again.');
    if (!account.tokens.scopes.includes(DIRECT))
      throw Error('ChatGPT plan usage is no longer enabled.');
    return {
      accessToken: account.tokens.accessToken,
      accountId: account.id,
      sessionId: this.sessionId,
    };
  }

  async refresh(account, operation) {
    const originalTokens = account.tokens;
    try {
      const body = await this.exchange({
        grant_type: 'refresh_token',
        client_id: account.clientId,
        refresh_token: originalTokens.refreshToken,
      });
      if (body.id_token) {
        const identity = await this.identity(body.id_token, account.clientId);
        if (identity.sub !== account.subject)
          throw Error('ChatGPT returned a different account. Sign in again.');
      }
      const tokens = this.tokenSet(body, originalTokens);
      operation.rotatedRefreshToken = tokens.refreshToken;
      if (!this.data.accounts.includes(account) || account.tokens !== originalTokens)
        throw Error('The active ChatGPT account changed. Try again.');
      account.tokens = tokens;
      this.save();
    } catch (error) {
      if (
        TERMINAL_REFRESH.has(error.code) &&
        this.data.accounts.includes(account) &&
        account.tokens === originalTokens
      ) {
        delete account.tokens;
        account.usageAcknowledged = false;
        if (account === this.active()) this.sessionId++;
        this.save();
        throw reconnect('Your ChatGPT session has ended. Sign in again.');
      }
      throw error;
    }
  }
}

module.exports = { ChatGPTAuth };
