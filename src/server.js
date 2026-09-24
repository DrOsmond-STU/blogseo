import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { config, aiEnabled, googleEnabled } from './config.js';
import { db } from './db.js';
import { buildAuthUrl, consumeState, exchangeCode } from './google.js';
import { listBlogs } from './publishers/blogger.js';
import { publisherFor } from './publishers/index.js';
import { generateCampaignArticles, generateArticle, SIMILARITY_LIMIT, finalizeArticle } from './generator/index.js';
import { assignAngles, ANGLES } from './generator/angles.js';
import { planAnchors } from './generator/anchors.js';
import { maxSimilarities } from './generator/similarity.js';
import { schedulePosts, publishPost, startQueue } from './queue.js';
import { isLoggedIn, loginHandler, logoutHandler, requireLogin } from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(config.uploadDir, { recursive: true });

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use(express.urlencoded({ extended: false, limit: '20kb' }));

const publicDir = path.join(here, '..', 'public');

// Gambar upload harus bisa diakses publik: artikel di Blogger/website lain menautkannya.
// Nama file acak, jadi tidak bisa ditebak.
app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d' }));

// ---- Login ----
app.get('/login', (req, res) => (isLoggedIn(req) ? res.redirect('/') : res.sendFile(path.join(publicDir, 'login.html'))));
app.post('/login', loginHandler);
app.get('/logout', logoutHandler);
app.get('/style.css', (req, res) => res.sendFile(path.join(publicDir, 'style.css')));
if (!config.adminPassword) {
  console.warn('[peringatan] ADMIN_PASSWORD kosong: dashboard terbuka tanpa login. Jangan jalankan di server publik.');
}
app.use(requireLogin);

app.use(express.static(publicDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype];
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => res.status(err.status || 500).json({ error: err.message || String(err) }));

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

// Kredensial tidak pernah dikirim ke browser.
function publicSite(site) {
  const { appPassword, secret, ...rest } = site.config;
  return { ...site, config: { ...rest, hasSecret: Boolean(appPassword || secret) } };
}

// ---- Status ----
app.get('/api/status', (req, res) => {
  res.json({
    user: config.adminPassword ? config.adminUser : null,
    ai: aiEnabled(),
    model: aiEnabled() ? config.claudeModel : null,
    google: googleEnabled(),
    publicBaseUrl: config.publicBaseUrl,
    redirectUri: `${config.publicBaseUrl}/auth/google/callback`,
    angles: ANGLES.map(({ id, name }) => ({ id, name })),
    similarityLimit: SIMILARITY_LIMIT,
  });
});

// ---- Google / Blogger ----
app.get('/auth/google', (req, res) => {
  if (!googleEnabled()) return res.status(400).send('GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET belum diisi di .env');
  res.redirect(buildAuthUrl());
});

app.get('/auth/google/callback', wrap(async (req, res) => {
  if (req.query.error) return res.redirect(`/#sites?error=${encodeURIComponent(req.query.error)}`);
  if (!consumeState(req.query.state)) return res.status(400).send('State OAuth tidak valid atau kedaluwarsa. Ulangi dari dashboard.');
  const { email, refreshToken } = await exchangeCode(req.query.code);
  const existing = db.find('googleAccounts', (a) => a.email && a.email === email)[0];
  if (existing) db.update('googleAccounts', existing.id, { refreshToken });
  else db.insert('googleAccounts', { email, refreshToken });
  res.redirect('/#sites?google=ok');
}));

app.get('/api/google/accounts', (req, res) => {
  res.json(db.all('googleAccounts').map(({ id, email, createdAt }) => ({ id, email, createdAt })));
});

app.delete('/api/google/accounts/:id', (req, res) => {
  db.remove('googleAccounts', req.params.id);
  res.json({ ok: true });
});

app.get('/api/google/accounts/:id/blogs', wrap(async (req, res) => {
  const account = db.get('googleAccounts', req.params.id);
  if (!account) throw badRequest('Akun tidak ditemukan');
  res.json(await listBlogs(account));
}));

