// content.js — Temu Product Scraper v14

(function() {
  if (window.__temuScraperLoaded) return;
  window.__temuScraperLoaded = true;

  const DATE_PATTERN = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i;
  const MONTH_MAP = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const BIZ_DAYS_PATTERN = /(\d+)\s*[-–]\s*(\d+)\s*business\s*days?/i;
  const BIZ_SINGLE_PATTERN = /(\d+)\s*business\s*days?/i;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function addBusinessDays(date, days) {
    const d = new Date(date); let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    return d;
  }

  function formatDate(d) {
    return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
  }

  function parseBusinessDays(text) {
    if (!text) return null;
    const today = new Date();
    const rm = text.match(BIZ_DAYS_PATTERN);
    if (rm) return {
      start: formatDate(addBusinessDays(today, parseInt(rm[1]))),
      end:   formatDate(addBusinessDays(today, parseInt(rm[2])))
    };
    const sm = text.match(BIZ_SINGLE_PATTERN);
    if (sm) { const d = formatDate(addBusinessDays(today, parseInt(sm[1]))); return { start: d, end: d }; }
    return null;
  }

  function parseDateRange(text) {
    if (!text) return null;
    const m = text.match(DATE_PATTERN);
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
      if (!brand  && /^Brand\s*[：:]/i.test(t)) brand  = t.replace(/^Brand\s*[：:]\s*/i,  "").split("\n")[0].trim();
      if (!origin && /^Origin\s*[：:]/i.test(t)) origin = t.replace(/^Origin\s*[：:]\s*/i, "").split("\n")[0].trim();
      if (brand && origin) break;
    }
    if (!brand)  { const m = document.body.innerText.match(/Brand\s*[：:]\s*([^\n\r,]{1,60})/i);  if (m) brand  = m[1].trim(); }
    if (!origin) { const m = document.body.innerText.match(/Origin\s*[：:]\s*([^\n\r]{1,60})/i);  if (m) origin = m[1].trim(); }
    return { brand, origin };
  }

  // ── WAREHOUSE DETECTION v7 — Multi-signal approach ─────────
  //
  // Signal 1: Truck icon image (img.wxWpAMbp) adjacent to "Local warehouse" text
  //   DevTools shows <img class="wxWpAMbp" data-cui-image="1"> right before the span
  //
  // Signal 2: Green color in inline style (any green shade, not just #0A8800)
  //   Matches: #0A8800, #0a8800, rgb(10,136,0), rgb(10, 136, 0),
  //            and any green-ish hex like #0?[89A-F][0-9A-F]00 etc.
  //
  // Signal 3: Text content "Local warehouse" outside nav/interactive context
  //
  // We score signals and return Local if score >= 1 strong signal.

  function isGreenColor(styleStr) {
    if (!styleStr) return false;
    // Exact Temu greens from DevTools
    if (/color\s*:\s*#0[Aa]8800/i.test(styleStr)) return true;
    if (/color\s*:\s*rgb\(\s*10\s*,\s*136\s*,\s*0\s*\)/i.test(styleStr)) return true;
    // Broader green hex range: hue is green when R < G and B < G
    // Simple check: color:#RRGGBB where GG > RR and GG > BB
    const hexMatch = styleStr.match(/color\s*:\s*#([0-9a-fA-F]{6})/i);
    if (hexMatch) {
      const r = parseInt(hexMatch[1].slice(0,2), 16);
      const g = parseInt(hexMatch[1].slice(2,4), 16);
      const b = parseInt(hexMatch[1].slice(4,6), 16);
      if (g > 80 && g > r * 1.5 && g > b * 1.5) return true;
    }
    // Broader rgb green
    const rgbMatch = styleStr.match(/color\s*:\s*rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);
      if (g > 80 && g > r * 1.5 && g > b * 1.5) return true;
    }
    return false;
  }

  function isInsideNavOrInteractive(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const tag  = node.tagName?.toLowerCase();
      const role = node.getAttribute?.("role") || "";
      const cls  = (typeof node.className === "string") ? node.className : "";
      if (
        tag === "a" || tag === "nav" || tag === "header" ||
        role === "navigation" || role === "menuitem" ||
        /\b(nav|header|topBar|TopBar|NavBar|navBar|menu|Menu)\b/.test(cls)
      ) return true;
      node = node.parentElement;
    }
    return false;
  }

  function hasTruckIconNearby(el) {
    // Check siblings and parent for the truck image
    const parent = el.parentElement;
    if (!parent) return false;

    // Check for img with known truck class (wxWpAMbp from DevTools)
    if (parent.querySelector('img[class*="wxWpAMbp"]')) return true;
    if (parent.querySelector('img[data-cui-image="1"]')) return true;

    // Check grandparent
    const gp = parent.parentElement;
    if (gp) {
      if (gp.querySelector('img[class*="wxWpAMbp"]')) return true;
      if (gp.querySelector('img[data-cui-image="1"]')) return true;
    }

    // Check previous sibling element for an img
    let prev = el.previousElementSibling;
    while (prev) {
      if (prev.tagName === "IMG") return true;
      if (prev.querySelector && prev.querySelector("img")) return true;
      prev = prev.previousElementSibling;
    }

    return false;
  }

  function detectWarehouse() {
    // Collect all spans with "Local warehouse" text
    const candidates = Array.from(document.querySelectorAll("span")).filter(el => {
      const t = el.innerText?.trim();
      return t && /^local\s*warehouse$/i.test(t);
    });

    for (const el of candidates) {
      // Skip nav/interactive context
      if (isInsideNavOrInteractive(el)) continue;

      const styleStr = el.getAttribute("style") || "";
      const score = [
        isGreenColor(styleStr),           // Signal 1: green color style
        hasTruckIconNearby(el),           // Signal 2: truck icon adjacent
        el.getAttribute("data-type") !== null, // Signal 3: has data-type attr (Temu product badges do)
        /font-weight\s*:\s*[5-9]00/i.test(styleStr), // Signal 4: bold weight (500+)
      ].filter(Boolean).length;

      // Any single strong signal is enough
      if (score >= 1) {
        console.log("🏠 Local warehouse detected, score:", score, el);
        return "Local";
      }
    }

    // Fallback: check computed style via getComputedStyle (slower but thorough)
    for (const el of candidates) {
      if (isInsideNavOrInteractive(el)) continue;
      try {
        const computed = window.getComputedStyle(el);
        const color = computed.color; // e.g. "rgb(10, 136, 0)"
        if (color) {
          const m = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
          if (m) {
            const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
            if (g > 80 && g > r * 1.5 && g > b * 1.5) {
              console.log("🏠 Local warehouse via computed style:", color);
              return "Local";
            }
          }
        }
      } catch(e) {}
    }

    // Last resort: check if the product title area (h1 or product name container)
    // contains "Local warehouse" text anywhere — Temu sometimes embeds it in title
    const titleArea = document.querySelector('h1, [class*="goods-title"], [class*="GoodsTitle"], [class*="_25GRue8h"]');
    if (titleArea && /local\s*warehouse/i.test(titleArea.innerText || "")) {
      console.log("🏠 Local warehouse found in title area");
      return "Local";
    }

    return "Non Local";
  }

  // ── DATE EXTRACTION ─────────────────────────────────────────
  function findShippingModal() {
    return (
      document.querySelector('[role="dialog"]') ||
      Array.from(document.querySelectorAll("div")).find(el => {
        const cls = (typeof el.className === "string") ? el.className : "";
        return /modal|Modal|dialog|Dialog/i.test(cls) &&
               el.offsetParent !== null &&
               el.querySelector("span, div");
      })
    ) || null;
  }

  function extractDateFromContainer(container) {
    for (const el of container.querySelectorAll("span, div")) {
      const t = el.innerText?.trim();
      if (!t || t.length > 400) continue;
      if (/^delivery\s*:/i.test(t)) {
        const part = t.replace(/^delivery\s*:\s*/i, "").split("|")[0].trim();
        const r = parseDateRange(part);
        if (r) return r;
      }
    }
    for (const el of container.querySelectorAll("span")) {
      const t = el.innerText?.trim();
      if (t && t.length < 30 && DATE_PATTERN.test(t)) {
        const r = parseDateRange(t); if (r) return r;
      }
    }
    for (const el of container.querySelectorAll('[class*="PjdWJn3s"]')) {
      const r = parseDateRange(el.innerText?.trim()); if (r) return r;
    }
    for (const el of container.querySelectorAll("span, div")) {
      const t = el.innerText?.trim();
      if (!t || t.length > 100) continue;
      const r = parseBusinessDays(t); if (r) return r;
    }
    for (const el of container.querySelectorAll("span, div")) {
      const t = el.innerText?.trim();
      if (t && t.length < 60) { const r = parseDateRange(t); if (r) return r; }
    }
    return null;
  }

  async function openShippingModalAndGetDate() {
    const triggers = [
      document.querySelector('[aria-label*="Ships from this seller"]'),
      document.querySelector('[aria-label*="ships from"]'),
      document.querySelector('[class*="_15GwfeZv"]'),
      Array.from(document.querySelectorAll('[role="button"], [tabindex="0"]')).find(el => {
        const t = (el.innerText?.trim() || "") + (el.getAttribute("aria-label") || "");
        return /ships from/i.test(t) && t.length < 200;
      }),
      Array.from(document.querySelectorAll("span, div")).find(el => {
        const t = el.innerText?.trim();
        return t && /ships from this seller/i.test(t) && t.length < 80;
      }),
    ].filter(Boolean);

    for (const trigger of triggers) {
      try {
        trigger.click();
        await sleep(1600);
        const modal = findShippingModal();
        const result = modal
          ? extractDateFromContainer(modal)
          : extractDateFromContainer(document);
        const closeBtn =
          document.querySelector('[aria-label="Close"]') ||
          document.querySelector('[aria-label="close"]') ||
          document.querySelector('[class*="closeBtn"]') ||
          document.querySelector('[class*="close-btn"]') ||
          document.querySelector('[class*="modalClose"]') ||
          document.querySelector('[data-ignore-height="true"][role="button"]');
        if (closeBtn) closeBtn.click();
        else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(500);
        if (result) return result;
      } catch(e) {}
    }
    return null;
  }

  // ── MAIN ────────────────────────────────────────────────────
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

    const warehouse = detectWarehouse();

    let dateResult = await openShippingModalAndGetDate();
    if (!dateResult) dateResult = extractDateFromContainer(document);

    const shippingStart = dateResult?.start || "";
    const shippingEnd   = dateResult?.end   || "";

    console.log("🛒 Temu Scraper v14:", { price, brand, seller, origin, warehouse, shippingStart, shippingEnd });
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
