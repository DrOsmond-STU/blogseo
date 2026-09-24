import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ quiet: true });

const dataDir = path.resolve(process.env.DATA_DIR || './data');

export const config = {
  port: Number(process.env.PORT || 3000),
  // Isi 127.0.0.1 jika aplikasi berada di balik reverse proxy (Apache/Nginx).
  host: process.env.HOST || undefined,
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  adminUser: (process.env.ADMIN_USER || 'admin').trim(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-5',
  // Penyedia AI: 'gemini', 'claude', 'none', atau kosong = otomatis (Gemini dulu jika ada key).
  aiProvider: process.env.AI_PROVIDER || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  geminiBaseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, ''),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  dbFile: path.join(dataDir, 'db.json'),
  // Worker antrean memeriksa postingan terjadwal setiap N milidetik.
  queueIntervalMs: Number(process.env.QUEUE_INTERVAL_MS || 20000),
};

// Penyedia AI yang benar-benar aktif (punya API key), atau null = mode template.
export function aiProvider() {
  const choice = config.aiProvider;
  if (choice === 'none') return null;
  if (choice === 'gemini') return config.geminiApiKey ? 'gemini' : null;
  if (choice === 'claude') return config.anthropicApiKey ? 'claude' : null;
  if (config.geminiApiKey) return 'gemini';
  return config.anthropicApiKey ? 'claude' : null;
}

export function aiEnabled() {
  return Boolean(aiProvider());
}

export function aiModel() {
  const p = aiProvider();
  return p === 'gemini' ? config.geminiModel : p === 'claude' ? config.claudeModel : null;
}

export function googleEnabled() {
  return Boolean(config.googleClientId && config.googleClientSecret);
}
