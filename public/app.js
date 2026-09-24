const view = document.getElementById('view');
let status = null;
let pollTimer = null;

// ---------- utilitas ----------
const esc = (v = '') =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, options = {}) {
  const opts = { ...options };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(message, bad = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast${bad ? ' bad' : ''}`;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), bad ? 6000 : 3000);
}

async function withBusy(button, fn) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Memproses…';
  try {
    await fn();
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

const SITE_TYPES = { blogger: 'Blogger', wordpress: 'WordPress', webhook: 'Webhook' };
const POST_STATUS = {
  generated: ['Siap direview', 'muted'],
  scheduled: ['Terjadwal', ''],
  publishing: ['Sedang terbit', 'warn'],
  published: ['Terbit', 'ok'],
  failed: ['Gagal', 'bad'],
};
const CAMPAIGN_STATUS = {
  generating: ['Menulis artikel', 'warn'],
  review: ['Menunggu review', ''],
  publishing: ['Sedang dipublikasikan', 'warn'],
  done: ['Selesai', 'ok'],
  error: ['Error', 'bad'],
};
const ANCHOR_KIND = { brand: 'brand', generic: 'generik', partial: 'partial match', naked: 'URL', exact: 'exact match' };

function badge([text, cls]) {
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}

function simBadge(sim) {
  if (sim == null) return '';
  const pct = Math.round(sim * 100);
  const cls = sim < 0.15 ? 'ok' : sim <= status.similarityLimit ? 'warn' : 'bad';
  return `<span class="badge ${cls}" title="Kemiripan tertinggi dengan artikel lain di kampanye ini">mirip ${pct}%</span>`;
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

// ---------- router ----------
function route() {
  clearInterval(pollTimer);
  const [page, query = ''] = location.hash.slice(1).split('?');
  const [name, id] = (page || 'new').split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name || (name === 'campaign' && a.dataset.nav === 'campaigns')));
  const params = new URLSearchParams(query);
  const pages = { new: renderNew, campaigns: renderCampaigns, campaign: () => renderCampaign(id), sites: () => renderSites(params), help: renderHelp };
  (pages[name] || renderNew)().catch((err) => {
    view.innerHTML = `<div class="notice">${esc(err.message)}</div>`;
  });
}

// ---------- Kampanye baru ----------
async function renderNew() {
  const sites = (await api('/api/sites')).filter((s) => s.active);
  view.innerHTML = `
    <h1>Kampanye baru</h1>
    <p class="sub">Isi kata kunci, deskripsi singkat, gambar, dan URL situs utama. Engine akan menulis artikel dengan narasi berbeda untuk setiap blog tujuan, lalu Anda review sebelum terbit.</p>
    ${status.ai ? '' : '<div class="notice">Mode template aktif (tanpa AI). Artikel akan lebih sederhana dan sebaiknya diedit. Isi <code>ANTHROPIC_API_KEY</code> di <code>.env</code> untuk artikel yang ditulis AI.</div>'}
    ${sites.length ? '' : '<div class="notice info">Belum ada situs tujuan. <a href="#sites">Tambahkan blog Blogger / WordPress / webhook</a> terlebih dulu.</div>'}
    <form id="new-form" class="card">
      <div class="grid">
        <label>Kata kunci utama *<input name="keyword" required placeholder="contoh: jasa pembuatan website Surabaya" /></label>
        <label>Nama brand <small>Opsional, untuk variasi anchor text. Default: nama domain.</small><input name="brandName" placeholder="contoh: WebKita" /></label>
      </div>
      <label>URL situs utama (tujuan backlink) *<input name="targetUrl" type="url" required placeholder="https://situsanda.com/halaman" /></label>
      <label>Deskripsi sederhana *
        <small>Tulis fakta tentang produk/layanan Anda: apa yang ditawarkan, keunggulan, lokasi, untuk siapa. AI hanya memakai fakta dari sini.</small>
        <textarea name="description" rows="5" required minlength="20"></textarea>
      </label>
      <div class="grid">
        <label>Upload gambar<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /><img id="img-preview" class="img-preview" hidden /></label>
        <label>…atau URL gambar<input name="imageUrl" type="url" placeholder="https://…/gambar.jpg" /><small>Blogger butuh gambar ber-URL publik. Lihat Panduan.</small></label>
      </div>
      <div class="label">Situs tujuan *</div>
      <div class="actions" style="margin:0 0 8px"><button type="button" class="small" id="select-all">Pilih semua</button></div>
      <div class="checklist">
        ${sites.map((s) => `<label><input type="checkbox" name="site" value="${s.id}" checked /> ${esc(s.name)} <span class="badge muted" style="margin-left:auto">${SITE_TYPES[s.type]}</span></label>`).join('') || '<span class="hint">—</span>'}
      </div>
      <div class="grid" style="margin-top:16px">
        <label>Atribut link
          <select name="linkRel">
            <option value="dofollow">dofollow (tanpa rel)</option>
            <option value="nofollow">nofollow</option>
            <option value="sponsored">sponsored</option>
          </select>
        </label>
        <label>Jeda antar posting (menit)<input name="spacingMinutes" type="number" min="0" value="60" /><small>Posting disebar bertahap, tidak serentak.</small></label>
      </div>
      <div class="actions"><button class="primary" ${sites.length ? '' : 'disabled'}>Buat artikel</button></div>
    </form>`;

  const form = document.getElementById('new-form');
  form.elements.image.addEventListener('change', () => {
    const file = form.elements.image.files[0];
    const img = document.getElementById('img-preview');
    img.hidden = !file;
    if (file) img.src = URL.createObjectURL(file);
  });
  document.getElementById('select-all').onclick = () => {
    const boxes = [...form.querySelectorAll('[name=site]')];
    const all = boxes.every((b) => b.checked);
    boxes.forEach((b) => (b.checked = !all));
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const button = form.querySelector('button.primary');
    withBusy(button, async () => {
      const fd = new FormData(form);
      fd.delete('site');
      fd.set('siteIds', JSON.stringify([...form.querySelectorAll('[name=site]:checked')].map((b) => b.value)));
      if (!form.elements.image.files.length) fd.delete('image');
      const campaign = await api('/api/campaigns', { method: 'POST', body: fd });
      location.hash = `campaign/${campaign.id}`;
    });
  };
}

// ---------- Daftar kampanye ----------
async function renderCampaigns() {
  const list = await api('/api/campaigns');
  view.innerHTML = `
    <h1>Kampanye</h1>
    <p class="sub">Riwayat semua kampanye dan status publikasinya.</p>
    <div class="card">
      ${list.length ? `<table>
        <thead><tr><th>Kata kunci</th><th>URL tujuan</th><th>Status</th><th>Terbit</th><th>Dibuat</th></tr></thead>
        <tbody>${list.map((c) => `
          <tr>
            <td><a href="#campaign/${c.id}">${esc(c.keyword)}</a></td>
            <td><a href="${esc(c.targetUrl)}" target="_blank" rel="noopener">${esc(c.targetUrl)}</a></td>
            <td>${badge(CAMPAIGN_STATUS[c.status] || [c.status, 'muted'])}</td>
            <td>${c.counts.published || 0} / ${c.total}${c.counts.failed ? ` <span class="badge bad">${c.counts.failed} gagal</span>` : ''}</td>
            <td>${fmtDate(c.createdAt)}</td>
          </tr>`).join('')}
        </tbody></table>` : '<p class="hint">Belum ada kampanye. <a href="#new">Buat kampanye pertama</a>.</p>'}
    </div>`;
}

// ---------- Detail kampanye ----------
async function renderCampaign(id) {
  const c = await api(`/api/campaigns/${id}`);
  const ready = c.posts.filter((p) => p.status === 'generated' && !p.skip);
  const progress = c.progress ? Math.round((c.progress.done / Math.max(c.progress.total, 1)) * 100) : 0;
  view.innerHTML = `
    <p><a href="#campaigns">← Semua kampanye</a></p>
    <h1>${esc(c.keyword)} ${badge(CAMPAIGN_STATUS[c.status] || [c.status, 'muted'])}</h1>
    <p class="sub">Tujuan: <a href="${esc(c.targetUrl)}" target="_blank" rel="noopener">${esc(c.targetUrl)}</a> · link ${esc(c.linkRel)} · jeda ${c.spacingMinutes} menit</p>
    <div class="card">
      <div class="post">
        <div>
          <div class="label">Deskripsi</div>
          <p style="margin:0;white-space:pre-wrap">${esc(c.description)}</p>
        </div>
        ${c.imageSrc ? `<img src="${esc(c.imageSrc)}" class="img-preview" alt="" />` : ''}
      </div>
    </div>
    ${c.status === 'generating' ? `<div class="card">Menulis artikel ${c.progress?.done || 0} dari ${c.progress?.total || '?'}…<div class="progress"><div style="width:${progress}%"></div></div></div>` : ''}
    ${c.status === 'error' ? `<div class="notice">${esc(c.error)}</div>` : ''}
    ${ready.length ? `
      <div class="card">
        <div class="actions" style="margin:0">
          <strong>${ready.length} artikel siap.</strong>
          <label style="margin:0;display:flex;align-items:center;gap:8px;font-weight:400">Jeda <input id="spacing" type="number" min="0" value="${c.spacingMinutes}" style="width:90px;margin:0" /> menit</label>
          <button class="primary" id="publish-all">Jadwalkan & terbitkan semua</button>
        </div>
        <p class="hint" style="margin:8px 0 0">Artikel pertama terbit segera, berikutnya menyusul sesuai jeda (+ variasi acak) agar tidak serentak.</p>
      </div>` : ''}
    <div id="posts">${c.posts.map(postCard).join('')}</div>
    <div class="actions" style="margin-top:24px"><button class="danger" id="delete-campaign">Hapus kampanye</button></div>`;

  document.getElementById('publish-all')?.addEventListener('click', (e) =>
    withBusy(e.target, async () => {
      const r = await api(`/api/campaigns/${id}/publish`, { method: 'POST', body: { spacingMinutes: Number(document.getElementById('spacing').value) } });
      toast(`${r.scheduled} artikel dijadwalkan`);
      renderCampaign(id);
    }),
  );
  document.getElementById('delete-campaign').onclick = async () => {
    if (!confirm('Hapus kampanye ini? Artikel yang sudah terbit di blog tidak ikut terhapus.')) return;
    await api(`/api/campaigns/${id}`, { method: 'DELETE' });
    location.hash = 'campaigns';
  };
  view.querySelectorAll('[data-action]').forEach((btn) => (btn.onclick = () => postAction(btn, c)));

  const busy = c.status === 'generating' || c.posts.some((p) => ['scheduled', 'publishing'].includes(p.status));
  if (busy) pollTimer = setInterval(() => (document.activeElement?.tagName === 'INPUT' ? null : renderCampaign(id)), c.status === 'generating' ? 2500 : 15000);
}

function postCard(p) {
  const editable = ['generated', 'failed'].includes(p.status) && p.html;
  return `
    <div class="card post">
      <div>
        <div>
          ${badge(POST_STATUS[p.status] || [p.status, 'muted'])}
          ${p.skip ? badge(['Dilewati', 'muted']) : ''}
          <span class="badge muted">${esc(SITE_TYPES[p.siteType] || '')}: ${esc(p.siteName)}</span>
          ${p.angle ? `<span class="badge">${esc(p.angle.name)}</span>` : ''}
          ${p.anchor ? `<span class="badge muted" title="Anchor text">⚓ ${esc(p.anchor.text)} (${ANCHOR_KIND[p.anchor.kind] || p.anchor.kind})</span>` : ''}
          ${simBadge(p.similarity)}
          ${p.generator === 'template' ? badge(['template', 'warn']) : ''}
        </div>
        <h3>${esc(p.title || '(tanpa judul)')}</h3>
        <div class="meta">${esc(p.metaDescription || '')}</div>
        ${p.status === 'scheduled' ? `<div class="meta">Jadwal: ${fmtDate(p.scheduledAt)}${p.attempts ? ` · percobaan ke-${p.attempts + 1}` : ''}</div>` : ''}
        ${p.publishedUrl ? `<div class="meta">Terbit ${fmtDate(p.publishedAt)}: <a href="${esc(p.publishedUrl)}" target="_blank" rel="noopener">${esc(p.publishedUrl)}</a></div>` : ''}
        ${p.error ? `<div class="err">${esc(p.error)}</div>` : ''}
        ${(p.warnings || []).map((w) => `<div class="warnings">${esc(w)}</div>`).join('')}
      </div>
      <div class="buttons">
        ${p.html ? `<button class="small" data-action="edit" data-id="${p.id}">${editable ? 'Lihat / edit' : 'Lihat'}</button>` : ''}
        ${editable || p.status === 'failed' ? `<button class="small" data-action="regenerate" data-id="${p.id}">Tulis ulang</button>` : ''}
        ${editable ? `<button class="small" data-action="skip" data-id="${p.id}">${p.skip ? 'Batal lewati' : 'Lewati'}</button>` : ''}
        ${editable || p.status === 'scheduled' ? `<button class="small" data-action="publish-now" data-id="${p.id}">Terbitkan sekarang</button>` : ''}
      </div>
    </div>`;
}

async function postAction(btn, campaign) {
  const post = campaign.posts.find((p) => p.id === btn.dataset.id);
  const reload = () => renderCampaign(campaign.id);
  switch (btn.dataset.action) {
    case 'edit':
      return openEditor(post, reload);
    case 'regenerate':
      return withBusy(btn, async () => {
        await api(`/api/posts/${post.id}/regenerate`, { method: 'POST' });
        toast('Artikel ditulis ulang dengan sudut pandang lain');
        reload();
      });
    case 'skip':
      return withBusy(btn, async () => {
        await api(`/api/posts/${post.id}`, { method: 'PUT', body: { skip: !post.skip } });
        reload();
      });
    case 'publish-now':
      return withBusy(btn, async () => {
        const r = await api(`/api/posts/${post.id}/publish-now`, { method: 'POST' });
        toast(r.status === 'published' ? 'Artikel terbit' : `Gagal: ${r.error}`, r.status !== 'published');
        reload();
      });
  }
}

function openEditor(post, onSaved) {
  const dialog = document.getElementById('editor');
  const form = dialog.querySelector('form');
  const preview = document.getElementById('editor-preview');
  const editable = ['generated', 'failed'].includes(post.status);
  form.elements.title.value = post.title || '';
  form.elements.metaDescription.value = post.metaDescription || '';
  form.elements.labels.value = (post.labels || []).join(', ');
  form.elements.html.value = post.html || '';
  [...form.elements].forEach((el) => {
    if (el.name) el.readOnly = !editable;
  });
  form.querySelector('[value=save]').hidden = !editable;
  const update = () => (preview.innerHTML = `<h2>${esc(form.elements.title.value)}</h2>${form.elements.html.value}`);
  form.elements.html.oninput = update;
  form.elements.title.oninput = update;
  update();
  dialog.onclose = async () => {
    if (dialog.returnValue !== 'save' || !editable) return;
    try {
      await api(`/api/posts/${post.id}`, {
        method: 'PUT',
        body: {
          title: form.elements.title.value,
          metaDescription: form.elements.metaDescription.value,
          labels: form.elements.labels.value.split(',').map((s) => s.trim()).filter(Boolean),
          html: form.elements.html.value,
        },
      });
      toast('Artikel disimpan');
      onSaved();
    } catch (err) {
      toast(err.message, true);
    }
  };
  dialog.returnValue = '';
  dialog.showModal();
}

// ---------- Situs tujuan ----------
async function renderSites(params) {
  const [sites, accounts] = await Promise.all([api('/api/sites'), api('/api/google/accounts')]);
  if (params.get('google') === 'ok') toast('Akun Google terhubung');
  if (params.get('error')) toast(`Google: ${params.get('error')}`, true);
  view.innerHTML = `
    <h1>Situs tujuan</h1>
    <p class="sub">Blog dan website tempat artikel akan diposting. Makin beragam platform dan topik blognya, makin alami profil backlink Anda.</p>
    <div class="card">
      ${sites.length ? `<table>
        <thead><tr><th>Nama</th><th>Tipe</th><th>Alamat</th><th>Mode</th><th></th></tr></thead>
        <tbody>${sites.map((s) => `
          <tr>
            <td>${esc(s.name)} ${s.active ? '' : badge(['nonaktif', 'muted'])}</td>
            <td>${SITE_TYPES[s.type]}</td>
            <td class="hint">${esc(s.config.blogUrl || s.config.url || '')}</td>
            <td>${s.config.draft ? badge(['draft', 'warn']) : badge(['langsung terbit', 'ok'])}</td>
            <td style="white-space:nowrap">
              <button class="small" data-test="${s.id}">Tes</button>
              <button class="small" data-draft="${s.id}">${s.config.draft ? 'Set terbit' : 'Set draft'}</button>
              <button class="small" data-toggle="${s.id}">${s.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
              <button class="small danger" data-del="${s.id}">Hapus</button>
            </td>
          </tr>`).join('')}</tbody></table>` : '<p class="hint">Belum ada situs.</p>'}
    </div>

    <h2>Tambah situs</h2>
    <div class="tabs">
      <button class="active" data-tab="blogger">Blogger</button>
      <button data-tab="wordpress">WordPress</button>
      <button data-tab="webhook">Website lain (webhook)</button>
    </div>
    <div class="card" data-panel="blogger">
      ${status.google ? `
        <p class="hint" style="margin-top:0">Hubungkan akun Google pemilik blog. Satu akun bisa punya banyak blog.</p>
        <div class="actions" style="margin-top:0"><a href="/auth/google"><button type="button" class="primary">+ Hubungkan akun Google</button></a></div>
        ${accounts.length ? `
          <label style="margin-top:16px">Akun
            <select id="g-account">${accounts.map((a) => `<option value="${a.id}">${esc(a.email || a.id)}</option>`).join('')}</select>
          </label>
          <div class="actions"><button type="button" id="load-blogs">Tampilkan blog</button><button type="button" class="danger small" id="del-account">Putuskan akun</button></div>
          <div id="blog-list" style="margin-top:12px"></div>` : ''}
      ` : `<div class="notice">Isi <code>GOOGLE_CLIENT_ID</code> dan <code>GOOGLE_CLIENT_SECRET</code> di <code>.env</code> lalu restart server. Redirect URI yang harus didaftarkan di Google Cloud Console:<br /><code>${esc(status.redirectUri)}</code></div>`}
    </div>
    <form class="card" data-panel="wordpress" hidden id="wp-form">
      <div class="grid">
        <label>Nama<input name="name" required placeholder="Blog Kuliner Saya" /></label>
        <label>URL situs<input name="url" type="url" required placeholder="https://blogsaya.com" /></label>
        <label>Username<input name="username" required /></label>
        <label>Application Password<input name="appPassword" required placeholder="xxxx xxxx xxxx xxxx" /><small>WP Admin → Users → Profile → Application Passwords</small></label>
        <label>ID kategori (opsional)<input name="categoryId" type="number" min="1" /></label>
      </div>
      <label style="font-weight:400"><input type="checkbox" name="draft" /> Simpan sebagai draft (tidak langsung terbit)</label>
      <div class="actions"><button class="primary">Tambah WordPress</button></div>
    </form>
    <form class="card" data-panel="webhook" hidden id="hook-form">
      <p class="hint" style="margin-top:0">Untuk website dengan CMS sendiri. Engine mengirim POST JSON berisi judul, HTML, label, dll., ditandatangani HMAC-SHA256 di header <code>X-BlogSEO-Signature</code>. Server Anda sebaiknya membalas <code>{"url": "…"}</code>. Contoh penerima ada di folder <code>examples/</code>.</p>
      <div class="grid">
        <label>Nama<input name="name" required /></label>
        <label>URL webhook<input name="url" type="url" required placeholder="https://websiteanda.com/api/blogseo" /></label>
        <label>Secret<input name="secret" placeholder="string acak panjang" /></label>
      </div>
      <label style="font-weight:400"><input type="checkbox" name="draft" /> Minta disimpan sebagai draft</label>
      <div class="actions"><button class="primary">Tambah webhook</button></div>
    </form>`;

  const reload = () => renderSites(new URLSearchParams());
  view.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.onclick = () => {
      view.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('active', t === tab));
      view.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    };
  });
  view.querySelectorAll('[data-test]').forEach((b) => (b.onclick = () => withBusy(b, async () => toast((await api(`/api/sites/${b.dataset.test}/test`, { method: 'POST' })).message))));
  view.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Hapus situs ini?')) return;
    await api(`/api/sites/${b.dataset.del}`, { method: 'DELETE' });
    reload();
  }));
  view.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = () => withBusy(b, async () => {
    const s = sites.find((x) => x.id === b.dataset.toggle);
    await api(`/api/sites/${s.id}`, { method: 'PUT', body: { active: !s.active } });
    reload();
  })));
  view.querySelectorAll('[data-draft]').forEach((b) => (b.onclick = () => withBusy(b, async () => {
    const s = sites.find((x) => x.id === b.dataset.draft);
    await api(`/api/sites/${s.id}`, { method: 'PUT', body: { config: { draft: !s.config.draft } } });
    reload();
  })));

  document.getElementById('del-account')?.addEventListener('click', async () => {
    if (!confirm('Putuskan akun Google ini? Blog yang memakai akun ini tidak bisa diposting lagi.')) return;
    await api(`/api/google/accounts/${document.getElementById('g-account').value}`, { method: 'DELETE' });
    reload();
  });
  document.getElementById('load-blogs')?.addEventListener('click', (e) => withBusy(e.target, async () => {
    const accountId = document.getElementById('g-account').value;
    const blogs = await api(`/api/google/accounts/${accountId}/blogs`);
    const existing = new Set(sites.filter((s) => s.type === 'blogger').map((s) => s.config.blogId));
    const box = document.getElementById('blog-list');
    box.innerHTML = blogs.length ? `
      <div class="checklist">${blogs.map((b) => `<label><input type="checkbox" value="${b.id}" ${existing.has(b.id) ? 'disabled' : 'checked'} data-name="${esc(b.name)}" data-url="${esc(b.url)}" /> ${esc(b.name)}${existing.has(b.id) ? ' <span class="badge muted" style="margin-left:auto">sudah ada</span>' : ''}</label>`).join('')}</div>
      <div class="actions"><button type="button" class="primary" id="add-blogs">Tambah blog terpilih</button></div>` : '<p class="hint">Akun ini belum punya blog di Blogger.</p>';
    document.getElementById('add-blogs')?.addEventListener('click', (ev) => withBusy(ev.target, async () => {
      const picked = [...box.querySelectorAll('input:checked:not(:disabled)')];
      for (const input of picked) {
        await api('/api/sites', { method: 'POST', body: { type: 'blogger', name: input.dataset.name, config: { blogId: input.value, blogUrl: input.dataset.url, googleAccountId: accountId } } });
      }
      toast(`${picked.length} blog ditambahkan`);
      reload();
    }));
  }));

  const submitSite = (form, type, keys) => {
    form.onsubmit = (e) => {
      e.preventDefault();
      withBusy(form.querySelector('button.primary'), async () => {
        const config = Object.fromEntries(keys.map((k) => [k, form.elements[k].value.trim()]));
        config.draft = form.elements.draft.checked;
        const site = await api('/api/sites', { method: 'POST', body: { type, name: form.elements.name.value, config } });
        try {
          toast((await api(`/api/sites/${site.id}/test`, { method: 'POST' })).message);
        } catch (err) {
          toast(`Situs ditambahkan, tetapi tes koneksi gagal: ${err.message}`, true);
        }
        reload();
      });
    };
  };
  submitSite(document.getElementById('wp-form'), 'wordpress', ['url', 'username', 'appPassword', 'categoryId']);
  submitSite(document.getElementById('hook-form'), 'webhook', ['url', 'secret']);
}

// ---------- Panduan ----------
async function renderHelp() {
  view.innerHTML = `
    <h1>Panduan</h1>
    <div class="card help">
      <h2 style="margin-top:0">Alur kerja</h2>
      <ol>
        <li>Tambahkan blog tujuan di menu <a href="#sites">Situs Tujuan</a> (Blogger lewat login Google, WordPress lewat Application Password, website lain lewat webhook).</li>
        <li>Buat <a href="#new">kampanye baru</a>: kata kunci, deskripsi, gambar, URL situs utama.</li>
        <li>Engine menulis satu artikel per blog dengan <strong>sudut pandang berbeda</strong> (panduan, daftar tips, FAQ, cerita, dll.), anchor text bervariasi, dan mengecek kemiripan antar artikel.</li>
        <li>Review, edit, atau tulis ulang artikel. Lalu klik <em>Jadwalkan & terbitkan semua</em>; posting disebar sesuai jeda.</li>
      </ol>
      <h2>Gambar</h2>
      <p>WordPress: gambar upload otomatis masuk media library dan dijadikan featured image. Blogger & webhook butuh URL publik: pakai kolom URL gambar, atau jalankan server dengan <code>PUBLIC_BASE_URL</code> berupa domain publik, atau sertakan minimal satu WordPress (gambar dari media library WordPress dipakai ulang untuk blog lain).</p>
      <h2>Agar hasil SEO-nya bertahan (penting)</h2>
      <ul>
        <li><strong>Tidak ada alat yang bisa menjamin peringkat 1 Google.</strong> Peringkat ditentukan oleh kualitas situs utama, relevansi, dan otoritas link.</li>
        <li>Google punya kebijakan spam untuk <em>link scheme</em> (jaringan blog yang dibuat hanya untuk menaikkan link) dan <em>scaled content abuse</em> (konten massal yang tidak bermanfaat). Jika terdeteksi, link diabaikan atau situs bisa terkena penalti manual.</li>
        <li>Karena itu engine ini dirancang untuk kualitas: artikel orisinal per blog, anchor bervariasi, satu link per artikel, posting bertahap, dan wajib review sebelum terbit.</li>
        <li>Rawat blog satelit seperti blog sungguhan: isi juga dengan artikel lain yang tidak menautkan situs utama, beri topik yang jelas, dan jangan hanya berisi artikel promosi.</li>
        <li>Backlink paling kuat tetap dari situs pihak lain yang relevan (media, direktori bisnis lokal, Google Business Profile, kerja sama/guest post). Gunakan <code>sponsored</code> untuk link berbayar.</li>
        <li>Daftarkan situs utama & blog di Google Search Console dan kirim sitemap agar cepat terindeks.</li>
      </ul>
    </div>`;
}

// ---------- init ----------
(async () => {
  status = await api('/api/status');
  document.getElementById('mode').innerHTML = status.ai ? `Penulis: <strong>AI</strong> (${esc(status.model)})` : 'Penulis: <strong>template</strong> (tanpa AI)';
  window.addEventListener('hashchange', route);
  route();
})();
