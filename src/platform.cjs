const path = require('node:path');

const POWERSHELL_PREFIX = 'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ';
const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;
function windowsHook(node, script, provider, event) {
  if (
    ![node, script, provider, event].every(
      (value) => typeof value === 'string' && !/[\0\r\n]/.test(value),
    )
  )
    throw Error('Invalid hook command arguments.');
  // Only the base64 payload reaches the agent's shell. Windows paths can contain
  // spaces, $, &, %, apostrophes and backticks without becoming shell syntax.
  const payload = `$OutputEncoding = [Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $hookInput = [Console]::In.ReadToEnd(); $hookInput | & ${[node, script, provider, event].map(psQuote).join(' ')}; exit $LASTEXITCODE`;
  return POWERSHELL_PREFIX + Buffer.from(payload, 'utf16le').toString('base64');
}
function windowsHookNode(command, script, provider, event) {
  if (typeof command !== 'string' || !command.startsWith(POWERSHELL_PREFIX)) return null;
  const encoded = command.slice(POWERSHELL_PREFIX.length);
  if (encoded.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const payload = Buffer.from(encoded, 'base64').toString('utf16le');
  const node = payload.match(/\$hookInput \| & '((?:[^']|'')*)' /)?.[1]?.replace(/''/g, "'");
  return node &&
    path.win32.isAbsolute(node) &&
    windowsHook(node, script, provider, event) === command
    ? node
    : null;
}
function nodeCandidates({
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  electron = Boolean(process.versions.electron),
} = {}) {
  const candidates = [env.WORKWORK_NODE, !electron && execPath];
  if (platform === 'win32') {
    for (const directory of [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']])
      if (directory) candidates.push(path.win32.join(directory, 'nodejs', 'node.exe'));
    if (env.LOCALAPPDATA)
      candidates.push(path.win32.join(env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe'));
  } else candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node');
  return [...new Set(candidates.filter(Boolean))];
}
function windowsAppPaths(provider, env = process.env) {
  const product = { cursor: 'Cursor', codex: 'Codex' }[provider];
  if (!product) return [];
  const paths = [];
  if (env.LOCALAPPDATA)
    paths.push(path.win32.join(env.LOCALAPPDATA, 'Programs', product, `${product}.exe`));
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)']])
    if (base) paths.push(path.win32.join(base, product, `${product}.exe`));
  return paths;
}
module.exports = { windowsHook, windowsHookNode, nodeCandidates, windowsAppPaths };
