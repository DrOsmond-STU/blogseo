// OAuth 2.0 Google untuk Blogger API v3 (tanpa library tambahan).
import crypto from 'node:crypto';
import { config } from './config.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/blogger'];

export function redirectUri() {
  return `${config.publicBaseUrl}/auth/google/callback`;
}

const pendingStates = new Map();

export function buildAuthUrl() {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now());
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export function consumeState(state) {
  const createdAt = pendingStates.get(state);
  pendingStates.delete(state);
  return Boolean(createdAt && Date.now() - createdAt < 15 * 60 * 1000);
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      ...body,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    // invalid_grant = izin dicabut atau kedaluwarsa (aplikasi OAuth berstatus "Testing" hanya memberi izin 7 hari).
    if (data.error === 'invalid_grant') {
      throw new Error('Izin Google sudah kedaluwarsa atau dicabut. Buka Situs Tujuan → Blogger → Hubungkan akun Google lagi. Agar tidak terulang tiap 7 hari, ubah status aplikasi OAuth ke "In production" (lihat Pengaturan → Blogger).');
    }
    throw new Error(`Google OAuth: ${data.error_description || data.error || res.status}`);
  }
  return data;
}

function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return payload.email || '';
  } catch {
    return '';
  }
}

export async function exchangeCode(code) {
  const data = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
  if (!data.refresh_token) {
    throw new Error('Google tidak mengirim refresh token. Cabut akses aplikasi di myaccount.google.com/permissions lalu hubungkan ulang.');
  }
  return { email: emailFromIdToken(data.id_token), refreshToken: data.refresh_token };
}

const accessTokens = new Map();

export async function getAccessToken(account) {
  const cached = accessTokens.get(account.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const data = await tokenRequest({ refresh_token: account.refreshToken, grant_type: 'refresh_token' });
  accessTokens.set(account.id, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}
