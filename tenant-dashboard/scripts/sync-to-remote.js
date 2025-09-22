/*
  Clone selected collections from local MongoDB to a remote MongoDB
  Usage:
    DEST_URI=mongodb://127.0.0.1:27018/tenant_dashboard node tenant-dashboard/scripts/sync-to-remote.js
*/
const mongoose = require('mongoose');

async function main() {
  const SRC_URI = process.env.SRC_URI || 'mongodb://127.0.0.1:27017/tenantDB';
  const DEST_URI = process.env.DEST_URI || 'mongodb://127.0.0.1:27018/tenant_dashboard';
  const collections = (process.env.COLLECTIONS || 'students,tenants,roomflags')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const src = await mongoose.createConnection(SRC_URI).asPromise();
  const dst = await mongoose.createConnection(DEST_URI).asPromise();

  for (const name of collections) {
    const sCol = src.db.collection(name);
    const dCol = dst.db.collection(name);
    const count = await sCol.countDocuments({});
    const docs = await sCol.find({}).toArray();
    try { await dCol.drop(); } catch (_) {}
    if (docs.length) {
      await dCol.insertMany(docs, { ordered: false });
    }
    console.log(`[sync] ${name}: ${count} docs copied.`);
  }

  await src.close();
  await dst.close();
  console.log('[sync] done.');
}

main().catch((e) => {
  console.error('[sync] failed:', e);
  process.exit(1);
});

