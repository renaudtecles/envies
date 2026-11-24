/* Popup Envies — liste d'achats. */

const $ = (s, r = document) => r.querySelector(s);

const ICON = {
  go: '<svg viewBox="0 0 12 12"><path d="M3.5 2.5h6v6M9.5 2.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  more: '<svg viewBox="0 0 20 20"><circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/></svg>',
  refresh: '<svg viewBox="0 0 20 20"><path d="M15.5 8A6 6 0 0 0 4.6 6.5M4.5 12a6 6 0 0 0 10.9 1.5M15.5 3.5V8H11M4.5 16.5V12H9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 20 20"><path d="M12.5 4.5l3 3L8 15H5v-3l7.5-7.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 10.2l2 2 4-4.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  undo: '<svg viewBox="0 0 20 20"><path d="M7 8H13a3.5 3.5 0 0 1 0 7H9M7 8l3-3M7 8l3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  copy: '<svg viewBox="0 0 20 20"><rect x="7" y="7" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13 5.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  trash: '<svg viewBox="0 0 20 20"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L14 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chev: '<svg viewBox="0 0 10 10"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sort: '<svg viewBox="0 0 10 10"><path d="M2.5 4L5 1.5 7.5 4M2.5 6L5 8.5 7.5 6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  x: '<svg viewBox="0 0 10 10"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  empty: `<svg viewBox="0 0 84 84" fill="none">
      <path d="M44 12h20a8 8 0 0 1 8 8v20L40 72a6 6 0 0 1-8.5 0L12 52.5a6 6 0 0 1 0-8.5L44 12z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
      <circle cx="58" cy="26" r="4.5" stroke="currentColor" stroke-width="2.2"/>
      <path d="M33 44.5c2.6-2.6 6.4-2 8 .2 1.6-2.2 5.4-2.8 8-.2 3 3 1.4 7.8-8 14.6-9.4-6.8-11-11.6-8-14.6z" fill="#E0694B"/>
      <path d="M70 6v6M67 9h6M76 22v4M74 24h4" stroke="#D49A2A" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
};

const SORTS = { recent: 'Plus récents', 'price-asc': 'Prix croissant', 'price-desc': 'Prix décroissant' };

let state = normalizeState();
let filter = 'all';          // 'all' | id de catégorie | 'none'
let sortMode = 'recent';
let editCats = false;
let addingCat = false;
let showBought = false;
let currentTab = null;
let draft = null;            // fiche ouverte
let draftToken = 0;
let freshId = null;          // article tout juste ajouté (animation)
let lastWritten = null;
const refreshing = new Set();
let rates = FALLBACK_RATES.rates;   // unités de devise pour 1 CHF

/* Utilitaires -------------------------------------------------------------- */

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;            // icônes statiques uniquement
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

const catById = (id) => state.categories.find((c) => c.id === id) || null;
const catKey = (item) => (item.categoryId && catById(item.categoryId) ? item.categoryId : 'none');

/** Texte lisible sur un fond de couleur pleine : blanc ou encre, selon le meilleur contraste. */
function onColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1], 16);
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  const INK = 0.0113;   // #1D1B18
  return 1.05 / (L + 0.05) >= (L + 0.05) / (INK + 0.05) ? '#FFFFFF' : '#1D1B18';
}
const fav = (url) => `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=32`;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const isPending = (item) => item.pending && Date.now() - (item.updatedAt || 0) < 180000;

function fmt(amount, currency) {
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency', currency: currency || 'EUR',
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch (e) {
    return `${amount.toFixed(2).replace('.', ',')} ${currency || ''}`.trim();
  }
}

/** Arrondi lisible d'un montant converti : à l'unité dès 100. */
const roundApprox = (v) => (v >= 100 ? Math.round(v) : Math.round(v * 100) / 100);

/** Devise d'affichage : CHF par défaut, € au choix (clic sur le total). */
const mainCurrency = () => (state.prefs.currency === 'EUR' ? 'EUR' : 'CHF');
const otherCurrency = () => (mainCurrency() === 'CHF' ? 'EUR' : 'CHF');

/** Un prix exprimé en CHF et en EUR ; approx = conversion (le site affiche une autre devise). */
function inBoth(amount, currency) {
  const chf = toCHF(amount, currency, rates);
  if (chf == null) return null;
  return {
    CHF: { value: currency === 'CHF' ? amount : chf, approx: currency !== 'CHF' },
    EUR: { value: currency === 'EUR' ? amount : chf * rates.EUR, approx: currency !== 'EUR' },
  };
}

const show = (v, cur) => fmt(v.approx ? roundApprox(v.value) : v.value, cur);

/** Prix affiché dans la devise principale, l'autre en plus petit dessous. */
function money(amount, currency) {
  const both = inBoth(amount, currency);
  if (!both) return { approx: false, main: fmt(amount, currency), sub: '' };
  const a = mainCurrency();
  const b = otherCurrency();
  return {
    approx: both[a].approx,
    main: show(both[a], a),
    sub: `${both[b].approx ? '≈ ' : ''}${show(both[b], b)}`,
  };
}

