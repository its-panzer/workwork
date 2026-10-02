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
    node('h2', '', 'What’s your next quest?'),
    node('p', 'guide-intro', 'Quest help, farming spots, and gear advice for WoW Forever.'),
  );
  const tabs = node('div', 'guide-tabs');
  tabs.setAttribute('aria-label', 'Guide mode');
  const lookup = node('section', 'guide-lookup');
  const character = node('section', 'guide-character');
  const chat = node('section', 'guide-chat');
  const views = [chat, lookup, character];
  const modeButtons = ['Chat', 'Lookup', 'Character'].map((label, index) =>
    button(label, () => showView(views[index])),
  );
  function showView(view) {
    views.forEach((section, index) => {
      section.hidden = section !== view;
      modeButtons[index].setAttribute('aria-pressed', String(section === view));
    });
    if (view === character) refreshCharacter();
  }
  showView(chat);
  tabs.append(...modeButtons);
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
    const detail = response.value;
    selected = detail;
    selectedView.append(
      node('div', 'eyebrow', `${entry.type.toUpperCase()} · FOREVER`),
      node('h3', '', selected.name),
      node('p', 'guide-entry-text', selected.text),
      sourceLink('Open full entry on Wowhead ↗', selected.url),
      button('Ask about this', () => {
        selected = detail;
        showView(chat);
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
  let configured = false,
    answering = false,
    settingsBusy = false,
    signingIn = false;
  let configuration = {};
  const connection = node('div', 'guide-connection');
  const connectionCopy = node('div');
  const connectionTitle = node('strong', '', 'Use your ChatGPT plan');
  const connectionNote = node(
    'p',
    '',
    'Connect an eligible Plus or Pro account to start chatting.',
  );
  connectionCopy.append(connectionTitle, connectionNote);
  const signIn = button('Continue with ChatGPT', () => connect(), 'chatgpt-sign-in');
  const logo = node('img');
  logo.src = 'assets/chatgpt-logo-white.svg';
  logo.alt = '';
  signIn.prepend(logo);
  const cancelSignIn = button(
    'Cancel sign-in',
    () => runAction(() => api.guideChatGPTCancel()),
    'text-button',
  );
  cancelSignIn.hidden = true;
  const retrySignIn = button('Retry sign-in', () => connect('retry'), 'text-button');
  retrySignIn.hidden = true;
  connection.append(connectionCopy, signIn, cancelSignIn, retrySignIn);

  const options = node('details', 'guide-setup');
  options.append(node('summary', '', 'Account & API options'));
  const accounts = node('div', 'guide-accounts');
  const accountLabel = node('label', 'guide-field');
  accountLabel.append(node('span', '', 'ChatGPT account'));
  const account = node('select');
  accountLabel.append(account);
  account.addEventListener('change', () =>
    runAction(() => api.guideChatGPTAccount(account.value), true),
  );
  const addAccount = button('Add account', () => connect('add'), 'text-button');
  const signOut = button(
    'Sign out',
    () => runAction(() => api.guideChatGPTSignOut(), true),
    'text-button',
  );
  const usePlan = button('Use ChatGPT plan', () =>
    runAction(() => api.guideBilling('chatgpt'), true),
  );
  accounts.append(accountLabel, addAccount, signOut, usePlan);
  options.append(accounts);

  const setup = node('details', 'guide-api-setup');
  setup.append(node('summary', '', 'Use an API key instead'));
  setup.append(
    node(
      'p',
      '',
      'OpenAI and Anthropic API usage is billed separately from your chat subscription.',
    ),
  );
  const keyLinks = node('div', 'guide-key-links');
  keyLinks.append(
    sourceLink('OpenAI API keys ↗', 'https://platform.openai.com/api-keys'),
    sourceLink('Anthropic API keys ↗', 'https://console.anthropic.com/settings/keys'),
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
  const save = node('button', 'primary', 'Save API setup');
  save.type = 'submit';
  const useAPI = button('Use saved API setup', () =>
    runAction(() => api.guideBilling('api'), true),
  );
  const remove = button(
    'Remove saved key',
    () => runAction(() => api.guideClear(true), true),
    'text-button',
  );
  setupForm.append(providerLabel, model.wrap, key.wrap, save, useAPI, remove);
  setup.append(setupForm);
  options.append(
    setup,
    node(
      'p',
      'guide-note',
      'Credentials are encrypted on this computer. Switching accounts starts a new conversation.',
    ),
  );

  const planDialog = node('dialog', 'guide-plan-dialog');
  planDialog.setAttribute('aria-labelledby', 'guide-plan-title');
  const planTitle = node('h3', '', 'You’re using your ChatGPT plan');
  planTitle.id = 'guide-plan-title';
  const acknowledge = button(
    'Got it',
    async () => {
      if (await runAction(() => api.guideChatGPTAcknowledge())) planDialog.close();
    },
    'primary',
  );
  planDialog.append(
    planTitle,
    node(
      'p',
      '',
      'Eligible AI requests in WorkWork use your ChatGPT plan and count toward its limits. You can manage usage in ChatGPT settings.',
    ),
    acknowledge,
  );
  const reviewPlan = button('Review plan usage', () => planDialog.showModal());
  reviewPlan.hidden = true;
  connection.append(reviewPlan);

  const context = node('div', 'guide-context');
  function updateContext() {
    context.hidden = !selected;
    context.replaceChildren();
    if (selected)
      context.append(
        node('span', '', 'Discussing: ' + selected.name),
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
  transcript.setAttribute('aria-live', 'polite');
  const empty = node('div', 'guide-chat-empty');
  empty.append(node('p', '', 'Tell me what you’re working on.'));
  const starters = node('div', 'guide-starters');
  for (const [label, draft] of [
    ['How do I complete this quest?', 'How do I complete [quest name]?'],
    ['Where should I farm?', 'Where is the best place to farm [item or material]?'],
    ['Which item should I use?', 'Which is better for my build: [first item] or [second item]?'],
  ])
    starters.append(
      button(
        label,
        () => {
          question.field.value = draft;
          const start = draft.indexOf('[');
          question.field.focus();
          question.field.setSelectionRange(start, draft.indexOf(']') + 1);
        },
        'guide-starter',
      ),
    );
  empty.append(starters);
  const askForm = node('form', 'guide-ask');
  const question = { wrap: node('label', 'guide-field'), field: node('textarea') };
  question.wrap.append(node('span', 'guide-composer-label', 'Ask the guide'), question.field);
  question.field.rows = 3;
  question.field.maxLength = 2000;
  question.field.placeholder = 'Name a quest, item, or farming goal…';
  question.field.required = true;
  const ask = node('button', 'primary', 'Send');
  ask.type = 'submit';
  question.field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      askForm.requestSubmit();
    }
  });
  const usage = node('div', 'guide-usage');
  const usageLabel = node('span');
  const manageUsage = button('Manage usage ↗', () => openUsage(), 'text-button');
  async function openUsage() {
    const response = await api
      .guideChatGPTUsage()
      .catch(() => ({ ok: false, error: 'Could not open ChatGPT usage settings.' }));
    if (!response.ok) message(response.error);
  }
  usage.append(usageLabel, manageUsage);
  const clear = button(
    'New conversation',
    async () => {
      if (await runAction(() => api.guideClear(false), true)) question.field.value = '';
    },
    'text-button',
  );
  const footer = node('div', 'guide-chat-footer');
  footer.append(node('span', '', 'Enter to send · Shift+Enter for a new line'), clear);
  const characterOption = node('label', 'guide-character-option');
  const includeCharacter = node('input');
  includeCharacter.type = 'checkbox';
  characterOption.append(includeCharacter, node('span', '', 'Include saved character context'));
  const characterNote = node(
    'p',
    'guide-character-note',
    'Shares the latest saved level, gear, stats and location with your selected provider. Saved on /reload or logout; quest progress is not included.',
  );
  const privacy = node(
    'p',
    'guide-note guide-chat-privacy',
    'Questions, recent guide messages and selected entries go to your selected provider. Character context is optional; character names, realm, money and coding tasks are excluded.',
  );

  function resetTranscript() {
    transcript.replaceChildren();
    empty.hidden = false;
    selected = null;
    updateContext();
  }
  function updateDisabled() {
    const busy = answering || settingsBusy || signingIn;
    for (const control of [
      signIn,
      retrySignIn,
      addAccount,
      signOut,
      account,
      usePlan,
      useAPI,
      save,
      remove,
      clear,
      acknowledge,
      includeCharacter,
    ])
      control.disabled = busy;
    ask.disabled = busy || !configured;
    question.field.disabled = answering;
    for (const starter of starters.children) starter.disabled = answering;
    ask.textContent = answering ? 'Thinking…' : 'Send';
    cancelSignIn.hidden = !signingIn;
  }
  function updateConfiguration(config) {
    configuration = config;
    configured = config.configured;
    const auth = config.chatgpt || {};
    const apiConfig = config.api || (config.provider !== 'chatgpt' ? config : {});
    provider.value = apiConfig.provider || 'openai';
    model.field.value = apiConfig.model || '';
    const usingPlan = config.provider === 'chatgpt';
    if (configured) options.insertBefore(connection, accounts);
    else chat.prepend(connection);
    connectionTitle.textContent = auth.connected ? 'ChatGPT connected' : 'Use your ChatGPT plan';
    connectionNote.textContent =
      auth.error ||
      (auth.connected
        ? (auth.email || 'Your account') +
          (auth.planEnabled ? ' · Plan usage enabled' : ' · Plan usage not enabled')
        : 'Connect an eligible Plus or Pro account to start chatting.');
    signIn.hidden = Boolean(auth.connected && auth.planEnabled);
    retrySignIn.hidden = !auth.registrationPending;
    reviewPlan.hidden = !auth.connected || !auth.planEnabled || auth.usageAcknowledged;
    accounts.hidden = !auth.accounts?.length;
    account.replaceChildren(
      ...(auth.accounts || []).map((saved) => {
        const option = node('option', '', saved.label || saved.email || 'ChatGPT account');
        option.value = saved.id;
        return option;
      }),
    );
    account.value = auth.accountId || '';
    signOut.hidden = !auth.connected;
    usePlan.hidden = usingPlan || !auth.connected;
    useAPI.hidden = !apiConfig.configured || !usingPlan;
    remove.hidden = !apiConfig.configured;
    usageLabel.textContent = usingPlan
      ? configured
        ? 'Using ChatGPT plan'
        : auth.connected
          ? 'ChatGPT plan setup'
          : 'Sign in to send a question'
      : (config.provider === 'anthropic' ? 'Anthropic' : 'OpenAI') + ' API · Billed separately';
    manageUsage.hidden = !usingPlan || !auth.connected;
    updateDisabled();
    showPlanDisclosure();
    if (auth.revocationUnconfirmed)
      message(
        'Signed out locally. To finish disconnecting, remove WorkWork in ChatGPT’s Security and login settings.',
      );
  }
  function showPlanDisclosure() {
    if (!reviewPlan.hidden && planDialog.isConnected && !planDialog.open) planDialog.showModal();
  }
  async function runAction(action, reset = false) {
    settingsBusy = true;
    updateDisabled();
    let response;
    try {
      response = await action();
    } catch {
      response = { ok: false, error: 'Could not update the guide connection. Try again.' };
    }
    settingsBusy = false;
    if (response.ok) {
      if (reset) resetTranscript();
      message('');
      updateConfiguration(response.value);
    } else {
      message(response.error);
      const status = await api.guideStatus().catch(() => null);
      if (status?.ok) updateConfiguration(status.value);
    }
    updateDisabled();
    return response.ok;
  }
  async function connect(action) {
    signingIn = true;
    updateDisabled();
    message('Finish signing in with ChatGPT in your browser. Your draft will stay here.');
    await runAction(
      () =>
        api.guideChatGPTSignIn(action || (configuration.chatgpt?.connected ? 'enable' : undefined)),
      true,
    );
    signingIn = false;
    updateDisabled();
  }
  setupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const next = {
      provider: provider.value,
      model: model.field.value.trim(),
      key: key.field.value.trim(),
    };
    key.field.value = '';
    if (await runAction(() => api.guideConfigure(next), true)) {
      setup.open = false;
      options.open = false;
    }
  });
  askForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!configured || answering || settingsBusy || signingIn) return;
    const prompt = question.field.value.trim();
    if (!prompt) return;
    answering = true;
    updateDisabled();
    empty.hidden = true;
    const turn = node('article', 'guide-turn');
    const userMessage = () => node('h3', 'guide-question', prompt);
    turn.append(
      node('span', 'eyebrow', 'YOU'),
      userMessage(),
      node('p', 'guide-answer-pending', 'Thinking…'),
    );
    transcript.append(turn);
    transcript.scrollTop = transcript.scrollHeight;
    const response = await api
      .guideAsk(prompt, selected, includeCharacter.checked)
      .catch(() => ({ ok: false, error: 'Could not get an answer. Try again.' }));
    turn.replaceChildren(node('span', 'eyebrow', 'YOU'), userMessage());
    if (response.ok) {
      question.field.value = '';
      turn.append(
        node('span', 'eyebrow guide-speaker', 'GUIDE'),
        node('p', 'guide-answer', response.value.answer),
      );
      const sources = node('div', 'guide-citations');
      response.value.sources.forEach((source, index) =>
        sources.append(
          sourceLink('[' + (source.citation ?? index + 1) + '] ' + source.name, source.url),
        ),
      );
      turn.append(sources);
      message('');
    } else {
      turn.append(node('p', 'guide-answer-error', response.error));
      if (response.code === 'usage_limit')
        turn.append(button('Manage usage', () => openUsage(), 'primary'));
      if (response.code === 'reconnect')
        turn.append(button('Continue with ChatGPT', () => connect()));
      message('Your question is ready to retry.');
    }
    answering = false;
    updateDisabled();
    while (transcript.children.length > 10) transcript.firstElementChild.remove();
    transcript.scrollTop = transcript.scrollHeight;
    const status = await api.guideStatus().catch(() => null);
    if (status?.ok) updateConfiguration(status.value);
    question.field.focus();
  });
  askForm.append(question.wrap, ask);
  chat.append(
    connection,
    context,
    empty,
    transcript,
    askForm,
    characterOption,
    characterNote,
    usage,
    footer,
    options,
    privacy,
  );
  root.append(planDialog);
  updateContext();
  updateDisabled();
  api
    .guideStatus()
    .then((response) => {
      if (response.ok) updateConfiguration(response.value);
      else message(response.error);
    })
    .catch(() => message('Guide setup is unavailable.'));
  return {
    mount(container) {
      container.replaceChildren(root);
      showPlanDisclosure();
    },
  };
};
