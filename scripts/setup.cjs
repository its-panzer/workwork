#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { atomicJSON, readJSON, dataRoot } = require('../src/storage.cjs');
const { windowsHook, windowsHookNode } = require('../src/platform.cjs');
const ROOT = path.resolve(__dirname, '..');
const quote = (value) =>
  process.platform === 'win32'
    ? `"${value.replace(/"/g, '')}"`
    : `'${value.replace(/'/g, "'\\''")}'`;

function hookPlan(home = os.homedir(), node = process.execPath, { cursorReview = false } = {}) {
  const command = (file, provider, event) =>
    process.platform === 'win32'
      ? windowsHook(node, path.join(ROOT, 'hooks', file), provider, event)
      : `${quote(node)} ${quote(path.join(ROOT, 'hooks', file))} ${provider} ${event}`;
  const definitions = [
    {
      provider: 'claude',
      file: path.join(home, '.claude', 'settings.json'),
      events: [
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'PostToolUseFailure',
        'PermissionRequest',
        'Elicitation',
        'Notification',
        'Stop',
        'StopFailure',
        'SessionEnd',
      ],
    },
    {
      provider: 'codex',
      file: path.join(home, '.codex', 'hooks.json'),
      events: [
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'PermissionRequest',
        'Stop',
        'Interrupt',
        'SessionEnd',
      ],
    },
    {
      provider: 'cursor',
      file: path.join(home, '.cursor', 'hooks.json'),
      events: [
        'sessionStart',
        'beforeSubmitPrompt',
        'postToolUse',
        'postToolUseFailure',
        'stop',
        'sessionEnd',
        ...(cursorReview ? ['beforeShellExecution', 'beforeMCPExecution'] : []),
      ],
    },
  ];
  return definitions.map((def) => ({
    ...def,
    additions: Object.fromEntries(
      def.events.map((event) => {
        const request = [
          'PermissionRequest',
          'Elicitation',
          'beforeShellExecution',
          'beforeMCPExecution',
        ].includes(event);
        const hook = {
          type: 'command',
          command: command(request ? 'request.cjs' : 'emit.cjs', def.provider, event),
          timeout: request ? 125 : process.platform === 'win32' ? 5 : 2,
        };
        const groups =
          def.provider === 'cursor'
            ? [{ command: hook.command, ...(request ? { timeout: 620, failClosed: true } : {}) }]
            : [{ hooks: [hook] }];
        if (def.provider === 'claude' && event === 'PreToolUse')
          groups.push({
            matcher: 'AskUserQuestion',
            hooks: [
              { type: 'command', command: command('request.cjs', 'claude', event), timeout: 125 },
            ],
          });
        return [event, groups];
      }),
    ),
  }));
}
const OWN_COMMAND_SUFFIXES = hookPlan('', '', { cursorReview: true }).flatMap((plan) =>
  Object.values(plan.additions).flatMap((groups) =>
    groups
      .flatMap((group) => group.hooks || [group])
      .map((hook) => hook.command.slice(quote('').length)),
  ),
);
function isOurs(command) {
  if (typeof command !== 'string') return false;
  if (process.platform === 'win32') {
    return hookPlan('', '', { cursorReview: true }).some((plan) =>
      Object.entries(plan.additions).some(([event, groups]) => {
        const request = [
          'PermissionRequest',
          'Elicitation',
          'beforeShellExecution',
          'beforeMCPExecution',
        ].includes(event);
        const files = request
          ? ['request.cjs']
          : event === 'PreToolUse' && plan.provider === 'claude'
            ? ['emit.cjs', 'request.cjs']
            : ['emit.cjs'];
        return files.some((file) =>
          windowsHookNode(command, path.join(ROOT, 'hooks', file), plan.provider, event),
        );
      }),
    );
  }
  return OWN_COMMAND_SUFFIXES.some((suffix) => {
    if (!command.endsWith(suffix)) return false;
    const quotedNode = command.slice(0, -suffix.length);
    const node =
      process.platform === 'win32'
        ? quotedNode.slice(1, -1)
        : quotedNode.slice(1, -1).replace(/'\\''/g, "'");
    return path.isAbsolute(node) && quote(node) === quotedNode;
  });
}
function mergeHooks(current, plan, install) {
  if (!current || typeof current !== 'object' || Array.isArray(current))
    throw new Error('Config must be an object');
  if (
    current.hooks !== undefined &&
    (!current.hooks || typeof current.hooks !== 'object' || Array.isArray(current.hooks))
  )
    throw new Error('Unexpected hooks configuration; nothing changed');
  const next = structuredClone(current);
  if (!install && next.hooks === undefined) return next;
  next.hooks ||= {};
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups))
      throw new Error(`Unexpected ${event} configuration; nothing changed`);
    next.hooks[event] = groups
      .map((group) => {
        if (isOurs(group?.command)) return null;
        if (Array.isArray(group?.hooks)) {
          const remaining = group.hooks.filter((h) => !isOurs(h.command));
          if (remaining.length === group.hooks.length) return group;
          return remaining.length ? { ...group, hooks: remaining } : null;
        }
        return group;
      })
      .filter(Boolean);
    if (groups.length && !next.hooks[event].length) delete next.hooks[event];
  }
  if (install) {
    for (const [event, additions] of Object.entries(plan.additions))
      next.hooks[event] = [...(next.hooks[event] || []), ...additions];
    if (plan.provider === 'cursor') next.version ??= 1;
  }
  return next;
}
function configSnapshot(file) {
  let info;
  try {
    info = fs.lstatSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (info) {
    let target;
    try {
      target = fs.realpathSync(file);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Settings path has a dangling symlink: ${file}`);
      throw error;
    }
    if (!fs.statSync(target).isFile()) throw new Error(`Settings path is not a file: ${file}`);
    return { target, source: fs.readFileSync(target, 'utf8') };
  }
  // Resolve existing parents too, so directory symlinks remain intact and dangling
  // parents are rejected before any of the selected settings files are changed.
  let parent = path.dirname(file);
  while (true) {
    try {
      fs.lstatSync(parent);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const next = path.dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
  let resolved;
  try {
    resolved = fs.realpathSync(parent);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Settings path has a dangling symlink: ${file}`);
    throw error;
  }
  return { target: path.join(resolved, path.relative(parent, file)), source: null };
}
function assertUnchanged(plan) {
  const latest = configSnapshot(plan.file);
  if (latest.target !== plan.target || latest.source !== plan.source)
    throw new Error(`${plan.provider} settings changed during setup. Try connecting again.`);
}
function configure({
  install = false,
  remove = false,
  home = os.homedir(),
  node = process.execPath,
  provider,
  cursorReview = false,
} = {}) {
  if (provider && !['claude', 'codex', 'cursor'].includes(provider))
    throw new Error('Unknown provider');
  const plans = hookPlan(home, node, { cursorReview })
    .filter((plan) => !provider || plan.provider === provider)
    .map((plan) => {
      const { target, source } = configSnapshot(plan.file);
      const current = source === null ? {} : JSON.parse(source);
      return { ...plan, target, source, current, next: mergeHooks(current, plan, !remove) };
    });
  // Parse every source before touching any file. Preserve a byte-for-byte backup.
  const results = [];
  for (const plan of plans) {
    if (!install && !remove) {
      results.push({
        provider: plan.provider,
        file: plan.file,
        events: plan.events,
        action: 'preview',
      });
      continue;
    }
    if (JSON.stringify(plan.current) === JSON.stringify(plan.next)) {
      results.push({
        provider: plan.provider,
        file: plan.file,
        backup: null,
        action: remove ? 'removed' : 'installed',
      });
      continue;
    }
    assertUnchanged(plan);
    const backup =
      plan.source !== null
        ? `${plan.file}.workwork-${Date.now()}-${require('node:crypto').randomUUID()}.bak`
        : null;
    if (backup) {
      fs.copyFileSync(plan.target, backup);
      fs.chmodSync(backup, 0o600);
    }
    atomicJSON(plan.target, plan.next, { beforeCommit: () => assertUnchanged(plan) });
    results.push({
      provider: plan.provider,
      file: plan.file,
      backup,
      action: remove ? 'removed' : 'installed',
    });
  }
  return results;
}
if (require.main === module) {
  try {
    const install = process.argv.includes('--install'),
      remove = process.argv.includes('--remove');
    if (install && remove) throw new Error('Choose --install or --remove');
    const provider = process.argv.find((arg) => arg.startsWith('--provider='))?.split('=')[1];
    const node = fs.realpathSync(process.execPath);
    const cursorReview =
      readJSON(path.join(dataRoot(), 'controls.json'), {})?.cursorReview === true;
    for (const result of configure({ install, remove, provider, node, cursorReview }))
      console.log(
        `${result.provider}: ${result.action} — ${result.file}${result.backup ? ` (backup: ${result.backup})` : ''}`,
      );
    if (install)
      console.log(
        'Codex: Settings → Hooks → Reload hooks, then trust workwork (CLI: /hooks). Claude Code and Cursor reload hooks automatically; continue a task to verify activity.',
      );
    if (!install && !remove)
      console.log(
        'Preview only. Use --install to connect, or --remove to remove only workwork hooks.',
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { hookPlan, mergeHooks, configure, isOurs };
