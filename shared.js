/* Stockage et utilitaires partagés entre le popup et le service worker. */

const STORE_KEY = 'envies';

const PALETTE = ['#4F6BED', '#E0694B', '#4E9A76', '#D49A2A', '#9473C2', '#2F95AE', '#C2507F', '#7C8A4E', '#5C6B7A'];

const DEFAULT_CATEGORIES = [
  { id: 'bureau', name: 'Bureau', color: '#4F6BED' },
  { id: 'appartement', name: 'Appartement', color: '#E0694B' },
  { id: 'cuisine', name: 'Cuisine', color: '#4E9A76' },
  { id: 'salon', name: 'Salon', color: '#D49A2A' },
  { id: 'chambre', name: 'Chambre', color: '#9473C2' },
  { id: 'salle-de-bain', name: 'Salle de bain', color: '#2F95AE' },
];

function normalizeState(s) {
  s = s || {};
  return {
    items: Array.isArray(s.items) ? s.items : [],
    categories: Array.isArray(s.categories) ? s.categories : DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    prefs: s.prefs || {},
  };
}

async function loadState() {
  const r = await chrome.storage.local.get(STORE_KEY);
  return normalizeState(r[STORE_KEY]);
}

async function saveState(state) {
  await chrome.storage.local.set({ [STORE_KEY]: state });
}

/** Lecture-modification-écriture : évite d'écraser ce qu'un autre contexte vient d'écrire. */
async function mutate(fn) {
  const s = await loadState();
  const r = await fn(s);
  await saveState(s);
  return r === undefined ? s : r;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

const TRACKING_PREFIX = /^(utm_|mc_|pk_|hsa_|pd_rd_|pf_rd_|sp_|_ga|_gl)/i;
const TRACKING_EXACT = new Set(['gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'yclid', 'igshid', 'ref', 'ref_', 'tag', 'psc', 'th', 'smid',
  'content-id', 'linkcode', 'linkid', 'camp', 'creative', 'creativeasin', 'ascsubtag', 'srsltid', 'cmp', 'xtor', 'awc', 'sv1', 'sv_campaign', 'dib', 'dib_tag', 'qid', 'sr', 'keywords', 'crid', 'sprefix']);
const isTracking = (k) => TRACKING_PREFIX.test(k) || TRACKING_EXACT.has(k.toLowerCase());

/** URL propre : sans #ancre ni traceurs ; Amazon ramené à /dp/ASIN. */
function cleanUrl(url) {
  let u;
  try { u = new URL(url); } catch (e) { return url; }
  u.hash = '';
  if (/(^|\.)amazon\.[a-z.]+$/.test(u.hostname)) {
    const m = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
    if (m) return `${u.protocol}//${u.hostname}/dp/${m[1].toUpperCase()}`;
  }
  for (const k of [...u.searchParams.keys()]) if (isTracking(k)) u.searchParams.delete(k);
  return u.href;
}

function sameUrl(a, b) {
  return cleanUrl(a).replace(/\/$/, '') === cleanUrl(b).replace(/\/$/, '');
}

function guessCurrency(url) {
  const h = hostOf(url);
  if (h.endsWith('.co.uk')) return 'GBP';
  const tld = h.split('.').pop();
  if (tld === 'ch' || tld === 'li') return 'CHF';
  if (tld === 'com' || tld === 'us') return 'USD';
  return 'EUR';
}

function makeItem(url, data, categoryId) {
  const now = Date.now();
  const price = data && data.price ? data.price : null;
  return {
    id: uid(),
    url: cleanUrl(url),
    title: (data && data.title) || hostOf(url),
    price,
    initialPrice: price,
    currency: (data && data.currency) || guessCurrency(url),
    image: (data && data.image) || null,
    site: (data && data.siteName) || hostOf(url),
    categoryId: categoryId || null,
    note: '',
    bought: false,
    addedAt: now,
    updatedAt: now,
    history: price ? [{ price, at: now }] : [],
  };
}

/** Applique un nouveau relevé de prix à un article existant (historique compris). */
function applyFreshData(item, data) {
  if (!data) return { changed: false, found: false };
  if (data.notFound || isHomeRedirect(item.url, data.finalUrl)) return { changed: false, found: false, gone: true };
  if (!item.image && data.image) item.image = data.image;
  if ((!item.title || item.title === hostOf(item.url)) && data.title) item.title = data.title;
  if (!data.price) return { changed: false, found: false };
  const before = item.price;
  item.price = data.price;
  if (data.currency) item.currency = data.currency;
  if (item.initialPrice == null) item.initialPrice = data.price;
  item.updatedAt = Date.now();
  item.history = item.history || [];
  if (before !== data.price) item.history.push({ price: data.price, at: item.updatedAt });
  if (item.history.length > 50) item.history = item.history.slice(-50);
  return { changed: before !== data.price, found: true, before };
}

function slugify(name) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cat';
}

/** Lien mort : la fiche demandée renvoie vers l'accueil du site (produit retiré). */
function isHomeRedirect(requested, final) {
  if (!requested || !final) return false;
  try {
    const a = new URL(requested);
    const b = new URL(final);
    const depth = (u) => u.pathname.split('/').filter(Boolean).length;
    return hostOf(a.href) === hostOf(b.href) && depth(a) >= 2 && depth(b) <= 1 && !b.search;
  } catch (e) {
    return false;
  }
}

/* Taux de change : tout s'affiche en CHF, avec l'équivalent en euros ------- */

const RATES_KEY = 'envies-rates';

// Taux BCE du 23/11/2026 (unités de devise pour 1 CHF), remplacés par ceux du jour dès que possible.
const FALLBACK_RATES = { date: '2026-11-23', rates: { EUR: 1.0886, USD: 1.1908, GBP: 0.91088 } };

async function loadRates() {
  try {
    const r = await chrome.storage.local.get(RATES_KEY);
    return r[RATES_KEY] || null;
  } catch (e) {
    return null;
  }
}

/** Taux du jour de la Banque centrale européenne (frankfurter.dev, sans clé). */
async function fetchRates() {
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=CHF&symbols=EUR,USD,GBP');
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || !j.rates || !j.rates.EUR) return null;
    const value = { date: j.date, rates: j.rates, fetchedAt: Date.now() };
    await chrome.storage.local.set({ [RATES_KEY]: value });
    return value;
  } catch (e) {
    return null;
  }
}

/** Montant converti en CHF, ou null si la devise est inconnue. */
function toCHF(amount, currency, rates) {
  if (!amount) return null;
  if (!currency || currency === 'CHF') return amount;
  const r = rates && rates[currency];
  return r ? amount / r : null;
}
