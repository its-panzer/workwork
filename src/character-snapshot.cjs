const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicJSON } = require('./storage.cjs');

const FILE = 'WorkworkCharacter.lua';
const ADDON_FILES = ['WorkworkCharacter.toc', FILE];
const MAX_BYTES = 256000;

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw Error('The character snapshot has invalid text encoding.');
  }
}

function text(value, max = 500) {
  const decoded = decode(value || '');
  if (decoded.length > max || /[\u0000-\u001f]/.test(decoded))
    throw Error('The character snapshot has invalid text.');
  return decoded;
}

function number(value, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > 1e12)
    throw Error('The character snapshot has an invalid number.');
  return parsed;
}

function parseSnapshot(source) {
  if (Buffer.byteLength(source) > MAX_BYTES) throw Error('The character snapshot is too large.');
  const match = source.match(/^WorkworkCharacterSnapshot\s*=\s*"([A-Za-z0-9_.~%|;=,-]*)"\s*$/m);
  if (!match) throw Error('No Workwork Character snapshot was found in the saved file.');
  const records = match[1].split(';');
  if (records.shift() !== 'WW1') throw Error('Unsupported character snapshot version.');
  const result = { source: 'WoW Forever addon SavedVariables', equipment: [], stats: {} };
  for (const line of records) {
    const fields = line.split('|');
    if (fields[0] === 'character' && fields.length === 11) {
      if (result.name) throw Error('The character snapshot has duplicate identity data.');
      result.name = text(fields[1], 100);
      result.realm = text(fields[2], 100);
      result.level = number(fields[3]);
      result.class = text(fields[4], 50);
      result.race = text(fields[5], 50);
      result.specialization = text(fields[6], 100);
      result.zone = text(fields[7], 150);
      result.moneyCopper = number(fields[8]);
      result.capturedAt = number(fields[9]);
      result.clientVersion = text(fields[10], 50);
    } else if (fields[0] === 'stat' && (fields.length === 3 || fields.length === 4)) {
      const key = text(fields[1], 50);
      if (!/^[A-Za-z]+$/.test(key)) throw Error('The character snapshot has an invalid stat.');
      if (fields[2])
        result.stats[key] = {
          effective: number(fields[2]),
          base: fields[3] ? number(fields[3]) : null,
        };
    } else if (fields[0] === 'equipment' && fields.length === 6) {
      const stats = {};
      if (fields[5]) {
        for (const pair of decode(fields[5]).split(',')) {
          const equal = pair.indexOf('=');
          if (equal < 1) throw Error('The character snapshot has invalid equipment stats.');
          stats[text(pair.slice(0, equal), 100)] = number(decode(pair.slice(equal + 1)), -1e12);
        }
      }
      result.equipment.push({
        slot: number(fields[1]),
        itemId: number(fields[2]),
        name: text(fields[3], 150),
        link: text(fields[4], 500),
        stats,
      });
    } else if (line) {
      throw Error('The character snapshot has an unknown record.');
    }
  }
  if (!result.name || !result.realm || !result.capturedAt)
    throw Error('The character snapshot is incomplete.');
  if (
    result.equipment.length > 19 ||
    new Set(result.equipment.map((item) => item.slot)).size !== result.equipment.length
  )
    throw Error('The character snapshot has duplicate equipment slots.');
  return result;
}

function defaultGameDirectories(platform = process.platform) {
  if (process.env.WORKWORK_WOW_DIR) return [process.env.WORKWORK_WOW_DIR];
  if (platform === 'darwin') return ['/Applications/World of Warcraft/_classic_beta_'];
  if (platform === 'win32')
    return [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
      .filter(Boolean)
      .map((folder) => path.join(folder, 'World of Warcraft', '_classic_beta_'));
  return [path.join(os.homedir(), 'Games', 'World of Warcraft', '_classic_beta_')];
}

function directories(folder) {
  try {
    return fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(folder, entry.name));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') return [];
    throw error;
  }
}

function savedFiles(gameDirectory) {
  const files = [];
  for (const account of directories(path.join(gameDirectory, 'WTF', 'Account')))
    for (const server of directories(account))
      for (const character of directories(server)) {
        const file = path.join(character, 'SavedVariables', FILE);
        try {
          const stat = fs.lstatSync(file);
          if (stat.isFile() && stat.size <= MAX_BYTES)
            files.push({ file, modifiedAt: stat.mtimeMs });
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error;
        }
      }
  return files;
}

function readLatestCharacter(gameDirectories = defaultGameDirectories()) {
  const candidates = gameDirectories
    .flatMap(savedFiles)
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  if (!candidates.length) return null;
  const selected = candidates[0];
  const data = fs.readFileSync(selected.file, 'utf8');
  const result = parseSnapshot(data);
  result.savedAt = new Date(selected.modifiedAt).toISOString();
  return result;
}

function characterForGuide(snapshot) {
  if (!snapshot) return null;
  return {
    savedAt: snapshot.savedAt,
    capturedAt: snapshot.capturedAt,
    clientVersion: snapshot.clientVersion,
    level: snapshot.level,
    class: snapshot.class,
    race: snapshot.race,
    specialization: snapshot.specialization,
    zone: snapshot.zone,
    stats: Object.fromEntries(
      Object.entries(snapshot.stats)
        .slice(0, 40)
        .map(([key, value]) => [key, value.effective]),
    ),
    equipment: snapshot.equipment.map(({ slot, itemId, name, stats }) => ({
      slot,
      itemId,
      name,
      stats: Object.fromEntries(Object.entries(stats).slice(0, 30)),
    })),
  };
}

function exportForGamingBot(data, file) {
  if (!data) throw Error('No character snapshot is available yet.');
  const payload = {
    ...data,
    note: 'This is a local WoW Forever addon snapshot saved on /reload or logout, not live game state.',
  };
  atomicJSON(file, payload);
  return { file, savedAt: data.savedAt };
}

function installCharacterAddon(sourceDirectory, gameDirectories = defaultGameDirectories()) {
  const gameDirectory = gameDirectories.find((folder) =>
    fs.existsSync(path.join(folder, 'Interface', 'AddOns')),
  );
  if (!gameDirectory)
    throw Error(
      'Forever AddOns folder not found. Set WORKWORK_WOW_DIR to your Forever game folder.',
    );
  const destination = path.join(gameDirectory, 'Interface', 'AddOns', 'WorkworkCharacter');
  try {
    if (!fs.lstatSync(destination).isDirectory())
      throw Error('The WorkworkCharacter destination must be a directory, not a symbolic link.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of ADDON_FILES) {
    const source = path.join(sourceDirectory, name);
    const target = path.join(destination, name);
    try {
      const existing = fs.lstatSync(target);
      if (
        !existing.isFile() ||
        existing.isSymbolicLink() ||
        !fs.readFileSync(target).equals(fs.readFileSync(source))
      )
        throw Error(
          `Existing ${name} differs from the bundled addon. Back it up before replacing it.`,
        );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ADDON_FILES) {
    const source = path.join(sourceDirectory, name);
    const target = path.join(destination, name);
    fs.copyFileSync(source, target);
  }
  return { installed: true, gameDirectory };
}

module.exports = {
  parseSnapshot,
  readLatestCharacter,
  characterForGuide,
  exportForGamingBot,
  installCharacterAddon,
  defaultGameDirectories,
};