// ---- Situs tujuan ----
app.get('/api/sites', (req, res) => res.json(db.all('sites').map(publicSite)));

function validateSite(body, existing) {
  const type = existing?.type || body.type;
  const name = String(body.name || existing?.name || '').trim();
  const cfg = { ...(existing?.config || {}), ...(body.config || {}) };
  if (!name) throw badRequest('Nama situs wajib diisi');
  if (type === 'blogger') {
    if (!cfg.blogId || !cfg.googleAccountId) throw badRequest('Pilih akun Google dan blog');
  } else if (type === 'wordpress') {
    if (!isHttpUrl(cfg.url)) throw badRequest('URL WordPress tidak valid');
    if (!cfg.username || !cfg.appPassword) throw badRequest('Username dan Application Password wajib diisi');
  } else if (type === 'webhook') {
    if (!isHttpUrl(cfg.url)) throw badRequest('URL webhook tidak valid');
  } else {
    throw badRequest('Tipe situs harus blogger, wordpress, atau webhook');
  }
  cfg.draft = Boolean(cfg.draft);
  return { type, name, config: cfg, active: body.active ?? existing?.active ?? true };
}

app.post('/api/sites', wrap(async (req, res) => {
  res.json(publicSite(db.insert('sites', validateSite(req.body))));
}));

app.put('/api/sites/:id', wrap(async (req, res) => {
  const site = db.get('sites', req.params.id);
  if (!site) throw badRequest('Situs tidak ditemukan');
  const body = { ...req.body, config: { ...(req.body.config || {}) } };
  // kolom rahasia yang dikosongkan berarti "tidak diubah"
  for (const key of ['appPassword', 'secret']) if (!body.config[key]) delete body.config[key];
  res.json(publicSite(db.update('sites', site.id, validateSite(body, site))));
}));

app.delete('/api/sites/:id', (req, res) => {
  db.remove('sites', req.params.id);
  res.json({ ok: true });
});

app.post('/api/sites/:id/test', wrap(async (req, res) => {
  const site = db.get('sites', req.params.id);
  if (!site) throw badRequest('Situs tidak ditemukan');
  res.json({ message: await publisherFor(site).testConnection(site) });
}));

// ---- Kampanye ----
function campaignView(campaign) {
  const posts = db.find('posts', (p) => p.campaignId === campaign.id);
  const counts = posts.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] || 0) + 1 }), {});
  const imageSrc = campaign.imageUrl || (campaign.imageFile ? `/uploads/${campaign.imageFile}` : null);
  return { ...campaign, imageSrc, counts, total: posts.length };
}

app.get('/api/campaigns', (req, res) => {
  const list = [...db.all('campaigns')].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(list.map(campaignView));
});

