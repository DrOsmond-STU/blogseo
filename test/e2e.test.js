// Uji menyeluruh: server sungguhan dijalankan sebagai proses terpisah, semua layanan
// luar (Google OAuth, Blogger, WordPress, webhook, Gemini) diganti server tiruan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const HOOK_SECRET = 'rahasia-webhook';
const PASSWORD = 'PasswordAwal123';

// ---------- server tiruan ----------
const seen = { bloggerPosts: [], wpPosts: [], wpMedia: 0, hooks: [], geminiCalls: 0 };
let mockUrl;
let mock;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function fakeIdToken(email) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ email })}.sig`;
}

async function handleMock(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const url = new URL(req.url, mockUrl);
  const p = url.pathname;

  // Google OAuth
  if (p === '/token') {
    const form = new URLSearchParams(raw.toString());
    if (form.get('grant_type') === 'authorization_code') {
      if (form.get('code') !== 'kode-benar') return json(res, 400, { error: 'invalid_grant' });
      return json(res, 200, { access_token: 'akses-1', refresh_token: 'refresh-1', expires_in: 3600, id_token: fakeIdToken('pemilik@gmail.com') });
    }
    if (form.get('refresh_token') === 'refresh-1') return json(res, 200, { access_token: 'akses-1', expires_in: 3600 });
    return json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
  }

  // Blogger API
  if (p.startsWith('/blogger/v3/')) {
    if (req.headers.authorization !== 'Bearer akses-1') return json(res, 401, { error: { message: 'Invalid Credentials' } });
    if (p === '/blogger/v3/users/self/blogs') {
      return json(res, 200, { items: [
        { id: '111', name: 'Blog Kopi', url: 'https://blogkopi.blogspot.com/' },
        { id: '222', name: 'Blog Kuliner', url: 'https://blogkuliner.blogspot.com/' },
        { id: '999', name: 'Blog Terkunci', url: 'https://terkunci.blogspot.com/' },
      ] });
    }
    const m = p.match(/^\/blogger\/v3\/blogs\/(\d+)(\/posts\/?)?$/);
    if (m && m[1] === '999') return json(res, 403, { error: { message: 'We\'re sorry, but you don\'t have permission to access this resource.' } });
    if (m && !m[2]) return json(res, 200, { id: m[1], name: `Blog ${m[1]}`, url: `https://blog${m[1]}.blogspot.com/` });
    if (m && req.method === 'POST') {
      const post = JSON.parse(raw);
      seen.bloggerPosts.push({ blogId: m[1], isDraft: url.searchParams.get('isDraft'), ...post });
      return json(res, 200, { id: `p${seen.bloggerPosts.length}`, url: `https://blog${m[1]}.blogspot.com/2026/10/${seen.bloggerPosts.length}.html` });
    }
  }

  // WordPress REST API
  if (p.startsWith('/wp-json/wp/v2/')) {
    // Application Password WordPress dikirim tanpa spasi.
    const expected = `Basic ${Buffer.from('editor:abcdefgh').toString('base64')}`;
    if (req.headers.authorization !== expected) return json(res, 401, { message: 'Sorry, you are not allowed to do that.' });
    if (p === '/wp-json/wp/v2/users/me') return json(res, 200, { id: 1, name: 'Editor' });
    if (p === '/wp-json/wp/v2/tags' && req.method === 'GET') return json(res, 200, []);
    if (p === '/wp-json/wp/v2/tags') return json(res, 201, { id: Math.floor(Math.random() * 1000) });
    if (p === '/wp-json/wp/v2/media' && req.method === 'POST') {
      assert.equal(req.headers['content-type'], 'image/png');
      assert.deepEqual(raw, PNG);
      seen.wpMedia++;
      return json(res, 201, { id: 77, source_url: `${mockUrl}/wp-content/uploads/gambar.png` });
    }
    if (p.startsWith('/wp-json/wp/v2/media/')) return json(res, 200, { id: 77 });
    if (p === '/wp-json/wp/v2/posts') {
      const post = JSON.parse(raw);
      seen.wpPosts.push(post);
      return json(res, 201, { id: 500 + seen.wpPosts.length, link: `${mockUrl}/${post.slug}/` });
    }
  }

  // Webhook (website lain)
  if (p === '/hook') {
    const sig = crypto.createHmac('sha256', HOOK_SECRET).update(raw).digest('hex');
    if (req.headers['x-blogseo-signature'] !== sig) return json(res, 401, { error: 'signature salah' });
    const body = JSON.parse(raw);
    if (body.event === 'ping') return json(res, 200, { ok: true });
    seen.hooks.push(body);
    return json(res, 200, { id: 9, url: `https://websiteku.id/${body.slug}` });
  }

  // Gemini API
  if (p === '/v1beta/models') {
    if (req.headers['x-goog-api-key'] !== 'AIzaKunciGeminiUji-000000') return json(res, 400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
    return json(res, 200, { models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] }] });
  }
  if (p.startsWith('/v1beta/models/')) {
    seen.geminiCalls++;
    const prompt = JSON.parse(raw).contents[0].parts[0].text;
    const field = (name) => (prompt.match(new RegExp(`${name}: (.*)`)) || [])[1];
    const angle = field('Sudut pandang artikel');
    const words = Array.from({ length: 150 }, (_, i) => `${angle.replace(/\W/g, '')}${seen.geminiCalls}k${i}`).join(' ');
    const article = {
      title: `${field('Kata kunci utama')}: ${angle}`,
      metaDescription: `Ulasan ${angle}`,
      labels: ['kopi', angle],
      html: `<p>Pembuka ${angle}. ${words}</p><h2>Bagian</h2><p>Lihat <a href="${field('URL tujuan')}">${field('Anchor text untuk link')}</a> ya.</p><script>alert(1)</script>`,
      imageCaption: 'Biji kopi',
    };
    return json(res, 200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(article) }] } }] });
  }

  json(res, 404, { error: `tidak dikenal: ${req.method} ${p}` });
}

