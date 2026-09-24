// Publikasi ke WordPress (self-hosted atau WordPress.com dengan plugin REST)
// memakai REST API + Application Password (Users → Profile → Application Passwords).
import fs from 'node:fs';

function base(site) {
  return site.config.url.replace(/\/+$/, '') + '/wp-json/wp/v2';
}

function authHeader(site) {
  const token = Buffer.from(`${site.config.username}:${site.config.appPassword.replace(/\s+/g, '')}`).toString('base64');
  return `Basic ${token}`;
}

async function wpFetch(site, path, options = {}) {
  const res = await fetch(`${base(site)}${path}`, {
    ...options,
    headers: { Authorization: authHeader(site), ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WordPress ${res.status}: ${data.message || res.statusText}`);
  return data;
}

export async function testConnection(site) {
  const me = await wpFetch(site, '/users/me?context=edit');
  return `Terhubung sebagai "${me.name}" di ${site.config.url}`;
}

async function ensureTags(site, labels) {
  const ids = [];
  for (const name of labels) {
    try {
      const found = await wpFetch(site, `/tags?search=${encodeURIComponent(name)}&per_page=20`);
      const match = found.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (match) {
        ids.push(match.id);
        continue;
      }
      const created = await wpFetch(site, '/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      ids.push(created.id);
    } catch {
      // tag gagal dibuat bukan alasan membatalkan posting
    }
  }
  return ids;
}

export async function uploadMedia(site, { localPath, filename, mime, alt }) {
  const media = await wpFetch(site, '/media', {
    method: 'POST',
    headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${filename}"` },
    body: fs.readFileSync(localPath),
  });
  await wpFetch(site, `/media/${media.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alt_text: alt, title: alt }),
  }).catch(() => {});
  return { id: media.id, url: media.source_url };
}

export async function publish({ site, post, image }) {
  let featuredMedia;
  let figureHtml = image?.figureHtml;
  // Gambar hasil upload diunggah ke media library WordPress agar tidak bergantung pada server ini.
  if (image?.localPath) {
    const media = await uploadMedia(site, { ...image, alt: image.alt });
    featuredMedia = media.id;
    figureHtml = image.buildFigure(media.url);
    image.onHosted?.(media.url);
  }
  const tags = await ensureTags(site, post.labels);
  const data = await wpFetch(site, '/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: post.title,
      content: figureHtml ? post.htmlWithImage(figureHtml) : post.html,
      excerpt: post.metaDescription,
      slug: post.slug,
      status: site.config.draft ? 'draft' : 'publish',
      tags,
      ...(site.config.categoryId ? { categories: [Number(site.config.categoryId)] } : {}),
      ...(featuredMedia ? { featured_media: featuredMedia } : {}),
    }),
  });
  return { url: data.link, remoteId: String(data.id) };
}