app.get('/api/campaigns/:id', (req, res) => {
  const campaign = db.get('campaigns', req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Kampanye tidak ditemukan' });
  const sites = new Map(db.all('sites').map((s) => [s.id, s]));
  const posts = db
    .find('posts', (p) => p.campaignId === campaign.id)
    .map((p) => ({ ...p, siteName: sites.get(p.siteId)?.name || '(dihapus)', siteType: sites.get(p.siteId)?.type }));
  res.json({ ...campaignView(campaign), posts });
});

async function runGeneration(campaign) {
  const siteIds = campaign.siteIds.filter((id) => db.get('sites', id));
  const sites = siteIds.map((id) => db.get('sites', id));
  db.update('campaigns', campaign.id, { status: 'generating', progress: { done: 0, total: sites.length } });
  try {
    const results = await generateCampaignArticles(campaign, sites, {
      onProgress: (done, total) => db.update('campaigns', campaign.id, { progress: { done, total } }),
    });
    for (const r of results) {
      db.insert('posts', {
        campaignId: campaign.id,
        siteId: r.site.id,
        status: r.ok ? 'generated' : 'failed',
        error: r.ok ? null : r.error,
        similarity: r.similarity,
        ...(r.ok ? r.article : { title: '', html: '', labels: [], metaDescription: '' }),
      });
    }
    db.update('campaigns', campaign.id, { status: 'review' });
  } catch (err) {
    db.update('campaigns', campaign.id, { status: 'error', error: err.message });
  }
}

app.post('/api/campaigns', upload.single('image'), wrap(async (req, res) => {
  const body = req.body;
  const keyword = String(body.keyword || '').trim();
  const description = String(body.description || '').trim();
  const targetUrl = String(body.targetUrl || '').trim();
  const imageUrl = String(body.imageUrl || '').trim();
  let siteIds = [];
  try {
    siteIds = JSON.parse(body.siteIds || '[]');
  } catch {
    siteIds = [];
  }
  if (!keyword) throw badRequest('Kata kunci wajib diisi');
  if (description.length < 20) throw badRequest('Deskripsi minimal 20 karakter agar artikel punya bahan');
  if (!isHttpUrl(targetUrl)) throw badRequest('URL tujuan tidak valid (harus diawali http:// atau https://)');
  if (imageUrl && !isHttpUrl(imageUrl)) throw badRequest('URL gambar tidak valid');
  siteIds = siteIds.filter((id) => db.get('sites', id));
  if (!siteIds.length) throw badRequest('Pilih minimal satu situs tujuan');

  const campaign = db.insert('campaigns', {
    keyword,
    description,
    targetUrl,
    brandName: String(body.brandName || '').trim(),
    imageUrl: imageUrl || null,
    imageFile: req.file?.filename || null,
    imageMime: req.file?.mimetype || null,
    siteIds,
    linkRel: ['dofollow', 'nofollow', 'sponsored'].includes(body.linkRel) ? body.linkRel : 'dofollow',
    spacingMinutes: Math.max(0, Number(body.spacingMinutes ?? 60)),
    status: 'generating',
  });
  runGeneration(campaign); // berjalan di latar belakang; UI memantau progres
  res.json(campaignView(campaign));
}));

app.delete('/api/campaigns/:id', (req, res) => {
  const campaign = db.get('campaigns', req.params.id);
  if (campaign?.imageFile) fs.rm(path.join(config.uploadDir, campaign.imageFile), { force: true }, () => {});
  db.removeWhere('posts', (p) => p.campaignId === req.params.id);
  db.remove('campaigns', req.params.id);
  res.json({ ok: true });
});

// Jadwalkan semua artikel yang sudah direview.
app.post('/api/campaigns/:id/publish', wrap(async (req, res) => {
  const campaign = db.get('campaigns', req.params.id);
  if (!campaign) throw badRequest('Kampanye tidak ditemukan');
  if (req.body.spacingMinutes !== undefined) {
    db.update('campaigns', campaign.id, { spacingMinutes: Math.max(0, Number(req.body.spacingMinutes)) });
  }
  const posts = db.find('posts', (p) => p.campaignId === campaign.id && p.status === 'generated' && !p.skip);
  if (!posts.length) throw badRequest('Tidak ada artikel yang siap dipublikasikan');
  schedulePosts(db.get('campaigns', campaign.id), posts);
  res.json({ scheduled: posts.length });
}));

// ---- Postingan individual ----
function recomputeSimilarity(campaignId) {
  const posts = db.find('posts', (p) => p.campaignId === campaignId && p.html);
  const sims = maxSimilarities(posts.map((p) => p.html));
  posts.forEach((p, i) => db.update('posts', p.id, { similarity: sims[i] }));
}

app.put('/api/posts/:id', wrap(async (req, res) => {
  const post = db.get('posts', req.params.id);
  if (!post) throw badRequest('Artikel tidak ditemukan');
  if (!['generated', 'failed'].includes(post.status)) throw badRequest('Artikel yang sudah dijadwalkan/terbit tidak bisa diedit');
  const campaign = db.get('campaigns', post.campaignId);
  const edited = finalizeArticle(
    {
      title: req.body.title ?? post.title,
      metaDescription: req.body.metaDescription ?? post.metaDescription,
      labels: req.body.labels ?? post.labels,
      html: req.body.html ?? post.html,
      imageCaption: post.imageCaption,
    },
    { targetUrl: campaign.targetUrl, anchorText: post.anchor?.text || campaign.keyword, linkRel: campaign.linkRel },
  );
  db.update('posts', post.id, { ...edited, skip: Boolean(req.body.skip ?? post.skip), status: 'generated', error: null });
  recomputeSimilarity(post.campaignId);
  res.json(db.get('posts', post.id));
}));

app.post('/api/posts/:id/regenerate', wrap(async (req, res) => {
  const post = db.get('posts', req.params.id);
  if (!post) throw badRequest('Artikel tidak ditemukan');
  if (!['generated', 'failed'].includes(post.status)) throw badRequest('Artikel yang sudah dijadwalkan/terbit tidak bisa ditulis ulang');
  const campaign = db.get('campaigns', post.campaignId);
  const site = db.get('sites', post.siteId);
  if (!site) throw badRequest('Situs tujuan sudah dihapus');
  const used = new Set(db.find('posts', (p) => p.campaignId === campaign.id).map((p) => p.angle?.id));
  // Pilih sudut pandang yang belum dipakai di kampanye ini jika ada.
  const candidates = assignAngles(ANGLES.length, `${campaign.id}:${Date.now()}`);
  const angle = candidates.find((a) => !used.has(a.id)) || { ...candidates[0], variant: 2 };
  const anchor = post.anchor || planAnchors(1, { keyword: campaign.keyword, targetUrl: campaign.targetUrl, brandName: campaign.brandName, seed: post.id })[0];
  const article = await generateArticle({ campaign, site, angle, anchor });
  db.update('posts', post.id, { ...article, status: 'generated', error: null });
  recomputeSimilarity(campaign.id);
  res.json(db.get('posts', post.id));
}));

// Terbitkan satu artikel sekarang juga (tanpa menunggu antrean).
app.post('/api/posts/:id/publish-now', wrap(async (req, res) => {
  const post = db.get('posts', req.params.id);
  if (!post) throw badRequest('Artikel tidak ditemukan');
  if (!['generated', 'failed', 'scheduled'].includes(post.status) || !post.html) throw badRequest('Artikel tidak bisa dipublikasikan');
  db.update('posts', post.id, { status: 'publishing' });
  try {
    const { url, remoteId, warnings } = await publishPost(post);
    db.update('posts', post.id, { status: 'published', publishedAt: new Date().toISOString(), publishedUrl: url, remoteId, warnings, error: null });
  } catch (err) {
    db.update('posts', post.id, { status: 'failed', error: err.message });
  }
  const campaign = db.get('campaigns', post.campaignId);
  if (campaign.status === 'review') db.update('campaigns', campaign.id, { status: 'publishing' });
  const remaining = db.find('posts', (p) => p.campaignId === campaign.id && ['generated', 'scheduled', 'publishing'].includes(p.status) && !p.skip);
  if (!remaining.length) db.update('campaigns', campaign.id, { status: 'done' });
  res.json(db.get('posts', post.id));
}));

app.use((err, req, res, next) => {
  res.status(err.status || 400).json({ error: err.message || String(err) });
});

export function start() {
  // Kampanye yang terputus saat server mati di tengah pembuatan artikel.
  for (const c of db.find('campaigns', (x) => x.status === 'generating')) {
    db.update('campaigns', c.id, { status: 'error', error: 'Server berhenti saat membuat artikel. Hapus dan buat ulang kampanye.' });
  }
  startQueue();
  return app.listen(config.port, config.host, () => {
    console.log(`BlogSEO berjalan di http://${config.host || 'localhost'}:${config.port}`);
    console.log(`Mode penulisan: ${aiEnabled() ? `AI (${config.claudeModel})` : 'template (isi ANTHROPIC_API_KEY untuk mode AI)'}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start();
}

export { app };
