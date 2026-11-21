// Inspo Library — front end. No build step: plain ES modules.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};

const state = {
  styles: [],
  kits: [],
  section: store.get('inspo-section', 'all'),
  stats: null,
  taste: null,
  config: null,
  queue: 0,
  view: 'library',
  q: '',
  sort: store.get('inspo-sort', 'newest'),
  density: store.get('inspo-density', 'm'),
  filters: { show: 'all', facet: null, type: null, mood: null, tag: null, hue: null },
  showAllTags: false,
  detailId: null,
  editing: false,
  zoomed: false,
  loaded: false,
};

// ---------- API ----------
// The hosted web view (npm run site:build) has no server: it reads a snapshot from
// /data/library.json and builds briefs in the browser with the same modules the server uses.
const STATIC = Boolean(window.INSPO_STATIC);
const READ_ONLY = 'This is the read-only web view. Add and edit references in the local app.';
let snapshot = null;
const picked = () => new Set(JSON.parse(store.get('inspo-picked', '[]')));

async function staticApi(path, opts = {}) {
  if (path === '/api/library') {
    snapshot ||= await (await fetch('/data/library.json', { cache: 'no-cache' })).json();
    const on = picked();
    return { ...snapshot, styles: snapshot.styles.map((s) => ({ ...s, pinned: on.has(s.id) })), stats: { ...snapshot.stats, pinned: on.size } };
  }
  if (path === '/api/active') {
    const on = picked();
    const { id, pinned } = opts.body;
    if (id === '*') on.clear(); else if (pinned) on.add(id); else on.delete(id);
    store.set('inspo-picked', JSON.stringify([...on]));
    if (id === '*') state.styles.forEach((s) => { s.pinned = false; });
    return { ok: true };
  }
  const [prompts, play] = await Promise.all([import('/lib/prompts.js'), import('/lib/playbooks.js')]);
  if (path === '/api/taste.md') return prompts.tasteToMarkdown(state.taste, state.stats);
  if (path === '/api/prompt') {
    const { ids, kitId, content, task } = opts.body || {};
    let { medium } = opts.body || {};
    const kit = kitId ? state.kits.find((k) => k.id === kitId) : null;
    const styles = (kit ? kit.parts.map((x) => x.styleId) : ids || []).map(byId).filter(Boolean);
    if (!styles.length) throw new Error('No styles selected');
    medium = medium || kit?.medium || null;
    if (medium && !play.PLAYBOOKS[medium]) medium = null;
    const tokens = play.buildTokens(styles.map((st) => ({ style: st, role: kit?.parts.find((x) => x.styleId === st.id)?.role || null })));
    return { prompt: prompts.bundlePrompt(styles, { taste: state.taste, task, medium, content, kit }), css: play.tokensToCss(tokens), json: play.tokensToJson(tokens) };
  }
  throw new Error(READ_ONLY);
}

async function api(path, opts = {}) {
  if (STATIC) return staticApi(path, opts);
  const res = await fetch(path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof Blob) && !(opts.body instanceof ArrayBuffer) ? { 'Content-Type': 'application/json', ...opts.headers } : opts.headers,
    body: opts.body && typeof opts.body === 'object' && !(opts.body instanceof Blob) && !(opts.body instanceof ArrayBuffer) ? JSON.stringify(opts.body) : opts.body,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

async function refresh() {
  const data = await api('/api/library');
  Object.assign(state, { styles: data.styles, kits: data.kits || [], stats: data.stats, taste: data.taste, config: data.config, queue: data.queue, loaded: true });
  renumber();
  render();
}

let refreshTimer;
const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh().catch(() => {}), 120); };

// ---------- Helpers ----------
const byId = (id) => state.styles.find((s) => s.id === id);
// Stable catalogue numbers: order of arrival in the library.
let numbers = new Map();
function renumber() {
  const order = [...state.styles].sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || '') || a.id.localeCompare(b.id));
  numbers = new Map(order.map((s, i) => [s.id, String(i + 1).padStart(3, '0')]));
}
const pinLabel = (s) => (STATIC
  ? (s.pinned ? '<span class="spark">✓</span> Selected' : '<span class="spark">✳</span> Select for brief')
  : (s.pinned ? '<span class="spark">✓</span> In Claude' : '<span class="spark">✳</span> Add to Claude'));
const catalogNo = (s) => numbers.get(s.id) || '—';
const colorsOf = (s) => (s.colors?.length ? s.colors : (s.localColors || []).map((c) => ({ hex: c.hex.toUpperCase(), name: '', role: '' })));

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
const readableOn = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#161513' : '#ffffff';
};

const HUES = [
  ['red', '#D8392B'], ['orange', '#F0862A'], ['yellow', '#EBC32B'], ['green', '#4F9A4C'], ['teal', '#2A9D97'],
  ['blue', '#2F62D9'], ['purple', '#7B4CC4'], ['pink', '#E05A9A'], ['brown', '#8A5A3B'], ['black', '#1B1B1B'],
  ['grey', '#9C9A95'], ['white', '#F5F3EE'],
];
function hueBucket(hex) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  if (l < 0.13) return 'black';
  if (l > 0.9 && s < 0.4) return 'white';
  if (s < 0.14) return 'grey';
  if (h >= 15 && h < 45 && l < 0.42) return 'brown';
  if (h < 12 || h >= 345) return 'red';
  if (h < 42) return 'orange';
  if (h < 68) return 'yellow';
  if (h < 160) return 'green';
  if (h < 195) return 'teal';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}
const huesOf = (s) => new Set(colorsOf(s).slice(0, 4).map((c) => hueBucket(c.hex)));

function copy(text, message = 'Copied') {
  const done = () => toast(message);
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  fallbackCopy(text, done);
}
function fallbackCopy(text, done) {
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.append(ta); ta.select();
  document.execCommand('copy'); ta.remove(); done();
}

function toast(message, { error = false, action, onAction, ms = 3200 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' is-error' : ''}`;
  el.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const b = Object.assign(document.createElement('button'), { textContent: action });
    b.onclick = () => { onAction(); el.remove(); };
    el.append(b);
  }
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}
const fail = (err) => toast(err.message || String(err), { error: true, ms: 5000 });

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round((b || 0) / 1e3)} KB`);

