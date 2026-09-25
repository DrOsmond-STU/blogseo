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
  // Urutan penyedia AI (dipisah koma) dan mode: 'fallback' (berurutan/cadangan) atau 'mix' (bergantian).
  aiOrder: (process.env.AI_ORDER || 'gemini,claude,openai').split(',').map((x) => x.trim()).filter(Boolean),
  aiDisabled: (process.env.AI_DISABLED || '').split(',').map((x) => x.trim()).filter(Boolean),
  aiMode: process.env.AI_MODE || 'fallback',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  geminiBaseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, ''),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5-mini',
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, ''),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  dbFile: path.join(dataDir, 'db.json'),
  // Worker antrean memeriksa postingan terjadwal setiap N milidetik.
  queueIntervalMs: Number(process.env.QUEUE_INTERVAL_MS || 20000),
};

export const AI_PROVIDERS = {
  gemini: { name: 'Google Gemini', keyField: 'geminiApiKey', modelField: 'geminiModel', paid: false },
  claude: { name: 'Claude', keyField: 'anthropicApiKey', modelField: 'claudeModel', paid: true },
  openai: { name: 'ChatGPT (OpenAI)', keyField: 'openaiApiKey', modelField: 'openaiModel', paid: true },
};

// Urutan lengkap semua penyedia (yang tidak disebut di aiOrder ditaruh di belakang).
export function providerOrder() {
  const known = config.aiOrder.filter((id) => AI_PROVIDERS[id]);
  return [...new Set([...known, ...Object.keys(AI_PROVIDERS)])];
}

// Penyedia AI yang aktif (punya API key & tidak dinonaktifkan), sesuai urutan prioritas.
export function activeProviders() {
  return providerOrder().filter((id) => config[AI_PROVIDERS[id].keyField] && !config.aiDisabled.includes(id));
}

export function aiEnabled() {
  return activeProviders().length > 0;
}

export function modelOf(id) {
  return AI_PROVIDERS[id] ? config[AI_PROVIDERS[id].modelField] : null;
}

export function googleEnabled() {
  return Boolean(config.googleClientId && config.googleClientSecret);
}
