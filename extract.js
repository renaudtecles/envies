/*
 * Lecture d'une fiche produit : titre, prix, devise, image.
 *
 * La fonction est autonome (aucune référence extérieure) : elle est injectée
 * telle quelle dans l'onglet via chrome.scripting.executeScript, et appelée
 * aussi depuis le popup sur une page récupérée en fetch (doc + url fournis).
 *
 * Ordre de confiance : données structurées JSON-LD > balises meta >
 * microdonnées itemprop > sélecteurs connus (Amazon & co) > balayage des
 * éléments « price » visibles (le plus gros caractère gagne).
 */
function extractProduct(doc, pageUrl) {
  doc = doc || document;
  pageUrl = pageUrl || location.href;
  const live = !!doc.defaultView;

  const clean = (s) => (s == null ? '' : String(s)).replace(/[\u200b-\u200f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const abs = (u) => {
    if (!u) return null;
    try { return new URL(String(u).trim(), pageUrl).href; } catch (e) { return null; }
  };
  const meta = (...names) => {
    for (const n of names) {
      const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`);
      const v = el && el.getAttribute('content');
      if (v && v.trim()) return v.trim();
    }
    return null;
  };

  const CURRENCIES = [
    ['CHF', 'CHF'], ['SFr', 'CHF'], ['Fr.', 'CHF'],
    ['€', 'EUR'], ['EUR', 'EUR'],
    ['£', 'GBP'], ['GBP', 'GBP'],
    ['US$', 'USD'], ['USD', 'USD'], ['$', 'USD'],
  ];
  const detectCurrency = (text) => {
    if (!text) return null;
    for (const [sym, code] of CURRENCIES) if (String(text).includes(sym)) return code;
    return null;
  };
  const normCurrency = (c) => {
    if (!c) return null;
    const s = String(c).trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(s)) return s;
    return detectCurrency(c);
  };

  // "1 299,90 €", "CHF 1'299.–", "$1,299.99", "49,99", 1299.5
  const parsePrice = (raw) => {
    if (raw == null) return null;
    if (typeof raw === 'number') return isFinite(raw) && raw > 0 ? raw : null;
    const s = String(raw).replace(/[   ]/g, ' ');
    if (/^\s*\d+(\.\d+)?\s*$/.test(s)) {           // format machine (JSON-LD, meta)
      const v = parseFloat(s);
      return v > 0 ? v : null;
    }
    const m = s.match(/\d{1,3}(?:[ '’.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/);
    if (!m) return null;
    const n = m[0].replace(/[ '’]/g, '');
    const dec = n.match(/[.,](\d{1,2})$/);
    const int = (dec ? n.slice(0, -dec[0].length) : n).replace(/[.,]/g, '');
    const v = parseFloat(int + (dec ? '.' + dec[1] : ''));
    return v > 0 ? v : null;
  };

  const out = { title: null, price: null, currency: null, image: null, siteName: null, source: null };
  const setPrice = (price, currency, source) => {
    if (out.price || !price) return;
    out.price = Math.round(price * 100) / 100;
    out.currency = out.currency || normCurrency(currency);
    out.source = source;
  };

  /* 0. Page morte (404) : rien à lire ---------------------------------------- */
  const headText = `${clean(doc.title)} ${clean((doc.querySelector('h1') || {}).textContent)}`.toLowerCase();
  if (/page (non trouvée|introuvable|not found)|404 not found|seite nicht gefunden|pagina non trovata|(^|\s)404(\s|$).*(trouv|found|erreur|error)|(trouv|found|erreur|error).*(^|\s)404(\s|$)/.test(headText)) {
    let h = '';
    try { h = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
    return { title: null, price: null, currency: null, image: null, siteName: h || null, source: null, finalUrl: pageUrl, notFound: true };
  }
  // Page de vérification anti-robot (« Access Denied », « Just a moment… ») : rien de fiable à lire
  if (/^(access denied|just a moment|attention required|are you a robot|robot check|pardon our interruption|request blocked|403 forbidden|forbidden|vérification de sécurité|un instant)/.test(headText)) {
    return { title: null, price: null, currency: null, image: null, siteName: null, source: null, finalUrl: pageUrl, blocked: true };
  }

  /* 1. JSON-LD ------------------------------------------------------------ */
  const products = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
    const types = [].concat(node['@type'] || []);
    if (types.some((t) => typeof t === 'string' && /^(Product|ProductGroup|IndividualProduct|ProductModel|Car|Book)$/i.test(t))) {
      products.push(node);
    }
    if (node['@graph']) walk(node['@graph'], depth + 1);
    if (node.mainEntity) walk(node.mainEntity, depth + 1);
    if (node.itemListElement && !products.length) walk(node.itemListElement, depth + 1);
  };
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try { walk(JSON.parse(s.textContent.replace(/[\u0000-\u001f]+/g, ' ')), 0); } catch (e) { /* JSON invalide : on ignore */ }
  });

  const offerPrice = (o, depth = 0) => {
    if (!o || depth > 4) return null;
    if (Array.isArray(o)) {
      for (const x of o) { const r = offerPrice(x, depth + 1); if (r) return r; }
      return null;
    }
    let p = o.price != null ? o.price : (o.lowPrice != null ? o.lowPrice : null);
    let c = o.priceCurrency || null;
    if (p == null && o.priceSpecification) {
      const ps = [].concat(o.priceSpecification)[0] || {};
      p = ps.price; c = c || ps.priceCurrency;
    }
    if (p == null && o.offers) return offerPrice(o.offers, depth + 1);
    const v = parsePrice(p);
    return v ? { price: v, currency: c } : null;
  };
  const ldImage = (img) => {
    if (!img) return null;
    if (Array.isArray(img)) return ldImage(img[0]);
    if (typeof img === 'object') return img.url || img.contentUrl || null;
    return img;
  };

  // Plusieurs produits (carrousel, page d'accueil, liste) : on ne garde que
  // celui qui correspond à la page ; aucun ne correspond = ce n'est pas une fiche.
  let mainProducts = products;
  if (products.length > 1) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const pageKey = norm(pageUrl);
    let path = '';
    try { path = norm(new URL(pageUrl).pathname); } catch (e) { /* ignore */ }
    const heading = norm(meta('og:title') || (doc.querySelector('h1') || {}).textContent || doc.title);
    const score = (p) => {
      let sc = 0;
      const offer = [].concat(p.offers || [])[0] || {};
      const u = p.url || offer.url;
      if (u && path.length > 3) {
        try { if (norm(new URL(u, pageUrl).pathname) === path) sc += 4; } catch (e) { /* ignore */ }
      }
      const sku = norm(p.sku || p.mpn || p.productID);
      if (sku.length >= 4 && pageKey.includes(sku)) sc += 3;
      const name = norm(p.name);
      if (name.length >= 4 && heading.includes(name)) sc += 2;
      return sc;
    };
    mainProducts = products.map((p) => ({ p, sc: score(p) }))
      .filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc)
      .map((x) => x.p);
  }

  for (const p of mainProducts) {
    let offer = offerPrice(p.offers);
    if (!offer && p.hasVariant) offer = offerPrice([].concat(p.hasVariant).map((v) => v.offers));
    if (offer) setPrice(offer.price, offer.currency, 'json-ld');
    if (!out.title && p.name) out.title = clean(p.name);
    if (!out.image) out.image = abs(ldImage(p.image));
    if (out.price && out.title && out.image) break;
  }

  /* 2. Balises meta (Open Graph, Facebook, Pinterest) -------------------- */
  setPrice(
    parsePrice(meta('product:price:amount', 'og:price:amount', 'product:sale_price:amount', 'twitter:data1')),
    meta('product:price:currency', 'og:price:currency', 'product:sale_price:currency') || detectCurrency(meta('twitter:data1')),
    'meta'
  );

  /* 3. Microdonnées ------------------------------------------------------- */
  if (!out.price) {
    const el = doc.querySelector('[itemprop="price"]');
    if (el) {
      const raw = el.getAttribute('content') || el.textContent;
      const curEl = doc.querySelector('[itemprop="priceCurrency"]');
      const cur = curEl && (curEl.getAttribute('content') || curEl.textContent);
      setPrice(parsePrice(raw), cur || detectCurrency(el.textContent), 'itemprop');
    }
  }

  /* 4. Sélecteurs connus -------------------------------------------------- */
  // Prix barré / ancien prix : on remonte 4 niveaux au plus (pas jusqu'au <body>).
  const OLD_RE = /old|was|strike|barr|before|crossed|regular|original|rrp|uvp|compare|list-?price/i;
  const isOld = (el) => {
    let n = el;
    for (let d = 0; n && d < 4; d++, n = n.parentElement) {
      if (/^(DEL|S|STRIKE)$/.test(n.tagName)) return true;
      const c = (typeof n.className === 'string' ? n.className : '') + ' ' + (n.id || '');
      if (OLD_RE.test(c)) return true;
    }
    return false;
  };
  const visible = (el) => {
    if (!live) return true;
    if (el.closest('.a-offscreen')) return true;   // Amazon : texte masqué mais exact
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const KNOWN = [
    '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
    '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
    '#corePrice_desktop .a-price .a-offscreen',
    '#apex_desktop .a-price:not(.a-text-price) .a-offscreen',
    '#tp_price_block_total_price_ww .a-offscreen',
    '#priceblock_dealprice', '#priceblock_ourprice', '#price_inside_buybox',
    '[data-testid="price-current"]', '[data-testid="product-price"]', '[data-testid="price"]',
    '[data-test="product-price"]', '[data-qa="price"]', '[data-price-type="finalPrice"]',
    '.product-price__current', '.price__current', '.price--current', '.current-price',
    '.price-current', '.product__price', '.product-price', '.sale-price', '.price ins',
  ];
  if (!out.price) {
    for (const sel of KNOWN) {
      let els;
      try { els = doc.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of els) {
        if (isOld(el) || !visible(el)) continue;
        const raw = el.getAttribute('data-price-amount') || el.getAttribute('content') || el.textContent;
        const v = parsePrice(raw);
        if (v) { setPrice(v, detectCurrency(el.textContent), 'selector'); break; }
      }
      if (out.price) break;
    }
  }

  /* 5. Balayage : texte court avec devise, dans un élément « price » ------ */
  if (!out.price) {
    const cands = [];
    const nodes = doc.querySelectorAll('[class*="price" i], [id*="price" i], [class*="prix" i], [class*="preis" i], [class*="amount" i]');
    for (let i = 0; i < nodes.length && i < 600; i++) {
      const el = nodes[i];
      const txt = clean(el.textContent);
      if (!txt || txt.length > 40 || !/\d/.test(txt) || !detectCurrency(txt)) continue;
      if (isOld(el) || !visible(el)) continue;
      const v = parsePrice(txt);
      if (!v) continue;
      let score = 0;
      if (live) {
        const st = doc.defaultView.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        score = parseFloat(st.fontSize) || 0;
        if (r.top + doc.defaultView.scrollY > 1400) score -= 8;   // loin du haut de page
      }
      cands.push({ v, cur: detectCurrency(txt), score, i });
    }
    cands.sort((a, b) => b.score - a.score || a.i - b.i);
    if (cands[0]) setPrice(cands[0].v, cands[0].cur, 'scan');
  }

  /* Titre, image, site ---------------------------------------------------- */
  const amazonTitle = doc.querySelector('#productTitle');
  if (amazonTitle) out.title = clean(amazonTitle.textContent);
  out.title = out.title
    || clean(meta('og:title', 'twitter:title'))
    || clean((doc.querySelector('h1') || {}).textContent)
    || clean(doc.title)
    || null;
  // Un titre de page plus précis que le nom générique (« … Master Collection - L2.920.4.78.3 »)
  const h1Text = clean((doc.querySelector('h1') || {}).textContent);
  if (out.title && h1Text && !amazonTitle && h1Text.length <= 140 && h1Text.length > out.title.length
    && h1Text.toLowerCase().includes(out.title.toLowerCase())) out.title = h1Text;
  // TOUT EN CAPITALES → Majuscules Aux Mots
  if (out.title && out.title === out.title.toUpperCase() && /\p{Lu}{4}/u.test(out.title)) {
    out.title = out.title.toLowerCase().replace(/(^|[\s\-–—(/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  }
  if (out.title) out.title = out.title.replace(/\s*[|:–—-]\s*(Amazon|Achat|Buy|Kaufen)[^|]*$/i, '').slice(0, 220);

  if (!out.image) {
    const amz = doc.querySelector('#landingImage, #imgBlkFront, #main-image');
    out.image = abs(meta('og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'))
      || (amz && abs(amz.getAttribute('data-old-hires') || amz.getAttribute('src')))
      || null;
  }
  if (out.image && out.image.startsWith('data:')) out.image = null;

  let host = '';
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
  out.siteName = clean(meta('og:site_name')) || host || null;

  if (out.price && !out.currency) {
    const tld = host.split('.').pop();
    out.currency = host.endsWith('.co.uk') ? 'GBP'
      : tld === 'ch' || tld === 'li' ? 'CHF'
      : tld === 'com' || tld === 'us' ? 'USD'
      : 'EUR';
  }
  out.finalUrl = pageUrl;
  return out;
}