// ---------- klien HTTP sederhana dengan cookie ----------
let base;
let cookie = '';
async function call(method, p, { body, form, multipart, jar = true, cookieOverride } = {}) {
  const headers = {};
  const c = cookieOverride ?? (jar ? cookie : '');
  if (c) headers.Cookie = c;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (multipart) {
    payload = multipart;
  }
  const res = await fetch(base + p, { method, headers, body: payload, redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie');
  if (jar && setCookie && !cookieOverride) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, location: res.headers.get('location'), data, setCookie };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`waktu habis menunggu: ${label}`);
    await sleep(150);
  }
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

let child;
let logs = '';
let dataDir;
let serverEnv;

async function startServer() {
  logs = '';
  child = spawn(process.execPath, ['src/server.js'], { cwd: root, env: serverEnv });
  child.stdout.on('data', (d) => (logs += d));
  child.stderr.on('data', (d) => (logs += d));
  await waitFor(() => /BlogSEO berjalan/.test(logs), 'server menyala');
}

before(async () => {
  mock = http.createServer((req, res) => handleMock(req, res).catch((err) => json(res, 500, { error: String(err) })));
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockUrl = `http://127.0.0.1:${mock.address().port}`;
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blogseo-e2e-'));
  serverEnv = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    PUBLIC_BASE_URL: base,
    DATA_DIR: dataDir,
    ADMIN_USER: 'admin',
    ADMIN_PASSWORD: PASSWORD,
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    GEMINI_BASE_URL: mockUrl,
    GOOGLE_AUTH_URL: `${mockUrl}/auth`,
    GOOGLE_TOKEN_URL: `${mockUrl}/token`,
    BLOGGER_API_URL: `${mockUrl}/blogger/v3`,
    QUEUE_INTERVAL_MS: '300',
  };
  await startServer();
});

after(() => {
  child?.kill();
  mock?.close();
});

// ---------- skenario ----------
const ids = {};

