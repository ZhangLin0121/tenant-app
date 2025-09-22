const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { runFetchOnly } = require('../services/syncService');

(async () => {
  try {
    const n = await runFetchOnly();
    console.log('[fetch-only] 拉取数量:', n);
    console.log('[fetch-only] 请查看 logs/guestsSnapshot.json, logs/enrichSnapshot.json, logs/fetchStats.json');
    process.exit(0);
  } catch (e) {
    console.error('[fetch-only] 失败:', e.message);
    process.exit(1);
  }
})();

