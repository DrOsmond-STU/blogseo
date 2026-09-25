// Orkestrasi pembuatan artikel untuk satu kampanye: satu artikel per situs tujuan,
// masing-masing dengan sudut pandang & anchor text berbeda, lalu dicek kemiripannya.
import Anthropic from '@anthropic-ai/sdk';
import { config, aiEnabled, activeProviders, AI_PROVIDERS } from '../config.js';
import { assignAngles } from './angles.js';
import { planAnchors } from './anchors.js';
import { generateWithClaude } from './ai.js';
import { generateWithGemini } from './gemini.js';
import { generateWithOpenAI } from './openai.js';
import { generateWithTemplate } from './template.js';
import { sanitizeHtml, ensureTargetLink, slugify } from './html.js';
import { maxSimilarities } from './similarity.js';

const WRITERS = { gemini: generateWithGemini, claude: generateWithClaude, openai: generateWithOpenAI };

function claudeMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'API key Claude tidak valid atau sudah dicabut.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'API key Claude tidak punya izin untuk model ini.';
  if (err instanceof Anthropic.NotFoundError) return `Model ${config.claudeModel} tidak tersedia.`;
  if (err instanceof Anthropic.RateLimitError) return 'Batas permintaan Claude tercapai.';
  if (/credit balance/i.test(err.message || '')) return 'Saldo Claude habis.';
  return err.message || String(err);
}

// Error yang membuat penyedia ini percuma dicoba lagi selama kampanye berjalan.
function isFatal(err) {
  return Boolean(err.fatal) || [401, 403, 404].includes(err.status) || /credit balance|insufficient_quota/i.test(err.message || '');
}

// Tulis artikel dengan AI sesuai urutan prioritas di Pengaturan.
// Mode 'fallback': selalu mulai dari AI nomor 1, pindah ke berikutnya jika gagal.
// Mode 'mix': artikel ke-n dimulai dari AI ke-(n mod jumlah AI), jadi tiap blog ditulis AI berbeda.
// ctx.skip dibagi antar-artikel dalam satu kampanye agar AI yang key/kuotanya bermasalah tidak dicoba terus.
export async function writeWithProviders(input, { slot = 0, ctx = {} } = {}) {
  const active = activeProviders();
  const k = config.aiMode === 'mix' && active.length > 1 ? slot % active.length : 0;
  const order = [...active.slice(k), ...active.slice(0, k)];
  ctx.skip ||= new Set();
  const errors = [];
  for (const id of order) {
    if (ctx.skip.has(id)) continue;
    try {
      return { raw: await WRITERS[id](input), provider: id, errors };
    } catch (err) {
      errors.push(`${AI_PROVIDERS[id].name}: ${id === 'claude' ? claudeMessage(err) : err.message}`);
      if (isFatal(err)) ctx.skip.add(id);
    }
  }
  const skipped = order.filter((id) => ctx.skip.has(id)).map((id) => AI_PROVIDERS[id].name);
  if (!errors.length && skipped.length) errors.push(`${skipped.join(', ')} dilewati karena error sebelumnya`);
  return { raw: null, provider: null, errors };
}

// Artikel dengan kemiripan 3-gram di atas ambang ini dianggap terlalu mirip.
export const SIMILARITY_LIMIT = 0.3;

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function finalizeArticle(raw, { targetUrl, anchorText, linkRel }) {
  const html = ensureTargetLink(sanitizeHtml(raw.html), { targetUrl, anchorText, linkRel });
  return {
    title: String(raw.title || '').trim(),
    metaDescription: String(raw.metaDescription || '').trim().slice(0, 160),
    labels: [...new Set((raw.labels || []).map((l) => String(l).trim()).filter(Boolean))].slice(0, 6),
    html,
    imageCaption: String(raw.imageCaption || '').trim(),
    slug: slugify(raw.title),
  };
}

export async function generateArticle({ campaign, site, angle, anchor, useAI = aiEnabled(), slot = 0, ctx = {} }) {
  const input = {
    keyword: campaign.keyword,
    description: campaign.description,
    targetUrl: campaign.targetUrl,
    anchorText: anchor.text,
    linkRel: campaign.linkRel,
    angle,
    siteName: site.name,
  };
  let raw = null;
  let generator = 'template';
  const warnings = [];
  if (useAI) {
    const result = await writeWithProviders(input, { slot, ctx });
    if (result.raw) {
      raw = result.raw;
      generator = result.provider;
      if (result.errors.length) warnings.push(`AI cadangan dipakai. ${result.errors.join(' | ')}`);
    } else {
      // Semua AI gagal: tetap buat artikel dengan template agar kampanye tidak berhenti.
      warnings.push(`Semua AI gagal, artikel ditulis dengan template (sebaiknya diedit). ${result.errors.join(' | ')}`);
    }
  }
  raw ||= generateWithTemplate(input);
  return {
    ...finalizeArticle(raw, { targetUrl: campaign.targetUrl, anchorText: anchor.text, linkRel: campaign.linkRel }),
    angle: { id: angle.id, name: angle.name, variant: angle.variant },
    anchor,
    generator,
    warnings,
  };
}

export async function generateCampaignArticles(campaign, sites, { onProgress } = {}) {
  const angles = assignAngles(sites.length, campaign.id);
  const anchors = planAnchors(sites.length, {
    keyword: campaign.keyword,
    targetUrl: campaign.targetUrl,
    brandName: campaign.brandName,
    seed: campaign.id,
  });

  let done = 0;
  // Paket gratis Gemini dibatasi per menit, jadi permintaan paralel dikurangi.
  const concurrency = activeProviders().includes('gemini') ? 2 : 3;
  const ctx = {};
  const articles = await mapLimit(sites, concurrency, async (site, i) => {
    try {
      const article = await generateArticle({ campaign, site, angle: angles[i], anchor: anchors[i], slot: i, ctx });
      return { ok: true, article };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    } finally {
      onProgress?.(++done, sites.length);
    }
  });

  // Jika ada artikel yang terlalu mirip dengan artikel lain, tulis ulang sekali (khusus mode AI).
  const sims = maxSimilarities(articles.map((r) => (r.ok ? r.article.html : '')));
  if (aiEnabled()) {
    for (let i = 0; i < articles.length; i++) {
      if (!articles[i].ok || sims[i] <= SIMILARITY_LIMIT) continue;
      try {
        const angle = { ...angles[i], variant: angles[i].variant + 1 };
        const again = await generateArticle({ campaign, site: sites[i], angle, anchor: anchors[i], slot: i, ctx });
        // Jangan ganti artikel AI dengan hasil template cadangan.
        if (again.generator !== 'template' || articles[i].article.generator === 'template') articles[i] = { ok: true, article: again };
      } catch {
        // tetap pakai versi pertama
      }
    }
  }
  const finalSims = maxSimilarities(articles.map((r) => (r.ok ? r.article.html : '')));
  return articles.map((r, i) => ({ ...r, similarity: finalSims[i], site: sites[i] }));
}