/** Total dans la devise principale (+ l'autre dessous) ; une devise sans taux connu est signalée à part. */
function totals(items) {
  const sum = { CHF: { value: 0, approx: false }, EUR: { value: 0, approx: false } };
  let priced = 0;
  let other = 0;
  for (const i of items) {
    if (!i.price) continue;
    const both = inBoth(i.price, i.currency);
    if (!both) { other += 1; continue; }
    priced += 1;
    for (const cur of ['CHF', 'EUR']) {
      sum[cur].value += both[cur].value;
      sum[cur].approx = sum[cur].approx || both[cur].approx;
    }
  }
  const a = mainCurrency();
  const b = otherCurrency();
  const sub = priced ? `${sum[b].approx ? '≈ ' : ''}${show(sum[b], b)}` : '';
  return {
    approx: sum[a].approx,
    main: show(sum[a], a),
    sub: other ? `${sub}${sub ? ' · ' : ''}+ ${other} en autre devise` : sub,
  };
}

function ago(ts) {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d < 1) return "aujourd'hui";
  if (d === 1) return 'hier';
  if (d < 30) return `il y a ${d} j`;
  if (d < 365) return `il y a ${Math.floor(d / 30)} mois`;
  return `il y a ${plural(Math.floor(d / 365), 'an')}`;
}

