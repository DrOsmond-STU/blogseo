// Publikasi ke website lain (CMS buatan sendiri, Laravel, Ghost via middleware, dll.)
// melalui webhook JSON yang ditandatangani HMAC-SHA256.
//
// Server penerima menerima POST JSON dan sebaiknya membalas JSON { "url": "https://..." }.
// Verifikasi: hmac_sha256(secret, rawBody) === header "X-BlogSEO-Signature".
import crypto from 'node:crypto';

function sign(secret, body) {
  return crypto.createHmac('sha256', secret || '').update(body).digest('hex');
}

async function send(site, payload) {
  const body = JSON.stringify(payload);
  const res = await fetch(site.config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-BlogSEO-Signature': sign(site.config.secret, body),
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Webhook ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function testConnection(site) {
  await send(site, { event: 'ping' });
  return `Webhook ${site.config.url} merespons dengan sukses`;
}

export async function publish({ site, post, campaign, image }) {
  const data = await send(site, {
    event: 'post.publish',
    title: post.title,
    slug: post.slug,
    html: image?.figureHtml ? post.htmlWithImage(image.figureHtml) : post.html,
    excerpt: post.metaDescription,
    labels: post.labels,
    keyword: campaign.keyword,
    targetUrl: campaign.targetUrl,
    imageUrl: image?.publicUrl || null,
    imageAlt: image?.alt || null,
    draft: Boolean(site.config.draft),
  });
  return { url: data.url || '', remoteId: data.id ? String(data.id) : '' };
}
