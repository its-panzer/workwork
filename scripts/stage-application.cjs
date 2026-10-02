const fs = require('node:fs');
const path = require('node:path');
const { SOURCE_FILES } = require('./source-archive.cjs');

// Ship only reviewed runtime files. Never copy the checkout, local state, or tests.
const APP_FILES = [
  ...SOURCE_FILES.filter(
    (file) => /^(app|src|hooks|addons)\//.test(file) || file === 'scripts/setup.cjs',
  ).filter((file) => !file.endsWith('.md')),
  'LICENSE',
  'NOTICE',
];

function stageApplication(root, destination) {
  function sourcePath(file) {
    const source = path.join(root, file);
    for (let current = source; current !== root; current = path.dirname(current)) {
      if (fs.lstatSync(current).isSymbolicLink()) throw Error(`Refusing symbolic link: ${file}`);
    }
    return source;
  }
  function copy(file) {
    const source = sourcePath(file);
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  for (const file of APP_FILES) copy(file);
  // jose is the only runtime dependency. Include its published JS and license,
  // not development dependencies or arbitrary files from node_modules.
  const dependency = 'node_modules/jose';
  copy(`${dependency}/package.json`);
  copy(`${dependency}/LICENSE.md`);
  function copyJavaScript(directory) {
    const source = sourcePath(directory);
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw Error(`Refusing symbolic link: ${file}`);
      if (entry.isDirectory()) copyJavaScript(file);
      else if (entry.isFile() && entry.name.endsWith('.js')) copy(file);
    }
  }
  copyJavaScript(`${dependency}/dist/webapi`);
  const { name, productName, version, description, main, engines, license, dependencies } =
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(destination, 'package.json'),
    JSON.stringify(
      {
        name,
        productName,
        version,
        description,
        main,
        engines,
        license,
        dependencies: { jose: dependencies.jose },
      },
      null,
      2,
    ) + '\n',
  );
}

module.exports = { APP_FILES, stageApplication };
