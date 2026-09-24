// Mengukur kemiripan antar artikel (Jaccard atas 3-gram kata).
// Dipakai untuk memastikan artikel di tiap blog benar-benar berbeda narasinya.
import { stripTags } from './html.js';

function shingles(text, size = 3) {
  const words = stripTags(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i + size <= words.length; i++) set.add(words.slice(i, i + size).join(' '));
  return set;
}

export function similarity(a, b) {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const s of A) if (B.has(s)) inter++;
  return inter / (A.size + B.size - inter);
}

// Untuk setiap artikel, hitung kemiripan tertinggi terhadap artikel lain.
export function maxSimilarities(htmlList) {
  const sets = htmlList.map((h) => shingles(h));
  return sets.map((A, i) => {
    let max = 0;
    sets.forEach((B, j) => {
      if (i === j || !A.size || !B.size) return;
      let inter = 0;
      for (const s of A) if (B.has(s)) inter++;
      max = Math.max(max, inter / (A.size + B.size - inter));
    });
    return Math.round(max * 1000) / 1000;
  });
}
