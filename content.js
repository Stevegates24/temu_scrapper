// content.js — Temu Product Scraper v9

(function() {
  if (window.__temuScraperLoaded) return;
  window.__temuScraperLoaded = true;

  // ── Pattern: "Apr 11 - 17" style actual dates ──
  const DATE_PATTERN = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i;
  const MONTH_MAP = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

  // ── Pattern: "5-8 business days" or "5 - 8 business days" ──
  const BIZ_DAYS_PATTERN = /(\d+)\s*[-–]\s*(\d+)\s*business\s*days?/i;
  // ── Pattern: single "7 business days" ──
  const BIZ_SINGLE_PATTERN = /(\d+)\s*business\s*days?/i;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Add N business days to a date (skips Sat/Sun)
  function addBusinessDays(date, days) {
    const d = new Date(date);
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) added++; // skip Sunday(0) and Saturday(6)
    }
    return d;
  }

  function formatDate(date) {
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }

  // Try to parse business-days range from text → return {start, end} or null
  function parseBusinessDays(text) {
    if (!text) return null;
    const today = new Date();

    const rangeMatch = text.match(BIZ_DAYS_PATTERN);
    if (rangeMatch) {
      const startDays = parseInt(rangeMatch[1]);
      const endDays   = parseInt(rangeMatch[2]);
      return {
        start: formatDate(addBusinessDays(today, startDays)),
        end:   formatDate(addBusinessDays(today, endDays))
      };
    }

    const singleMatch = text.match(BIZ_SINGLE_PATTERN);
    if (singleMatch) {
      const days = parseInt(singleMatch[1]);
      return {
        start: formatDate(addBusinessDays(today, days)),
        end:   formatDate(addBusinessDays(today, days))
      };
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

  // Scan page for BOTH actual date ranges AND business-day ranges
  function scanPageForDate() {
    // 1. Try actual date format first (e.g. "Apr 11 - 17")
    for (const el of document.querySelectorAll("span")) {
      const t = el.innerText?.trim();
      if (t && t.length < 30 && DATE_PATTERN.test(t)) { const r = parseDateRange(t); if (r) return r; }
    }
    for (const el of document.querySelectorAll('[class*="PjdWJn3s"]')) {
      const r = parseDateRange(el.innerText?.trim()); if (r) return r;
    }

    // 2. Try "Delivery time" blocks — check both date and business-days formats
    for (const el of document.querySelectorAll("div")) {
      const t = el.innerText?.trim();
      if (t && t.startsWith("Delivery time") && t.length < 200) {
        const inner = t.replace(/Delivery time/i,"").trim().split("\n")[0];
        const r = parseDateRange(inner) || parseBusinessDays(inner);
        if (r) return r;
      }
    }

    // 3. Scan spans/divs for business-days pattern
    for (const el of document.querySelectorAll("span, div")) {
      const t = el.innerText?.trim();
      if (!t || t.length > 80) continue;
      const r = parseBusinessDays(t);
      if (r) return r;
    }

    // 4. Fallback: any short element with actual date
    for (const el of document.querySelectorAll("span, div")) {
      const t = el.innerText?.trim();
      if (t && t.length < 60) { const r = parseDateRange(t); if (r) return r; }
    }

    return null;
  }

  async function openShippingModalAndGetDate() {
    const triggers = [
      document.querySelector('[aria-label*="Ships from this seller"]'),
      document.querySelector('[aria-label*="ships from"]'),
      Array.from(document.querySelectorAll('[role="button"], button')).find(el => {
        const t = el.innerText?.trim() || el.getAttribute("aria-label") || "";
        return /ships from/i.test(t) && t.length < 100;
      }),
      Array.from(document.querySelectorAll("span")).find(el =>
        /ships from this seller/i.test(el.innerText?.trim()) && el.innerText.length < 60
      ),
    ].filter(Boolean);

    for (const trigger of triggers) {
      try {
        trigger.click(); await sleep(1200);
        const result = scanPageForDate();
        const closeBtn = document.querySelector('[class*="close"], [aria-label*="close"], [aria-label*="Close"]');
        if (closeBtn) closeBtn.click();
        else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(400);
        if (result) return result;
      } catch(e) {}
    }
    return null;
  }

  async function scrapeTemuData() {
    await sleep(2500);

    let price = "";
    const priceEl = document.querySelector('#goods_price') ||
                    document.querySelector('[class*="goods_price"]') ||
                    document.querySelector('[class*="GoodsPrice"]');
    if (priceEl) {
      const match = priceEl.innerText.trim().match(/[\d,]+\.?\d*/);
      if (match) price = match[0].replace(/,/g, "");
    }

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

    let { brand, origin } = extractBrandOrigin();
    if (!brand || !origin) {
      await expandProductDetails();
      const expanded = extractBrandOrigin();
      if (!brand)  brand  = expanded.brand;
      if (!origin) origin = expanded.origin;
    }
    if (!brand) brand = "Brand Not Mentioned";

    let warehouse = "Non Local";
    const localSpan = Array.from(document.querySelectorAll("span")).find(el => {
      const t = el.innerText?.trim(); return t && /local\s*warehouse/i.test(t) && t.length < 60;
    });
    if (localSpan) warehouse = "Local";
    if (warehouse === "Non Local") {
      const localDiv = Array.from(document.querySelectorAll("div")).find(el => {
        const t = el.innerText?.trim(); return t && /local\s*warehouse/i.test(t) && t.length < 80;
      });
      if (localDiv) warehouse = "Local";
    }

    let dateResult = scanPageForDate();
    if (!dateResult) dateResult = await openShippingModalAndGetDate();
    const shippingStart = dateResult?.start || "";
    const shippingEnd   = dateResult?.end   || "";

    console.log("🛒 Temu Scraper v9:", { price, brand, seller, origin, warehouse, shippingStart, shippingEnd });
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
