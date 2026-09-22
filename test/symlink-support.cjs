const fs = require('node:fs');
const path = require('node:path');
function canSymlink(t, directory) {
  const link = path.join(directory, 'symlink-capability');
  try {
    fs.symlinkSync('missing-fixture', link);
    fs.unlinkSync(link);
    return true;
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('Windows file symlinks require Developer Mode or the symlink privilege.');
      return false;
    }
    throw error;
  }
}
module.exports = { canSymlink };
