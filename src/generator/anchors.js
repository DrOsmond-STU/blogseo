// Variasi anchor text. Anchor yang semuanya persis sama dengan kata kunci
// (exact match) adalah pola yang paling mudah dikenali mesin pencari sebagai
// link buatan, jadi engine mencampur beberapa jenis anchor seperti pola link alami.
import { shuffle } from './angles.js';

const GENERIC = [
  'selengkapnya di sini',
  'kunjungi situs resminya',
  'baca informasi lengkapnya',
  'lihat detailnya',
  'sumber ini',
  'halaman ini',
];

const PARTIAL_TEMPLATES = [
  (k) => `informasi seputar ${k}`,
  (k) => `panduan ${k}`,
  (k) => `pilihan ${k} terpercaya`,
  (k) => `layanan ${k}`,
  (k) => `referensi ${k}`,
];

export function brandFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const name = host.split('.')[0];
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return '';
  }
}

export function nakedUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '');
  } catch {
    return url;
  }
}

// Proporsi kira-kira: brand 30%, generik 25%, partial 20%, naked URL 15%, exact 10%.
const PLAN = ['brand', 'generic', 'partial', 'naked', 'brand', 'generic', 'partial', 'exact', 'brand', 'naked'];

export function planAnchors(count, { keyword, targetUrl, brandName, seed = '' }) {
  const brand = brandName || brandFromUrl(targetUrl) || keyword;
  const kinds = shuffle(
    Array.from({ length: count }, (_, i) => PLAN[i % PLAN.length]),
    `${seed}:anchors`,
  );
  const generic = shuffle([...GENERIC], `${seed}:generic`);
  const partial = shuffle([...PARTIAL_TEMPLATES], `${seed}:partial`);
  let g = 0;
  let p = 0;
  return kinds.map((kind) => {
    switch (kind) {
      case 'brand':
        return { kind, text: brand };
      case 'generic':
        return { kind, text: generic[g++ % generic.length] };
      case 'partial':
        return { kind, text: partial[p++ % partial.length](keyword) };
      case 'naked':
        return { kind, text: nakedUrl(targetUrl) };
      default:
        return { kind: 'exact', text: keyword };
    }
  });
}
