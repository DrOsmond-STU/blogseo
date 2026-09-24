// Login dashboard dengan halaman form + cookie sesi bertanda tangan (HMAC).
// Menggantikan HTTP Basic, yang pop-up-nya sering tidak muncul di browser HP
// atau browser di dalam aplikasi.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const COOKIE = 'blogseo_session';
const SESSION_DAYS = 30;
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

// Kunci penanda tangan disimpan di DATA_DIR agar sesi tetap valid setelah restart.
// Ikut diturunkan dari password, jadi mengganti ADMIN_PASSWORD otomatis mengeluarkan semua sesi.
function signingKey() {
  const file = path.join(config.dataDir, 'session.key');
  let secret;
  try {
    secret = fs.readFileSync(file, 'utf8').trim();
  } catch {
    secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
  }
  return crypto.createHash('sha256').update(`${secret}:${config.adminPassword}`).digest();
}

let key = null;
const sign = (value) => crypto.createHmac('sha256', (key ||= signingKey())).update(value).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function isHttps(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

export function isLoggedIn(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const [expires, mac] = token.split('.');
  return Number(expires) > Date.now() && safeEqual(mac, sign(`${config.adminUser}:${expires}`));
}

function setSession(req, res) {
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  const value = `${expires}.${sign(`${config.adminUser}:${expires}`)}`;
  res.append(
    'Set-Cookie',
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`,
  );
}

const fails = new Map();
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

export function checkCredentials(username, password) {
  const userOk = safeEqual(String(username || '').trim().toLowerCase(), config.adminUser.toLowerCase());
  const passOk = safeEqual(password || '', config.adminPassword);
  return userOk && passOk;
}

export function loginHandler(req, res) {
  const ip = clientIp(req);
  const rec = fails.get(ip);
  if (rec && rec.count >= MAX_FAILS && Date.now() - rec.first < FAIL_WINDOW_MS) {
    return res.redirect('/login?e=locked');
  }
  if (!checkCredentials(req.body?.username, req.body?.password)) {
    const fresh = !rec || Date.now() - rec.first >= FAIL_WINDOW_MS;
    fails.set(ip, fresh ? { count: 1, first: Date.now() } : { ...rec, count: rec.count + 1 });
    return res.redirect('/login?e=1');
  }
  fails.delete(ip);
  setSession(req, res);
  res.redirect('/');
}

export function logoutHandler(req, res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.redirect('/login');
}

// Semua rute selain halaman login wajib sesi. API membalas 401 JSON, halaman dialihkan ke /login.
export function requireLogin(req, res, next) {
  if (!config.adminPassword || isLoggedIn(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sesi berakhir. Silakan login lagi.' });
  res.redirect('/login');
}