test('1. tanpa login: dashboard dialihkan ke /login, API menolak', async () => {
  const home = await call('GET', '/', { jar: false });
  assert.equal(home.status, 302);
  assert.match(home.location, /\/login$/);
  assert.equal((await call('GET', '/api/status', { jar: false })).status, 401);
  assert.equal((await call('GET', '/login', { jar: false })).status, 200);
});

test('2. login: password salah ditolak, password benar masuk', async () => {
  const bad = await call('POST', '/login', { form: { username: 'admin', password: 'salah' }, jar: false });
  assert.match(bad.location, /e=1/);
  const ok = await call('POST', '/login', { form: { username: 'Admin', password: PASSWORD } });
  assert.equal(ok.location, '/');
  assert.match(ok.setCookie, /HttpOnly/);
  const st = await call('GET', '/api/status');
  assert.equal(st.status, 200);
  assert.equal(st.data.user, 'admin');
  assert.equal(st.data.ai, false);
});

test('3. pengaturan AI: key Gemini salah ditolak, key benar memuat model', async () => {
  await call('PUT', '/api/settings', { body: { geminiApiKey: 'AIzaKunciSalah-0000000000' } });
  const bad = await call('POST', '/api/settings/test-gemini');
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /tidak valid/);
  await call('PUT', '/api/settings', { body: { geminiApiKey: 'AIzaKunciGeminiUji-000000', aiMode: 'fallback' } });
  const ok = await call('POST', '/api/settings/test-gemini');
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.models[0].id, 'gemini-2.5-flash');
  const st = await call('GET', '/api/status');
  assert.deepEqual(st.data.writers.map((w) => w.id), ['gemini']);
  const settings = await call('GET', '/api/settings');
  assert.doesNotMatch(JSON.stringify(settings.data), /AIzaKunciGeminiUji-000000/, 'key tidak dikirim utuh ke browser');
});

test('4. Google OAuth: simpan Client ID, hubungkan akun, daftar blog', async () => {
  const bad = await call('PUT', '/api/settings', { body: { googleClientId: 'salah' } });
  assert.equal(bad.status, 400);
  await call('PUT', '/api/settings', { body: { googleClientId: '123-abc.apps.googleusercontent.com', googleClientSecret: 'GOCSPX-rahasia' } });
  const start = await call('GET', '/auth/google');
  assert.equal(start.status, 302);
  const authUrl = new URL(start.location);
  assert.equal(authUrl.origin + authUrl.pathname, `${mockUrl}/auth`);
  assert.equal(authUrl.searchParams.get('redirect_uri'), `${base}/auth/google/callback`);
  assert.equal(authUrl.searchParams.get('access_type'), 'offline');
  assert.match(authUrl.searchParams.get('scope'), /blogger/);
  const state = authUrl.searchParams.get('state');

  const forged = await call('GET', `/auth/google/callback?code=kode-benar&state=palsu`);
  assert.equal(forged.status, 400, 'state palsu ditolak');
  const denied = await call('GET', `/auth/google/callback?error=access_denied`);
  assert.match(denied.location, /error=access_denied/);

  const cb = await call('GET', `/auth/google/callback?code=kode-benar&state=${state}`);
  assert.match(cb.location, /google=ok/);
  const accounts = await call('GET', '/api/google/accounts');
  assert.equal(accounts.data.length, 1);
  assert.equal(accounts.data[0].email, 'pemilik@gmail.com');
  assert.equal(accounts.data[0].refreshToken, undefined, 'refresh token tidak dikirim ke browser');
  ids.account = accounts.data[0].id;
  const blogs = await call('GET', `/api/google/accounts/${ids.account}/blogs`);
  assert.deepEqual(blogs.data.map((b) => b.id), ['111', '222', '999']);
});

