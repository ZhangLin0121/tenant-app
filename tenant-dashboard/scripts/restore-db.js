#!/usr/bin/env node
/*
  Restore JSON-dumped collections into a MongoDB database.
  Env:
    DEST_URI        mongodb uri (default: mongodb://127.0.0.1:27017/tenant_dashboard)
    INPUT_DIR       directory containing <collection>.json files
    COLLECTIONS     comma list (default: students,tenants,roomflags)
*/
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

async function main() {
  const DEST_URI = process.env.DEST_URI || 'mongodb://127.0.0.1:27017/tenant_dashboard';
  const INPUT_DIR = process.env.INPUT_DIR || path.resolve(process.cwd(), 'dump');
  const collections = (process.env.COLLECTIONS || 'students,tenants,roomflags')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const conn = await mongoose.createConnection(DEST_URI).asPromise();

  for (const name of collections) {
    const fp = path.join(INPUT_DIR, `${name}.json`);
    const json = await fs.promises.readFile(fp, 'utf8');
    const arr = JSON.parse(json);
    const docs = arr.map(d => {
      const doc = { ...d };
      try {
        const id = d._id;
        if (typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)) {
          doc._id = new mongoose.Types.ObjectId(id);
        } else if (id && typeof id === 'object' && typeof id.$oid === 'string') {
          doc._id = new mongoose.Types.ObjectId(id.$oid);
        } else {
          // 保留原样（字符串或其他类型）
          doc._id = id;
        }
      } catch (_) {
        doc._id = d._id;
      }
      return doc;
    });
    const col = conn.db.collection(name);
    try { await col.drop(); } catch (_) {}
    if (docs.length) await col.insertMany(docs, { ordered: false });
    console.log(`[restore] ${name}: ${docs.length} docs restored.`);
  }

  await conn.close();
  console.log('[restore] done.');
}

main().catch(err => { console.error('[restore] failed:', err); process.exit(1); });
