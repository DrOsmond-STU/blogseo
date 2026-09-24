// Utilitas HTML: escape, sanitasi hasil AI, sisip gambar & link.

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ALLOWED_TAGS = new Set([
  'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'a',
  'blockquote', 'br', 'figure', 'figcaption', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);
const ALLOWED_ATTRS = {
  a: ['href', 'rel', 'target', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
};

// Sanitasi ringan: buang tag berbahaya beserta isinya, lalu buang tag/atribut
// yang tidak ada di daftar putih. Cukup untuk konten yang kita hasilkan sendiri.
export function sanitizeHtml(html = '') {
  let out = String(html).replace(/<(script|style|iframe|object|embed|form|noscript)[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (match, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (match.startsWith('</')) return `</${tag}>`;
    const allowed = ALLOWED_ATTRS[tag] || [];
    const attrs = [];
    const attrRe = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m;
    while ((m = attrRe.exec(rawAttrs))) {
      const name = m[1].toLowerCase();
      const value = m[3] ?? m[4] ?? m[5] ?? '';
      if (!allowed.includes(name)) continue;
      if ((name === 'href' || name === 'src') && !/^(https?:)?\/\//i.test(value.trim())) continue;
      attrs.push(`${name}="${escapeHtml(value)}"`);
    }
    const selfClose = tag === 'br' || tag === 'img';
    return `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}${selfClose ? ' /' : ''}>`;
  });
  return out.trim();
}

export function relAttribute(linkRel) {
  // "dofollow" bukan nilai rel resmi; link tanpa rel sudah dofollow.
  return linkRel && linkRel !== 'dofollow' ? ` rel="${escapeHtml(linkRel)}"` : '';
}

export function buildLink(url, text, linkRel) {
  return `<a href="${escapeHtml(url)}"${relAttribute(linkRel)}>${escapeHtml(text)}</a>`;
}

export function containsLinkTo(html, url) {
  const target = url.replace(/\/+$/, '');
  const re = /<a\s[^>]*href="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1].replace(/&amp;/g, '&').replace(/\/+$/, '') === target) return true;
  }
  return false;
}

// Pastikan link ke situs utama memakai atribut rel yang dipilih dan ada tepat satu kali.
export function ensureTargetLink(html, { targetUrl, anchorText, linkRel }) {
  const target = targetUrl.replace(/\/+$/, '');
  let seen = false;
  let out = html.replace(/<a\s([^>]*)href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi, (match, pre, href, post, inner) => {
    if (href.replace(/&amp;/g, '&').replace(/\/+$/, '') !== target) return match;
    if (seen) return inner; // link ganda ke URL yang sama dijadikan teks biasa
    seen = true;
    return `<a href="${escapeHtml(targetUrl)}"${relAttribute(linkRel)}>${inner}</a>`;
  });
  if (!seen) {
    out += `\n<p>Untuk informasi lebih lanjut, ${buildLink(targetUrl, anchorText, linkRel)}.</p>`;
  }
  return out;
}

export function imageFigure({ src, alt, caption }) {
  if (!src) return '';
  return (
    `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" title="${escapeHtml(alt)}" loading="lazy" />` +
    (caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '') +
    '</figure>'
  );
}

// Sisipkan gambar setelah paragraf pertama (posisi yang umum untuk SEO & keterbacaan).
export function insertAfterFirstParagraph(html, snippet) {
  if (!snippet) return html;
  const idx = html.indexOf('</p>');
  if (idx === -1) return snippet + '\n' + html;
  return html.slice(0, idx + 4) + '\n' + snippet + '\n' + html.slice(idx + 4);
}

export function stripTags(html = '') {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

export function slugify(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
