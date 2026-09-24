import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ quiet: true });

const dataDir = path.resolve(process.env.DATA_DIR || './data');

export const config = {
  port: Number(process.env.PORT || 3000),
  // Isi 127.0.0.1 jika aplikasi berada di balik reverse proxy (Apache/Nginx).
  host: process.env.HOST || undefined,
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-opus-5',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  dbFile: path.join(dataDir, 'db.json'),
  // Worker antrean memeriksa postingan terjadwal setiap N milidetik.
  queueIntervalMs: Number(process.env.QUEUE_INTERVAL_MS || 20000),
};

export function aiEnabled() {
  return Boolean(config.anthropicApiKey);
}

export function googleEnabled() {
  return Boolean(config.googleClientId && config.googleClientSecret);
}
