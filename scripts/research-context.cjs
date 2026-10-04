// Stable navigation entry; implementation lives with the research tools.
const navigation = require('./research/research-context.cjs');
if (require.main === module) {
  try { navigation.main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = navigation;
