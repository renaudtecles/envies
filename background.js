/* Service worker : menu clic droit, import de liens, lecture d'une URL dans un onglet discret. */

importScripts('shared.js', 'extract.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (promise, ms) => Promise.race([promise, sleep(ms).then(() => null)]);

/** Lecture de la page d'un onglet ; abandon au bout de 8 s (page qui ne finit jamais de charger). */
async function extractFromTab(tabId) {
  const run = chrome.scripting
    .executeScript({ target: { tabId }, func: extractProduct, injectImmediately: true })
    .then(([res]) => (res ? res.result : null));
  return withTimeout(run, 8000);
}

function waitForComplete(tabId, timeout) {
  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') done(); }).catch(done);
  });
}

/**
 * Ouvre l'URL dans un onglet en arrière-plan, laisse le JavaScript du site
 * afficher le prix, le lit, puis referme l'onglet. Sert quand la simple
 * lecture du HTML ne suffit pas (sites rendus côté navigateur).
 */
async function extractViaTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForComplete(tab.id, 20000);
    let data = null;
    const waits = [800, 1500, 2500, 3500];
    for (let k = 0; k < waits.length; k += 1) {
      await sleep(waits[k]);
      try { data = (await extractFromTab(tab.id)) || data; } catch (e) { /* page pas prête */ }
      if (data && (data.price || data.notFound)) break;
      // Dernière chance réservée aux pages de vérification anti-robot qui se lèvent seules
      if (k >= 2 && !(data && data.blocked)) break;
    }
    return data;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/* Lecture des articles « en attente », un par un -------------------------- */

const DEAD_LINK_NOTE = 'Lien mort : la page n’existe plus';

/** Range le résultat d'une lecture dans l'article (prix, titre, image, lien mort). */
function storeReading(item, data, { replaceTitle = false } = {}) {
  delete item.pending;
  if (data && data.blocked && !data.price) data = null;   // page anti-robot : on ne touche à rien
  const r = applyFreshData(item, data);
  if (r.gone) {
    item.note = item.note || DEAD_LINK_NOTE;
  } else if (data) {
    if (data.title && (replaceTitle || item.titleGuess || item.title === hostOf(item.url))) item.title = data.title;
    if (data.siteName) item.site = data.siteName;
  }
  delete item.titleGuess;
  return r;
}

async function readPendingItem(id) {
  const current = (await loadState()).items.find((i) => i.id === id);
  if (!current || !current.pending) return;
  let data = null;
  try { data = await extractViaTab(current.url); } catch (e) { /* on garde l'article sans prix */ }
  await mutate((s) => {
    const item = s.items.find((i) => i.id === id);
    if (item) storeReading(item, data);
  });
}

const queued = new Set();
let readQueue = Promise.resolve();

/** File d'attente : un seul onglet discret à la fois. */
function enqueueRead(id) {
  if (queued.has(id)) return;
  queued.add(id);
  readQueue = readQueue
    .then(() => readPendingItem(id))
    .catch(() => {})
    .finally(() => queued.delete(id));
}

/** Reprend les lectures interrompues (plus d'une minute sans nouvelles). */
async function readAllPending() {
  const s = await loadState();
  s.items
    .filter((i) => i.pending && Date.now() - (i.updatedAt || 0) > 60000)
    .forEach((i) => enqueueRead(i.id));
}

/* Import de plusieurs liens (collage, fichier import.json) ----------------- */

function findOrCreateCategory(s, { categoryId, categoryName }) {
  if (categoryId && s.categories.some((c) => c.id === categoryId)) return categoryId;
  if (!categoryName) return null;
  let cat = s.categories.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
  if (!cat) {
    const used = new Set(s.categories.map((c) => c.color));
    cat = {
      id: `${slugify(categoryName)}-${uid().slice(-4)}`,
      name: categoryName,
      color: PALETTE.find((p) => !used.has(p)) || PALETTE[s.categories.length % PALETTE.length],
    };
    s.categories.push(cat);
  }
  return cat.id;
}

/**
 * Ajoute des liens (chaînes, ou objets {url, title, price, currency, image,
 * siteName, note, skipRead, titleGuess}) dans une catégorie. Un lien déjà dans
 * la liste change seulement de catégorie. Les articles sans prix sont lus
 * ensuite, un par un, dans un onglet discret.
 */
