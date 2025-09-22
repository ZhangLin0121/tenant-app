#!/usr/bin/env node
/*
  Export selected collections from a MongoDB to JSON files.
  Env:
    SRC_URI        mongodb uri (default: mongodb://127.0.0.1:27017/tenantDB)
    OUTPUT_DIR     target directory (default: ./dump)
    COLLECTIONS    comma list (default: students,tenants,roomflags)
*/
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function main() {
  const SRC_URI = process.env.SRC_URI || 'mongodb://127.0.0.1:27017/tenantDB';
  const OUTPUT_DIR = process.env.OUTPUT_DIR || path.resolve(process.cwd(), 'dump');
  const collections = (process.env.COLLECTIONS || 'students,tenants,roomflags')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  await ensureDir(OUTPUT_DIR);
  const conn = await mongoose.createConnection(SRC_URI).asPromise();

  for (const name of collections) {
    const col = conn.db.collection(name);
    const docs = await col.find({}).toArray();
    const transformed = docs.map(d => ({ ...d, _id: String(d._id) }));
    const fp = path.join(OUTPUT_DIR, `${name}.json`);
    await fs.promises.writeFile(fp, JSON.stringify(transformed));
    console.log(`[export] ${name}: ${transformed.length} docs -> ${fp}`);
  }

  await conn.close();
  console.log('[export] done:', OUTPUT_DIR);
}

main().catch(err => { console.error('[export] failed:', err); process.exit(1); });

