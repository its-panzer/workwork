// This view owns its DOM so activity snapshots never erase a search or draft.
window.createGameGuide = function (api) {
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (text, handler, className = 'secondary') => {
    const b = node('button', className, text);
    b.type = 'button';
    b.addEventListener('click', handler);
    return b;
  };
  const input = (label, type = 'text', maxLength = 240) => {
    const wrap = node('label', 'guide-field');
    const field = node('input');
    field.type = type;
    field.maxLength = maxLength;
    wrap.append(node('span', '', label), field);
    return { wrap, field };
  };
  const root = node('div', 'game-guide');
  root.append(
    node('div', 'eyebrow', 'WORKWORK · GAME GUIDE'),
    node('h2', '', 'Know your next move.'),
    node('p', 'guide-intro', 'Quests, gear, spells and creatures from Wowhead’s Forever database.'),
  );
  const tabs = node('div', 'guide-tabs');
  tabs.setAttribute('aria-label', 'Guide mode');
  const lookup = node('section', 'guide-lookup');
  const chat = node('section', 'guide-chat');
  chat.hidden = true;
  const searchTab = button('Lookup', () => mode(false));
  const chatTab = button('Conversation', () => mode(true));
  function mode(conversation) {
    lookup.hidden = conversation;
    chat.hidden = !conversation;
    searchTab.setAttribute('aria-pressed', String(!conversation));
    chatTab.setAttribute('aria-pressed', String(conversation));
  }
  mode(false);
  tabs.append(searchTab, chatTab);
  root.append(tabs, lookup, chat);
  const status = node('p', 'guide-status');
  status.setAttribute('role', 'status');
  root.insertBefore(status, lookup);
  const message = (value) => {
    status.textContent = value;
  };
  const openSource = (url) =>
    api
      .guideOpen(url)
      .then((result) => {
        if (!result.ok) message(result.error);
      })
      .catch(() => message('Could not open the source.'));
  const sourceLink = (label, url) => button(label, () => openSource(url), 'guide-source');
  const searchForm = node('form', 'guide-search');
  const query = input('Search Forever');
  query.field.placeholder = 'Quest, item, NPC or spell name';
  query.field.required = true;
  const searchButton = node('button', 'primary', 'Search');
  searchButton.type = 'submit';
  searchForm.append(query.wrap, searchButton);
  lookup.append(searchForm);
  const examples = node('div', 'guide-examples');
  for (const example of ['Sticks and Bones', 'Thunderfury', 'Sewer Beast'])
    examples.append(
      button(
        example,
        () => {
          query.field.value = example;
          searchForm.requestSubmit();
        },
        'text-button',
      ),
    );
  lookup.append(examples);
  const results = node('div', 'guide-results');
  const selectedView = node('div', 'guide-entry');
  lookup.append(results, selectedView);
  let selected = null,
    searching = false,
    generation = 0;
  async function select(entry) {
    const ticket = ++generation;
    selected = null;
    selectedView.replaceChildren(node('p', '', 'Reading the database entry…'));
    const response = await api
      .guideDetail(entry.type, entry.id)
      .catch(() => ({ ok: false, error: 'Could not load this entry.' }));
    if (ticket !== generation) return;
    selectedView.replaceChildren();
    if (!response.ok) {
      selectedView.append(
        node('p', '', response.error),
        sourceLink('Open on Wowhead ↗', entry.url),
      );
      return;
    }
    selected = response.value;
    selectedView.append(
      node('div', 'eyebrow', `${entry.type.toUpperCase()} · FOREVER`),
      node('h3', '', selected.name),
      node('p', 'guide-entry-text', selected.text),
      sourceLink('Open full entry on Wowhead ↗', selected.url),
      button('Ask about this', () => {
        mode(true);
        updateContext();
        question.field.focus();
      }),
    );
    updateContext();
    selectedView.scrollIntoView({ block: 'nearest' });
  }
  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (searching) return;
    searching = true;
    searchButton.disabled = true;
    selected = null;
    generation++;
    selectedView.replaceChildren();
    updateContext();
    results.replaceChildren();
    message('Searching Wowhead Forever…');
    const response = await api
      .guideSearch(query.field.value)
      .catch(() => ({ ok: false, error: 'Could not search. Try again.' }));
    searching = false;
    searchButton.disabled = false;
    if (!response.ok) {
      message(response.error);
      results.append(
        sourceLink(
          'Search on Wowhead ↗',
          `https://www.wowhead.com/forever/search?q=${encodeURIComponent(query.field.value)}`,
        ),
      );
      return;
    }
    const result = response.value;
    message(
      result.entries.length
        ? `${result.entries.length} ${result.entries.length === 1 ? 'result' : 'results'} · Wowhead · Forever`
        : 'No matching entries. Try an exact name or fewer words.',
    );
    for (const entry of result.entries) {
      const row = button('', () => select(entry), 'guide-result');
      row.append(
        node('span', 'eyebrow', entry.type.toUpperCase()),
        node('strong', '', entry.name),
        node('span', 'guide-stats', entry.stats.join(' · ')),
      );
      results.append(row);
    }
    results.append(sourceLink('All results on Wowhead ↗', result.url));
  });
  const setup = node('details', 'guide-setup');
  setup.append(node('summary', '', 'Conversation setup'));
  setup.append(
    node(
      'p',
      '',
      'Use your own API key. Questions, recent guide messages and retrieved game data go to your chosen provider. API usage may be billed separately. Your coding tasks are never included.',
    ),
  );
  const keyLinks = node('div', 'guide-key-links');
  keyLinks.append(
    sourceLink('Get an OpenAI API key ↗', 'https://platform.openai.com/api-keys'),
    sourceLink('Get an Anthropic API key ↗', 'https://console.anthropic.com/settings/keys'),
  );
  setup.append(keyLinks);
  const setupForm = node('form', 'guide-setup-form');
  const providerLabel = node('label', 'guide-field');
  providerLabel.append(node('span', '', 'Provider'));
  const provider = node('select');
  for (const [id, label] of [
    ['openai', 'OpenAI'],
    ['anthropic', 'Anthropic'],
  ]) {
    const option = node('option', '', label);
    option.value = id;
    provider.append(option);
  }
  providerLabel.append(provider);
  const model = input('Model ID', 'text', 100);
  model.field.placeholder = 'A model available to your API account';
  model.field.required = true;
  const key = input('API key', 'password', 512);
  key.field.required = true;
  key.field.autocomplete = 'off';
  key.field.spellcheck = false;
  const save = node('button', 'primary', 'Save setup');
  save.type = 'submit';
  const remove = button(
    'Remove saved key',
    async () => {
      const response = await api.guideClear(true);
      if (!response.ok) {
        message(response.error);
        return;
      }
      transcript.replaceChildren();
      configured = false;
      setup.open = true;
      updateConfiguration(response.value);
      message('Saved key removed.');
    },
    'text-button',
  );
  setupForm.append(providerLabel, model.wrap, key.wrap, save, remove);
  setup.append(
    setupForm,
    node(
      'p',
      'guide-note',
      'The key is encrypted locally using your operating system’s secure storage. Guide conversations stay in memory and clear when workwork quits.',
    ),
  );
  const context = node('div', 'guide-context');
  function updateContext() {
    context.replaceChildren(
      node(
        'span',
        '',
        selected
          ? `Discussing: ${selected.name}`
          : 'The guide searches Forever for each new topic.',
      ),
    );
    if (selected)
      context.append(
        button(
          'Clear entry',
          () => {
            selected = null;
            updateContext();
          },
          'text-button',
        ),
      );
  }
  const transcript = node('div', 'guide-transcript');
  transcript.setAttribute('role', 'log');
  transcript.setAttribute('aria-label', 'Game guide conversation');
  const askForm = node('form', 'guide-ask');
  const question = input('Ask the guide', 'text', 2000);
  question.field.placeholder = 'What stats does this item have?';
  question.field.required = true;
  const ask = node('button', 'primary', 'Ask');
  ask.type = 'submit';
  let configured = false,
    answering = false;
  function updateConfiguration(config) {
    configured = config.configured;
    provider.value = config.provider;
    model.field.value = config.model;
    ask.disabled = !configured;
    remove.hidden = !configured;
    setup.open = !configured;
  }
  setupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    save.disabled = true;
    const response = await api
      .guideConfigure({
        provider: provider.value,
        model: model.field.value.trim(),
        key: key.field.value.trim(),
      })
      .catch(() => ({ ok: false, error: 'Could not save setup.' }));
    key.field.value = '';
    save.disabled = false;
    if (!response.ok) {
      message(response.error);
      return;
    }
    updateConfiguration(response.value);
    transcript.replaceChildren();
    message('Setup saved. Ask a question to use your provider.');
  });
  askForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!configured || answering) return;
    const prompt = question.field.value.trim();
    if (!prompt) return;
    answering = true;
    ask.disabled = true;
    clear.disabled = true;
    save.disabled = true;
    remove.disabled = true;
    question.field.disabled = true;
    const turn = node('article', 'guide-turn');
    turn.append(
      node('h3', '', prompt),
      node('p', '', 'Looking up sources and preparing an answer…'),
    );
    transcript.append(turn);
    turn.scrollIntoView({ block: 'nearest' });
    message('The guide is working…');
    const response = await api
      .guideAsk(prompt, selected ? { type: selected.type, id: selected.id } : null)
      .catch(() => ({ ok: false, error: 'Could not get an answer. Try again.' }));
    turn.replaceChildren(node('h3', '', prompt));
    if (response.ok) {
      question.field.value = '';
      turn.append(node('p', 'guide-answer', response.value.answer));
      const sources = node('div', 'guide-citations');
      response.value.sources.forEach((source, index) =>
        sources.append(sourceLink(`[${source.citation ?? index + 1}] ${source.name}`, source.url)),
      );
      turn.append(
        sources,
        node(
          'small',
          'guide-note',
          `${response.value.provider} · Check cited sources; AI can make mistakes.`,
        ),
      );
      message('');
    } else {
      turn.append(node('p', '', response.error));
      message('Answer unavailable. Your question is ready to retry.');
    }
    answering = false;
    ask.disabled = false;
    clear.disabled = false;
    save.disabled = false;
    remove.disabled = false;
    question.field.disabled = false;
    while (transcript.children.length > 10) transcript.firstElementChild.remove();
  });
  const clear = button(
    'New conversation',
    async () => {
      const response = await api.guideClear(false);
      if (!response.ok) {
        message(response.error);
        return;
      }
      transcript.replaceChildren();
      selected = null;
      updateContext();
      question.field.value = '';
      message('Conversation cleared.');
    },
    'text-button',
  );
  askForm.append(question.wrap, ask);
  chat.append(setup, context, transcript, askForm, clear);
  updateContext();
  root.append(
    node(
      'p',
      'guide-note',
      'Forever database snapshot, not live character data. Beta values may change. Missing entries and detailed quest routes are available at the source.',
    ),
  );
  api
    .guideStatus()
    .then((response) => {
      if (response.ok) updateConfiguration(response.value);
      else message(response.error);
    })
    .catch(() => message('Conversation setup is unavailable.'));
  return {
    mount(container) {
      container.replaceChildren(root);
    },
  };
};
