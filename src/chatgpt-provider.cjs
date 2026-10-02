const API = 'https://api.openai.com/v1';
const LIMIT = 12000;
const MODEL_CATALOG_LIMIT = 5 * 1024 * 1024;
const ERROR_BODY_LIMIT = 32000;
const ERROR_MESSAGES = {
  subscription_sharing_usage_limit_exceeded: [
    'usage_limit',
    'ChatGPT plan usage is paused. Review this app’s limit in ChatGPT Settings → Usage.',
  ],
  subscription_sharing_usage_unavailable: [
    'unavailable',
    'ChatGPT usage could not be checked. Try again later.',
  ],
  subscription_sharing_user_unavailable: [
    'unavailable',
    'This ChatGPT account is temporarily unavailable. Try again later.',
  ],
  subscription_sharing_user_not_eligible: [
    'not_eligible',
    'ChatGPT plan usage is unavailable for this account or workspace. Choose another account or an API provider.',
  ],
  subscription_sharing_invalid_user: [
    'reconnect',
    'ChatGPT could not validate this session. Sign in again.',
  ],
  subscription_sharing_unsupported_capability: [
    'unsupported',
    'ChatGPT does not support this request. Update WorkWork or choose an API provider.',
  ],
  subscription_sharing_route_not_supported: [
    'unsupported',
    'ChatGPT did not accept this inference route. Update WorkWork or choose an API provider.',
  ],
  chatpass_v2_scope_not_authorized: [
    'permission',
    'ChatGPT plan permission does not authorize this request. Check your connection settings.',
  ],
  chatpass_v2_invalid_authorization_context: [
    'permission',
    'ChatGPT plan permission does not authorize this request. Check your connection settings.',
  ],
};
function failure(code, message) {
  return Object.assign(Error(message), { code });
}
function responseError(response, detail = {}) {
  detail ||= {};
  const providerCode =
    typeof detail.code === 'string' && /^[\w.-]{1,100}$/.test(detail.code) ? detail.code : '';
  const [code, message] =
    (Object.hasOwn(ERROR_MESSAGES, providerCode) ? ERROR_MESSAGES[providerCode] : null) ||
    (response.status === 401
      ? ['reconnect', 'ChatGPT did not accept this session. Sign in again.']
      : response.status === 403
        ? [
            'permission',
            'ChatGPT denied this request. Check the account, workspace and region permissions.',
          ]
        : response.status === 429
          ? [
              'usage_limit',
              'ChatGPT cannot accept more requests right now. Review usage or try again later.',
            ]
          : response.status >= 500
            ? ['unavailable', 'ChatGPT is temporarily unavailable. Try again later.']
            : ['provider_error', 'ChatGPT could not complete this request. Try again.']);
  return Object.assign(failure(code, message), {
    status: response.status,
    providerCode,
    requestId:
      response.headers
        .get('x-request-id')
        ?.replace(/[^\w.-]/g, '')
        .slice(0, 150) || '',
    param:
      typeof detail.param === 'string' && /^[\w.[\]-]{1,100}$/.test(detail.param)
        ? detail.param
        : '',
  });
}
async function jsonBody(
  response,
  limit,
  oversizedMessage = 'ChatGPT returned an oversized response.',
) {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw failure('response_too_large', oversizedMessage);
      chunks.push(Buffer.from(value));
    }
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return body && typeof body === 'object' ? body : {};
    } catch {
      return {};
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
async function checkResponse(response) {
  if (response.ok) return;
  let body;
  try {
    body = await jsonBody(response, ERROR_BODY_LIMIT);
  } catch (error) {
    if (error.code !== 'response_too_large') throw error;
    throw Object.assign(responseError(response), { responseShape: 'oversized' });
  }
  const error = responseError(response, body.error);
  error.responseShape = body.error ? 'error' : Object.hasOwn(body, 'detail') ? 'detail' : 'other';
  throw error;
}
async function streamAnswer(response, limit) {
  if (!response.body) throw failure('interrupted', 'ChatGPT returned no answer stream. Try again.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    data = [],
    answer = '',
    size = 0,
    completed = false;
  const dispatch = () => {
    if (!data.length) return;
    const text = data.join('\n');
    data = [];
    if (text === '[DONE]') return;
    let event;
    try {
      event = JSON.parse(text);
    } catch {
      throw failure('provider_error', 'ChatGPT returned an unreadable stream. Try again.');
    }
    if (!event || typeof event !== 'object')
      throw failure('provider_error', 'ChatGPT returned an unreadable stream. Try again.');
    if (event.type === 'response.failed' || event.type === 'error')
      throw responseError(response, event.response?.error || event.error || event);
    if (event.type === 'response.incomplete')
      throw failure(
        'incomplete',
        'ChatGPT stopped before finishing the answer. Try a shorter question.',
      );
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string')
      answer += event.delta;
    if (event.type === 'response.completed') {
      completed = true;
      if (!answer)
        answer = (event.response?.output || [])
          .flatMap((item) => item.content || [])
          .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('\n');
    }
    if (answer.length > limit)
      throw failure('output_limit', 'ChatGPT’s answer was too long. Ask a narrower question.');
  };
  const lines = (final = false) => {
    let newline;
    while (!completed && (newline = /\r\n|\n|\r/.exec(buffer))) {
      if (!final && newline[0] === '\r' && newline.index === buffer.length - 1) break;
      const line = buffer.slice(0, newline.index);
      buffer = buffer.slice(newline.index + newline[0].length);
      if (!line) dispatch();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (final && !completed) {
      if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, ''));
      dispatch();
    }
  };
  try {
    while (!completed) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        lines(true);
        break;
      }
      size += value.length;
      if (size > 1000000)
        throw failure('output_limit', 'ChatGPT’s response was too large. Ask a narrower question.');
      buffer += decoder.decode(value, { stream: true });
      lines();
    }
    if (!completed)
      throw failure(
        'interrupted',
        'The ChatGPT connection ended before the answer finished. Try again.',
      );
    if (!answer.trim())
      throw failure('provider_error', 'ChatGPT returned no answer. Try a different question.');
    return answer.trim();
  } finally {
    await reader.cancel().catch(() => {});
  }
}
class ChatGPTProvider {
  constructor({ auth, fetcher = fetch }) {
    this.auth = auth;
    this.fetcher = fetcher;
    this.catalog = null;
  }
  status() {
    const status = this.auth.status();
    const model = this.catalog?.accountId === status.accountId ? this.catalog.models[0] : null;
    return { ...status, model: model?.slug || '', modelName: model?.display_name || '' };
  }
  assertSession(session) {
    const current = this.auth.status();
    if (
      !current.connected ||
      current.accountId !== session.accountId ||
      current.sessionId !== session.sessionId
    )
      throw failure('reconnect', 'The ChatGPT account changed. Try your question again.');
  }
  async models(session) {
    session ||= await this.auth.access();
    if (this.catalog?.accountId === session.accountId && Date.now() - this.catalog.time < 300000)
      return this.catalog.models;
    const response = await this.fetcher(`${API}/models`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/json' },
    });
    await checkResponse(response);
    const body = await jsonBody(
      response,
      MODEL_CATALOG_LIMIT,
      'ChatGPT’s model list was too large to load. Try again later.',
    );
    const models = Array.isArray(body.models)
      ? body.models
          .filter(
            (model) =>
              model?.visibility === 'list' &&
              typeof model.slug === 'string' &&
              /^[\w.:/-]{1,100}$/.test(model.slug),
          )
          .map((model) => ({
            slug: model.slug,
            display_name:
              typeof model.display_name === 'string'
                ? model.display_name.slice(0, 100)
                : model.slug,
          }))
      : [];
    this.assertSession(session);
    if (!models.length)
      throw failure(
        'model_unavailable',
        'No ChatGPT models are available for this account. Check your plan access.',
      );
    this.catalog = { accountId: session.accountId, models, time: Date.now() };
    return models;
  }
  async complete(instructions, messages, limit = LIMIT, expectedSession) {
    if (expectedSession) this.assertSession(expectedSession);
    const status = this.auth.status();
    if (!status.usageAcknowledged)
      throw failure('usage_consent', 'Confirm ChatGPT plan usage before asking a question.');
    const session = await this.auth.access();
    this.assertSession(status);
    const models = await this.models(session);
    this.assertSession(session);
    const response = await this.fetcher(`${API}/responses`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: models[0].slug,
        instructions,
        input: messages,
        store: false,
        stream: true,
      }),
    });
    await checkResponse(response);
    const answer = await streamAnswer(response, Math.min(LIMIT, Math.max(1, limit)));
    this.assertSession(session);
    return answer;
  }
}
module.exports = { ChatGPTProvider };