function parseInputPrice(v) {
  if (!v) return null;
  let s = String(v).replace(/[\s'’€$£]|CHF|EUR|USD|GBP/gi, '').replace(/[.,]–$/, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return n > 0 ? Math.round(n * 100) / 100 : null;
}

const priceToInput = (p) => (p ? p.toFixed(2).replace('.', ',').replace(/,00$/, '') : '');

async function persist() {
  lastWritten = JSON.stringify(state);
  await saveState(state);
}

function openUrl(url, e) {
  const background = e && (e.metaKey || e.ctrlKey || e.button === 1);
  chrome.tabs.create({ url, active: !background });
}

/* Lecture du prix ---------------------------------------------------------- */

async function extractFromTab(tabId) {
  try {
    const run = chrome.scripting.executeScript({ target: { tabId }, func: extractProduct })
      .then(([res]) => (res ? res.result : null));
    return await Promise.race([run, new Promise((r) => setTimeout(() => r(null), 8000))]);
  } catch (e) {
    return null;   // page protégée (Chrome Web Store, PDF…)
  }
}

async function extractByFetch(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { credentials: 'include', signal: ctrl.signal });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html')) return null;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    return extractProduct(doc, res.url || url);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Lecture rapide du HTML ; si le prix n'y est pas, onglet discret en arrière-plan. */
async function extractUrl(url) {
  const quick = await extractByFetch(url);
  if (quick && quick.price) return quick;
  let viaTab = null;
  try { viaTab = await chrome.runtime.sendMessage({ type: 'extract-url', url }); } catch (e) { /* ignore */ }
  if (viaTab && viaTab.price) return { ...quick, ...viaTab, image: viaTab.image || (quick && quick.image) };
  return viaTab || quick;
}

/* Rendu -------------------------------------------------------------------- */

function render() {
  renderHeader();
  renderChips();
  renderToolbar();
  renderList();
  updateCurrent();
}

function scopedItems() {
  return state.items.filter((i) => filter === 'all' || catKey(i) === filter);
}

function filterName() {
  if (filter === 'none') return 'À classer';
  const c = catById(filter);
  return c ? c.name : '';
}

function renderHeader() {
  const todoAll = state.items.filter((i) => !i.bought);
  const scoped = scopedItems().filter((i) => !i.bought);
  const t = totals(scoped);
  const tv = $('#totalValue');
  tv.replaceChildren(...(t.approx ? [h('span', { class: 'approx' }, '≈')] : []), t.main);
  tv.title = mainCurrency() === 'CHF' ? 'Afficher les montants en euros' : 'Afficher les montants en francs suisses';
  $('#totalSub').textContent = t.sub;
  $('#totalLabel').textContent = filter === 'all' ? 'Total à prévoir' : `Total · ${filterName()}`;
  $('#summary').textContent = todoAll.length ? `${plural(todoAll.length, 'article')} à acheter` : 'Rien en attente';
}

function renderChips() {
  const el = $('#chips');
  el.replaceChildren();
  const todo = state.items.filter((i) => !i.bought);
  const count = (k) => todo.filter((i) => catKey(i) === k).length;

  const chip = (key, name, n, color, extra = '') => h('button', {
    type: 'button',
    class: `chip ${extra} ${color ? 'tinted' : ''} ${filter === key ? 'active' : ''} ${n === 0 && key !== 'all' ? 'empty' : ''}`,
    style: color ? `--c:${color};--on:${onColor(color)}` : null,
    'aria-pressed': String(filter === key),
    onclick: () => setFilter(key),
  }, name, h('span', { class: 'n' }, n));

  if (!editCats) el.append(chip('all', 'Tout', todo.length));
  for (const c of state.categories) el.append(editCats ? editChip(c) : chip(c.id, c.name, count(c.id), c.color));
  const none = count('none');
  if (!editCats && (none || filter === 'none')) el.append(chip('none', 'À classer', none, null, 'todo'));

  if (addingCat) {
    el.append(newCatInput((name) => { createCategory(name); }, () => { addingCat = false; renderChips(); }, 'chip editing'));
  } else {
    el.append(h('button', { type: 'button', class: 'chip ghost', onclick: () => { addingCat = true; renderChips(); } }, '+ Catégorie'));
  }
  el.append(h('button', {
    type: 'button', class: 'chip ghost',
    onclick: () => { editCats = !editCats; addingCat = false; renderChips(); },
  }, editCats ? 'Terminé' : 'Gérer'));

  const active = el.querySelector('.chip.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function editChip(c) {
  const input = h('input', { value: c.name, 'aria-label': `Renommer ${c.name}`, maxlength: '28' });
  const fit = () => { input.style.width = `${Math.max(4, input.value.length + 1)}ch`; };
  fit();
  input.addEventListener('input', fit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('change', async () => {
    const name = input.value.trim();
    if (!name) { input.value = c.name; fit(); return; }
    const cat = catById(c.id);
    if (cat) { cat.name = name; await persist(); renderHeader(); }
  });
  const dot = h('button', {
    type: 'button', class: 'dot', title: 'Changer la couleur', 'aria-label': 'Changer la couleur',
    style: 'border:0;padding:0;width:12px;height:12px;cursor:pointer',
    onclick: async () => {
      const cat = catById(c.id);
      cat.color = PALETTE[(PALETTE.indexOf(cat.color) + 1) % PALETTE.length];
      await persist(); render();
    },
  });
  const x = h('button', { type: 'button', class: 'x', title: 'Supprimer la catégorie', 'aria-label': `Supprimer ${c.name}`, html: ICON.x, onclick: () => deleteCategory(c.id) });
  return h('span', { class: 'chip editing tinted', style: `--c:${c.color};--on:${onColor(c.color)}` }, dot, input, x);
}

function newCatInput(onCreate, onCancel, className) {
  const input = h('input', { placeholder: 'Nouvelle catégorie', maxlength: '28', 'aria-label': 'Nom de la nouvelle catégorie' });
  input.style.width = '120px';
  let done = false;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); done = true; input.value.trim() ? onCreate(input.value.trim()) : onCancel(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done = true; onCancel(); }
  });
  input.addEventListener('blur', () => {
    if (done) return;
    done = true;
    input.value.trim() ? onCreate(input.value.trim()) : onCancel();
  });
  const wrap = h('span', { class: className }, input);
  requestAnimationFrame(() => input.focus());
  return wrap;
}

function renderToolbar() {
  const items = scopedItems().filter((i) => !i.bought);
  const missing = items.filter((i) => !i.price && !isPending(i)).length;
  const bar = $('.toolbar');
  bar.hidden = !state.items.length;
  $('#countLabel').textContent = items.length
    ? `${plural(items.length, 'article')}${missing ? ` · ${missing} sans prix` : ''}`
    : '';
  $('#sortBtn').innerHTML = `${SORTS[sortMode]}${ICON.sort}`;
}

function sortItems(items) {
  const value = (i) => toCHF(i.price, i.currency, rates) ?? i.price;   // tout comparé en CHF
  const byPrice = (dir) => (a, b) => {
    if (!a.price && !b.price) return b.addedAt - a.addedAt;
    if (!a.price) return 1;
    if (!b.price) return -1;
    return dir * (value(a) - value(b));
  };
  const fns = { recent: (a, b) => b.addedAt - a.addedAt, 'price-asc': byPrice(1), 'price-desc': byPrice(-1) };
  return items.slice().sort(fns[sortMode] || fns.recent);
}

function renderList() {
  const list = $('#list');
  list.replaceChildren();
  if (!state.items.length) { list.append(emptyState(true)); return; }

  const scoped = scopedItems();
  const todo = sortItems(scoped.filter((i) => !i.bought));
  const bought = scoped.filter((i) => i.bought).sort((a, b) => (b.boughtAt || 0) - (a.boughtAt || 0));

  if (!todo.length) list.append(emptyState(false));
  todo.forEach((i) => list.append(itemEl(i)));

  if (bought.length) {
    list.append(h('button', {
      type: 'button', class: `section-toggle ${showBought ? 'open' : ''}`,
      onclick: () => { showBought = !showBought; renderList(); },
    }, h('span', { html: ICON.chev, style: 'width:10px;height:10px' }), `Achetés · ${bought.length}`));
    if (showBought) bought.forEach((i) => list.append(itemEl(i)));
  }
  freshId = null;
}

function emptyState(first) {
  if (first) {
    return h('div', { class: 'empty-state' },
      h('div', { class: 'art', html: ICON.empty }),
      h('h2', null, 'Ta liste est vide'),
      h('p', null,
        'Colle un lien produit ci-dessus (', h('kbd', null, '⌘V'), ' marche partout dans ce panneau), ',
        'ou fais un clic droit sur une page ou un lien : « Ajouter à mes envies ».'));
  }
  return h('div', { class: 'empty-state' },
    h('h2', null, 'Rien à acheter ici'),
    h('p', null, filter === 'all' ? 'Tout est acheté. Bien joué.' : `Aucun article en attente dans « ${filterName()} ».`));
}

function mono(item) {
  const letter = (item.site || hostOf(item.url) || '?').replace(/^www\./, '').charAt(0).toUpperCase();
  return h('div', { class: 'mono' }, letter);
}

function thumbEl(item, className = 'thumb') {
  const t = h('div', { class: className });
  if (item.image) {
    const img = h('img', { src: item.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(mono(item)));
    t.append(img);
  } else {
    t.append(mono(item));
  }
  return t;
}

function deltaEl(item) {
  if (!item.price || !item.initialPrice || Math.abs(item.price - item.initialPrice) < 0.005) return null;
  const d = item.price - item.initialPrice;
  return h('span', {
    class: `delta ${d < 0 ? 'down' : 'up'}`,
    title: `Prix à l'ajout : ${fmt(item.initialPrice, item.currency)}`,
  }, `${d < 0 ? '↓ ' : '↑ '}${fmt(Math.abs(d), item.currency)}`);
}

function itemEl(item) {
  const cat = catById(item.categoryId);
  const color = cat ? cat.color : null;
  const pending = isPending(item) || refreshing.has(item.id);

  const thumb = thumbEl(item);
  thumb.title = 'Accéder au produit';
  thumb.addEventListener('click', (e) => openUrl(item.url, e));

  const title = h('h3', { class: 'title', title: item.title, onclick: () => openEdit(item.id) }, item.title || hostOf(item.url));

  const m = item.price ? money(item.price, item.currency) : null;
  const priceCol = h('div', { class: 'price-col' },
    pending ? h('span', { class: 'shimmer', 'aria-label': 'Lecture du prix' })
      : m ? [
        h('span', { class: 'price', title: m.approx ? `Prix sur le site : ${fmt(item.price, item.currency)}` : null },
          m.approx ? h('span', { class: 'approx' }, '≈') : null, m.main),
        m.sub ? h('span', { class: 'price-sub' }, m.sub) : null,
      ]
        : h('button', { type: 'button', class: 'price none', style: 'border:0;background:none;padding:0', onclick: () => openEdit(item.id) }, 'Prix ?'),
    pending ? null : deltaEl(item));

  const select = h('select', { 'aria-label': 'Catégorie', onchange: (e) => setItemCategory(item.id, e.target.value) },
    h('option', { value: '', selected: !cat }, 'À classer'),
    state.categories.map((c) => h('option', { value: c.id, selected: cat && c.id === cat.id }, c.name)));
  const pill = h('label', { class: `cat-pill ${cat ? '' : 'none'}`, title: 'Changer de catégorie' },
    cat ? cat.name : 'À classer', select);

  const site = h('span', { class: 'site', title: item.note || item.site || '' },
    h('img', { src: fav(item.url), alt: '' }),
    item.note
      ? h('span', { class: 'note' }, item.note)
      : h('span', null, `${item.site || hostOf(item.url)} · ${ago(item.addedAt)}`));

  const more = h('button', {
    type: 'button', class: `icon-btn ${refreshing.has(item.id) ? 'spin' : ''}`, 'aria-label': 'Plus d’actions', 'aria-haspopup': 'menu',
    html: refreshing.has(item.id) ? ICON.refresh : ICON.more,
    onclick: (e) => { e.stopPropagation(); openMenu(e.currentTarget, item.id); },
  });

  const go = h('a', {
    class: 'go', href: item.url, title: item.url,
    onclick: (e) => { e.preventDefault(); openUrl(item.url, e); },
    onauxclick: (e) => { e.preventDefault(); openUrl(item.url, e); },
  }, 'Accéder', h('span', { html: ICON.go, style: 'width:11px;height:11px;display:block' }));

  return h('article', {
    class: `item ${item.bought ? 'bought' : ''} ${pending ? 'pending' : ''} ${item.id === freshId ? 'is-new' : ''}`,
    style: color ? `--c:${color}` : null,
    'data-id': item.id,
  }, thumb, h('div', { class: 'main' }, title, site), priceCol, h('div', { class: 'foot' }, pill, h('span', { class: 'spacer' }), more, go));
}

/* Actions sur les articles ------------------------------------------------- */

async function setFilter(key) {
  filter = key;
  state.prefs.filter = key;
  await persist();
  render();
}

async function setItemCategory(id, value) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  item.categoryId = value || null;
  await persist();
  render();
}

async function toggleBought(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  item.bought = !item.bought;
  item.boughtAt = item.bought ? Date.now() : null;
  await persist();
  render();
  if (item.bought) {
    toast('Marqué comme acheté', 'Annuler', async () => { item.bought = false; item.boughtAt = null; await persist(); render(); });
  }
}

async function removeItem(id) {
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const [item] = state.items.splice(idx, 1);
  await persist();
  render();
  toast('Article supprimé', 'Annuler', async () => {
    state.items.splice(Math.min(idx, state.items.length), 0, item);
    await persist();
    render();
  });
}

async function refreshItem(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item || refreshing.has(id)) return;
  refreshing.add(id);
  renderList();
  const data = await extractUrl(item.url);
  refreshing.delete(id);
  const cur = state.items.find((i) => i.id === id);
  if (!cur) return;
  const r = applyFreshData(cur, data);
  if (r.gone) cur.note = cur.note || 'Lien mort : la page n’existe plus';
  await persist();
  render();
  if (r.gone) toast('Lien mort : la page n’existe plus');
  else if (!r.found) toast('Prix introuvable sur la page', 'Saisir', () => openEdit(id));
  else if (!r.changed) toast(`Prix inchangé · ${fmt(cur.price, cur.currency)}`);
  else if (r.before) {
    const d = cur.price - r.before;
    toast(`${d < 0 ? 'Baisse' : 'Hausse'} : ${fmt(cur.price, cur.currency)} (${d < 0 ? '−' : '+'}${fmt(Math.abs(d), cur.currency)})`);
  } else toast(`Prix trouvé : ${fmt(cur.price, cur.currency)}`);
}

