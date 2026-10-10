require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { runSync } = require('./services/syncService');

(async () => {
  const result = await runSync();
  console.log('runSync returned:', result);
  process.exit(0);
})();
