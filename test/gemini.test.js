import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'blogseo-gemini-'));
process.env.GEMINI_API_KEY = 'AIzaTESTKEY-0123456789abcdef';
process.env.GEMINI_MODEL = 'gemini-2.5-flash';

let server;
let calls = [];
let mode = 'ok';
const ARTICLE = { title: 'Judul', metaDescription: 'Meta', labels: ['a'], html: '<p>Isi</p>', imageCaption: 'Cap' };

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    calls.push({ url: req.url, key: req.headers['x-goog-api-key'], body: body ? JSON.parse(body) : null });
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1beta/models?')) {
      return res.end(JSON.stringify({ models: [
        { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
      ] }));
    }
    if (mode === '429-once' && calls.filter((c) => c.url.includes(':generateContent')).length === 1) {
      res.statusCode = 429;
      return res.end(JSON.stringify({ error: { code: 429, message: 'Quota exceeded for requests per minute', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.1s' }] } }));
    }
    if (mode === 'daily') {
      res.statusCode = 429;
      return res.end(JSON.stringify({ error: { code: 429, message: 'Quota exceeded: GenerateRequestsPerDayPerProjectPerModel-FreeTier' } }));
    }
    res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'berpikir…', thought: true }, { text: JSON.stringify(ARTICLE) }] } }] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const load = async () => {
  const { config } = await import('../src/config.js');
  config.geminiBaseUrl = process.env.GEMINI_BASE_URL;
  return { config, ...(await import('../src/generator/gemini.js')), ...(await import('../src/config.js')) };
};

test('Gemini aktif otomatis bila API key ada', async () => {
  const { activeProviders, modelOf } = await load();
  assert.deepEqual(activeProviders(), ['gemini']);
  assert.equal(modelOf('gemini'), 'gemini-2.5-flash');
});

test('menulis artikel: kirim skema JSON, abaikan bagian "thought"', async () => {
  const { generateWithGemini } = await load();
  calls = []; mode = 'ok';
  const angle = { id: 'faq', name: 'FAQ', instruction: 'i', tone: 't', variant: 1 };
  const out = await generateWithGemini({ keyword: 'k', description: 'd', targetUrl: 'https://x.id', anchorText: 'X', angle, siteName: 'S' });
  assert.deepEqual(out, ARTICLE);
  const req = calls[0];
  assert.equal(req.url, '/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal(req.key, 'AIzaTESTKEY-0123456789abcdef');
  assert.equal(req.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(req.body.generationConfig.responseSchema.type, 'OBJECT');
});

test('batas per menit (429) dicoba ulang otomatis', async () => {
  const { generateWithGemini } = await load();
  calls = []; mode = '429-once';
  const angle = { id: 'faq', name: 'FAQ', instruction: 'i', tone: 't', variant: 1 };
  const out = await generateWithGemini({ keyword: 'k', description: 'd', targetUrl: 'https://x.id', anchorText: 'X', angle, siteName: 'S' });
  assert.equal(out.title, 'Judul');
  assert.equal(calls.length, 2);
});

test('kuota harian habis: tidak dicoba ulang, pesan jelas', async () => {
  const { generateWithGemini } = await load();
  calls = []; mode = 'daily';
  const angle = { id: 'faq', name: 'FAQ', instruction: 'i', tone: 't', variant: 1 };
  await assert.rejects(
    generateWithGemini({ keyword: 'k', description: 'd', targetUrl: 'https://x.id', anchorText: 'X', angle, siteName: 'S' }),
    /Kuota harian gratis Gemini sudah habis/,
  );
  assert.equal(calls.length, 1);
});

test('daftar model: hanya model teks, flash diurutkan duluan', async () => {
  const { listGeminiModels } = await load();
  mode = 'ok';
  const models = await listGeminiModels();
  assert.deepEqual(models.map((m) => m.id), ['gemini-2.5-flash', 'gemini-2.5-pro']);
});
