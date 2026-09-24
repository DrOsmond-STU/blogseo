// Penyimpanan sederhana berbasis file JSON. Cukup untuk satu proses server
// dan puluhan ribu postingan; ganti dengan database sungguhan bila perlu skala besar.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const EMPTY = { sites: [], googleAccounts: [], campaigns: [], posts: [] };

let state = null;

function load() {
  if (state) return state;
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  if (fs.existsSync(config.dbFile)) {
    state = { ...structuredClone(EMPTY), ...JSON.parse(fs.readFileSync(config.dbFile, 'utf8')) };
  } else {
    state = structuredClone(EMPTY);
  }
  return state;
}

function save() {
  const tmp = `${config.dbFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, config.dbFile);
}

export function newId() {
  return crypto.randomBytes(8).toString('hex');
}

export const db = {
  all(collection) {
    return load()[collection];
  },
  get(collection, id) {
    return load()[collection].find((row) => row.id === id) || null;
  },
  find(collection, predicate) {
    return load()[collection].filter(predicate);
  },
  insert(collection, row) {
    const record = { id: newId(), createdAt: new Date().toISOString(), ...row };
    load()[collection].push(record);
    save();
    return record;
  },
  update(collection, id, patch) {
    const row = this.get(collection, id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    save();
    return row;
  },
  remove(collection, id) {
    const rows = load()[collection];
    const index = rows.findIndex((row) => row.id === id);
    if (index === -1) return false;
    rows.splice(index, 1);
    save();
    return true;
  },
  removeWhere(collection, predicate) {
    const s = load();
    s[collection] = s[collection].filter((row) => !predicate(row));
    save();
  },
};