async function createCategory(name, selectInDraft = false) {
  const existing = state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  let cat = existing;
  if (!cat) {
    const used = new Set(state.categories.map((c) => c.color));
    const color = PALETTE.find((p) => !used.has(p)) || PALETTE[state.categories.length % PALETTE.length];
    cat = { id: `${slugify(name)}-${uid().slice(-4)}`, name, color };
    state.categories.push(cat);
  }
  addingCat = false;
  if (selectInDraft && draft) { draft.item.categoryId = cat.id; draft.addingCat = false; }
  await persist();
  render();
  if (draft) renderDraftCats();
  return cat;
}

async function deleteCategory(id) {
  const idx = state.categories.findIndex((c) => c.id === id);
  if (idx < 0) return;
  const [cat] = state.categories.splice(idx, 1);
  const moved = state.items.filter((i) => i.categoryId === id);
  moved.forEach((i) => { i.categoryId = null; });
  if (filter === id) filter = 'all';
  await persist();
  render();
  toast(`« ${cat.name} » supprimée${moved.length ? ` · ${plural(moved.length, 'article')} à classer` : ''}`, 'Annuler', async () => {
    state.categories.splice(idx, 0, cat);
    moved.forEach((m) => { const i = state.items.find((x) => x.id === m.id); if (i) i.categoryId = id; });
    await persist();
    render();
  });
}

