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
    node('p', 'guide-intro', 'Forever game sources and your saved character equipment and stats.'),
  );
  const tabs = node('div', 'guide-tabs');
  tabs.setAttribute('aria-label', 'Guide mode');
  const lookup = node('section', 'guide-lookup');
  const character = node('section', 'guide-character');
  character.hidden = true;
  const chat = node('section', 'guide-chat');
  chat.hidden = true;
  const searchTab = button('Lookup', () => mode(false));
  const characterTab = button('Character', () => showCharacter());
  const chatTab = button('Conversation', () => mode(true));
  function mode(conversation) {
    lookup.hidden = conversation;
    character.hidden = true;
    chat.hidden = !conversation;
    searchTab.setAttribute('aria-pressed', String(!conversation));
    characterTab.setAttribute('aria-pressed', 'false');
    chatTab.setAttribute('aria-pressed', String(conversation));
  }
  function showCharacter() {
    lookup.hidden = true;
    character.hidden = false;
    chat.hidden = true;
    searchTab.setAttribute('aria-pressed', 'false');
    characterTab.setAttribute('aria-pressed', 'true');
    chatTab.setAttribute('aria-pressed', 'false');
    refreshCharacter();
  }
  mode(false);
  tabs.append(searchTab, characterTab, chatTab);
  root.append(tabs, lookup, character, chat);
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
  const characterDetails = node('div', 'guide-character-details');
  const characterActions = node('div', 'guide-character-actions');
  const installCharacter = button('Install Forever addon', async () => {
    installCharacter.disabled = true;
    const response = await api.guideInstallCharacterAddon().catch(() => ({
      ok: false,
      error: 'Could not install the addon.',
    }));
    installCharacter.disabled = false;
    message(
      response.ok
        ? 'Addon installed. Restart Forever, then type /workwork and /reload in game.'
        : response.error,
    );
  });
  const refreshCharacterButton = button('Refresh snapshot', () => refreshCharacter());
  const prepareForGaming = button('Prepare for Gaming bot', async () => {
    prepareForGaming.disabled = true;
    const response = await api.guideExportCharacter().catch(() => ({
      ok: false,
      error: 'Could not prepare the character snapshot.',
    }));
    prepareForGaming.disabled = false;
    message(
      response.ok
        ? 'Local snapshot prepared. A message for Gaming is on your clipboard; paste it into that bot.'
        : response.error,
    );
  });
  prepareForGaming.disabled = true;
  characterActions.append(installCharacter, refreshCharacterButton, prepareForGaming);
  character.append(
    node('h3', '', 'Your Forever character'),
    node(
      'p',
      'guide-note',
      'The addon reads your own character through WoW’s addon API. The game saves the snapshot on /reload or logout.',
    ),
    characterActions,
    characterDetails,
  );
  const slotNames = [
    '',
    'Head',
    'Neck',
    'Shoulders',
    'Shirt',
    'Chest',
    'Waist',
    'Legs',
    'Feet',
    'Wrist',
    'Hands',
    'Ring 1',
    'Ring 2',
    'Trinket 1',
    'Trinket 2',
    'Back',
    'Main hand',
    'Off hand',
    'Ranged',
    'Tabard',
  ];
  async function refreshCharacter() {
    characterDetails.replaceChildren(node('p', '', 'Reading the saved character snapshot…'));
    const response = await api.guideCharacter().catch(() => ({
      ok: false,
      error: 'Could not read the character snapshot.',
    }));
    characterDetails.replaceChildren();
    if (!response.ok) {
      prepareForGaming.disabled = true;
      characterDetails.append(node('p', '', response.error));
      return;
    }
    const data = response.value;
    prepareForGaming.disabled = !data;
    if (!data) {
      characterDetails.append(
        node(
          'p',
          '',
          'No snapshot yet. Install the addon, restart Forever, type /workwork and /reload, then refresh here.',
        ),
      );
      return;
    }
    characterDetails.append(
      node(
        'p',
        'guide-character-name',
        `${data.name} · ${data.realm} · Level ${data.level} ${data.class}`,
      ),
      node(
        'p',
        'guide-note',
        `Saved ${new Date(data.savedAt).toLocaleString()} · ${data.zone} · ${(data.moneyCopper / 10000).toFixed(2)} gold · Client ${data.clientVersion}. This is a saved snapshot, not live combat data.`,
      ),
    );
    const stats = node('dl', 'guide-character-stats');
    for (const [label, value] of Object.entries(data.stats)) {
      const pair = node('div', 'guide-character-stat');
      pair.append(
        node('dt', '', label.replace(/([A-Z])/g, ' $1')),
        node('dd', '', String(value.effective)),
      );
      stats.append(pair);
    }
    characterDetails.append(stats);
    const equipment = node('ul', 'guide-character-equipment');
    for (const item of data.equipment) {
      const statLine = Object.entries(item.stats)
        .filter(([key]) => !/^(?:ITEM_MOD_)?RESISTANCE\d+_NAME$/.test(key))
        .map(
          ([key, value]) =>
            `${key.replace(/^ITEM_MOD_|_SHORT$/g, '').replaceAll('_', ' ')} ${Number.isInteger(value) ? value : value.toFixed(2)}`,
        )
        .join(' · ');
      const entry = node('li');
      entry.append(
        node('strong', '', `${slotNames[item.slot] || `Slot ${item.slot}`}: `),
        node('span', '', item.name),
      );
      if (statLine) entry.append(node('small', '', statLine));
      equipment.append(entry);
    }
    characterDetails.append(node('h4', '', 'Equipped armor and items'), equipment);
  }
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
      'Lookup and Conversation use a Forever database snapshot. Character uses the last saved in-game addon snapshot. Beta values may change.',
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
