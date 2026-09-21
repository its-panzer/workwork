const test = require('node:test');
const assert = require('node:assert/strict');
const { GameGuide, parseSearch, parseDetail, sourceURL, plain } = require('../src/game-guide.cjs');
const searchPage = (rows = [{ id: 42, name: 'A &amp; B', level: 7, reqlevel: 4 }]) =>
  `<script type="application/json" id="data.sample">${JSON.stringify(rows)}</script><script>new Listview({template: "quest", data: WH.getPageData("sample"),});</script>`;
test('search reads JSON without executing scripts and constructs Forever links', () => {
  const [entry] = parseSearch(searchPage() + '<script>throw Error("never execute");</script>');
  assert.equal(entry.name, 'A & B');
  assert.deepEqual(entry.stats, ['Level 7', 'Requires level 4']);
  assert.equal(entry.url, 'https://www.wowhead.com/forever/quest=42');
  assert.deepEqual(parseSearch(searchPage([{ id: '../x', name: 'bad' }, null])), []);
  assert.throws(() => parseSearch('<html>Blocked</html>'), /could not be read/);
  assert.deepEqual(parseSearch(searchPage([])), []);
});
test('remote markup becomes text; invalid and missing detail fails explicitly', () => {
  assert.equal(plain('<script>alert(1)</script><b>A &amp; B</b><br>Hi &#x1f600;'), 'A & B\nHi 😀');
  const item = parseDetail(
    '<name><![CDATA[Blade]]></name><htmlTooltip><![CDATA[<b>Blade</b><br>+5 Agility]]></htmlTooltip>',
    'item',
  );
  assert.equal(item.text, 'Blade\n+5 Agility');
  assert.throws(
    () => parseDetail('<wowhead><error>Item not found!</error></wowhead>', 'item'),
    /unavailable/,
  );
  assert.equal(
    parseDetail('<meta name="description" content="Collect 6 branches."><h1>Sticks</h1>', 'quest')
      .text,
    'Collect 6 branches.',
  );
});
test('external source links exclude arbitrary hosts, schemes, credentials and versions', () => {
  assert.equal(
    sourceURL('https://www.wowhead.com/forever/item=42'),
    'https://www.wowhead.com/forever/item=42',
  );
  for (const url of [
    'file:///tmp/foo',
    'https://evil.test/forever/item=42',
    'https://www.wowhead.com/classic/item=42',
    'https://user@www.wowhead.com/forever/item=42',
    'https://www.wowhead.com/forever/search?redirect=evil',
  ])
    assert.throws(() => sourceURL(url));
});
test('lookup validates requests, bounds responses, caches and follows only Forever redirects', async () => {
  const calls = [];
  const guide = new GameGuide({
    fetcher: async (url) => {
      calls.push(url);
      return new Response(searchPage());
    },
  });
  await assert.rejects(guide.search(''), /Enter a name/);
  await assert.rejects(guide.detail('invalid', 3), /valid game/);
  const result = await guide.search('a&b');
  await guide.search('a&b');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /a%26b$/);
  assert.equal(result.entries[0].id, 42);
  const huge = new GameGuide({ fetcher: async () => new Response('x'.repeat(2_000_001)) });
  await assert.rejects(huge.search('a'), /too large/);
  const blocked = new GameGuide({ fetcher: async () => new Response('', { status: 403 }) });
  await assert.rejects(blocked.search('a'), /HTTP 403/);
  const redirected = new GameGuide({
    fetcher: async () =>
      new Response('', { status: 301, headers: { location: 'https://evil.test/' } }),
  });
  await assert.rejects(redirected.search('a'), /outside the Forever/);
  const requests = [];
  const detail = new GameGuide({
    fetcher: async (url) => {
      requests.push(url);
      return requests.length === 1
        ? new Response('', { status: 301, headers: { location: '/forever/quest=42/branches' } })
        : new Response('<meta name="description" content="Branches"><h1>Branches</h1>');
    },
  });
  assert.equal((await detail.detail('quest', 42)).name, 'Branches');
  assert.equal(requests[1], 'https://www.wowhead.com/forever/quest=42/branches');
});
test('concurrent requests fail clearly instead of creating unbounded work', async () => {
  let finish;
  const guide = new GameGuide({
    fetcher: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = guide.search('one');
  await assert.rejects(guide.search('two'), /already running/);
  finish(new Response(searchPage()));
  await pending;
  assert.equal(guide.busy, false);
});

test('quest map metadata is parsed as JSON and only valid start/end coordinates are exposed', () => {
  const body =
    '<meta name="description" content="Collect branches."><h1>Branches</h1><h2>Description</h2>Bring wood.<h2>Rewards</h2>' +
    'new Mapper(' +
    JSON.stringify({
      objectives: {
        1: {
          zone: 'Forest',
          levels: [
            [
              { point: 'end', name: 'Keeper', coord: [52, 44] },
              { point: 'start', name: 'Invalid', coord: [1000, 3] },
            ],
          ],
        },
      },
    }) +
    ');';
  const entry = parseDetail(body, 'quest');
  assert.match(entry.text, /Bring wood/);
  assert.match(entry.text, /Ends: Keeper — Forest \(52, 44\)/);
  assert.doesNotMatch(entry.text, /Invalid/);
});
