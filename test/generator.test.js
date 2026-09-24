import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignAngles, ANGLES } from '../src/generator/angles.js';
import { planAnchors, brandFromUrl } from '../src/generator/anchors.js';
import { sanitizeHtml, ensureTargetLink, containsLinkTo, insertAfterFirstParagraph } from '../src/generator/html.js';
import { maxSimilarities, similarity } from '../src/generator/similarity.js';
import { generateWithTemplate } from '../src/generator/template.js';
import { finalizeArticle } from '../src/generator/index.js';

const campaign = {
  keyword: 'jasa pembuatan website',
  description: 'Kami membuat website bisnis yang cepat dan mobile-friendly. Tersedia paket toko online. Melayani seluruh Indonesia.',
  targetUrl: 'https://webkita.id/jasa',
};

test('setiap situs mendapat sudut pandang berbeda', () => {
  const angles = assignAngles(ANGLES.length, 'abc');
  assert.equal(new Set(angles.map((a) => a.id)).size, ANGLES.length);
  const more = assignAngles(ANGLES.length + 2, 'abc');
  assert.equal(more[ANGLES.length].variant, 2);
});

test('anchor text bervariasi dan exact match dibatasi', () => {
  const anchors = planAnchors(10, { ...campaign, seed: 'x' });
  const kinds = anchors.map((a) => a.kind);
  assert.ok(new Set(kinds).size >= 4);
  assert.ok(kinds.filter((k) => k === 'exact').length <= 1);
  assert.equal(brandFromUrl('https://www.webkita.id/x'), 'Webkita');
});

test('sanitizeHtml membuang script, atribut event, dan link javascript', () => {
  const out = sanitizeHtml('<p onclick="x()">Hai<script>alert(1)</script> <a href="javascript:alert(1)">x</a> <a href="https://a.com">y</a></p><h1>t</h1>');
  assert.equal(out, '<p>Hai <a>x</a> <a href="https://a.com">y</a></p>t');
});

test('ensureTargetLink menambah link jika tidak ada dan menghapus duplikat', () => {
  const added = ensureTargetLink('<p>Isi</p>', { targetUrl: campaign.targetUrl, anchorText: 'WebKita', linkRel: 'nofollow' });
  assert.ok(containsLinkTo(added, campaign.targetUrl));
  assert.match(added, /rel="nofollow"/);
  const dup = ensureTargetLink(`<p><a href="${campaign.targetUrl}">a</a> dan <a href="${campaign.targetUrl}/">b</a></p>`, {
    targetUrl: campaign.targetUrl, anchorText: 'x', linkRel: 'dofollow',
  });
  assert.equal(dup.match(/<a /g).length, 1);
  assert.doesNotMatch(dup, /rel=/);
});

test('gambar disisipkan setelah paragraf pertama', () => {
  assert.equal(insertAfterFirstParagraph('<p>a</p><p>b</p>', '<figure></figure>'), '<p>a</p>\n<figure></figure>\n<p>b</p>');
});

test('artikel template untuk tiap sudut pandang berbeda satu sama lain', () => {
  const anchors = planAnchors(ANGLES.length, { ...campaign, seed: 's' });
  const articles = assignAngles(ANGLES.length, 's').map((angle, i) =>
    finalizeArticle(
      generateWithTemplate({ ...campaign, anchorText: anchors[i].text, linkRel: 'dofollow', angle, siteName: `Blog ${i}` }),
      { targetUrl: campaign.targetUrl, anchorText: anchors[i].text, linkRel: 'dofollow' },
    ),
  );
  assert.equal(new Set(articles.map((a) => a.title)).size, ANGLES.length);
  for (const a of articles) {
    assert.ok(containsLinkTo(a.html, campaign.targetUrl), a.title);
    assert.equal(a.html.split(campaign.targetUrl).length - 1, 1, 'tepat satu link ke tujuan');
  }
  const sims = maxSimilarities(articles.map((a) => a.html));
  assert.ok(Math.max(...sims) < 0.5, `kemiripan terlalu tinggi: ${sims}`);
});

test('similarity: teks sama = 1, teks berbeda ~ 0', () => {
  const t = 'satu dua tiga empat lima enam';
  assert.equal(similarity(t, t), 1);
  assert.equal(similarity(t, 'tujuh delapan sembilan sepuluh sebelas'), 0);
});
