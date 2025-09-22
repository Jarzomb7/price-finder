// ESM (package.json "type":"module")
import chromium from '@sparticuz/chromium';
import playwright from 'playwright-core';

// ---- CORS helpers ----
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ---- utils ----
function toNumber(txt) {
  if (!txt) return null;
  const m = String(txt).replace(/\u00A0|\u202F/g, '').match(/(\d+[.,]?\d*)/);
  if (!m) return null;
  return Number(m[1].replace(',', '.'));
}

async function priceFromProductPage(page) {
  const title =
    (await page.locator('h1').first().textContent().catch(() => ''))?.trim() ||
    'Produkt';

  // JSON-LD
  try {
    const jsons = await page.$$eval(
      'script[type="application/ld+json"]',
      (els) => els.map((e) => e.textContent || '')
    );
    for (const raw of jsons) {
      try {
        const j = JSON.parse(raw);
        const arr = Array.isArray(j) ? j : [j];
        for (const node of arr) {
          const t = JSON.stringify(node['@type'] || '');
          if (/Product/i.test(t)) {
            const offers = node.offers;
            const price =
              offers?.price ??
              offers?.priceSpecification?.price ??
              (Array.isArray(offers)
                ? offers.find((o) => o.price)?.price ||
                  offers.find((o) => o.priceSpecification?.price)?.price
                : null);
            const num = toNumber(price);
            if (num) return { title: node.name || title, price: num };
          }
          if (/Offer/i.test(t)) {
            const num = toNumber(node.price ?? node.priceSpecification?.price);
            if (num) return { title, price: num };
          }
        }
      } catch {}
    }
  } catch {}

  // fallback – widoczny element ceny
  const priceTxt = await page
    .locator(
      '[itemprop="price"], .price, .product-price, .a-price-whole, [data-price], .price__value'
    )
    .first()
    .textContent()
    .catch(() => null);
  return { title, price: toNumber(priceTxt) };
}

// ---- Sklepy (6) ----
const STORES = [
  {
    store: 'Ceneo',
    domain: 'ceneo.pl',
    search: (q) => `https://www.ceneo.pl/;szukaj=${q}`,
    sort: async (p) => {
      try {
        await p.click('button.js_sort_filter, .sorting .btn', { timeout: 2000 });
        await p.click('text=/Cena.*najniższej/i', { timeout: 2000 });
      } catch {}
    },
    openSel: '.cat-prod-row a.js_clickHash'
  },
  {
    store: 'Allegro',
    domain: 'allegro.pl',
    // qd = cena rosnąco (jeśli nie zadziała, klikamy niżej)
    search: (q) => `https://allegro.pl/listing?string=${q}&order=qd`,
    sort: async (p) => {
      try {
        await p.click('[data-role="sort-order"]', { timeout: 2000 });
        await p.click('text=/najniższa cena/i', { timeout: 2000 });
      } catch {}
    },
    openSel: 'article a[href*="/oferta/"], a._9c44d_3tX7G'
  },
  {
    store: 'Media Expert',
    domain: 'mediaexpert.pl',
    search: (q) =>
      `https://www.mediaexpert.pl/search?query%5Bquerystring%5D=${q}`,
    sort: async (p) => {
      try {
        await p.click('button[data-testid="SortSelect__button"]', {
          timeout: 2000
        });
        await p.click('text=/cena rosnąco|najniższa/i', { timeout: 2000 });
      } catch {}
    },
    openSel: 'a.product-box, a[href*="/p/"]'
  },
  {
    store: 'RTV Euro AGD',
    domain: 'euro.com.pl',
    search: (q) => `https://www.euro.com.pl/search.bhtml?keyword=${q}`,
    sort: async (p) => {
      try {
        await p.selectOption('#sorter', 'priceAsc').catch(() => {});
      } catch {}
    },
    openSel: 'a.js-save-keyword, a.link.js-add-to-compare'
  },
  {
    store: 'MediaMarkt',
    domain: 'mediamarkt.pl',
    search: (q) =>
      `https://mediamarkt.pl/pl/search?query%5Bquerystring%5D=${q}`,
    sort: async (p) => {
      try {
        await p.click('button[aria-haspopup="listbox"], .Sort_select__trigger', {
          timeout: 2000
        });
        await p.click('text=/cena rosnąco/i', { timeout: 2000 });
      } catch {}
    },
    openSel: 'a.ty-product-link, a[href*="/p/"]'
  },
  {
    store: 'x-kom',
    domain: 'x-kom.pl',
    search: (q) => `https://www.x-kom.pl/szukaj?q=${q}`,
    sort: async (p) => {
      try {
        await p.click('[data-testid="sortButton"]', { timeout: 2000 });
        await p.click('text=/cena rosnąco/i', { timeout: 2000 });
      } catch {}
    },
    openSel: 'a.sc-1h16fat-0, a[href*="/p/"]'
  }
];

// ---- główny scraping jednego sklepu ----
async function scrapeStore(browser, def, rawQuery) {
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    locale: 'pl-PL'
  });
  const page = await ctx.newPage();

  const q = encodeURIComponent(rawQuery.replace(/^"|"$/g, ''));
  const searchUrl = def.search(q);
  let link = searchUrl;
  let title = 'Przejdź do wyszukiwania w sklepie';
  let price = null;

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await def.sort(page);
    await page.waitForTimeout(600);
    const href = await page
      .locator(def.openSel)
      .first()
      .getAttribute('href')
      .catch(() => null);
    if (href) {
      link = href.startsWith('http') ? href : `https://${def.domain}${href}`;
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const got = await priceFromProductPage(page);
      title = got.title || title;
      price = got.price;
    }
  } catch {}

  await ctx.close();
  return { store: def.store, domain: def.domain, title, price, link };
}

// ---- handler Vercel ----
export default async function handler(req, res) {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const q =
      (req.method === 'POST'
        ? (req.body && req.body.q) || ''
        : req.query.q || '') + '';
    const query = q.trim();
    if (!query) return res.status(400).json({ error: 'Brak frazy' });

    const exe = await chromium.executablePath();
    const browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: exe,
      headless: true
    });

    const out = [];
    for (const s of STORES) {
      out.push(await scrapeStore(browser, s, query));
    }
    await browser.close();

    out.sort((a, b) => {
      if (a.price && b.price) return a.price - b.price;
      if (a.price && !b.price) return -1;
      if (!a.price && b.price) return 1;
      return a.store.localeCompare(b.store);
    });

    return res.status(200).json({ items: out });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}
