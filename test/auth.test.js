import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Direktori data sementara, harus diset sebelum modul aplikasi dimuat.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'blogseo-test-'));
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'Rahasia123';

const { config } = await import('../src/config.js');
const settings = await import('../src/settings.js');
const { checkCredentials } = await import('../src/auth.js');

test('login dari .env: username tidak peka huruf besar, password harus persis', () => {
  settings.applySettings();
  assert.equal(checkCredentials('Admin ', 'Rahasia123'), true);
  assert.equal(checkCredentials('admin', 'rahasia123'), false);
  assert.equal(checkCredentials('orang', 'Rahasia123'), false);
  assert.equal(checkCredentials(undefined, undefined), false);
});

test('password & username dari dashboard menggantikan .env dan disimpan sebagai hash', () => {
  settings.setPassword('PasswordBaru123');
  settings.updateSettings({ adminUser: 'pemilik' });
  assert.equal(checkCredentials('pemilik', 'PasswordBaru123'), true);
  assert.equal(checkCredentials('admin', 'Rahasia123'), false);
  const raw = fs.readFileSync(path.join(config.dataDir, 'settings.json'), 'utf8');
  assert.doesNotMatch(raw, /PasswordBaru123/);
  assert.equal(fs.statSync(path.join(config.dataDir, 'settings.json')).mode & 0o777, 0o600);
});

test('API key dari dashboard menimpa .env dan bisa dihapus kembali', () => {
  settings.updateSettings({ anthropicApiKey: 'sk-ant-dashboard-key-123456' });
  assert.equal(config.anthropicApiKey, 'sk-ant-dashboard-key-123456');
  assert.equal(settings.sourceOf('anthropicApiKey'), 'dashboard');
  assert.equal(settings.maskSecret(config.anthropicApiKey), 'sk-ant-…3456');
  settings.updateSettings({ anthropicApiKey: null });
  assert.equal(config.anthropicApiKey, '');
});
