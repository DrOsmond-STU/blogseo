// Generator artikel memakai OpenAI API (ChatGPT), lewat REST tanpa library tambahan.
// API OpenAI berbayar per pemakaian dan terpisah dari langganan ChatGPT Plus.
import { config } from '../config.js';
import { ARTICLE_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from './ai.js';

const MAX_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class OpenAIError extends Error {
  // fatal = tidak ada gunanya dicoba lagi dalam waktu dekat (key salah, saldo habis, model tidak ada).
  constructor(message, { status, fatal = false } = {}) {
    super(message);
    this.status = status;
    this.fatal = fatal;
  }
}

function toError(status, data) {
  const err = data?.error || {};
  if (status === 401) return new OpenAIError('API key OpenAI tidak valid atau sudah dicabut.', { status, fatal: true });
  if (status === 403) return new OpenAIError('API key OpenAI tidak punya izin untuk model ini.', { status, fatal: true });
  if (status === 404) return new OpenAIError(`Model ${config.openaiModel} tidak tersedia untuk akun OpenAI ini. Pilih model lain.`, { status, fatal: true });
  if (status === 429 && err.code === 'insufficient_quota') {
    return new OpenAIError('Saldo/kuota OpenAI habis. Isi saldo di platform.openai.com atau pakai AI lain.', { status, fatal: true });
  }
  if (status === 429) return new OpenAIError('Batas permintaan OpenAI tercapai. Coba lagi sebentar lagi.', { status });
  return new OpenAIError(`OpenAI API ${status}: ${err.message || 'kesalahan tidak dikenal'}`, { status });
}

async function openaiFetch(path, { method = 'GET', body } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${config.openaiBaseUrl}/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.openaiApiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const quotaGone = data?.error?.code === 'insufficient_quota';
    if (((res.status === 429 && !quotaGone) || res.status >= 500) && attempt < MAX_RETRIES) {
      const wait = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 90) * 1000 : 3000 * 2 ** attempt);
      continue;
    }
    throw toError(res.status, data);
  }
}

// Model teks yang bisa dipakai untuk menulis artikel, model "mini" (lebih murah) diurutkan duluan.
export async function listOpenAIModels() {
  const data = await openaiFetch('models');
  return (data.data || [])
    .map((m) => m.id)
    .filter((id) => /^(gpt-|o\d)/.test(id) && !/(audio|realtime|tts|transcribe|search|image|embedding|instruct|codex|moderation)/i.test(id))
    .sort((a, b) => {
      const mini = (x) => (/mini/.test(x) ? 0 : /nano/.test(x) ? 1 : 2);
      return mini(a) - mini(b) || b.localeCompare(a, 'en', { numeric: true });
    })
    .map((id) => ({ id, name: id }));
}

export async function generateWithOpenAI(input) {
  const data = await openaiFetch('chat/completions', {
    method: 'POST',
    body: {
      model: config.openaiModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'artikel', strict: true, schema: ARTICLE_SCHEMA } },
      max_completion_tokens: 16000,
    },
  });
  const choice = data.choices?.[0];
  if (!choice) throw new OpenAIError('OpenAI tidak mengembalikan artikel. Coba lagi.');
  if (choice.message?.refusal) throw new OpenAIError('OpenAI menolak membuat artikel untuk input ini. Coba ubah deskripsi.');
  if (choice.finish_reason === 'length') throw new OpenAIError('Artikel terpotong (batas token). Coba lagi.');
  let article;
  try {
    article = JSON.parse(choice.message?.content || '');
  } catch {
    throw new OpenAIError('Format jawaban OpenAI tidak valid. Coba tulis ulang.');
  }
  return {
    title: article.title,
    metaDescription: article.metaDescription,
    labels: article.labels,
    html: article.html,
    imageCaption: article.imageCaption,
  };
}
