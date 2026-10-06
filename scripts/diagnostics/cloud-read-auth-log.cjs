// Wrangler 4.85 logs even `auth token --json` output to its debug file.
// Suppress only this dedicated auth invocation's log destination. The official
// login/cache and every other file operation keep their normal behavior.
const path = require('node:path');
function suppressAuthLog(target, fileSystem = require('node:fs/promises')) {
  const append = fileSystem.appendFile;
  fileSystem.appendFile = function(file, ...args) {
    if (typeof file === 'string' && path.resolve(file) === path.resolve(target)) return Promise.resolve();
    return append.call(this, file, ...args);
  };
  return () => { fileSystem.appendFile = append; };
}
if (process.env.BIT_CLOUD_READ_AUTH_LOG && process.env.BIT_CLOUD_READ_AUTH_LOG === process.env.WRANGLER_LOG_PATH) {
  suppressAuthLog(process.env.BIT_CLOUD_READ_AUTH_LOG);
}
module.exports = { suppressAuthLog };
