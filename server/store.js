// Flat-file persistence. Good enough for a prototype with a handful of
// players; swap for a database before anything resembling launch.

import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.playerDir = path.join(dir, 'players');
    fs.mkdirSync(this.playerDir, { recursive: true });
    this.cache = new Map();
  }

  file(name) {
    return path.join(this.playerDir, `${name.toLowerCase()}.json`);
  }

  // Returns the cached record or loads it from disk. null if unknown.
  get(name) {
    const key = name.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key);
    const f = this.file(name);
    if (!fs.existsSync(f)) return null;
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    this.cache.set(key, rec);
    return rec;
  }

  put(rec) {
    this.cache.set(rec.name.toLowerCase(), rec);
  }

  saveAll() {
    for (const rec of this.cache.values()) {
      const f = this.file(rec.name);
      fs.writeFileSync(`${f}.tmp`, JSON.stringify(rec));
      fs.renameSync(`${f}.tmp`, f);
    }
  }

  loadMeta(name) {
    const f = path.join(this.dir, `${name}.json`);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  }

  saveMeta(name, data) {
    const f = path.join(this.dir, `${name}.json`);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(data));
    fs.renameSync(`${f}.tmp`, f);
  }
}