// ---------- Filtering & sorting ----------
function visibleStyles() {
  const { filters: f } = state;
  const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  let list = state.styles.filter((s) => {
    if (f.show === 'favorites' && !s.favorite) return false;
    if (f.show === 'active' && !s.pinned) return false;
    if (f.show === 'pending' && s.status === 'ready') return false;
    if (state.section !== 'all' && s.sectionId !== state.section) return false;
    if (f.facet && !(s.facets || []).includes(f.facet)) return false;
    if (f.type && s.type !== f.type) return false;
    if (f.mood && !(s.mood || []).includes(f.mood)) return false;
    if (f.tag && !(s.tags || []).includes(f.tag)) return false;
    if (f.hue && !huesOf(s).has(f.hue)) return false;
    if (words.length) {
      const hay = [s.styleName, s.type, s.description, s.fileName, s.collection, s.notes, s.instructions, s.sectionId, ...(s.facets || []), ...(s.tags || []), ...(s.mood || []),
        ...colorsOf(s).flatMap((c) => [c.hex, c.name]), ...(s.typography || []).map((t) => t.family)].join(' ').toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const name = (s) => (s.styleName || s.fileName).toLowerCase();
  const sorters = {
    newest: (a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''),
    oldest: (a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''),
    name: (a, b) => name(a).localeCompare(name(b)),
    type: (a, b) => (a.type || 'zzz').localeCompare(b.type || 'zzz') || name(a).localeCompare(name(b)),
    analysed: (a, b) => (b.analyzedAt || '').localeCompare(a.analyzedAt || ''),
    favorites: (a, b) => Number(b.favorite) - Number(a.favorite) || (b.addedAt || '').localeCompare(a.addedAt || ''),
    color: (a, b) => {
      const key = (s) => {
        const c = colorsOf(s)[0];
        if (!c) return 999;
        const [h, sat, l] = rgbToHsl(hexToRgb(c.hex));
        return sat < 0.14 ? 400 + l * 100 : h;
      };
      return key(a) - key(b);
    },
  };
  return list.sort(sorters[state.sort] || sorters.newest);
}

// ---------- Render: rail ----------
function renderFilters() {
  const el = $('#filters');
  if (state.view !== 'library' || !state.stats) { el.innerHTML = ''; return; }
  const { stats, filters: f } = state;
  const inSec = state.styles.filter((s) => state.section === 'all' || s.sectionId === state.section);
  const counts = {
    all: inSec.length,
    favorites: inSec.filter((s) => s.favorite).length,
    active: inSec.filter((s) => s.pinned).length,
    pending: inSec.filter((s) => s.status !== 'ready').length,
  };
  const item = (key, val, label, count) =>
    `<button class="fitem${f[key] === val ? ' is-on' : ''}" data-filter="${key}" data-value="${esc(val ?? '')}"><span>${esc(label)}</span><span class="fcount">${count}</span></button>`;
  const group = (title, key, inner) =>
    `<div class="fgroup"><h4 class="mono label">${title}${f[key] ? `<button data-clear="${key}">Clear</button>` : ''}</h4>${inner}</div>`;

  const hueCounts = new Map();
  state.styles.forEach((s) => huesOf(s).forEach((h) => hueCounts.set(h, (hueCounts.get(h) || 0) + 1)));
  const tags = state.showAllTags ? stats.tags : stats.tags.slice(0, 18);

  el.innerHTML = [
    `<div class="fgroup"><div class="flist">
      ${item('show', 'all', 'Everything', counts.all)}
      ${item('show', 'favorites', '★ Favourites', counts.favorites)}
      ${item('show', 'active', STATIC ? '✳ Selected' : '✳ Active in Claude', counts.active)}
      ${counts.pending ? item('show', 'pending', 'Needs analysis', counts.pending) : ''}
    </div></div>`,
    stats.facets?.length ? group('Borrow its…', 'facet', `<div class="chips">${stats.facets.map((x) =>
      `<button class="fchip${f.facet === x.name ? ' is-on' : ''}" data-filter="facet" data-value="${esc(x.name)}">${esc(x.name)} <span class="fcount">${x.count}</span></button>`).join('')}</div>`) : '',
    stats.types.length ? group('Type', 'type', `<div class="flist">${stats.types.map((t) => item('type', t.name, t.name, t.count)).join('')}</div>`) : '',
    hueCounts.size ? group('Colour', 'hue', `<div class="hues">${HUES.filter(([h]) => hueCounts.has(h)).map(([h, c]) =>
      `<button class="hue${f.hue === h ? ' is-on' : ''}" style="background:${c}" data-filter="hue" data-value="${h}" title="${h} (${hueCounts.get(h)})" aria-label="${h}"></button>`).join('')}</div>`) : '',
    stats.moods.length ? group('Mood', 'mood', `<div class="chips">${stats.moods.slice(0, 14).map((m) =>
      `<button class="fchip${f.mood === m.name ? ' is-on' : ''}" data-filter="mood" data-value="${esc(m.name)}">${esc(m.name)}</button>`).join('')}</div>`) : '',
    stats.tags.length ? group('Keywords', 'tag', `<div class="chips">${tags.map((t) =>
      `<button class="fchip${f.tag === t.name ? ' is-on' : ''}" data-filter="tag" data-value="${esc(t.name)}">${esc(t.name)}</button>`).join('')}
      ${stats.tags.length > 18 ? `<button class="fchip" data-more-tags>${state.showAllTags ? 'Less' : `+${stats.tags.length - 18}`}</button>` : ''}</div>`) : '',
  ].join('');
}

// ---------- Render: cards ----------
const cardCache = new Map(); // id -> { sig, el }

function cardSignature(s) {
  return JSON.stringify([s.styleName, s.type, s.description, s.status, s.error, s.favorite, s.pinned, s.colors, s.localColors, s.typography, s.tags, s.collection, s.width, s.height, s.fileName, s.sectionId, s.facets]);
}

function cardHTML(s) {
  const colors = colorsOf(s).slice(0, 7);
  const font = (s.typography || [])[0];
  const fonts = (s.typography || []).slice(0, 2).map((t) => `${t.family}${t.category ? ` · ${t.category}` : ''}`).join('  /  ');
  // Full-page screenshots get cropped to their top so one card can't dominate the grid.
  const tall = s.width && s.height && s.height / s.width > 1.5;
  const ratio = tall ? '2 / 3' : s.width && s.height ? `${s.width} / ${s.height}` : '4 / 3';
  const status = s.status === 'analyzing' ? `<div class="scan is-analyzing"><span class="mono">Reading style…</span></div>`
    : s.status === 'error' ? `<div class="scan is-error"><span class="mono">Analysis failed</span></div>`
    : s.status !== 'ready' ? `<div class="scan"><span class="mono">Waiting for analysis</span></div>` : '';
  return `
    <button class="card__media" data-open aria-label="Open ${esc(s.styleName || s.fileName)}">
      <img src="/thumbs/${s.id}" alt="" loading="lazy" decoding="async" style="aspect-ratio:${ratio}"${tall ? ' class="is-tall"' : ''} />
      <span class="glare" aria-hidden="true"></span>
      <span class="card__no mono">No. ${catalogNo(s)}</span>
      ${s.pinned ? `<span class="card__flag mono">${STATIC ? 'Selected' : 'In Claude'}</span>` : ''}
      ${status}
    </button>
    <div class="card__body">
      <div class="card__meta">
        ${s.type ? `<span class="chip">${esc(s.type)}</span>` : ''}
        <span class="card__coll mono">${esc(sectionMeta(s.sectionId).glyph)} ${esc(sectionMeta(s.sectionId).label)}</span>
        <button class="fav${s.favorite ? ' is-on' : ''}" data-fav title="Favourite" aria-label="Favourite">${s.favorite ? '★' : '☆'}</button>
      </div>
      <h3 class="card__title${s.styleName ? '' : ' is-placeholder'}" data-open>${esc(s.styleName || s.fileName)}</h3>
      ${s.description ? `<p class="card__desc">${esc(s.description)}</p>` : ''}
      ${colors.length ? `<div class="swatches">${colors.map((c) => `<button style="background:${c.hex};--fg:${readableOn(c.hex)}" data-hex="${c.hex}" title="${esc(c.name ? `${c.name} ${c.hex}` : c.hex)}"></button>`).join('')}</div>` : ''}
      ${font ? `<div class="card__typo"><span class="aa">Aa</span><span>${esc(fonts)}</span></div>` : ''}
      ${s.facets?.length ? `<div class="facets">${s.facets.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
      ${s.tags?.length ? `<div class="tags">${s.tags.slice(0, 4).map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="card__actions">
        <button class="cta${s.pinned ? ' is-on' : ''}" data-pin>${pinLabel(s)}</button>
        <button class="iconbtn" data-copy title="Copy this style as a prompt" aria-label="Copy prompt">⧉</button>
      </div>
    </div>`;
}

function getCard(s, i) {
  const sig = cardSignature(s) + catalogNo(s);
  const cached = cardCache.get(s.id);
  if (cached && cached.sig === sig) return cached.el;
  const el = cached?.el || document.createElement('article');
  el.className = `card${s.pinned ? ' is-pinned' : ''}${cached ? ' settled' : ''}`;
  el.dataset.id = s.id;
  el.style.setProperty('--i', Math.min(i, 24));
  el.innerHTML = cardHTML(s);
  if (!cached) {
    el.addEventListener('animationend', () => el.classList.add('settled'), { once: true });
    resizer.observe(el);
  }
  cardCache.set(s.id, { sig, el });
  return el;
}

const ROW = 4, GAP = 22;
const resizer = new ResizeObserver((entries) => {
  for (const { target } of entries) sizeCard(target);
});
function sizeCard(el) {
  const h = el.firstElementChild ? el.scrollHeight : 0;
  el.style.gridRowEnd = `span ${Math.ceil((h + GAP) / ROW)}`;
}

function renderGrid() {
  const grid = $('#grid');
  const list = visibleStyles();
  const ids = new Set(state.styles.map((s) => s.id));
  for (const [id, { el }] of cardCache) {
    if (!ids.has(id)) { resizer.unobserve(el); el.remove(); cardCache.delete(id); }
  }
  list.forEach((s, i) => {
    const el = getCard(s, i);
    if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null);
  });
  while (grid.children.length > list.length) grid.lastElementChild.remove();

  const empty = $('#empty');
  if (STATIC && (!state.styles.length || (!list.length && state.section !== 'all' && !state.q && !activeFilters()))) {
    empty.hidden = false;
    empty.innerHTML = state.styles.length
      ? `<h2>Nothing in ${esc(sectionMeta(state.section).label)} yet.</h2><p>Add references to this section in the local app, then publish a new snapshot.</p>`
      : `<h2>This web view is empty.</h2><p>On your computer, in the app folder, run <code>npm run site:export</code>, commit the <code>site/</code> folder and push. The hosted view rebuilds with your library.</p>`;
  } else if (!state.styles.length || (!list.length && state.section !== 'all' && !state.q && !activeFilters())) {
    const sec = sectionMeta(state.section);
    empty.hidden = false;
    empty.innerHTML = `
      <h2>${state.styles.length ? `Nothing in ${esc(sec.label)} yet.` : 'Your library is empty.'}</h2>
      <p>Drop images anywhere on this page, paste a screenshot, or save files into:</p>
      <p><code>${esc(`${state.config.libraryDir}/${uploadTarget()}`)}</code></p>
      <p>Put a same-named <code>.md</code> next to an image for instructions or its source URL (“take the type, ignore the colours”). Claude turns each reference into a style and files it into its section.</p>
      <label class="btn btn--ink" for="fileInput">＋ Add references</label>`;
  } else if (!list.length) {
    empty.hidden = false;
    empty.innerHTML = `<h2>Nothing matches.</h2><p>Try a different search or clear the filters.</p><button class="btn" data-reset>Clear filters</button>`;
  } else empty.hidden = true;

  const { stats } = state;
  const status = [`<span><b>${list.length}</b> of ${state.styles.length} references</span>`];
  if (STATIC && snapshot?.demo) status.unshift('<span class="live">Demo data · run npm run site:export to publish your library</span>');
  if (stats.pinned) status.push(`<span><b>${stats.pinned}</b> active in Claude</span>`);
  if (state.queue) status.push(`<span class="live">Analysing ${state.queue}</span>`);
  else if (stats.pending && !state.config.aiEnabled && !STATIC) status.push(`<span>${stats.pending} waiting — add an API key in Settings or ask Claude to analyse them over MCP</span>`);
  $('#statusline').innerHTML = status.join('');
}

// ---------- Render: tray ----------
function renderTray() {
  const tray = $('#tray');
  const active = state.styles.filter((s) => s.pinned);
  if (!active.length) { tray.hidden = true; return; }
  tray.hidden = false;
  tray.innerHTML = `
    <div class="tray__stack">${active.slice(0, 5).map((s) => `<button data-open-id="${s.id}" title="${esc(s.styleName || s.fileName)}"><img src="/thumbs/${s.id}" alt="" /></button>`).join('')}</div>
    <div class="tray__text"><b>${active.length} style${active.length > 1 ? 's' : ''} ${STATIC ? 'selected' : 'active in Claude'}</b><span class="mono">${STATIC ? 'Execute or copy a brief' : 'Live over MCP'} · ${esc(active.map((s) => s.styleName || s.fileName).join(', '))}</span></div>
    <button class="btn btn--accent btn--sm" data-tray-copy>Copy brief</button>
    <button class="btn btn--sm" data-tray-clear>Clear</button>`;
}

// ---------- Render: detail ----------
function loadFonts(families) {
  const names = [...new Set(families.filter(Boolean))].slice(0, 8);
  for (const name of names) {
    const id = `gf-${name.replace(/\W+/g, '-')}`;
    if (document.getElementById(id)) continue;
    const link = Object.assign(document.createElement('link'), {
      id, rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}&display=swap`,
    });
    document.head.append(link);
  }
}

function openDetail(id) {
  state.detailId = id;
  state.editing = false;
  state.zoomed = false;
  const dlg = $('#detail');
  renderDetail(true);
  if (!dlg.open) dlg.showModal();
}

function renderDetail(full = false) {
  const dlg = $('#detail');
  const s = byId(state.detailId);
  if (!s) { if (dlg.open) dlg.close(); return; }
  const list = visibleStyles();
  const idx = list.findIndex((x) => x.id === s.id);

  if (full || !$('.detail__media', dlg) || $('.detail__media', dlg).dataset.id !== s.id) {
    dlg.innerHTML = `
      <div class="detail__media" data-id="${s.id}">
        <img src="/media/${s.id}" alt="${esc(s.styleName || s.fileName)}" data-zoom />
        <div class="detail__nav">
          <button data-nav="-1" ${idx <= 0 ? 'disabled' : ''} aria-label="Previous">←</button>
          <button data-nav="1" ${idx < 0 || idx >= list.length - 1 ? 'disabled' : ''} aria-label="Next">→</button>
        </div>
      </div>
      <div class="detail__panel"></div>`;
  }
  const panel = $('.detail__panel', dlg);
  const scroll = panel.scrollTop;
  panel.innerHTML = state.editing ? editHTML(s) : detailHTML(s);
  panel.scrollTop = scroll;
  loadFonts((s.typography || []).flatMap((t) => [t.family, ...(t.alternatives || [])]));
}

function detailHTML(s) {
  const colors = colorsOf(s);
  const t = s.tokens || {};
  const tokenRows = [['Corners', t.cornerRadius], ['Spacing', t.spacing], ['Borders', t.borders], ['Shadows', t.shadows], ['Texture', t.texture], ['Motion', t.motion]].filter(([, v]) => v);
  const bullets = (items, cls = '') => `<ul class="bul ${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  const sect = (title, body, extra = '') => `<section class="sect"><h5 class="mono label">${title}${extra}</h5>${body}</section>`;
  const ai = state.config.aiEnabled;

  return `
    <header class="detail__head">
      <div class="detail__top">
        <span class="chip">No. ${catalogNo(s)}</span>
        ${s.type ? `<span class="chip">${esc(s.type)}</span>` : ''}
        ${s.collection ? `<span class="mono label">${esc(s.collection)}</span>` : ''}
        <button class="ghost icon close" data-close aria-label="Close">✕</button>
      </div>
      <h2 class="detail__title">${esc(s.styleName || s.fileName)}</h2>
      ${s.description ? `<p class="detail__desc">${esc(s.description)}</p>` : ''}
      <div class="detail__actions">
        <button class="cta${s.pinned ? ' is-on' : ''}" data-pin>${pinLabel(s)}</button>
        <button class="btn btn--sm btn--accent" data-exec-style>Execute ⟶</button>
        <button class="btn btn--sm" data-copy>Copy prompt</button>
        <button class="btn btn--sm" data-fav>${s.favorite ? '★ Favourite' : '☆ Favourite'}</button>
        <button class="btn btn--sm" data-edit>Edit</button>
        ${ai ? `<button class="btn btn--sm" data-analyze ${s.status === 'analyzing' ? 'disabled' : ''}>${s.status === 'ready' ? 'Re-analyse' : 'Analyse'}</button>` : ''}
        <button class="btn btn--sm" data-reveal>Show in folder</button>
        <button class="btn btn--sm" data-trash title="Moves the file to .inspo/trash">Remove</button>
      </div>
      <div class="detail__org">
        <label class="select"><span class="mono label">Section</span><select data-set-section>${state.config.sections.map((x) => `<option value="${x.id}" ${x.id === s.sectionId ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
        <label class="select"><span class="mono label">Kit</span><select data-add-kit><option value="">Add to kit…</option>${state.kits.map((k) => { const has = k.parts.some((p) => p.styleId === s.id); return `<option value="${k.id}" ${has ? 'disabled' : ''}>${esc(k.name)}${has ? ' ✓' : ''}</option>`; }).join('')}<option value="__new">＋ New kit with this style</option></select></label>
      </div>
      ${s.status === 'error' ? `<div class="error-box">${esc(s.error || 'Analysis failed')}</div>` : ''}
      ${s.status === 'analyzing' ? `<div class="error-box" style="color:var(--ink-2)">Claude is reading this reference…</div>` : ''}
      ${s.status === 'pending' && !ai ? `<div class="error-box" style="color:var(--ink-2)">Not analysed yet. Add an API key in Settings, ask Claude “analyse my new references” (MCP), or fill it in with Edit.</div>` : ''}
    </header>
    <div class="detail__body">
      ${s.instructions || s.sourceUrl ? sect('Curator instructions', `${s.instructions ? `<p>${esc(s.instructions)}</p>` : ''}${s.sourceUrl ? `<p><a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(s.sourceUrl)}</a></p>` : ''}`) : ''}
      ${s.facets?.length || s.bestFor?.length ? sect('Use it for', `<div class="chips">${(s.facets || []).map((x) => `<span class="fchip is-facet">borrow ${esc(x)}</span>`).join('')}${(s.bestFor || []).map((m) => `<button class="fchip" data-exec-style="${esc(m)}">${esc(mediumLabel(m))} ⟶</button>`).join('')}</div>`) : ''}
      ${s.summary ? sect('Overview', `<p>${esc(s.summary)}</p>`) : ''}
      ${colors.length ? sect('Palette', `<div class="palette">${colors.map((c) => `
        <button data-hex="${c.hex}" title="Copy ${c.hex}"><div class="sw" style="background:${c.hex}"></div>
        <div class="meta"><b>${esc(c.name || c.hex)}</b><span class="mono">${c.hex}</span>${c.role ? `<span>${esc(c.role)}</span>` : ''}</div></button>`).join('')}</div>`,
        `<button class="ghost" style="padding:0;font-size:12px;text-transform:none;letter-spacing:0" data-copy-palette>Copy hex codes</button>`) : ''}
      ${s.typography?.length ? sect('Typography', `<div class="fonts">${s.typography.map((f) => `
        <div class="font"><div class="aa" style="font-family:'${esc(f.family)}','${esc((f.alternatives || [])[0] || '')}',var(--sans)">Aa</div>
        <div><b>${esc(f.family)}</b><div class="sub">${esc([f.role, f.category, f.weight].filter(Boolean).join(' · '))}</div>
        ${f.notes ? `<div class="notes">${esc(f.notes)}</div>` : ''}
        ${f.alternatives?.length ? `<div class="sub">Free alternatives: ${esc(f.alternatives.join(', '))}</div>` : ''}</div></div>`).join('')}</div>`) : ''}
      ${s.layout || s.composition ? sect('Layout & composition', `${s.layout ? `<p>${esc(s.layout)}</p>` : ''}${s.composition ? `<p>${esc(s.composition)}</p>` : ''}`) : ''}
      ${tokenRows.length ? sect('Design tokens', `<dl class="kv">${tokenRows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`) : ''}
      ${s.visualElements?.length ? sect('Signature details', bullets(s.visualElements)) : ''}
      ${s.principles?.length ? sect('Principles', bullets(s.principles)) : ''}
      ${s.doUse?.length || s.avoid?.length ? sect('Do / avoid', `<div class="two"><div>${bullets(s.doUse || [], 'do')}</div><div>${bullets(s.avoid || [], 'dont')}</div></div>`) : ''}
      ${s.mood?.length || s.tags?.length ? sect('Mood & keywords', `<div class="chips">${[...(s.mood || []), ...(s.tags || [])].map((x) => `<button class="fchip" data-tag-filter="${esc(x)}">${esc(x)}</button>`).join('')}</div>`) : ''}
      ${s.promptSnippet ? sect('Prompt', `<pre class="prompt">${esc(s.promptSnippet)}</pre>`, `<button class="ghost" style="padding:0;font-size:12px;text-transform:none;letter-spacing:0" data-copy>Copy full prompt</button>`) : ''}
      ${STATIC ? (s.notes ? sect('My notes', `<p>${esc(s.notes)}</p>`) : '') : sect('My notes', `<textarea class="notes" rows="3" data-notes placeholder="Why you saved this, where to use it… (Claude sees these notes)">${esc(s.notes || '')}</textarea>`)}
      ${sect('File', `<dl class="kv">
        <dt>Name</dt><dd>${esc(s.file)}</dd>
        ${s.width ? `<dt>Size</dt><dd>${s.width} × ${s.height}px · ${fmtSize(s.size)}</dd>` : ''}
        <dt>Added</dt><dd>${fmtDate(s.addedAt)}</dd>
        ${s.analyzedAt ? `<dt>Analysed</dt><dd>${fmtDate(s.analyzedAt)} · ${esc(s.source === 'claude-mcp' ? 'by Claude via MCP' : s.model || '')}</dd>` : ''}
        <dt>ID</dt><dd class="mono">${s.id}</dd></dl>`)}
    </div>`;
}

function editHTML(s) {
  const types = state.config.types;
  return `
    <header class="detail__head">
      <div class="detail__top"><span class="mono label">Editing</span><button class="ghost icon close" data-close aria-label="Close">✕</button></div>
      <h2 class="detail__title">Edit style</h2>
    </header>
    <form class="detail__body" data-edit-form style="padding-top:20px">
      <div class="field"><label class="mono label">Style name</label><input name="styleName" value="${esc(s.styleName || '')}" placeholder="e.g. Swiss Grid Brutalism" /></div>
      <div class="field"><label class="mono label">Type</label><select name="type">${['', ...types].map((t) => `<option ${t === (s.type || '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      <div class="field"><label class="mono label">Short description</label><textarea name="description" rows="2">${esc(s.description || '')}</textarea></div>
      <div class="field"><label class="mono label">Colours</label><textarea name="colors" rows="5" placeholder="#1A1A1A Ink — text">${esc(colorsOf(s).map((c) => `${c.hex}${c.name ? ` ${c.name}` : ''}${c.role ? ` — ${c.role}` : ''}`).join('\n'))}</textarea><small>One per line: #HEX Name — role</small></div>
      <div class="field"><label class="mono label">Typography</label><textarea name="typography" rows="3" placeholder="Neue Haas Grotesk | sans-serif | headline">${esc((s.typography || []).map((t) => [t.family, t.category, t.role, t.weight].filter(Boolean).join(' | ')).join('\n'))}</textarea><small>One per line: Family | category | role | weight</small></div>
      <div class="field"><label class="mono label">Keywords</label><input name="tags" value="${esc((s.tags || []).join(', '))}" /><small>Comma separated</small></div>
      <div class="field"><label class="mono label">Mood</label><input name="mood" value="${esc((s.mood || []).join(', '))}" /></div>
      <div class="field"><label class="mono label">Prompt / art direction</label><textarea name="promptSnippet" rows="6">${esc(s.promptSnippet || '')}</textarea></div>
      <div class="form-actions"><button type="button" class="btn" data-cancel-edit>Cancel</button><button class="btn btn--ink">Save</button></div>
    </form>`;
}

function parseEdit(form, s) {
  const fd = new FormData(form);
  const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  const colors = String(fd.get('colors') || '').split('\n').map((line) => {
    const m = line.trim().match(/^(#?[0-9a-f]{3,6})\b\s*([^—–-]*)?(?:[—–-]\s*(.*))?$/i);
    return m ? { hex: m[1].startsWith('#') ? m[1] : `#${m[1]}`, name: (m[2] || '').trim(), role: (m[3] || '').trim() } : null;
  }).filter(Boolean);
  const typography = String(fd.get('typography') || '').split('\n').map((line) => {
    const [family, category = '', role = '', weight = ''] = line.split('|').map((x) => x.trim());
    if (!family) return null;
    const prev = (s.typography || []).find((t) => t.family.toLowerCase() === family.toLowerCase());
    return { family, category, role, weight, notes: prev?.notes || '', alternatives: prev?.alternatives || [] };
  }).filter(Boolean);
  return {
    styleName: fd.get('styleName'), type: fd.get('type'), description: fd.get('description'),
    colors, typography, tags: list(fd.get('tags')), mood: list(fd.get('mood')), promptSnippet: fd.get('promptSnippet'),
  };
}

// ---------- Render: taste ----------
function renderTaste() {
  const el = $('#view-taste');
  const { taste, stats, config } = state;
  const pal = stats.palette.slice(0, 12);
  const max = Math.max(1, ...stats.types.map((t) => t.count));
  const tagMax = Math.max(1, ...stats.tags.map((t) => t.count));
  el.innerHTML = `
    <div class="page">
      <div class="kicker mono">Taste profile · ${stats.analysed} of ${stats.total} references analysed</div>
      <h1 class="hero">${esc(taste?.headline || 'Your taste, distilled.')}</h1>
      <p class="lede">${esc(taste?.summary || 'Once a few references are analysed, Claude reads across your whole library and writes down what you consistently gravitate to: palettes, type, layout, the details you love and the things you avoid. Claude then applies it automatically.')}</p>
      <div class="page-actions">
        ${config.aiEnabled ? `<button class="btn btn--ink" data-rebuild ${stats.analysed < 2 ? 'disabled' : ''}>${taste ? 'Rebuild taste profile' : 'Build taste profile'}</button>`
          : `<button class="btn btn--ink" data-copy-text="Rebuild my design taste profile from my inspo library.">Copy MCP request for Claude</button>`}
        <button class="btn" data-copy-taste>Copy as Markdown</button>
        <button class="btn" data-copy-text="${esc(config.files.taste)}">Copy TASTE.md path</button>
        ${taste?.builtAt ? `<span class="mono">Built ${fmtDate(taste.builtAt)} from ${taste.basedOn} references</span>` : ''}
      </div>
      ${pal.length ? `<div class="bigpal">${pal.map((c) => `<button style="background:${c.hex};flex-grow:${c.weight};color:${readableOn(c.hex)}" data-hex="${c.hex}"><span>${c.hex}</span></button>`).join('')}</div>
        <div class="mono label" style="margin-bottom:28px">Your recurring palette — click to copy</div>` : ''}
      <div class="cols">
        ${taste?.signatureTraits?.length ? `<div class="block"><h3>Signature traits</h3><ol class="traits">${taste.signatureTraits.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>` : ''}
        ${taste?.palette ? `<div class="block"><h3>Colour</h3><p>${esc(taste.palette)}</p></div>` : ''}
        ${taste?.typography || stats.fonts.length ? `<div class="block"><h3>Typography</h3>${taste?.typography ? `<p>${esc(taste.typography)}</p>` : ''}
          ${stats.fonts.length ? `<div class="chips" style="margin-top:12px">${stats.fonts.slice(0, 10).map((f) => `<span class="fchip">${esc(f.name)}</span>`).join('')}</div>` : ''}</div>` : ''}
        ${taste?.layout ? `<div class="block"><h3>Layout</h3><p>${esc(taste.layout)}</p></div>` : ''}
        ${taste?.alwaysDo?.length ? `<div class="block"><h3>Always</h3><ul class="bul do">${taste.alwaysDo.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
        ${taste?.neverDo?.length ? `<div class="block"><h3>Never</h3><ul class="bul dont">${taste.neverDo.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
        ${stats.types.length ? `<div class="block"><h3>What you collect</h3><div class="bars">${stats.types.map((t) => `<div class="bar"><span>${esc(t.name)}</span><i style="width:${(t.count / max) * 100}%"></i><span>${t.count}</span></div>`).join('')}</div></div>` : ''}
        ${stats.tags.length ? `<div class="block"><h3>Your vocabulary</h3><div class="cloud">${stats.tags.slice(0, 40).map((t) => `<span style="font-size:${14 + (t.count / tagMax) * 22}px">${esc(t.name)}</span>`).join('')}</div></div>` : ''}
        ${taste?.promptPreamble ? `<div class="block" style="grid-column:1/-1"><h3>How Claude should design for you</h3><pre class="prompt">${esc(taste.promptPreamble)}</pre></div>` : ''}
      </div>
    </div>`;
}

// ---------- Render: connect ----------
function renderConnect() {
  const el = $('#view-connect');
  const { config } = state;
  const desktop = JSON.stringify({ mcpServers: { inspo: { command: config.mcp.command, args: config.mcp.args } } }, null, 2);
  const examples = [
    'Design a landing page for my coffee brand using my active styles.',
    'Analyse my new references and save them to my inspo library.',
    'Search my inspo library for something brutalist and use it for a poster.',
    'Use my Pitch deck kit to build slides from this outline: …',
    'Process my inspo inbox and suggest kits for the new references.',
    'Rebuild my design taste profile from my inspo library.',
    'Restyle this component to match my design taste.',
  ];
  const code = (txt) => `<div class="code"><pre>${esc(txt)}</pre><button class="btn btn--sm" data-copy-text="${esc(txt)}">Copy</button></div>`;
  el.innerHTML = `
    <div class="page">
      <div class="kicker mono">Connect Claude</div>
      <h1 class="hero">One tap, and Claude knows your taste.</h1>
      <p class="lede">The library runs a small MCP server. Once Claude is connected, it reads your active styles and taste profile by itself — you never paste references or explain your style again.</p>
      <div class="page-actions">
        <span class="mono ${config.aiEnabled ? 'pill-ok' : 'pill-warn'}">${config.aiEnabled ? '● Auto-analysis on' : '○ Auto-analysis off (no API key)'}</span>
        <span class="mono ${config.sharp ? 'pill-ok' : 'pill-warn'}">${config.sharp ? '● Image processing on' : '○ Install sharp for thumbnails'}</span>
      </div>
      <div class="steps">
        <div class="step"><div>
          <h3>Claude Desktop</h3>
          <p>Open Claude Desktop → Settings → Developer → Edit Config, paste this into <code>claude_desktop_config.json</code> (merge with any existing <code>mcpServers</code>), then restart Claude.</p>
          ${code(desktop)}
        </div></div>
        <div class="step"><div>
          <h3>Claude Code</h3>
          <p>Run this once in a terminal. Every Claude Code session can then use your library.</p>
          ${code(config.mcp.claudeCode)}
          <p style="margin-top:12px">No MCP? You can also point Claude Code at the generated files: <code>@${esc(config.files.active)}</code> or <code>@${esc(config.files.taste)}</code>.</p>
        </div></div>
        <div class="step"><div>
          <h3>Install the inspo skill</h3>
          <p>The skill teaches Claude the whole workflow: process the inbox, file references, build kits, and execute in Figma, code, slides or graphics. It is already active when Claude Code runs inside this app's folder. To use it from every project, run this once in the app folder:</p>
          ${code(config.skill.install)}
          <p style="margin-top:12px">Then just say “process my inspo inbox” or “use my Pitch deck kit for this content: …”.</p>
        </div></div>
        <div class="step"><div>
          <h3>Tap “Add to Claude”</h3>
          <p>Every style you add is live in Claude straight away through <code>get_design_brief</code>. The full brief is also copied to your clipboard, so you can paste it into claude.ai or any other tool.</p>
        </div></div>
        <div class="step"><div>
          <h3>Then just ask</h3>
          <p>Click to copy an example:</p>
          <div class="examples">${examples.map((e) => `<button data-copy-text="${esc(e)}">“${esc(e)}”</button>`).join('')}</div>
        </div></div>
      </div>
    </div>`;
}

// ---------- Sections, navigation ----------
const ALL = { id: 'all', label: 'Everything', glyph: '◎', blurb: 'Every reference in the library, across all sections.' };
const INBOX_META = { id: 'inbox', label: 'Inbox', glyph: '↓', blurb: 'Fresh drops waiting for Claude to read them and file them into a section.' };
function sectionMeta(id) {
  if (id === 'all') return ALL;
  if (id === 'inbox') return INBOX_META;
  return state.config?.sections.find((s) => s.id === id) || { id, label: id, glyph: '·', blurb: '' };
}
const mediumLabel = (m) => state.config?.media.find((x) => x.id === m)?.label || m;
const activeFilters = () => Object.entries(state.filters).some(([k, v]) => (k === 'show' ? v !== 'all' : v));
function uploadTarget() {
  const sec = state.config?.sections.find((s) => s.id === state.section);
  return sec ? sec.folder : state.config?.inbox || '_inbox';
}

// Navigation with a cross-fade where the browser supports view transitions.
function go({ view = state.view, section = state.section } = {}) {
  const changed = view !== state.view || section !== state.section;
  state.view = view;
  state.section = section;
  store.set('inspo-section', section);
  document.body.classList.remove('rail-open');
  if (!changed) return render();
  const run = () => { window.scrollTo(0, 0); render(); };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(run);
  else run();
}

function renderSections() {
  const counts = new Map();
  state.styles.forEach((s) => counts.set(s.sectionId, (counts.get(s.sectionId) || 0) + 1));
  const items = [ALL, INBOX_META, ...state.config.sections];
  $('#sections').innerHTML = `<h4 class="mono label">Sections</h4>${items.map((sec) => {
    const n = sec.id === 'all' ? state.styles.length : counts.get(sec.id) || 0;
    const on = state.view === 'library' && state.section === sec.id;
    return `<button class="sec${on ? ' is-on' : ''}${sec.id === 'inbox' && n ? ' has-new' : ''}" data-section="${sec.id}">
      <span class="sec__glyph">${esc(sec.glyph)}</span><span class="sec__label">${esc(sec.label)}</span><span class="fcount">${n}</span></button>`;
  }).join('')}`;
}

// Picks a few well-separated colours from a set of styles, for the hero aurora.
function heroColors(list, n = 4) {
  const out = [];
  for (const s of list) {
    for (const c of colorsOf(s).slice(0, 4)) {
      const [h, sat, l] = rgbToHsl(hexToRgb(c.hex));
      if (sat < 0.18 || l < 0.12 || l > 0.92) continue;
      if (out.some((o) => Math.min(Math.abs(o.h - h), 360 - Math.abs(o.h - h)) < 28)) continue;
      out.push({ hex: c.hex, h });
      if (out.length >= n) return out.map((o) => o.hex);
    }
  }
  const fallback = ['#FF4A1C', '#2F62D9', '#EBC32B', '#2A9D97'];
  return [...out.map((o) => o.hex), ...fallback].slice(0, n);
}

let heroSig = '';
function renderHero() {
  const el = $('#hero');
  const sec = sectionMeta(state.section);
  const list = state.styles.filter((s) => state.section === 'all' || s.sectionId === state.section);
  const ready = list.filter((s) => s.status === 'ready');
  const colors = heroColors(ready.length ? ready : list);
  const fan = list.filter((s) => s.hasThumb !== false).slice(0, 6);
  const sig = JSON.stringify([state.section, list.length, colors, fan.map((s) => s.id), state.filters.facet, state.kits.length]);
  if (sig === heroSig) return;
  heroSig = sig;
  colors.forEach((c, i) => el.style.setProperty(`--a${i}`, c));
  const facets = new Map();
  list.forEach((s) => (s.facets || []).forEach((f) => facets.set(f, (facets.get(f) || 0) + 1)));
  el.innerHTML = `
    <div class="aurora" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="shero__text">
      <div class="kicker mono">${esc(sec.glyph)} ${state.section === 'all' ? 'The whole library' : 'Section'} · ${list.length} reference${list.length === 1 ? '' : 's'}${state.kits.length ? ` · ${state.kits.length} kit${state.kits.length === 1 ? '' : 's'}` : ''}</div>
      <h1 class="shero__title">${esc(sec.label)}</h1>
      <p class="shero__blurb">${esc(sec.blurb)}</p>
      ${facets.size ? `<div class="shero__facets">${[...facets].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, n]) => `<button class="fchip${state.filters.facet === f ? ' is-on' : ''}" data-filter="facet" data-value="${esc(f)}">${esc(f)} <span class="fcount">${n}</span></button>`).join('')}</div>` : ''}
    </div>
    ${fan.length ? `<div class="fan" aria-hidden="true">${fan.map((s, i) => `<img src="/thumbs/${s.id}" alt="" style="--k:${i - (fan.length - 1) / 2}" />`).join('')}</div>` : ''}`;
}

// ---------- Kits ----------
const ROLE_HINT = {
  primary: 'decides everything else', layout: 'grid & structure', typography: 'type system', color: 'palette',
  illustration: 'drawing style', imagery: 'photo/art direction', iconography: 'icons', components: 'UI details & shape',
  texture: 'grain & effects', motion: 'movement',
};

function kitCollage(kit) {
  const thumbs = kit.parts.map((p) => byId(p.styleId)).filter(Boolean).slice(0, 4);
  if (!thumbs.length) return `<div class="kit__collage is-empty"><span>Add styles</span></div>`;
  return `<div class="kit__collage n${thumbs.length}">${thumbs.map((s) => `<img src="/thumbs/${s.id}" alt="" loading="lazy" />`).join('')}</div>`;
}

function renderKits() {
  const el = $('#view-kits');
  const kits = state.kits;
  el.innerHTML = `
    <div class="page">
      <div class="kicker mono">Kits · ${kits.length}</div>
      <h1 class="hero">Kits do the execution.</h1>
      <p class="lede">A kit combines styles with roles (layout from one reference, illustrations from another, type from a third) and aims them at a medium. Bring the content, pick the kit, and Claude builds the deck, page, screen or graphic.</p>
      <div class="page-actions"><button class="btn btn--ink" data-kit-new>＋ New kit</button>
        <span class="mono label">In Claude: “use my &lt;kit&gt; kit to make …”</span></div>
      <div class="kits">
        ${kits.map((k) => `
          <article class="kit" data-kit="${k.id}">
            <button class="kit__media" data-kit-edit>${kitCollage(k)}</button>
            <div class="kit__body">
              <div class="card__meta">${k.medium ? `<span class="chip">${esc(mediumLabel(k.medium))}</span>` : '<span class="chip">Any medium</span>'}<span class="card__coll mono">${k.parts.length} style${k.parts.length === 1 ? '' : 's'}</span></div>
              <h3 class="card__title" data-kit-edit>${esc(k.name)}</h3>
              ${k.description ? `<p class="card__desc">${esc(k.description)}</p>` : ''}
              <ul class="kit__roles">${k.parts.map((p) => { const s = byId(p.styleId); return `<li><span class="mono">${esc(p.role)}</span><span>${esc(s ? s.styleName || s.fileName : 'missing')}</span></li>`; }).join('')}</ul>
              <div class="card__actions"><button class="cta" data-kit-exec><span class="spark">⟶</span> Execute</button><button class="iconbtn" data-kit-edit title="Edit kit" aria-label="Edit kit">✎</button></div>
            </div>
          </article>`).join('')}
        <button class="kit kit--new" data-kit-new><span>＋</span><b>New kit</b><small>e.g. “Pitch deck”, “Brand site”, “Onboarding app”</small></button>
      </div>
    </div>`;
}

let kitDraft = null;
let kitPickerQ = '';
function openKitDialog(kit, withStyle) {
  kitDraft = kit ? structuredClone(kit) : { name: '', medium: state.section === 'presentation' ? 'presentation' : null, description: '', notes: '', parts: [] };
  if (withStyle && !kitDraft.parts.some((p) => p.styleId === withStyle)) kitDraft.parts.push({ styleId: withStyle, role: kitDraft.parts.length ? 'typography' : 'primary' });
  kitPickerQ = '';
  renderKitDialog();
  $('#kitDialog').showModal();
}

function renderKitDialog() {
  const k = kitDraft;
  const roles = state.config.kitRoles;
  const words = kitPickerQ.toLowerCase().split(/\s+/).filter(Boolean);
  const pool = state.styles.filter((s) => s.status === 'ready' && !k.parts.some((p) => p.styleId === s.id))
    .filter((s) => !words.length || words.every((w) => [s.styleName, s.sectionId, ...(s.tags || []), ...(s.facets || [])].join(' ').toLowerCase().includes(w)))
    .slice(0, 40);
  $('#kitDialog').innerHTML = `
    <form method="dialog" data-kit-form>
      <h2>${k.id ? 'Edit kit' : 'New kit'}</h2>
      <div class="two">
        <div class="field"><label class="mono label">Name</label><input name="name" value="${esc(k.name)}" placeholder="Pitch deck" required /></div>
        <div class="field"><label class="mono label">Medium</label><select name="medium"><option value="">Any</option>${state.config.media.map((m) => `<option value="${m.id}" ${k.medium === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label class="mono label">What it's for</label><input name="description" value="${esc(k.description || '')}" placeholder="Investor and client decks with hand-drawn spot illustrations" /></div>
      <div class="field"><label class="mono label">Rules</label><textarea name="notes" rows="2" placeholder="One illustration per slide · titles are full sentences · accent only on key numbers">${esc(k.notes || '')}</textarea></div>
      <div class="field"><label class="mono label">Styles &amp; roles</label>
        <div class="parts">${k.parts.length ? k.parts.map((p, i) => { const s = byId(p.styleId); return `
          <div class="part"><img src="/thumbs/${p.styleId}" alt="" /><div><b>${esc(s ? s.styleName || s.fileName : 'Missing style')}</b><small>${esc(ROLE_HINT[p.role] || '')}</small></div>
          <select data-part-role="${i}">${roles.map((r) => `<option ${r === p.role ? 'selected' : ''}>${r}</option>`).join('')}</select>
          <button type="button" class="iconbtn" data-part-remove="${i}" aria-label="Remove">✕</button></div>`; }).join('') : '<p class="mono label">Pick styles below. The first one is the primary direction.</p>'}</div>
      </div>
      <div class="field picker"><input data-kit-search placeholder="Find styles to add…" value="${esc(kitPickerQ)}" />
        <div class="picker__grid">${pool.map((s) => `<button type="button" data-part-add="${s.id}" title="${esc(s.styleName)}"><img src="/thumbs/${s.id}" alt="" loading="lazy" /><span>${esc(s.styleName)}</span></button>`).join('') || '<p class="mono label">No analysed styles match.</p>'}</div>
      </div>
      <div class="form-actions">${k.id ? '<button type="button" class="btn" data-kit-delete style="margin-right:auto">Delete</button>' : ''}<button type="button" class="btn" data-kit-cancel>Cancel</button><button class="btn btn--ink">Save kit</button></div>
    </form>`;
}

function readKitForm() {
  const fd = new FormData($('[data-kit-form]'));
  Object.assign(kitDraft, { name: fd.get('name'), medium: fd.get('medium') || null, description: fd.get('description'), notes: fd.get('notes') });
}

// ---------- Execute ----------
let execTarget = null; // { kitId } | { ids }
let execMedium = null;
let execTimer;
function openExec(target, medium) {
  execTarget = target;
  const kit = target.kitId && state.kits.find((k) => k.id === target.kitId);
  const first = target.ids && byId(target.ids[0]);
  execMedium = medium || kit?.medium || first?.bestFor?.[0] || (state.section === 'presentation' ? 'presentation' : state.section === 'mobile' ? 'app' : 'web');
  const title = kit ? `Kit · ${kit.name}` : target.ids.length === 1 ? first.styleName || first.fileName : `${target.ids.length} active styles`;
  const thumbs = (kit ? kit.parts.map((p) => p.styleId) : target.ids).slice(0, 5);
  $('#execDialog').innerHTML = `
    <form method="dialog" class="exec">
      <div class="exec__head"><div class="tray__stack">${thumbs.map((id) => `<button type="button"><img src="/thumbs/${id}" alt="" /></button>`).join('')}</div>
        <div><div class="mono label">Execute</div><h2>${esc(title)}</h2></div><button type="button" class="ghost icon close" data-exec-close aria-label="Close">✕</button></div>
      <div class="field"><label class="mono label">Medium</label><div class="media">${state.config.media.map((m) => `<button type="button" class="medium${m.id === execMedium ? ' is-on' : ''}" data-medium="${m.id}">${esc(m.label)}</button>`).join('')}</div></div>
      <div class="field"><label class="mono label">Content &amp; context</label><textarea data-exec-content rows="6" placeholder="Paste the content: slide outline, page copy, app flow, poster text, data… plus any context (audience, tone, size)."></textarea></div>
      <div class="field"><label class="mono label">Brief preview</label><pre class="prompt exec__preview" data-exec-preview>Building…</pre></div>
      <div class="form-actions"><button type="button" class="btn" data-exec-copy="css">Copy CSS tokens</button><button type="button" class="btn" data-exec-copy="json">Copy tokens JSON</button><button type="button" class="btn btn--ink" data-exec-copy="prompt">Copy brief for Claude</button></div>
      <p class="mono label exec__tip" data-exec-tip></p>
    </form>`;
  $('#execDialog').showModal();
  updateExec();
}
let execResult = null;
async function updateExec() {
  const content = $('[data-exec-content]')?.value || '';
  try {
    execResult = await api('/api/prompt', { method: 'POST', body: { ...execTarget, medium: execMedium, content } });
    const pre = $('[data-exec-preview]');
    if (pre) pre.textContent = execResult.prompt;
    const kit = execTarget.kitId && state.kits.find((k) => k.id === execTarget.kitId);
    const tip = $('[data-exec-tip]');
    if (tip) tip.textContent = `Paste into any Claude chat, or in Claude Code just say: “${kit ? `use my ${kit.name} kit` : 'use my active inspo styles'} for a ${mediumLabel(execMedium).toLowerCase()} deliverable: …”`;
  } catch (e) { fail(e); }
}

// ---------- Command palette ----------
let palItems = [];
let palIndex = 0;
// Word match anywhere scores high; a loose in-order letter match counts only against the label.
function fuzzy(label, hay, q) {
  if (!q) return 1;
  label = label.toLowerCase();
  hay = `${label} ${hay}`.toLowerCase();
  let score = 0;
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = hay.indexOf(w);
    if (at === 0 || label.startsWith(w)) score += 3;
    else if (at > 0) score += 2;
    else {
      let i = 0;
      for (const ch of label) if (ch === w[i]) i++;
      if (i < w.length) return 0;
      score += 0.5;
    }
  }
  return score;
}
function paletteSource() {
  const items = [];
  for (const sec of [ALL, INBOX_META, ...state.config.sections]) items.push({ kind: 'Section', label: sec.label, glyph: sec.glyph, hay: `${sec.label} section`, run: () => go({ view: 'library', section: sec.id }) });
  for (const [view, label] of [['kits', 'Kits'], ['taste', 'Taste profile'], ['connect', 'Connect Claude']]) items.push({ kind: 'View', label, glyph: '→', hay: label, run: () => go({ view }) });
  for (const k of state.kits) {
    items.push({ kind: 'Kit', label: k.name, thumb: k.parts[0]?.styleId, hay: `${k.name} kit ${k.medium || ''} ${k.description || ''}`, run: () => openExec({ kitId: k.id }) });
  }
  for (const s of state.styles) {
    items.push({ kind: sectionMeta(s.sectionId).label, label: s.styleName || s.fileName, thumb: s.id, sub: (s.tags || []).slice(0, 4).join(' · '),
      hay: [s.styleName, s.fileName, s.type, s.sectionId, ...(s.tags || []), ...(s.mood || []), ...(s.facets || []), ...(s.typography || []).map((t) => t.family)].join(' '),
      run: () => { go({ view: 'library' }); openDetail(s.id); } });
  }
  if (!STATIC) items.push({ kind: 'Action', label: 'Add references', glyph: '＋', hay: 'add upload import references', run: () => $('#fileInput').click() });
  items.push({ kind: 'Action', label: 'Execute with active styles', glyph: '⟶', hay: 'execute build make active brief', run: () => $('#execBtn').click() });
  if (!STATIC) items.push({ kind: 'Action', label: 'New kit', glyph: '＋', hay: 'new kit create', run: () => openKitDialog() });
  items.push({ kind: 'Action', label: 'Toggle theme', glyph: '◐', hay: 'theme dark light', run: () => $('#themeBtn').click() });
  items.push({ kind: 'Action', label: 'Copy “process my inbox” request', glyph: '⧉', hay: 'process inbox claude analyse', run: () => copy('Process my inspo inbox: catalogue the new references, follow their instructions, file them and suggest kits.', 'Request copied, paste it into Claude') });
  return items;
}
function renderPalette() {
  const q = $('#paletteInput').value.trim();
  palItems = paletteSource().map((it) => ({ it, score: fuzzy(it.label, it.hay, q) })).filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score).slice(0, 40).map((x) => x.it);
  if (!q) palItems.sort((a, b) => ['Section', 'View', 'Action', 'Kit'].indexOf(a.kind) - ['Section', 'View', 'Action', 'Kit'].indexOf(b.kind));
  palIndex = Math.min(palIndex, Math.max(0, palItems.length - 1));
  $('#paletteList').innerHTML = palItems.map((it, i) => `
    <button class="pal${i === palIndex ? ' is-on' : ''}" data-pal="${i}" role="option">
      ${it.thumb ? `<img src="/thumbs/${it.thumb}" alt="" loading="lazy" />` : `<span class="pal__glyph">${esc(it.glyph || '·')}</span>`}
      <span class="pal__label">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span><span class="mono label">${esc(it.kind)}</span></button>`).join('') || '<p class="mono label" style="padding:16px">Nothing found.</p>';
  $('#paletteList .is-on')?.scrollIntoView({ block: 'nearest' });
}
function openPalette() {
  if (!state.loaded) return;
  $('#paletteInput').value = '';
  palIndex = 0;
  renderPalette();
  $('#palette').showModal();
  $('#paletteInput').focus();
}
function runPalette(i) {
  const it = palItems[i];
  if (!it) return;
  $('#palette').close();
  it.run();
}

// ---------- Card tilt ----------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let tilted = null;
document.addEventListener('pointermove', (e) => {
  if (reduceMotion.matches || e.pointerType !== 'mouse') return;
  const media = e.target.closest?.('.card__media, .kit__media');
  if (tilted && tilted !== media) { tilted.style.removeProperty('--rx'); tilted.style.removeProperty('--ry'); tilted.classList.remove('is-tilt'); tilted = null; }
  if (!media) return;
  const r = media.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  media.style.setProperty('--rx', `${(0.5 - y) * 7}deg`);
  media.style.setProperty('--ry', `${(x - 0.5) * 9}deg`);
  media.style.setProperty('--gx', `${x * 100}%`);
  media.style.setProperty('--gy', `${y * 100}%`);
  media.classList.add('is-tilt');
  tilted = media;
});

// ---------- New interactions ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-kit-edit]');
  if (!t) return;
  const kitEl = t.closest('[data-kit]');
  try {
    if (t.id === 'cmdkBtn') return openPalette();
    if (t.dataset.pal) return runPalette(Number(t.dataset.pal));
    if (t.hasAttribute('data-kit-new')) return openKitDialog();
    if (t.hasAttribute('data-kit-edit') && kitEl) return STATIC ? openExec({ kitId: kitEl.dataset.kit }) : openKitDialog(state.kits.find((k) => k.id === kitEl.dataset.kit));
    if (t.hasAttribute('data-kit-exec') && kitEl) return openExec({ kitId: kitEl.dataset.kit });
    if (t.hasAttribute('data-kit-cancel')) return $('#kitDialog').close();
    if (t.dataset.partAdd) {
      readKitForm();
      kitDraft.parts.push({ styleId: t.dataset.partAdd, role: kitDraft.parts.length ? 'typography' : 'primary' });
      return renderKitDialog();
    }
    if (t.dataset.partRemove) { readKitForm(); kitDraft.parts.splice(Number(t.dataset.partRemove), 1); return renderKitDialog(); }
    if (t.hasAttribute('data-kit-delete')) {
      if (!confirm(`Delete the kit “${kitDraft.name}”? The styles stay in your library.`)) return;
      await api(`/api/kits/${kitDraft.id}`, { method: 'DELETE' });
      $('#kitDialog').close();
      toast('Kit deleted');
      return refresh();
    }
    if (t.id === 'execBtn') {
      const ids = state.styles.filter((s) => s.pinned).map((s) => s.id);
      if (!ids.length) return toast('Add styles to Claude first (✳ on a card), or execute a kit from the Kits tab');
      return openExec({ ids });
    }
    if (t.hasAttribute('data-exec-style') && state.detailId) return openExec({ ids: [state.detailId] }, t.dataset.execStyle || undefined);
    if (t.dataset.medium) {
      execMedium = t.dataset.medium;
      $$('.medium').forEach((b) => b.classList.toggle('is-on', b === t));
      return updateExec();
    }
    if (t.hasAttribute('data-exec-close')) return $('#execDialog').close();
    if (t.dataset.execCopy) {
      await updateExec();
      const kind = t.dataset.execCopy;
      return copy(execResult[kind], kind === 'prompt' ? 'Brief copied: paste it into Claude' : 'Tokens copied');
    }
  } catch (err) { fail(err); }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  try {
    if (el.matches('[data-set-section]')) { await patchStyle(state.detailId, { section: el.value }); return toast(`Moved to ${sectionMeta(el.value).label}`); }
    if (el.matches('[data-add-kit]')) {
      const v = el.value;
      el.value = '';
      if (v === '__new') return openKitDialog(null, state.detailId);
      const kit = state.kits.find((k) => k.id === v);
      if (!kit) return;
      await api(`/api/kits/${kit.id}`, { method: 'PATCH', body: { parts: [...kit.parts, { styleId: state.detailId, role: kit.parts.length ? 'typography' : 'primary' }] } });
      toast(`Added to ${kit.name} — change its role in Kits`);
      return refresh();
    }
    if (el.matches('[data-part-role]')) { kitDraft.parts[Number(el.dataset.partRole)].role = el.value; return; }
  } catch (err) { fail(err); }
});

document.addEventListener('input', (e) => {
  if (e.target.matches('[data-kit-search]')) {
    readKitForm();
    kitPickerQ = e.target.value;
    const pos = e.target.selectionStart;
    renderKitDialog();
    const input = $('[data-kit-search]');
    input.focus();
    input.setSelectionRange(pos, pos);
  }
  if (e.target.matches('[data-exec-content]')) { clearTimeout(execTimer); execTimer = setTimeout(updateExec, 250); }
  if (e.target.id === 'paletteInput') { palIndex = 0; renderPalette(); }
});

document.addEventListener('submit', async (e) => {
  if (!e.target.matches('[data-kit-form]')) return;
  e.preventDefault();
  readKitForm();
  if (!kitDraft.parts.length) return toast('Add at least one style to the kit', { error: true });
  try {
    const body = { name: kitDraft.name, medium: kitDraft.medium, description: kitDraft.description, notes: kitDraft.notes, parts: kitDraft.parts };
    const saved = kitDraft.id ? await api(`/api/kits/${kitDraft.id}`, { method: 'PATCH', body }) : await api('/api/kits', { method: 'POST', body });
    $('#kitDialog').close();
    toast(`Saved kit “${saved.name}”`);
    await refresh();
  } catch (err) { fail(err); }
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return $('#palette').open ? $('#palette').close() : openPalette(); }
  if ($('#palette').open) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      palIndex = (palIndex + (e.key === 'ArrowDown' ? 1 : -1) + palItems.length) % Math.max(1, palItems.length);
      renderPalette();
    }
    if (e.key === 'Enter') { e.preventDefault(); runPalette(palIndex); }
    return;
  }
  const typing = e.target.matches('input, textarea, select');
  if (typing || document.querySelector('dialog[open]')) return;
  // Number keys jump between sections: 0 everything, 1–6 sections.
  if (/^[0-6]$/.test(e.key)) {
    const order = ['all', ...state.config.sections.map((s) => s.id)];
    if (order[Number(e.key)]) go({ view: 'library', section: order[Number(e.key)] });
  }
});
$('#palette').addEventListener('click', (e) => { if (e.target.id === 'palette') $('#palette').close(); });
$('#kitDialog').addEventListener('close', () => { kitDraft = null; });

// ---------- Render: root ----------
function render() {
  if (!state.loaded) return;
  document.body.dataset.density = state.density;
  $$('.density button').forEach((b) => b.classList.toggle('is-on', b.dataset.density === state.density));
  $('#sort').value = state.sort;
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === state.view));
  $('#kitCount').textContent = state.kits.length || '';
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${state.view}`));
  $('#brandCount').textContent = `${state.styles.length} references`;
  $('#folderPath').textContent = STATIC ? (snapshot?.exportedAt ? `Snapshot of ${fmtDate(snapshot.exportedAt)}${snapshot.demo ? ' · demo data' : ''}` : 'No snapshot yet') : state.config.libraryDir;
  const pending = state.stats.pending + state.styles.filter((s) => s.status === 'error').length;
  $('#analyzeBtn').hidden = !(state.config.aiEnabled && pending && !state.queue);
  $('#pendingCount').textContent = pending;

  renderSections();
  renderFilters();
  if (state.view === 'library') { renderHero(); renderGrid(); }
  if (state.view === 'kits') renderKits();
  if (state.view === 'taste') renderTaste();
  if (state.view === 'connect') renderConnect();
  renderTray();
  if ($('#detail').open && !state.editing && !document.activeElement?.matches('[data-notes]')) renderDetail();
  if ($('#kitDialog').open && kitDraft && !document.activeElement?.closest('#kitDialog')) renderKitDialog();
}

// ---------- Actions ----------
async function activeBrief() {
  const ids = state.styles.filter((s) => s.pinned).map((s) => s.id);
  if (!ids.length) return '';
  return (await api('/api/prompt', { method: 'POST', body: { ids } })).prompt;
}

async function togglePin(id) {
  const s = byId(id);
  const pinned = !s.pinned;
  s.pinned = pinned;
  render();
  try {
    await api('/api/active', { method: 'POST', body: { id, pinned } });
    if (pinned) {
      const brief = await activeBrief();
      const n = state.styles.filter((x) => x.pinned).length;
      copy(brief, STATIC ? `${n} style${n > 1 ? 's' : ''} selected, brief copied` : `Added to Claude: ${n} active style${n > 1 ? 's' : ''}, brief copied`);
    } else toast(STATIC ? 'Removed from your selection' : 'Removed from Claude');
  } catch (e) { s.pinned = !pinned; render(); fail(e); }
}

async function copyStyle(id) {
  try {
    const { prompt } = await api('/api/prompt', { method: 'POST', body: { ids: [id] } });
    copy(prompt, 'Style prompt copied');
  } catch (e) { fail(e); }
}

async function patchStyle(id, body) {
  if (STATIC) throw new Error(READ_ONLY);
  const updated = await api(`/api/styles/${id}`, { method: 'PATCH', body });
  Object.assign(byId(id), updated);
  render();
}

async function uploadFiles(files) {
  if (STATIC) return toast(READ_ONLY);
  const images = [...files].filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|svg|heic|tiff?)$/i.test(f.name));
  if (!images.length) return toast('Only image files can be added', { error: true });
  const collection = uploadTarget();
  let ok = 0;
  let dupes = 0;
  for (const f of images) {
    try {
      const res = await api(`/api/upload?name=${encodeURIComponent(f.name)}${collection ? `&collection=${encodeURIComponent(collection)}` : ''}`, { method: 'POST', body: f });
      if (res.duplicate) dupes++;
      else ok++;
    } catch (e) { fail(e); }
  }
  if (dupes) toast(`${dupes} already in your library, skipped`);
  if (ok) toast(`Added ${ok} reference${ok > 1 ? 's' : ''}${collection ? ` to ${collection}` : ''}${state.config.aiEnabled && state.config.autoAnalyze ? ', analysing…' : ''}`);
}

// ---------- Settings ----------
function openSettings() {
  const c = state.config;
  const dlg = $('#settings');
  const models = [['claude-opus-5-5', 'Claude Opus 5.5 (recommended)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheapest)'], ['claude-fable-5-1', 'Claude Fable 5.1 (most capable)']];
  if (!models.some(([m]) => m === c.model)) models.unshift([c.model, c.model]);
  dlg.innerHTML = `
    <form method="dialog" data-settings-form>
      <h2>Settings</h2>
      <div class="field"><label class="mono label">References folder</label><input name="libraryDir" value="${esc(c.libraryDir)}" /><small>Any folder on your computer. Sub-folders become collections. Analysis is stored in its hidden <code>.inspo</code> folder.</small></div>
      <div class="field"><label class="mono label">Anthropic API key</label><input name="apiKey" type="password" placeholder="${c.hasApiKey ? `Saved (${esc(c.apiKeyHint)}) — leave blank to keep` : 'sk-ant-…'}" autocomplete="off" /><small>Optional. Lets the library analyse references automatically. Stored only in <code>config.local.json</code> on this computer. Without a key, Claude Desktop or Claude Code can analyse them over MCP.</small></div>
      <div class="field"><label class="mono label">Model</label><select name="model">${models.map(([m, l]) => `<option value="${m}" ${m === c.model ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <label class="check"><input type="checkbox" name="autoAnalyze" ${c.autoAnalyze ? 'checked' : ''} /> Analyse new references automatically</label>
      <label class="check"><input type="checkbox" name="autoOrganize" ${c.autoOrganize ? 'checked' : ''} /> File analysed inbox items into their section folder</label>
      ${c.hasApiKey ? `<label class="check"><input type="checkbox" name="removeKey" /> Remove saved API key</label>` : ''}
      <div class="form-actions"><button type="button" class="btn" data-close-settings>Cancel</button><button class="btn btn--ink" value="save">Save</button></div>
    </form>`;
  dlg.showModal();
}

// ---------- Events ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-open], label');
  if (!t) {
    if (e.target === $('#detail')) $('#detail').close();
    return;
  }
  const card = t.closest('.card');
  const inDetail = t.closest('#detail');
  const id = card?.dataset.id || (inDetail ? state.detailId : null);

  try {
    if (t.matches('.tab')) return go({ view: t.dataset.view });
    if (t.dataset.section) return go({ view: 'library', section: t.dataset.section });
    if (t.dataset.filter) {
      const { filter, value } = t.dataset;
      state.filters[filter] = filter === 'show' ? value : state.filters[filter] === value ? null : value;
      return render();
    }
    if (t.dataset.clear) { state.filters[t.dataset.clear] = null; return render(); }
    if (t.hasAttribute('data-more-tags')) { state.showAllTags = !state.showAllTags; return render(); }
    if (t.hasAttribute('data-reset')) {
      state.filters = { show: 'all', facet: null, type: null, mood: null, tag: null, hue: null };
      state.q = ''; $('#search').value = '';
      return render();
    }
    if (t.dataset.density) { state.density = t.dataset.density; store.set('inspo-density', state.density); return render(); }
    if (t.hasAttribute('data-open') && id) return openDetail(id);
    if (t.dataset.openId) return openDetail(t.dataset.openId);
    if (t.hasAttribute('data-pin') && id) return togglePin(id);
    if (t.hasAttribute('data-copy') && id) return copyStyle(id);
    if (t.hasAttribute('data-fav') && id) return patchStyle(id, { favorite: !byId(id).favorite });
    if (t.dataset.hex) return copy(t.dataset.hex, `${t.dataset.hex} copied`);
    if (t.dataset.copyText) return copy(t.dataset.copyText);
    if (t.hasAttribute('data-copy-palette')) return copy(colorsOf(byId(id)).map((c) => c.hex).join(' '), 'Palette copied');
    if (t.hasAttribute('data-copy-taste')) return copy(await api('/api/taste.md'), 'Taste profile copied');
    if (t.hasAttribute('data-tray-copy')) return copy(await activeBrief(), 'Brief copied');
    if (t.hasAttribute('data-tray-clear')) { await api('/api/active', { method: 'POST', body: { id: '*', pinned: false } }); return refresh(); }
    if (t.hasAttribute('data-close')) return $('#detail').close();
    if (t.dataset.nav) {
      const list = visibleStyles();
      const next = list[list.findIndex((x) => x.id === state.detailId) + Number(t.dataset.nav)];
      if (next) openDetail(next.id);
      return;
    }
    if (t.hasAttribute('data-zoom')) return;
    if (t.hasAttribute('data-edit')) { state.editing = true; return renderDetail(); }
    if (t.hasAttribute('data-cancel-edit')) { state.editing = false; return renderDetail(); }
    if (t.hasAttribute('data-analyze')) {
      await api(`/api/styles/${id}/analyze`, { method: 'POST' });
      toast('Sent to Claude for analysis');
      return refresh();
    }
    if (t.hasAttribute('data-reveal')) return api(`/api/styles/${id}/reveal`, { method: 'POST' });
    if (t.hasAttribute('data-trash')) {
      const s = byId(id);
      if (!confirm(`Remove “${s.styleName || s.fileName}” from the library? The file is moved to .inspo/trash in your folder.`)) return;
      await api(`/api/styles/${id}`, { method: 'DELETE' });
      $('#detail').close();
      toast('Moved to .inspo/trash');
      return refresh();
    }
    if (t.dataset.tagFilter) {
      const v = t.dataset.tagFilter;
      const s = byId(id);
      state.filters.mood = (s.mood || []).includes(v) ? v : null;
      state.filters.tag = (s.tags || []).includes(v) ? v : null;
      state.view = 'library';
      $('#detail').close();
      return render();
    }
    if (t.hasAttribute('data-rebuild')) {
      t.disabled = true; t.textContent = 'Claude is reading your library…';
      await api('/api/taste/rebuild', { method: 'POST' });
      toast('Taste profile updated');
      return refresh();
    }
    if (t.id === 'analyzeBtn') {
      const { queued } = await api('/api/analyze-pending', { method: 'POST' });
      toast(`Analysing ${queued} reference${queued === 1 ? '' : 's'}…`);
      return refresh();
    }
    if ((t.id === 'settingsBtn' || t.id === 'folderBtn') && !STATIC) return openSettings();
    if (t.hasAttribute('data-close-settings')) return $('#settings').close();
    if (t.id === 'themeBtn') {
      const dark = document.documentElement.dataset.theme
        ? document.documentElement.dataset.theme === 'dark'
        : matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = dark ? 'light' : 'dark';
      store.set('inspo-theme', document.documentElement.dataset.theme);
      return;
    }
    if (t.id === 'menuBtn') return document.body.classList.toggle('rail-open');
  } catch (err) {
    fail(err);
    if (t.hasAttribute('data-rebuild')) render();
  }
});

// Zoom the large image.
document.addEventListener('click', (e) => {
  const img = e.target.closest('[data-zoom]');
  if (!img) return;
  state.zoomed = !state.zoomed;
  img.parentElement.classList.toggle('is-zoomed', state.zoomed);
});

document.addEventListener('submit', async (e) => {
  if (e.target.matches('[data-edit-form]')) {
    e.preventDefault();
    try {
      await patchStyle(state.detailId, parseEdit(e.target, byId(state.detailId)));
      state.editing = false;
      renderDetail();
      toast('Saved');
    } catch (err) { fail(err); }
  }
  if (e.target.matches('[data-settings-form]')) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { libraryDir: fd.get('libraryDir'), model: fd.get('model'), autoAnalyze: fd.get('autoAnalyze') === 'on', autoOrganize: fd.get('autoOrganize') === 'on' };
    if (fd.get('apiKey')) body.apiKey = fd.get('apiKey');
    if (fd.get('removeKey') === 'on') body.apiKey = '';
    try {
      await api('/api/settings', { method: 'POST', body });
      $('#settings').close();
      cardCache.forEach(({ el }) => el.remove());
      cardCache.clear();
      await refresh();
      toast('Settings saved');
    } catch (err) { fail(err); }
  }
});

document.addEventListener('focusout', async (e) => {
  if (!e.target.matches('[data-notes]') || STATIC) return;
  const s = byId(state.detailId);
  if (!s || s.notes === e.target.value) return;
  try { await patchStyle(s.id, { notes: e.target.value }); toast('Notes saved'); } catch (err) { fail(err); }
});

$('#detail').addEventListener('close', () => { state.detailId = null; state.editing = false; });

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.q = e.target.value; if (state.view !== 'library') state.view = 'library'; render(); }, 90);
});
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; store.set('inspo-sort', state.sort); render(); });
$('#fileInput').addEventListener('change', (e) => { uploadFiles(e.target.files); e.target.value = ''; });

document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea, select');
  if (e.key === '/' && !typing && !$('#detail').open) { e.preventDefault(); $('#search').focus(); }
  if ($('#detail').open && !typing && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    $(`[data-nav="${e.key === 'ArrowRight' ? 1 : -1}"]`)?.click();
  }
});

// Drag & drop anywhere.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || STATIC) return;
  dragDepth++;
  $('#drop').hidden = false;
  $('#dropTarget').textContent = `into ${uploadTarget()}/ — Claude turns it into a style`;
});
window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e) || STATIC) return;
  e.preventDefault();
  dragDepth = 0;
  $('#drop').hidden = true;
  uploadFiles(e.dataTransfer.files);
});

// Paste an image from the clipboard (e.g. a screenshot).
window.addEventListener('paste', (e) => {
  if (e.target.matches('input, textarea')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    const named = files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}-${i}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })));
    uploadFiles(named);
  }
});

window.addEventListener('resize', () => cardCache.forEach(({ el }) => sizeCard(el)));

// Live updates from the server (folder changes, analysis progress, MCP writes).
function connectEvents() {
  if (STATIC) return;
  const es = new EventSource('/api/events');
  es.addEventListener('library', scheduleRefresh);
  es.onerror = () => {};
}

if (STATIC) {
  document.body.classList.add('is-static');
  $('#folderBtn .label').textContent = 'Web view · read-only';
}
refresh().catch(fail);
connectEvents();
