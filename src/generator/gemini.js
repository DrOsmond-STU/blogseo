// Generator artikel memakai Google Gemini API (REST, tanpa library tambahan).
// API key dibuat gratis di Google AI Studio; paket gratis punya batas jumlah
// permintaan per menit/per hari, jadi permintaan yang kena batas dicoba ulang otomatis.
import { config } from '../config.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './ai.js';

// Skema output dalam format OpenAPI yang dipakai Gemini (responseSchema).
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Judul artikel, 50–65 karakter, memuat kata kunci secara alami.' },
    metaDescription: { type: 'STRING', description: 'Meta description 140–160 karakter.' },
    labels: { type: 'ARRAY', items: { type: 'STRING' }, description: '3–5 label/tag relevan.' },
    html: { type: 'STRING', description: 'Isi artikel dalam HTML.' },
    imageCaption: { type: 'STRING', description: 'Keterangan singkat untuk gambar utama.' },
  },
  required: ['title', 'metaDescription', 'labels', 'html', 'imageCaption'],
  propertyOrdering: ['title', 'metaDescription', 'labels', 'html', 'imageCaption'],
};

const MAX_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function friendlyError(status, data) {
  const msg = data?.error?.message || '';
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) return 'API key Gemini tidak valid. Periksa kembali di Google AI Studio.';
  if (status === 403) return 'API key Gemini ditolak (izin tidak cukup atau Generative Language API belum aktif untuk project ini).';
  if (status === 404) return `Model ${config.geminiModel} tidak ditemukan. Pilih model lain di Pengaturan.`;
  if (status === 429) {
    return /per.?day|daily|PerDay/i.test(msg)
      ? 'Kuota harian gratis Gemini sudah habis. Coba lagi besok, atau kurangi jumlah blog per kampanye.'
      : 'Batas permintaan per menit Gemini tercapai. Coba lagi sebentar lagi.';
  }
  return `Gemini API ${status}: ${msg || 'kesalahan tidak dikenal'}`;
}

// Google menyertakan saran jeda (mis. "31s") di detail error 429.
function retryDelayMs(data, attempt) {
  const info = (data?.error?.details || []).find((d) => String(d['@type'] || '').includes('RetryInfo'));
  const seconds = parseFloat(String(info?.retryDelay || '').replace('s', ''));
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 90) * 1000 + 500;
  return 5000 * 2 ** attempt;
}

async function geminiFetch(path, { method = 'GET', body } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${config.geminiBaseUrl}/v1beta/${path}`, {
      method,
      headers: { 'x-goog-api-key': config.geminiApiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const perDay = /per.?day|daily|PerDay/i.test(data?.error?.message || '');
    const retryable = (res.status === 429 && !perDay) || res.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(data, attempt));
      continue;
    }
    throw new GeminiError(friendlyError(res.status, data), res.status);
  }
}

// Daftar model Gemini yang bisa menulis teks, model "flash" (tersedia di paket gratis) diurutkan duluan.
export async function listGeminiModels() {
  const models = [];
  let pageToken = '';
  do {
    const data = await geminiFetch(`models?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    models.push(...(data.models || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken && models.length < 500);
  return models
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }))
    .filter((m) => /^gemini-/.test(m.id) && !/(embedding|image|tts|audio|live|vision)/i.test(m.id))
    .sort((a, b) => {
      const flash = (x) => (/flash/i.test(x.id) ? 0 : 1);
      return flash(a) - flash(b) || b.id.localeCompare(a.id, 'en', { numeric: true });
    });
}

export async function generateWithGemini(input) {
  const data = await geminiFetch(`models/${encodeURIComponent(config.geminiModel)}:generateContent`, {
    method: 'POST',
    body: {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(input) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_SCHEMA,
        maxOutputTokens: 16384,
      },
    },
  });

  if (data.promptFeedback?.blockReason) {
    throw new GeminiError(`Gemini menolak permintaan ini (${data.promptFeedback.blockReason}). Coba ubah deskripsi.`);
  }
  const candidate = data.candidates?.[0];
  if (!candidate) throw new GeminiError('Gemini tidak mengembalikan artikel. Coba lagi.');
  if (candidate.finishReason === 'MAX_TOKENS') throw new GeminiError('Artikel terpotong (batas token). Coba lagi.');
  if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(candidate.finishReason)) {
    throw new GeminiError(`Gemini menghentikan penulisan (${candidate.finishReason}). Coba ubah deskripsi.`);
  }
  const text = (candidate.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
  let article;
  try {
    article = JSON.parse(text);
  } catch {
    throw new GeminiError('Format jawaban Gemini tidak valid. Coba tulis ulang.');
  }
  return {
    title: article.title,
    metaDescription: article.metaDescription,
    labels: article.labels,
    html: article.html,
    imageCaption: article.imageCaption,
  };
}