test('5. situs tujuan: Blogger, WordPress, webhook ditambah dan dites', async () => {
  for (const [key, blogId, name] of [['b1', '111', 'Blog Kopi'], ['b2', '222', 'Blog Kuliner'], ['bLocked', '999', 'Blog Terkunci']]) {
    const r = await call('POST', '/api/sites', { body: { type: 'blogger', name, config: { blogId, blogUrl: `https://x${blogId}.blogspot.com/`, googleAccountId: ids.account } } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    ids[key] = r.data.id;
  }
  assert.match((await call('POST', `/api/sites/${ids.b1}/test`)).data.message, /Terhubung/);

  const wpBad = await call('POST', '/api/sites', { body: { type: 'wordpress', name: 'WP', config: { url: 'bukan-url', username: 'a', appPassword: 'b' } } });
  assert.equal(wpBad.status, 400);
  const wp = await call('POST', '/api/sites', { body: { type: 'wordpress', name: 'WP Resep', config: { url: mockUrl, username: 'editor', appPassword: 'abcd efgh' } } });
  ids.wp = wp.data.id;
  assert.equal(wp.data.config.appPassword, undefined, 'password WP tidak dikirim ke browser');
  assert.match((await call('POST', `/api/sites/${ids.wp}/test`)).data.message, /Terhubung sebagai "Editor"/);

  const hook = await call('POST', '/api/sites', { body: { type: 'webhook', name: 'Website Saya', config: { url: `${mockUrl}/hook`, secret: HOOK_SECRET } } });
  ids.hook = hook.data.id;
  assert.match((await call('POST', `/api/sites/${ids.hook}/test`)).data.message, /merespons/);

  const draft = await call('PUT', `/api/sites/${ids.b2}`, { body: { config: { draft: true } } });
  assert.equal(draft.data.config.draft, true);
  assert.equal((await call('GET', '/api/sites')).data.length, 5);
});

test('6. kampanye: validasi input, upload gambar, artikel ditulis AI dengan narasi berbeda', async () => {
  const fdBad = new FormData();
  fdBad.set('keyword', 'kopi');
  fdBad.set('description', 'pendek');
  fdBad.set('targetUrl', 'https://kopigayo.id');
  fdBad.set('siteIds', JSON.stringify([ids.b1]));
  assert.equal((await call('POST', '/api/campaigns', { multipart: fdBad })).status, 400);

  const fd = new FormData();
  fd.set('keyword', 'kopi arabika gayo');
  fd.set('brandName', 'KopiGayo');
  fd.set('description', 'Kopi arabika Gayo asli dari Aceh Tengah, disangrai setiap minggu. Tersedia biji dan bubuk. Kirim ke seluruh Indonesia.');
  fd.set('targetUrl', 'https://kopigayo.id/produk');
  fd.set('siteIds', JSON.stringify([ids.b1, ids.b2, ids.wp, ids.hook]));
  fd.set('linkRel', 'dofollow');
  fd.set('spacingMinutes', '0');
  fd.set('image', new Blob([PNG], { type: 'image/png' }), 'kopi.png');
  const r = await call('POST', '/api/campaigns', { multipart: fd });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  ids.campaign = r.data.id;

  const c = await waitFor(async () => {
    const d = (await call('GET', `/api/campaigns/${ids.campaign}`)).data;
    return d.status === 'review' ? d : null;
  }, 'artikel selesai ditulis');
  assert.equal(c.posts.length, 4);
  for (const p of c.posts) {
    assert.equal(p.status, 'generated');
    assert.equal(p.generator, 'gemini');
    assert.doesNotMatch(p.html, /<script/i, 'HTML disanitasi');
    assert.equal(p.html.split('https://kopigayo.id/produk').length - 1, 1, 'tepat satu link ke situs utama');
    assert.ok(p.similarity < 0.3, `kemiripan ${p.similarity}`);
  }
  assert.equal(new Set(c.posts.map((p) => p.angle.id)).size, 4, 'sudut pandang berbeda');
  assert.ok(new Set(c.posts.map((p) => p.anchor.text)).size >= 3, 'anchor bervariasi');
  ids.posts = Object.fromEntries(c.posts.map((p) => [p.siteId, p]));

  const img = await call('GET', `/uploads/${c.imageFile}`, { jar: false });
  assert.equal(img.status, 200, 'gambar upload bisa diakses publik tanpa login');
});

test('7. edit, tulis ulang, dan lewati artikel', async () => {
  const p = ids.posts[ids.b1];
  const edited = await call('PUT', `/api/posts/${p.id}`, { body: { title: 'Judul Baru Diedit', html: '<p>Isi baru tanpa link.</p>' } });
  assert.equal(edited.data.title, 'Judul Baru Diedit');
  assert.match(edited.data.html, /href="https:\/\/kopigayo\.id\/produk"/, 'link ke situs utama ditambahkan kembali');

  const before = ids.posts[ids.b2];
  const again = await call('POST', `/api/posts/${before.id}/regenerate`);
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.notEqual(again.data.angle.id, before.angle.id, 'sudut pandang baru');

  const skipped = await call('PUT', `/api/posts/${ids.posts[ids.hook].id}`, { body: { skip: true } });
  assert.equal(skipped.data.skip, true);
});

test('8. jadwalkan & terbitkan: WordPress dulu (gambar), lalu Blogger memakai URL gambar WordPress', async () => {
  const r = await call('POST', `/api/campaigns/${ids.campaign}/publish`, { body: { spacingMinutes: 0 } });
  assert.equal(r.data.scheduled, 3, 'artikel yang dilewati tidak dijadwalkan');
  const c = await waitFor(async () => {
    const d = (await call('GET', `/api/campaigns/${ids.campaign}`)).data;
    return d.posts.filter((p) => p.status === 'published').length === 3 ? d : null;
  }, '3 artikel terbit');

  assert.equal(seen.wpMedia, 1, 'gambar diunggah ke media library WordPress');
  assert.equal(seen.wpPosts[0].featured_media, 77);
  assert.equal(seen.wpPosts[0].status, 'publish');
  assert.match(seen.wpPosts[0].content, /<figure><img src="http:\/\/127\.0\.0\.1:\d+\/wp-content\/uploads\/gambar\.png" alt="kopi arabika gayo"/);
  assert.equal(seen.bloggerPosts.length, 2);
  for (const bp of seen.bloggerPosts) {
    assert.match(bp.content, /wp-content\/uploads\/gambar\.png/, 'Blogger memakai URL gambar dari WordPress');
    assert.match(bp.content, /href="https:\/\/kopigayo\.id\/produk"/);
  }
  assert.equal(seen.bloggerPosts.find((b) => b.blogId === '222').isDraft, 'true', 'situs mode draft dikirim sebagai draft');
  assert.equal(seen.bloggerPosts.find((b) => b.blogId === '111').title, 'Judul Baru Diedit');
  const order = c.posts.filter((p) => p.publishedAt).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).map((p) => p.siteType);
  assert.equal(order[0], 'wordpress');
  for (const p of c.posts.filter((x) => x.status === 'published')) assert.match(p.publishedUrl, /^https?:\/\//);
  assert.equal(c.status, 'done');
});

test('9. terbitkan sekarang: artikel yang dilewati dikirim ke webhook bertanda tangan', async () => {
  const r = await call('POST', `/api/posts/${ids.posts[ids.hook].id}/publish-now`);
  assert.equal(r.data.status, 'published', JSON.stringify(r.data));
  assert.equal(seen.hooks.length, 1);
  assert.equal(seen.hooks[0].targetUrl, 'https://kopigayo.id/produk');
  assert.match(seen.hooks[0].imageUrl, /wp-content\/uploads\/gambar\.png/);
  assert.equal(r.data.publishedUrl, `https://websiteku.id/${seen.hooks[0].slug}`);
});

test('10. kegagalan publikasi tercatat dengan pesan jelas', async () => {
  const fd = new FormData();
  fd.set('keyword', 'kopi luwak');
  fd.set('description', 'Kopi luwak liar dari kebun rakyat, diproses alami tanpa bahan tambahan.');
  fd.set('targetUrl', 'https://kopigayo.id/luwak');
  fd.set('siteIds', JSON.stringify([ids.bLocked]));
  fd.set('imageUrl', 'https://cdn.example.com/luwak.jpg');
  fd.set('spacingMinutes', '0');
  const camp = (await call('POST', '/api/campaigns', { multipart: fd })).data;
  const c = await waitFor(async () => {
    const d = (await call('GET', `/api/campaigns/${camp.id}`)).data;
    return d.status === 'review' ? d : null;
  }, 'artikel kedua');
  const r = await call('POST', `/api/posts/${c.posts[0].id}/publish-now`);
  assert.equal(r.data.status, 'failed');
  assert.match(r.data.error, /Blogger API 403/);
  ids.campaign2 = camp.id;
});

test('11. tanpa AI aktif: artikel tetap dibuat dengan template', async () => {
  await call('PUT', '/api/settings', { body: { aiDisabled: ['gemini'] } });
  assert.equal((await call('GET', '/api/status')).data.ai, false);
  const fd = new FormData();
  fd.set('keyword', 'kopi susu');
  fd.set('description', 'Kopi susu gula aren dengan biji arabika pilihan.');
  fd.set('targetUrl', 'https://kopigayo.id/susu');
  fd.set('siteIds', JSON.stringify([ids.hook]));
  fd.set('spacingMinutes', '0');
  const camp = (await call('POST', '/api/campaigns', { multipart: fd })).data;
  const c = await waitFor(async () => {
    const d = (await call('GET', `/api/campaigns/${camp.id}`)).data;
    return d.status === 'review' ? d : null;
  }, 'artikel template');
  assert.equal(c.posts[0].generator, 'template');
  assert.match(c.posts[0].html, /kopigayo\.id\/susu/);
  await call('PUT', '/api/settings', { body: { aiDisabled: [] } });
});

test('12. hapus kampanye menghapus artikel & gambarnya', async () => {
  const c = (await call('GET', `/api/campaigns/${ids.campaign}`)).data;
  await call('DELETE', `/api/campaigns/${ids.campaign}`);
  assert.equal((await call('GET', `/api/campaigns/${ids.campaign}`)).status, 404);
  await sleep(200);
  assert.equal(fs.existsSync(path.join(dataDir, 'uploads', c.imageFile)), false);
  assert.ok((await call('GET', '/api/campaigns')).data.every((x) => x.id !== ids.campaign));
});

test('13. ganti password dari dashboard: sesi lama ditolak, login baru berhasil', async () => {
  const oldCookie = cookie;
  const wrong = await call('POST', '/api/settings/password', { body: { currentPassword: 'salah', newPassword: 'PasswordBaru456', confirmPassword: 'PasswordBaru456' } });
  assert.equal(wrong.status, 400);
  const ok = await call('POST', '/api/settings/password', { body: { currentPassword: PASSWORD, newPassword: 'PasswordBaru456', confirmPassword: 'PasswordBaru456' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await call('GET', '/api/status')).status, 200, 'browser ini tetap login');
  assert.equal((await call('GET', '/api/status', { cookieOverride: oldCookie })).status, 401, 'sesi lama tidak berlaku');
  const relog = await call('POST', '/login', { form: { username: 'admin', password: 'PasswordBaru456' }, jar: false });
  assert.equal(relog.location, '/');
  const settingsFile = fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8');
  assert.doesNotMatch(settingsFile, /PasswordBaru456/, 'password disimpan sebagai hash');
});

test('14. data & pengaturan tetap ada setelah server restart; logout', async () => {
  child.kill();
  await new Promise((r) => child.once('exit', r));
  await startServer();
  assert.equal((await call('GET', '/api/status')).status, 200, 'sesi tetap berlaku setelah restart');
  assert.equal((await call('GET', '/api/sites')).data.length, 5);
  assert.equal((await call('GET', '/api/google/accounts')).data.length, 1);
  assert.deepEqual((await call('GET', '/api/status')).data.writers.map((w) => w.id), ['gemini']);
  const camps = (await call('GET', '/api/campaigns')).data;
  assert.ok(camps.some((c) => c.id === ids.campaign2));
  const out = await call('GET', '/logout');
  assert.match(out.location, /\/login$/);
  assert.match(out.setCookie, /Max-Age=0/);
  cookie = '';
  assert.equal((await call('GET', '/api/status')).status, 401);
});
