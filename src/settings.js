// Pengaturan yang diisi dari halaman Pengaturan di dashboard (bukan dari .env).
// Disimpan di DATA_DIR/settings.json (izin 0600, di luar document root).
// Nilai di sini menimpa nilai .env; jika kosong, nilai .env tetap dipakai sebagai cadangan.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

export const MODELS = [
  { id: 'claude-opus-5', name: 'Claude Opus 5 (kualitas terbaik, direkomendasikan)' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5 (lebih hemat biaya)' },
];

const file = () => path.join(config.dataDir, 'settings.json');

// Nilai asli dari .env, dicatat sekali sebelum ditimpa pengaturan dashboard.
const ENV = {
  anthropicApiKey: config.anthropicApiKey,
  claudeModel: config.claudeModel,
  googleClientId: config.googleClientId,
  googleClientSecret: config.googleClientSecret,
  adminUser: config.adminUser,
  adminPassword: config.adminPassword,
};

let cache = null;

export function loadSettings() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

function persist(next) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file());
  cache = next;
  applySettings();
}

// Salin pengaturan aktif ke objek config yang dibaca seluruh aplikasi.
export function applySettings() {
  const s = loadSettings();
  config.anthropicApiKey = s.anthropicApiKey || ENV.anthropicApiKey;
  config.claudeModel = s.claudeModel || ENV.claudeModel;
  config.googleClientId = s.googleClientId || ENV.googleClientId;
  config.googleClientSecret = s.googleClientSecret || ENV.googleClientSecret;
  config.adminUser = s.adminUser || ENV.adminUser;
}

export function updateSettings(patch) {
  const next = { ...loadSettings() };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  persist(next);
}

export function sourceOf(key) {
  if (loadSettings()[key]) return 'dashboard';
  return ENV[key] ? 'env' : null;
}

export function maskSecret(value) {
  if (!value) return '';
  return value.length <= 12 ? '••••' : `${value.slice(0, 7)}…${value.slice(-4)}`;
}

// ---- Password admin ----
// Password yang diganti dari dashboard disimpan sebagai hash scrypt, bukan teks asli.
export function authEnabled() {
  return Boolean(loadSettings().adminPasswordHash || ENV.adminPassword);
}

export function passwordFingerprint() {
  return loadSettings().adminPasswordHash || ENV.adminPassword || '';
}

export function verifyPassword(password) {
  const stored = loadSettings().adminPasswordHash;
  if (stored) {
    const [salt, hash] = stored.split(':');
    const test = crypto.scryptSync(String(password || ''), Buffer.from(salt, 'hex'), 32);
    return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
  }
  const a = Buffer.from(String(password || ''));
  const b = Buffer.from(ENV.adminPassword);
  return Boolean(ENV.adminPassword) && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function setPassword(newPassword) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(newPassword, salt, 32);
  updateSettings({ adminPasswordHash: `${salt.toString('hex')}:${hash.toString('hex')}` });
}