/* Menu ⋯ ------------------------------------------------------------------- */

function closeMenu() {
  $('#menu').hidden = true;
}

function openMenu(anchor, id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  const m = $('#menu');
  const entry = (icon, label, fn, cls) => h('button', {
    type: 'button', role: 'menuitem', class: cls || null,
    onclick: () => { closeMenu(); fn(); },
  }, h('span', { html: icon, style: 'width:15px;height:15px;flex:none' }), label);

  m.replaceChildren(
    entry(ICON.refresh, 'Relire le prix', () => refreshItem(id)),
    entry(ICON.edit, 'Modifier', () => openEdit(id)),
    entry(item.bought ? ICON.undo : ICON.check, item.bought ? 'Remettre dans la liste' : 'Marquer comme acheté', () => toggleBought(id)),
    entry(ICON.copy, 'Copier le lien', () => navigator.clipboard.writeText(item.url).then(() => toast('Lien copié'))),
    h('hr'),
    entry(ICON.trash, 'Supprimer', () => removeItem(id), 'danger'),
  );
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth;
  const mh = m.offsetHeight;
  const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  m.style.left = `${left}px`;
  m.style.top = `${top}px`;
}

/* Fiche ajout / modification ----------------------------------------------- */

function defaultCategory() {
  if (filter !== 'all' && filter !== 'none' && catById(filter)) return filter;
  const last = state.prefs.lastCategory;
  return last && catById(last) ? last : null;
}

function openSheet(opts) {
  draft = { mode: opts.mode, item: { ...opts.item }, loading: !!opts.loading, tabId: opts.tabId || null, touched: {}, found: null };
  draftToken += 1;
  closeMenu();
  $('#sheet').hidden = false;
  fillSheet();
}

function closeSheet() {
  draft = null;
  draftToken += 1;
  $('#sheet').hidden = true;
}

