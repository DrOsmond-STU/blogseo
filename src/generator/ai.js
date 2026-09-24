// Generator artikel memakai Claude API. Setiap panggilan menulis satu artikel
// dengan sudut pandang (angle) tertentu, jadi tiap blog mendapat narasi berbeda.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

let client = null;
let clientKey = null;
// Klien dibuat ulang jika API key diganti dari halaman Pengaturan.
export function getClient() {
  if (!client || clientKey !== config.anthropicApiKey) {
    client = new Anthropic({ apiKey: config.anthropicApiKey });
    clientKey = config.anthropicApiKey;
  }
  return client;
}

// Model yang mendukung parameter fallbacks sisi server.
const FALLBACK_MODELS = new Set(['claude-opus-5']);

const ARTICLE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Judul artikel, 50–65 karakter, memuat kata kunci secara alami.' },
    metaDescription: { type: 'string', description: 'Meta description 140–160 karakter.' },
    labels: { type: 'array', items: { type: 'string' }, description: '3–5 label/tag relevan.' },
    html: { type: 'string', description: 'Isi artikel dalam HTML.' },
    imageCaption: { type: 'string', description: 'Keterangan singkat untuk gambar utama.' },
  },
  required: ['title', 'metaDescription', 'labels', 'html', 'imageCaption'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Anda adalah penulis konten SEO berbahasa Indonesia yang menulis artikel orisinal dan benar-benar bermanfaat bagi pembaca.

Aturan penulisan:
- Tulis 700–1000 kata dalam Bahasa Indonesia yang natural, bukan terjemahan kaku.
- Gunakan kata kunci utama di judul, di paragraf pertama, dan di satu subjudul; sisanya pakai sinonim dan variasi alami. Jangan menjejalkan kata kunci.
- HTML hanya boleh memakai tag: h2, h3, p, ul, ol, li, strong, em, blockquote, a. Jangan pakai h1 (judul sudah terpisah), jangan pakai gambar, style, atau script.
- Sisipkan tepat SATU link ke URL tujuan dengan anchor text yang diberikan, di tengah paragraf yang relevan (bukan di kalimat pertama). Jangan menambahkan link lain ke URL tujuan.
- Jangan mengarang fakta spesifik yang tidak diberikan: angka statistik, harga, nama orang, testimoni, penghargaan, atau klaim "nomor 1". Jika butuh contoh, buat contoh yang jelas bersifat ilustrasi.
- Ikuti sudut pandang dan gaya yang diminta dengan sungguh-sungguh; struktur dan pembukaan artikel harus khas sudut pandang tersebut.`;

function buildUserPrompt({ keyword, description, targetUrl, anchorText, angle, siteName }) {
  return `Kata kunci utama: ${keyword}
Deskripsi dari pemilik situs (sumber fakta satu-satunya tentang produk/layanan):
"""
${description}
"""
URL tujuan: ${targetUrl}
Anchor text untuk link: ${anchorText}
Blog tempat artikel ini terbit: ${siteName}

Sudut pandang artikel: ${angle.name}${angle.variant > 1 ? ` (versi ke-${angle.variant}, buat pembukaan dan susunan poin yang berbeda dari versi umum)` : ''}
Instruksi sudut pandang: ${angle.instruction}
Gaya bahasa: ${angle.tone}`;
}

export async function generateWithAI(input) {
  const response = await getClient().beta.messages.create({
    model: config.claudeModel,
    max_tokens: 16000,
    // Jika model menolak permintaan (safety classifier), server otomatis
    // mencoba ulang dengan model cadangan yang direkomendasikan.
    ...(FALLBACK_MODELS.has(config.claudeModel) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
    output_config: { format: { type: 'json_schema', schema: ARTICLE_SCHEMA } },
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Model menolak membuat artikel untuk input ini. Coba ubah deskripsi.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Artikel terpotong (batas token). Coba lagi.');
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const data = JSON.parse(text);
  return {
    title: data.title,
    metaDescription: data.metaDescription,
    labels: data.labels,
    html: data.html,
    imageCaption: data.imageCaption,
  };
}