async function importEntries(entries, opts = {}) {
  const toRead = [];
  let added = 0;
  let moved = 0;
  await mutate((s) => {
    const catId = findOrCreateCategory(s, opts);
    const base = Date.now();
    const fresh = [];
    entries.forEach((entry, index) => {
      const data = typeof entry === 'string' ? { url: entry } : (entry || {});
      const url = data.url;
      if (!url || !/^https?:/i.test(url)) return;
      const existing = s.items.find((i) => sameUrl(i.url, url)) || fresh.find((i) => sameUrl(i.url, url));
      if (existing) {
        if (catId && existing.categoryId !== catId) { existing.categoryId = catId; moved += 1; }
        return;
      }
      const item = makeItem(url, data.title || data.price ? data : null, catId);
      item.addedAt = base - index;              // garde l'ordre donné
      if (data.note) item.note = data.note;
      if (data.titleGuess) item.titleGuess = true;
      if (!data.price && !data.skipRead) {
        item.pending = true;
        toRead.push(item.id);
      }
      fresh.push(item);
      added += 1;
    });
    s.items.unshift(...fresh);
    if (opts.importId) s.prefs.imports = [...(s.prefs.imports || []), opts.importId];
  });
  toRead.forEach(enqueueRead);
  return { added, moved, reading: toRead.length };
}

/**
 * import.json, livré avec l'extension : importé une seule fois (son `id`
 * est retenu), au premier démarrage qui suit son ajout.
 */
let bundledImport = null;
function runBundledImport() {
  if (!bundledImport) {
    bundledImport = (async () => {
      let pack = null;
      try {
        const res = await fetch(chrome.runtime.getURL('import.json'));
        if (res.ok) pack = await res.json();
      } catch (e) { /* pas de fichier d'import */ }
      if (!pack || !pack.id || !Array.isArray(pack.items)) return;
      const s = await loadState();
      if ((s.prefs.imports || []).includes(pack.id)) return;
      await importEntries(pack.items, { categoryName: pack.category, importId: pack.id });
    })().finally(() => { bundledImport = null; });
  }
  return bundledImport;
}

/* Messages du popup -------------------------------------------------------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === 'extract-url') {
    extractViaTab(msg.url).then(sendResponse, () => sendResponse(null));
    return true; // réponse asynchrone
  }
  if (msg.type === 'import-urls') {
    importEntries(msg.urls || [], { categoryId: msg.categoryId }).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.type === 'read-pending') {
    readAllPending();
    sendResponse(true);
  }
  return false;
});

/* Menu clic droit ---------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'envies-page', title: 'Ajouter cette page à mes envies', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'envies-link', title: 'Ajouter ce lien à mes envies', contexts: ['link'] });
  });
  runBundledImport();
});

async function flashBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}

async function addFromContextMenu(info, tab) {
  const fromPage = info.menuItemId === 'envies-page';
  const url = fromPage ? (tab && tab.url) : info.linkUrl;
  if (!url || !/^https?:/.test(url)) return;

  // L'article apparaît tout de suite dans la liste (« lecture… »), le prix suit.
  const placeholder = await mutate((s) => {
    const existing = s.items.find((i) => sameUrl(i.url, url));
    if (existing) {
      existing.pending = true;
      existing.updatedAt = Date.now();
      return existing;
    }
    const item = makeItem(url, fromPage && tab ? { title: tab.title } : null, null);
    item.pending = true;
    s.items.unshift(item);
    return item;
  });

  let data = null;
  try {
    data = fromPage ? await extractFromTab(tab.id) : await extractViaTab(url);
  } catch (e) { /* on garde l'article sans prix */ }

  let result = { found: false };
  await mutate((s) => {
    const item = s.items.find((i) => i.id === placeholder.id);
    if (!item) return;
    const replaceTitle = fromPage && tab && item.title === tab.title;
    result = storeReading(item, data, { replaceTitle });
  });
  await flashBadge(result.found ? '+1' : '?', result.found ? '#1D1B18' : '#E0694B');
}

chrome.contextMenus.onClicked.addListener((info, tab) => { addFromContextMenu(info, tab); });

// À chaque réveil du service worker : import en attente, lectures interrompues.
runBundledImport().then(readAllPending);