function fillSheet() {
  if (!draft) return;
  const it = draft.item;
  const form = $('#draftForm');
  form.classList.toggle('loading', draft.loading);

  $('#sheetEyebrow').textContent = draft.loading ? 'Lecture de la page…'
    : draft.mode === 'edit' ? 'Modifier l’article'
      : draft.mode === 'update' ? 'Déjà dans ta liste · mise à jour'
        : 'Nouvel article';

  $('#draftThumb').replaceChildren(...thumbEl(it, 'x').childNodes);

  if (!draft.touched.title) $('#draftTitle').value = it.title || '';
  const site = $('#draftSite');
  site.textContent = `${it.site || hostOf(it.url)} ↗`;
  site.href = it.url;

  if (!draft.touched.price) $('#draftPrice').value = priceToInput(it.price);
  const cur = $('#draftCurrency');
  const code = it.currency || 'EUR';
  if (![...cur.options].some((o) => o.value === code)) cur.append(h('option', null, code));
  if (!draft.touched.currency) cur.value = code;
  if (!draft.touched.note) $('#draftNote').value = it.note || '';

  const hint = $('#draftHint');
  hint.className = 'hint';
  if (draft.loading) {
    hint.textContent = 'On cherche le prix sur la page…';
  } else if (draft.gone) {
    hint.textContent = 'Lien mort : la page n’existe plus (erreur 404 ou renvoi vers l’accueil du site).';
    hint.classList.add('warn');
  } else if (draft.blocked) {
    hint.textContent = 'Le site bloque la lecture automatique : saisis le prix à la main.';
    hint.classList.add('warn');
  } else if (draft.found === false) {
    hint.textContent = 'Prix introuvable sur la page — saisis-le à la main.';
    hint.classList.add('warn');
  } else if (draft.mode === 'update' && draft.previousPrice && it.price && draft.previousPrice !== it.price) {
    hint.textContent = `Avant : ${fmt(draft.previousPrice, it.currency)} · nouveau prix relevé à l’instant.`;
  } else if (draft.mode === 'edit' && it.initialPrice && it.price && it.initialPrice !== it.price) {
    hint.textContent = `Prix à l’ajout : ${fmt(it.initialPrice, it.currency)} · ajouté ${ago(it.addedAt)}`;
  } else if (draft.found) {
    hint.textContent = draft.source === 'scan'
      ? 'Prix trouvé sur la page : vérifie que c’est le bon.'
      : 'Prix relevé automatiquement sur la page.';
  } else {
    hint.textContent = '';
  }

  updateConv();
  renderDraftCats();
  const submit = $('#draftSubmit');
  submit.textContent = draft.mode === 'new' ? 'Ajouter à la liste' : 'Enregistrer';
  submit.disabled = draft.loading;
  $('#draftRefresh').classList.toggle('spin', draft.loading);
}

/** Sous le prix saisi : son équivalent (CHF si le site est en euros, euros s'il est en CHF). */
function updateConv() {
  const el = $('#draftConv');
  const price = draft ? parseInputPrice($('#draftPrice').value) : null;
  const cur = $('#draftCurrency').value;
  const both = price ? inBoth(price, cur) : null;
  if (!both) { el.textContent = ''; return; }
  el.textContent = `soit ${['CHF', 'EUR'].filter((c) => c !== cur).map((c) => `≈ ${show(both[c], c)}`).join(' · ')}`;
}

function renderDraftCats() {
  if (!draft) return;
  const seg = $('#draftCats');
  seg.replaceChildren();
  const sel = draft.item.categoryId && catById(draft.item.categoryId) ? draft.item.categoryId : null;
  for (const c of state.categories) {
    seg.append(h('button', {
      type: 'button', style: `--c:${c.color};--on:${onColor(c.color)}`, 'aria-pressed': String(sel === c.id),
      onclick: () => { draft.item.categoryId = sel === c.id ? null : c.id; renderDraftCats(); },
    }, c.name));
  }
  if (draft.addingCat) {
    seg.append(newCatInput(
      (name) => createCategory(name, true),
      () => { draft.addingCat = false; renderDraftCats(); },
      'seg-new',
    ));
  } else {
    seg.append(h('button', {
      type: 'button', class: 'seg-add',
      onclick: () => { draft.addingCat = true; renderDraftCats(); },
    }, '+ Nouvelle'));
  }
}

function mergeData(target, data, keepTitle) {
  if (!data) return;
  if (data.title && !keepTitle) target.title = data.title;
  if (data.price) target.price = data.price;
  if (data.currency) target.currency = data.currency;
  if (data.image) target.image = data.image;
  if (data.siteName && !keepTitle) target.site = data.siteName;
}

async function startAdd({ url, tabId, title }) {
  const existing = state.items.find((i) => sameUrl(i.url, url));
  const base = existing
    ? { ...existing }
    : { url: cleanUrl(url), title: title || '', site: hostOf(url), categoryId: defaultCategory(), currency: guessCurrency(url), image: null, price: null, note: '' };
  openSheet({ mode: existing ? 'update' : 'new', item: base, loading: true, tabId });
  if (existing) draft.previousPrice = existing.price;
  await readIntoDraft();
}

