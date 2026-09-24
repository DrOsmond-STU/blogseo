// Orkestrasi pembuatan artikel untuk satu kampanye: satu artikel per situs tujuan,
// masing-masing dengan sudut pandang & anchor text berbeda, lalu dicek kemiripannya.
import { aiEnabled, aiProvider } from '../config.js';
import { assignAngles } from './angles.js';
import { planAnchors } from './anchors.js';
import { generateWithClaude } from './ai.js';
import { generateWithGemini } from './gemini.js';
import { generateWithTemplate } from './template.js';
import { sanitizeHtml, ensureTargetLink, slugify } from './html.js';
import { maxSimilarities } from './similarity.js';

function generateWithAI(input) {
  return aiProvider() === 'gemini' ? generateWithGemini(input) : generateWithClaude(input);
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

export async function generateArticle({ campaign, site, angle, anchor, useAI = aiEnabled() }) {
  const input = {
    keyword: campaign.keyword,
    description: campaign.description,
    targetUrl: campaign.targetUrl,
    anchorText: anchor.text,
    linkRel: campaign.linkRel,
    angle,
    siteName: site.name,
  };
  const raw = useAI ? await generateWithAI(input) : generateWithTemplate(input);
  return {
    ...finalizeArticle(raw, { targetUrl: campaign.targetUrl, anchorText: anchor.text, linkRel: campaign.linkRel }),
    angle: { id: angle.id, name: angle.name, variant: angle.variant },
    anchor,
    generator: useAI ? aiProvider() : 'template',
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
  const concurrency = aiProvider() === 'gemini' ? 2 : 3;
  const articles = await mapLimit(sites, concurrency, async (site, i) => {
    try {
      const article = await generateArticle({ campaign, site, angle: angles[i], anchor: anchors[i] });
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
        articles[i] = { ok: true, article: await generateArticle({ campaign, site: sites[i], angle, anchor: anchors[i] }) };
      } catch {
        // tetap pakai versi pertama
      }
    }
  }
  const finalSims = maxSimilarities(articles.map((r) => (r.ok ? r.article.html : '')));
  return articles.map((r, i) => ({ ...r, similarity: finalSims[i], site: sites[i] }));
}
