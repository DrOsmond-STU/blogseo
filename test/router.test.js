import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'blogseo-router-'));

// Satu server tiruan untuk ketiga API. `fail` menentukan penyedia mana yang error.
let fail = {};
let hits = [];
const article = (who) => JSON.stringify({ title: `Ditulis ${who}`, metaDescription: 'm', labels: ['a'], html: '<p>isi</p>', imageCaption: 'c' });
let server;
before(async () => {
  server = http.createServer(async (req, res) => {
    for await (const _ of req);
    res.setHeader('content-type', 'application/json');
    const who = req.url.startsWith('/v1beta/') ? 'gemini' : req.url.startsWith('/v1/chat') ? 'openai' : 'claude';
    hits.push(who);
    const f = fail[who];
    if (f === 'badkey') {
      res.statusCode = who === 'gemini' ? 400 : 401;
      return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'API key not valid' } }));
    }
    if (f === 'quota') {
      res.statusCode = 429;
      return res.end(JSON.stringify({ error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }));
    }
    if (who === 'gemini') return res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: article('gemini') }] } }] }));
    if (who === 'openai') return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: article('openai') } }] }));
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'end_turn', content: [{ type: 'text', text: article('claude') }], usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_BASE_URL = base;
  const { config } = await import('../src/config.js');
  Object.assign(config, {
    geminiBaseUrl: base, openaiBaseUrl: base,
    geminiApiKey: 'AIza-test-key-000000000000', anthropicApiKey: 'sk-ant-test', openaiApiKey: 'sk-test',
    aiDisabled: [],
  });
});
after(() => server.close());
beforeEach(() => { fail = {}; hits = []; });

const input = { keyword: 'k', description: 'd', targetUrl: 'https://x.id', anchorText: 'X', angle: { id: 'faq', name: 'FAQ', instruction: 'i', tone: 't', variant: 1 }, siteName: 'S' };
const setup = async (order, mode = 'fallback', disabled = []) => {
  const { config } = await import('../src/config.js');
  Object.assign(config, { aiOrder: order, aiMode: mode, aiDisabled: disabled });
  return import('../src/generator/index.js');
};

test('berurutan: selalu pakai AI nomor 1', async () => {
  const { writeWithProviders } = await setup(['claude', 'gemini', 'openai']);
  for (let slot = 0; slot < 3; slot++) {
    const r = await writeWithProviders(input, { slot });
    assert.equal(r.provider, 'claude');
  }
});

test('berurutan: AI 1 gagal → pindah ke AI 2, dan AI 1 dilewati untuk artikel berikutnya', async () => {
  const { writeWithProviders } = await setup(['openai', 'gemini', 'claude']);
  fail = { openai: 'quota' };
  const ctx = {};
  const r1 = await writeWithProviders(input, { slot: 0, ctx });
  assert.equal(r1.provider, 'gemini');
  assert.match(r1.errors[0], /ChatGPT \(OpenAI\): Saldo\/kuota OpenAI habis/);
  hits = [];
  const r2 = await writeWithProviders(input, { slot: 1, ctx });
  assert.equal(r2.provider, 'gemini');
  assert.deepEqual(hits, ['gemini'], 'OpenAI tidak dicoba lagi');
});

test('bergantian: artikel dibagi ke semua AI aktif sesuai urutan', async () => {
  const { writeWithProviders } = await setup(['gemini', 'claude', 'openai'], 'mix');
  const used = [];
  for (let slot = 0; slot < 6; slot++) used.push((await writeWithProviders(input, { slot })).provider);
  assert.deepEqual(used, ['gemini', 'claude', 'openai', 'gemini', 'claude', 'openai']);
});

test('AI yang dinonaktifkan atau tanpa key tidak dipakai', async () => {
  const { writeWithProviders } = await setup(['gemini', 'claude', 'openai'], 'mix', ['claude']);
  const used = [];
  for (let slot = 0; slot < 4; slot++) used.push((await writeWithProviders(input, { slot })).provider);
  assert.deepEqual(used, ['gemini', 'openai', 'gemini', 'openai']);
});

test('semua AI gagal → artikel tetap dibuat dengan template + peringatan', async () => {
  const { generateArticle } = await setup(['gemini', 'claude', 'openai']);
  fail = { gemini: 'badkey', claude: 'badkey', openai: 'badkey' };
  const campaign = { id: 'c1', keyword: 'kopi', description: 'Kopi enak dari Aceh.', targetUrl: 'https://x.id', linkRel: 'dofollow' };
  const a = await generateArticle({ campaign, site: { name: 'S' }, angle: input.angle, anchor: { kind: 'brand', text: 'X' } });
  assert.equal(a.generator, 'template');
  assert.match(a.warnings[0], /Semua AI gagal/);
  assert.match(a.warnings[0], /Gemini: API key Gemini tidak valid/);
  assert.match(a.warnings[0], /Claude: API key Claude tidak valid/);
});