async function readIntoDraft() {
  if (!draft) return;
  const token = draftToken;
  const { url } = draft.item;
  let data = null;
  if (draft.tabId) data = await extractFromTab(draft.tabId);
  if (!data || !data.price) {
    const other = await extractUrl(url);
    data = other && other.price ? { ...data, ...other } : (data || other);
  }
  if (!draft || token !== draftToken) return;
  draft.loading = false;
  draft.blocked = !!(data && data.blocked && !data.price);
  draft.gone = !draft.blocked && !!(data && (data.notFound || isHomeRedirect(url, data.finalUrl)));
  draft.found = !draft.gone && !draft.blocked && !!(data && data.price);
  draft.source = data && data.source;
  if (!draft.gone && !draft.blocked) mergeData(draft.item, data, draft.mode !== 'new');
  fillSheet();
}

/** Tous les liens d'un texte collé (un par ligne, ou séparés par des espaces). */
function urlsIn(text) {
  const urls = [];
  for (const part of String(text || '').split(/\s+/)) {
    const u = asUrl(part);
    if (u && !urls.some((x) => sameUrl(x, u))) urls.push(u);
  }
  return urls;
}

/** Plusieurs liens d'un coup : ajoutés dans la catégorie affichée, prix lus en arrière-plan. */
async function bulkAdd(urls) {
  const categoryId = defaultCategory();
  const cat = catById(categoryId);
  let res = null;
  try { res = await chrome.runtime.sendMessage({ type: 'import-urls', urls, categoryId }); } catch (e) { /* ignore */ }
  if (!res) { toast('Impossible d’ajouter ces liens'); return; }
  const parts = [];
  if (res.added) parts.push(`${plural(res.added, 'lien')} ajouté${res.added > 1 ? 's' : ''}${cat ? ` à « ${cat.name} »` : ''}`);
  if (res.moved) parts.push(`${res.moved} déplacé${res.moved > 1 ? 's' : ''}${cat ? ` dans « ${cat.name} »` : ''}`);
  if (!parts.length) parts.push('Déjà tous dans ta liste');
  toast(`${parts.join(' · ')}${res.reading ? ' · lecture des prix…' : ''}`);
}

function openEdit(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  openSheet({ mode: 'edit', item });
}

async function submitDraft(e) {
  e.preventDefault();
  if (!draft || draft.loading) return;
  const it = draft.item;
  const title = $('#draftTitle').value.trim() || it.site || hostOf(it.url);
  const price = parseInputPrice($('#draftPrice').value);
  const currency = $('#draftCurrency').value;
  const note = $('#draftNote').value.trim();
  const categoryId = it.categoryId && catById(it.categoryId) ? it.categoryId : null;
  let saved;

  if (draft.mode === 'new') {
    saved = makeItem(it.url, { title, price, currency, image: it.image, siteName: it.site }, categoryId);
    saved.note = note;
    state.items.unshift(saved);
    freshId = saved.id;
  } else {
    saved = state.items.find((i) => i.id === it.id);
    if (!saved) { closeSheet(); return; }
    if (price !== saved.price) {
      saved.price = price;
      saved.updatedAt = Date.now();
      if (price) {
        saved.history = saved.history || [];
        saved.history.push({ price, at: saved.updatedAt });
        if (saved.initialPrice == null) saved.initialPrice = price;
      }
    }
    Object.assign(saved, { title, currency, note, categoryId, image: it.image || saved.image, site: it.site || saved.site });
    delete saved.pending;
  }

  state.prefs.lastCategory = categoryId;
  if (filter !== 'all' && catKey(saved) !== filter) filter = catKey(saved);
  state.prefs.filter = filter;
  const mode = draft.mode;
  closeSheet();
  await persist();
  render();
  const cat = catById(categoryId);
  if (mode === 'new') toast(cat ? `Ajouté à « ${cat.name} »` : 'Ajouté à ta liste');
  else toast('Enregistré');
}

/* Ajout depuis la page en cours -------------------------------------------- */

async function setupCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab && /^https?:/.test(tab.url || '') ? tab : null;
  } catch (e) {
    currentTab = null;
  }
  updateCurrent();
}

function updateCurrent() {
  const b = $('#addCurrent');
  if (!currentTab) { b.hidden = true; return; }
  b.hidden = false;
  const exists = state.items.some((i) => sameUrl(i.url, currentTab.url));
  b.classList.toggle('exists', exists);
  $('#currentLabel').textContent = exists ? 'Déjà dans ta liste — relire le prix' : 'Ajouter la page actuelle';
  $('#currentHost').textContent = currentTab.title || hostOf(currentTab.url);
  const img = $('#currentFav');
  img.src = currentTab.favIconUrl || fav(currentTab.url);
  img.onerror = () => { img.src = fav(currentTab.url); };
}

