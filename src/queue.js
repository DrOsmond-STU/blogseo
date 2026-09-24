// Antrean publikasi: postingan dijadwalkan dengan jeda antar blog supaya tidak
// terbit serentak (pola serentak di banyak blog terlihat tidak alami), lalu worker
// memublikasikannya satu per satu dan mencoba ulang bila gagal.
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { publisherFor } from './publishers/index.js';
import { imageFigure, insertAfterFirstParagraph } from './generator/html.js';

const MAX_ATTEMPTS = 3;
let running = false;

function isPublicBaseUrl() {
  return /^https?:\/\//.test(config.publicBaseUrl) && !/\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(config.publicBaseUrl);
}

// Menentukan URL gambar yang bisa diakses publik untuk sebuah kampanye.
function publicImageUrl(campaign) {
  if (campaign.imageUrl) return campaign.imageUrl;
  if (campaign.hostedImageUrl) return campaign.hostedImageUrl;
  if (campaign.imageFile && isPublicBaseUrl()) return `${config.publicBaseUrl}/uploads/${campaign.imageFile}`;
  return null;
}

function imageFor(campaign, site, post) {
  const alt = campaign.keyword;
  const caption = post.imageCaption;
  const buildFigure = (src) => imageFigure({ src, alt, caption });
  if (site.type === 'wordpress' && campaign.imageFile && !campaign.imageUrl) {
    return {
      localPath: path.join(config.uploadDir, campaign.imageFile),
      filename: campaign.imageFile,
      mime: campaign.imageMime,
      alt,
      buildFigure,
      onHosted: (url) => {
        if (!campaign.hostedImageUrl) db.update('campaigns', campaign.id, { hostedImageUrl: url });
      },
    };
  }
  const url = publicImageUrl(campaign);
  if (!url) return null;
  return { publicUrl: url, alt, figureHtml: buildFigure(url), buildFigure };
}

function wrapPost(post) {
  return { ...post, htmlWithImage: (figure) => insertAfterFirstParagraph(post.html, figure) };
}

export function schedulePosts(campaign, posts, { startAt = Date.now() } = {}) {
  const sites = new Map(db.all('sites').map((s) => [s.id, s]));
  // Jika gambar hanya di-upload lokal, terbitkan ke WordPress lebih dulu supaya
  // gambar mendapat URL publik dari media library dan bisa dipakai blog lain.
  const ordered = [...posts].sort((a, b) => {
    if (!campaign.imageFile || isPublicBaseUrl() || campaign.imageUrl) return 0;
    const wa = sites.get(a.siteId)?.type === 'wordpress' ? 0 : 1;
    const wb = sites.get(b.siteId)?.type === 'wordpress' ? 0 : 1;
    return wa - wb;
  });
  const spacingMs = Math.max(0, Number(campaign.spacingMinutes || 0)) * 60_000;
  ordered.forEach((post, i) => {
    const jitter = spacingMs ? Math.floor(Math.random() * spacingMs * 0.3) : 0;
    db.update('posts', post.id, {
      status: 'scheduled',
      // +i detik menjaga urutan walau jeda 0
      scheduledAt: new Date(startAt + i * (spacingMs + 1000) + (i ? jitter : 0)).toISOString(),
      attempts: 0,
      error: null,
    });
  });
  db.update('campaigns', campaign.id, { status: 'publishing' });
}

export async function publishPost(post) {
  const site = db.get('sites', post.siteId);
  const campaign = db.get('campaigns', post.campaignId);
  if (!site || !campaign) throw new Error('Situs atau kampanye sudah dihapus.');
  const image = imageFor(campaign, site, post);
  const warnings = [];
  if ((campaign.imageFile || campaign.imageUrl) && !image) {
    warnings.push('Gambar tidak disertakan: isi PUBLIC_BASE_URL dengan domain publik, pakai URL gambar, atau sertakan minimal satu situs WordPress.');
  }
  const result = await publisherFor(site).publish({ site, post: wrapPost(post), campaign, image });
  return { ...result, warnings };
}

function refreshCampaignStatus(campaignId) {
  const posts = db.find('posts', (p) => p.campaignId === campaignId);
  if (posts.some((p) => p.status === 'scheduled' || p.status === 'publishing')) return;
  const campaign = db.get('campaigns', campaignId);
  if (campaign && campaign.status === 'publishing') db.update('campaigns', campaignId, { status: 'done' });
}

export async function tick() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const due = db
      .find('posts', (p) => p.status === 'scheduled' && new Date(p.scheduledAt).getTime() <= now)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    for (const post of due) {
      db.update('posts', post.id, { status: 'publishing' });
      try {
        const { url, remoteId, warnings } = await publishPost(post);
        db.update('posts', post.id, {
          status: 'published',
          publishedAt: new Date().toISOString(),
          publishedUrl: url,
          remoteId,
          warnings,
          error: null,
        });
      } catch (err) {
        const attempts = (post.attempts || 0) + 1;
        const retry = attempts < MAX_ATTEMPTS;
        db.update('posts', post.id, {
          status: retry ? 'scheduled' : 'failed',
          attempts,
          error: err.message || String(err),
          // coba lagi 5, lalu 20 menit kemudian
          scheduledAt: retry ? new Date(Date.now() + 5 * 60_000 * 4 ** (attempts - 1)).toISOString() : post.scheduledAt,
        });
      }
      refreshCampaignStatus(post.campaignId);
    }
  } finally {
    running = false;
  }
}

export function startQueue() {
  // Postingan yang tertahan di status "publishing" (mis. server mati di tengah jalan) dijadwalkan ulang.
  for (const p of db.find('posts', (x) => x.status === 'publishing')) {
    db.update('posts', p.id, { status: 'scheduled' });
  }
  const timer = setInterval(() => tick().catch((err) => console.error('[queue]', err)), config.queueIntervalMs);
  timer.unref();
  tick().catch((err) => console.error('[queue]', err));
}
