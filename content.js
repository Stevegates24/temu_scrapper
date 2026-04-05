// content.js — Temu Product Scraper v10

(function() {
  if (window.__temuScraperLoaded) return;
  window.__temuScraperLoaded = true;

  const DATE_PATTERN = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i;
  const MONTH_MAP = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const BIZ_DAYS_PATTERN = /(\d+)\s*[-–]\s*(\d+)\s*business\s*days?/i;
  const BIZ_SINGLE_PATTERN = /(\d+)\s*business\s*days?/i;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function addBusinessDays(date, days) {
    const d = new Date(date);
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    return d;
  }

  function formatDate(date) {
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${mm}/${dd}/${date.getFullYear()}`;
  }

  function parseBusinessDays(text) {
    if (!text) return null;
    const today = new Date();
    const rangeMatch = text.match(BIZ_DAYS_PATTERN);
    if (rangeMatch) {
      return {
        start: formatDate(addBusinessDays(today, parseInt(rangeMatch[1]))),
        end:   formatDate(addBusinessDays(today, parseInt(rangeMatch[2])))
      };
    }
    const singleMatch = text.match(BIZ_SINGLE_PATTERN);
    if (singleMatch) {
      const d = formatDate(addBusinessDays(today, parseInt(singleMatch[1])));
      return { start: d, end: d };
    }
    return null;
  }

  function parseDateRange(text) {
    const m = text && text.match(DATE_PATTERN);
    if (!m) return null;
    const mn = MONTH_MAP[m[1].toLowerCase().slice(0,3)];
    const yr = new Date().getFullYear();
    const mm = String(mn).padStart(2,"0");
    return {
      start: `${mm}/${String(parseInt(m[2])).padStart(2,"0")}/${yr}`,
      end:   `${mm}/${String(parseInt(m[3])).padStart(2,"0")}/${yr}`
    };
  }

  async function expandProductDetails() {
    const btn =
      document.querySelector('div[class*="_3xcJKtRB"][role="button"]') ||
      Array.from(document.querySelectorAll('[role="button"]')).find(el =>
        /see all details/i.test(el.innerText?.trim()) && el.innerText.trim().length < 40
      ) ||
      Array.from(document.querySelectorAll("span")).find(el =>
        /^see all details$/i.test(el.innerText?.trim())
      );
    if (btn) { try { btn.click(); await sleep(900); } catch(e) {} }
  }

  function extractBrandOrigin() {
    const root = document.querySelector('#goodsDetail') ||
                 document.querySelector('[id*="goodsDetail"]') || document.body;
    let brand = "", origin = "";
    for (const div of root.querySelectorAll("div")) {
      const t = div.innerText?.trim();
      if (!t || t.length > 120 || t.includes("\n\n")) continue;
      if (!brand  && /^Brand\s*[：:]/i.test(t))
        brand  = t.replace(/^Brand\s*[：:]\s*/i,  "").split("\n")[0].trim();
      if (!origin && /^Origin\s*[：:]/i.test(t))
        origin = t.replace(/^Origin\s*[：:]\s*/i, "").split("\n")[0].trim();
      if (brand && origin) break;
    }
    if (!brand)  { const m = document.body.innerText.match(/Brand\s*[：:]\s*([^\n\r,]{1,60})/i);  if (m) brand  = m[1].trim(); }
    if (!origin) { const m = document.body.innerText.match(/Origin\s*[：:]\s*([^\n\r]{1,60})/i);  if (m) origin = m[1].trim(); }
    return { brand, origin };
  }

  // ── WAREHOUSE DETECTION ──────────────────────────────────────
  // KEY FIX: Only look for "Local warehouse" inside the product
  // area — NOT in the nav bar (which has "Local Warehouse" as a
  // category filter on temu.com/de and other locales).
  // Strategy:
  //   1. Find the right-side product panel (#rightContent or
  //      equivalent) and only scan that subtree.
  //   2. Look for it in the shipping modal if open.
  //   3. NEVER scan <nav>, <header>, or top-level nav divs.
  function detectWarehouse() {
    // Elements we must EXCLUDE (nav bar, header)
    const excluded = new Set([
      ...Array.from(document.querySelectorAll("nav, header, [class*='header'], [class*='Header'], [class*='nav'], [class*='Nav'], [class*='topBar'], [class*='TopBar']"))
    ]);

    function isExcluded(el) {
      let node = el;
      while (node && node !== document.body) {
        if (excluded.has(node)) return true;
        node = node.parentElement;
      }
      return false;
    }

    // Preferred: search inside known product/shipping containers
    const productContainers = [
      document.querySelector('#rightContent'),
      document.querySelector('[class*="rightContent"]'),
      document.querySelector('[class*="goodsDetail"]'),
      document.querySelector('[class*="product-detail"]'),
      document.querySelector('[class*="ProductDetail"]'),
      document.querySelector('[class*="shipping"]'),
      document.querySelector('[class*="Shipping"]'),
      // shipping modal / dialog
      document.querySelector('[role="dialog"]'),
      document.querySelector('[class*="modal"]'),
      document.querySelector('[class*="Modal"]'),
    ].filter(Boolean);

    // Search in product containers first
    for (const container of productContainers) {
      const spans = container.querySelectorAll("span, div");
      for (const el of spans) {
        if (isExcluded(el)) continue;
        const t = el.innerText?.trim();
        // Must say "Local warehouse" specifically (not just "Local")
        // AND be short (not a block of text)
        if (t && /local\s*warehouse/i.test(t) && t.length < 80) {
          return "Local";
        }
      }
    }

    // Fallback: scan all spans/divs but skip nav/header
    for (const el of document.querySelectorAll("span, div")) {
      if (isExcluded(el)) continue;
      const t = el.innerText?.trim();
      if (!t || t.length > 80) continue;
      // Must contain the FULL phrase "local warehouse"
      if (/local\s*warehouse/i.test(t)) {
        return "Local";
      }
    }

    return "Non Local";
  }

  // ── DATE SCANNING ────────────────────────────────────────────
  function scanPageForDate() {
    // 1. Short spans with only a date range
    for (const el of document.querySelectorAll("span")) {
      const t = el.innerText?.trim();
      if (t && t.length < 30 && DATE_PATTERN.test(t)) {
        const r = parseDateRange(t); if (r) return r;
      }
    }
    // 2. PjdWJn3s class (shipping modal date container)
    for (const el of document.querySelectorAll('[class*="PjdWJn3s"]')) {
      const r = parseDateRange(el.innerText?.trim()); if (r) return r;
    }
    // 3. "Delivery time" or "Delivery:" blocks
    for (const el of document.querySelectorAll("div, span")) {
      const t = el.innerText?.trim();
      if (!t || t.length > 300) continue;
      if (/delivery\s*(time)?[:\s]/i.test(t)) {
        // strip label, try both formats
        const inner = t.replace(/delivery\s*(time)?[:\s]*/i, "").trim().split("\n")[0];
        const r = parseDateRange(inner) || parseBusinessDays(inner);
        if (r) return r;
      }
    }
    // 4. Any short element with business-days pattern
    for (const el of document.querySelectorAll("span, div")) {
      const t = el.innerText?.trim();
      if (!t || t.length > 100) continue;
      const r = parseBusinessDays(t);
      if (r) return r;
    }
    // 5. Broad fallback: any short element with actual date pattern
    for (const el of document.querySelectorAll("span, div")) {
      const t = el.innerText?.trim();
      if (t && t.length < 60) { const r = parseDateRange(t); if (r) return r; }
    }
    return null;
  }

  async function openShippingModalAndGetDate() {
    // Try multiple selectors for the shipping trigger
    const triggers = [
      document.querySelector('[aria-label*="Ships from this seller"]'),
      document.querySelector('[aria-label*="ships from"]'),
      document.querySelector('[aria-label*="Delivery"]'),
      // The green truck "Ships from this seller" row
      Array.from(document.querySelectorAll('[role="button"], button, [tabindex="0"]')).find(el => {
        const t = (el.innerText?.trim() || "") + (el.getAttribute("aria-label") || "");
        return (/ships from/i.test(t) || /delivery/i.test(t)) && t.length < 150;
      }),
      Array.from(document.querySelectorAll("span, div")).find(el => {
        const t = el.innerText?.trim();
        return t && /ships from this seller/i.test(t) && t.length < 60;
      }),
    ].filter(Boolean);

    for (const trigger of triggers) {
      try {
        trigger.click();
        await sleep(1400);
        const result = scanPageForDate();
        // Close modal
        const closeBtn =
          document.querySelector('[aria-label="Close"]') ||
          document.querySelector('[aria-label="close"]') ||
          document.querySelector('[class*="closeBtn"]') ||
          document.querySelector('[class*="close-btn"]') ||
          document.querySelector('[class*="modalClose"]');
        if (closeBtn) closeBtn.click();
        else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(500);
        if (result) return result;
      } catch(e) {}
    }
    return null;
  }

  // ── MAIN ─────────────────────────────────────────────────────
  async function scrapeTemuData() {
    await sleep(2500);

    // PRICE
    let price = "";
    const priceEl = document.querySelector('#goods_price') ||
                    document.querySelector('[class*="goods_price"]') ||
                    document.querySelector('[class*="GoodsPrice"]');
    if (priceEl) {
      const match = priceEl.innerText.trim().match(/[\d,]+\.?\d*/);
      if (match) price = match[0].replace(/,/g, "");
    }

    // SELLER
    let seller = "";
    const storeLink = document.querySelector('[class*="_3A4F96VH"][role="link"]');
    if (storeLink) {
      const label = storeLink.getAttribute("aria-label");
      if (label && label.length < 100) seller = label.trim();
      if (!seller) { const inner = storeLink.querySelector("div, span"); if (inner) seller = inner.innerText?.trim().split("\n")[0]; }
    }
    if (!seller) {
      const soldByEl = Array.from(document.querySelectorAll("div, span")).find(el => {
        const t = el.innerText?.trim(); return t && /^Sold by/i.test(t) && t.length < 200;
      });
      if (soldByEl) {
        for (const k of soldByEl.querySelectorAll("div, span, a")) {
          const t = k.innerText?.trim();
          if (t && !/^Sold by/i.test(t) && t.length > 1 && t.length < 80) { seller = t.split("\n")[0].trim(); break; }
        }
      }
    }

    // BRAND + ORIGIN
    let { brand, origin } = extractBrandOrigin();
    if (!brand || !origin) {
      await expandProductDetails();
      const expanded = extractBrandOrigin();
      if (!brand)  brand  = expanded.brand;
      if (!origin) origin = expanded.origin;
    }
    if (!brand) brand = "Brand Not Mentioned";

    // WAREHOUSE — uses the fixed detector
    const warehouse = detectWarehouse();

    // SHIPPING DATES
    let dateResult = scanPageForDate();
    if (!dateResult) dateResult = await openShippingModalAndGetDate();
    const shippingStart = dateResult?.start || "";
    const shippingEnd   = dateResult?.end   || "";

    console.log("🛒 Temu Scraper v10:", { price, brand, seller, origin, warehouse, shippingStart, shippingEnd });
    return { price, brand, seller, origin, warehouse, shippingStart, shippingEnd };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "SCRAPE_TEMU") {
      window.__temuScraperLoaded = false;
      scrapeTemuData().then(data => sendResponse(data));
      return true;
    }
  });

})();