function asUrl(text) {
  let s = (text || '').trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (!/^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) return null;
    s = `https://${s}`;
  }
  try { return new URL(s).href; } catch (e) { return null; }
}

/* Toast -------------------------------------------------------------------- */

let toastTimer = null;
function toast(message, actionLabel, action) {
  const t = $('#toast');
  t.replaceChildren(h('span', null, message));
  if (actionLabel) {
    t.append(h('button', { type: 'button', onclick: () => { t.classList.remove('show'); action(); } }, actionLabel));
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), actionLabel ? 5000 : 2200);
}

/* Démarrage ---------------------------------------------------------------- */

function bind() {
  // Un lien : fiche à compléter. Plusieurs liens : ajout direct, prix lus en arrière-plan.
  const addLinks = (text) => {
    const urls = urlsIn(text);
    if (urls.length > 1) bulkAdd(urls);
    else if (urls.length === 1) startAdd({ url: urls[0] });
  };

  $('#addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#urlInput');
    if (!urlsIn(input.value).length) { toast('Ce n’est pas un lien valide'); input.focus(); return; }
    const text = input.value;
    input.value = '';
    input.blur();
    addLinks(text);
  });

  $('#urlInput').addEventListener('paste', (e) => {
    const text = e.clipboardData.getData('text');
    if (!urlsIn(text).length) return;
    e.preventDefault();
    e.target.value = '';
    e.target.blur();
    addLinks(text);
  });

  // ⌘V n'importe où dans le panneau = ajouter le ou les liens copiés
  document.addEventListener('paste', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    const text = e.clipboardData.getData('text');
    if (urlsIn(text).length) { e.preventDefault(); addLinks(text); }
  });

  $('#addCurrent').addEventListener('click', () => {
    if (currentTab) startAdd({ url: currentTab.url, tabId: currentTab.id, title: currentTab.title });
  });

  // Clic sur le total : montants en CHF ⇄ en euros
  $('#totalValue').addEventListener('click', async () => {
    state.prefs.currency = otherCurrency();
    await persist();
    render();
    toast(mainCurrency() === 'CHF' ? 'Montants en francs suisses' : 'Montants en euros');
  });

  $('#sortBtn').addEventListener('click', async () => {
    const keys = Object.keys(SORTS);
    sortMode = keys[(keys.indexOf(sortMode) + 1) % keys.length];
    state.prefs.sort = sortMode;
    await persist();
    renderToolbar();
    renderList();
  });

  $('#draftForm').addEventListener('submit', submitDraft);
  $('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  $('#draftSite').addEventListener('click', (e) => { e.preventDefault(); if (draft) openUrl(draft.item.url, e); });
  $('#draftRefresh').addEventListener('click', () => {
    if (!draft || draft.loading) return;
    draft.loading = true;
    draft.touched.price = false;
    if (draft.mode === 'edit') draft.previousPrice = draft.item.price;
    fillSheet();
    readIntoDraft();
  });
  for (const [id, key] of [['#draftTitle', 'title'], ['#draftPrice', 'price'], ['#draftCurrency', 'currency'], ['#draftNote', 'note']]) {
    $(id).addEventListener('input', () => { if (draft) draft.touched[key] = true; });
  }
  $('#draftPrice').addEventListener('input', updateConv);
  $('#draftCurrency').addEventListener('change', updateConv);

  document.addEventListener('click', (e) => {
    const m = $('#menu');
    if (!m.hidden && !m.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#menu').hidden) { closeMenu(); e.preventDefault(); return; }
    if (draft) { closeSheet(); e.preventDefault(); }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORE_KEY]) return;
    const next = changes[STORE_KEY].newValue;
    if (JSON.stringify(next) === lastWritten) return;
    state = normalizeState(next);
    render();
  });
}

/** Taux du jour (BCE), relus au plus deux fois par jour. */
async function refreshRatesIfStale(saved) {
  if (saved && Date.now() - (saved.fetchedAt || 0) < 12 * 3600 * 1000) return;
  const fresh = await fetchRates();
  if (!fresh) return;
  rates = fresh.rates;
  render();
  if (draft) updateConv();
}

async function init() {
  bind();
  const [loaded, savedRates] = await Promise.all([loadState(), loadRates()]);
  state = loaded;
  if (savedRates && savedRates.rates && savedRates.rates.EUR) rates = savedRates.rates;
  filter = state.prefs.filter || 'all';
  if (filter !== 'all' && filter !== 'none' && !catById(filter)) filter = 'all';
  sortMode = SORTS[state.prefs.sort] ? state.prefs.sort : 'recent';
  render();
  setupCurrentTab();
  refreshRatesIfStale(savedRates);
  // Articles « en lecture » : le service worker reprend ceux qui ont été interrompus.
  if (state.items.some((i) => i.pending)) {
    chrome.runtime.sendMessage({ type: 'read-pending' }).catch(() => {});
    setTimeout(render, 4000);
  }
}

init();
