const ORIGIN = 'https://www.wowhead.com';
const SETUP_URLS = [
  'https://platform.openai.com/api-keys',
  'https://console.anthropic.com/settings/keys',
];
const TYPES = ['item', 'quest', 'npc', 'spell', 'zone'];
function queryText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 240)
    throw Error('Enter a name or search phrase of up to 240 characters.');
  return value.trim();
}
function entryURL(type, id) {
  if (!TYPES.includes(type) || !Number.isSafeInteger(id) || id < 1)
    throw Error('Choose a valid game entry.');
  return `${ORIGIN}/forever/${type}=${id}`;
}
function sourceURL(value) {
  const url = new URL(value);
  if (SETUP_URLS.includes(url.href)) return url.href;
  if (
    url.origin !== ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    !/^\/forever\/(?:search|(?:item|quest|npc|spell|zone)=\d+)$/.test(url.pathname)
  )
    throw Error('Only guide source and provider setup links can be opened here.');
  if ([...url.searchParams.keys()].some((key) => key !== 'q')) throw Error('Invalid source link.');
  return url.href;
}
function plain(value) {
  return String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(?:br\s*\/?|\/p|\/div|\/tr|\/h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
      const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const code =
        entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function parseSearch(html) {
  const data = new Map();
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/type=["']application\/json["']/i.test(match[1])) continue;
    const id = match[1].match(/\bid=["']data\.([^"']+)["']/)?.[1];
    if (id) {
      try {
        data.set(id, JSON.parse(match[2]));
      } catch {}
    }
  }
  const entries = new Map();
  let recognized = false;
  for (const match of html.matchAll(/new Listview\(\{([\s\S]*?)\}\);/g)) {
    const type = match[1].match(/template:\s*["']([^"']+)["']/)?.[1];
    const id = match[1].match(/WH\.getPageData\(["']([^"']+)["']\)/)?.[1];
    if (!TYPES.includes(type) || !data.has(id)) continue;
    recognized = true;
    const rows = data.get(id);
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || typeof row.name !== 'string')
        continue;
      const stats = [];
      for (const [field, label] of [
        ['level', type === 'item' ? 'Item level' : 'Level'],
        ['reqlevel', 'Requires level'],
        ['dps', 'DPS'],
        ['speed', 'Speed'],
        ['xp', 'XP'],
      ]) {
        if (typeof row[field] === 'number' && Number.isFinite(row[field]) && row[field] >= 0)
          stats.push(`${label} ${row[field]}`);
      }
      entries.set(`${type}:${row.id}`, {
        type,
        id: row.id,
        name: plain(row.name).slice(0, 180),
        stats,
        url: entryURL(type, row.id),
        rank: Number(row.searchpopularity) || 0,
      });
    }
  }
  if (!recognized && !/No results|No matches|0 results/i.test(html))
    throw Error('Wowhead’s results could not be read. Open the source or try again later.');
  return [...entries.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 60)
    .map(({ rank, ...entry }) => entry);
}
function parseDetail(body, type) {
  if (type === 'item') {
    const name = body.match(/<name><!\[CDATA\[([\s\S]*?)\]\]><\/name>/)?.[1];
    const tooltip = body.match(/<htmlTooltip><!\[CDATA\[([\s\S]*?)\]\]><\/htmlTooltip>/)?.[1];
    if (!name || !tooltip)
      throw Error('Item details are unavailable. Open the source for this entry.');
    return { name: plain(name), text: plain(tooltip).slice(0, 5000) };
  }
  const name = body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const description = body.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1];
  if (!name || !description)
    throw Error('Details are unavailable. Open the source for this entry.');
  // Only the database summary; never execute remote markup or import comments/ads.
  let text = plain(description).slice(0, 2000);
  if (type === 'quest') {
    const questDescription = body.match(/<h2\b[^>]*>Description<\/h2>([\s\S]*?)(?=<h2\b|$)/i)?.[1];
    if (questDescription) text += `\n\nQuest text\n${plain(questDescription).slice(0, 1800)}`;
    // The mapper is a JSON literal, not executable page code. Only expose named
    // quest start/end points with valid game-map coordinates.
    try {
      const mapper = JSON.parse(body.match(/new Mapper\((\{[\s\S]*?\})\);/)?.[1] || '{}');
      const locations = [];
      for (const zone of Object.values(mapper.objectives || {}).slice(0, 10)) {
        if (!zone || typeof zone.zone !== 'string' || !Array.isArray(zone.levels)) continue;
        for (const point of zone.levels.flat(2).slice(0, 100)) {
          if (
            !point ||
            !['start', 'end'].includes(point.point) ||
            typeof point.name !== 'string' ||
            !Array.isArray(point.coord) ||
            point.coord.length !== 2 ||
            !point.coord.every((n) => Number.isFinite(n) && n >= 0 && n <= 100)
          )
            continue;
          locations.push(
            `${point.point === 'start' ? 'Starts' : 'Ends'}: ${plain(point.name).slice(0, 120)} — ${plain(zone.zone).slice(0, 120)} (${point.coord.join(', ')})`,
          );
        }
      }
      if (locations.length)
        text += `\n\nMap points listed by Wowhead\n${locations.slice(0, 10).join('\n')}`;
    } catch {
      /* Optional map metadata can change independently of the summary. */
    }
  }
  return { name: plain(name).slice(0, 180), text };
}
async function readResponse(response, limit = 2_000_000) {
  if (!response.ok) throw Error(`Source unavailable (HTTP ${response.status}). Try again later.`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error('Source response was too large.');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString('utf8');
}
class GameGuide {
  constructor({ fetcher = fetch } = {}) {
    this.fetcher = fetcher;
    this.cache = new Map();
    this.busy = false;
  }
  async load(url, parser) {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.time < 300000) return cached.value;
    if (this.busy) throw Error('A lookup is already running. Please wait.');
    this.busy = true;
    try {
      const signal = AbortSignal.timeout(15000);
      let target = url,
        response;
      for (let redirects = 0; redirects <= 3; redirects++) {
        response = await this.fetcher(target, {
          redirect: 'manual',
          signal,
          headers: {
            Accept: 'text/html, application/xml',
            'User-Agent': 'workwork/0.1 game guide (+https://github.com/its-panzer/workwork)',
          },
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 3) throw Error('Wowhead returned an invalid redirect.');
        const next = new URL(location, target);
        if (
          next.origin !== ORIGIN ||
          next.username ||
          next.password ||
          !next.pathname.startsWith('/forever/')
        )
          throw Error(
            'Wowhead redirected outside the Forever database. Open the source to check its version.',
          );
        target = next.href;
      }
      const value = parser(await readResponse(response));
      if (this.cache.size >= 50) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(url, { time: Date.now(), value });
      return value;
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError')
        throw Error('Wowhead took too long to respond. Try again.');
      if (error instanceof TypeError)
        throw Error('Could not reach Wowhead. Check your connection or open the source.');
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async search(query) {
    query = queryText(query);
    const url = `${ORIGIN}/forever/search?q=${encodeURIComponent(query)}`;
    return {
      query,
      url,
      source: 'Wowhead · Forever',
      retrievedAt: Date.now(),
      entries: await this.load(url, parseSearch),
    };
  }
  async detail(type, id) {
    const url = entryURL(type, id);
    const result = await this.load(type === 'item' ? `${url}&xml` : url, (body) =>
      parseDetail(body, type),
    );
    return { ...result, type, id, url, source: 'Wowhead · Forever', retrievedAt: Date.now() };
  }
}
module.exports = {
  GameGuide,
  queryText,
  entryURL,
  sourceURL,
  plain,
  parseSearch,
  parseDetail,
  readResponse,
};
