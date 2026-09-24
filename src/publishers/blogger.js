// Publikasi ke Blogger (blogspot) via Blogger API v3.
import { db } from '../db.js';
import { getAccessToken } from '../google.js';

const API = 'https://www.googleapis.com/blogger/v3';

async function bloggerFetch(account, path, options = {}) {
  const token = await getAccessToken(account);
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Blogger API ${res.status}: ${data.error?.message || res.statusText}`);
  return data;
}

function accountFor(site) {
  const account = db.get('googleAccounts', site.config.googleAccountId);
  if (!account) throw new Error('Akun Google untuk blog ini tidak ditemukan. Hubungkan ulang akun Google.');
  return account;
}

export async function listBlogs(account) {
  const data = await bloggerFetch(account, '/users/self/blogs');
  return (data.items || []).map((b) => ({ id: b.id, name: b.name, url: b.url }));
}

export async function testConnection(site) {
  const data = await bloggerFetch(accountFor(site), `/blogs/${site.config.blogId}`);
  return `Terhubung ke "${data.name}" (${data.url})`;
}

export async function publish({ site, post, image }) {
  const content = image?.figureHtml ? post.htmlWithImage(image.figureHtml) : post.html;
  const data = await bloggerFetch(accountFor(site), `/blogs/${site.config.blogId}/posts/?isDraft=${site.config.draft ? 'true' : 'false'}`, {
    method: 'POST',
    body: JSON.stringify({
      kind: 'blogger#post',
      title: post.title,
      content,
      labels: post.labels,
    }),
  });
  return { url: data.url, remoteId: data.id };
}
