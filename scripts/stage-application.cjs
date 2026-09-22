const fs = require('node:fs');
const path = require('node:path');
const { SOURCE_FILES } = require('./source-archive.cjs');

// Ship only reviewed runtime files. Never copy the checkout, local state, or tests.
const APP_FILES = [
  ...SOURCE_FILES.filter(
    (file) => /^(app|src|hooks)\//.test(file) || file === 'scripts/setup.cjs',
  ).filter((file) => !file.endsWith('.md')),
  'LICENSE',
  'NOTICE',
];

function stageApplication(root, destination) {
  for (const file of APP_FILES) {
    const source = path.join(root, file);
    for (let current = source; current !== root; current = path.dirname(current)) {
      if (fs.lstatSync(current).isSymbolicLink()) throw Error(`Refusing symbolic link: ${file}`);
    }
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  const { name, productName, version, description, main, engines, license } = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  );
  fs.writeFileSync(
    path.join(destination, 'package.json'),
    JSON.stringify({ name, productName, version, description, main, engines, license }, null, 2) +
      '\n',
  );
}

module.exports = { APP_FILES, stageApplication };
