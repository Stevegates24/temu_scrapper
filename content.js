// content.js — Temu Product Scraper v16.1

(function() {
  if (window.__temuScraperInjected) return;
  window.__temuScraperInjected = true;

  // ── Constants ────────────────────────────────────────────────
  const DATE_PATTERN = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*\.?\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i;
  const MONTH_MAP = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const BIZ_RANGE_PATTERN  = /(\d+)\s*[-–+]\s*(\d+)\s*business\s*days?/i;
  const BIZ_SINGLE_PATTERN = /[≤<]?\s*(\d+)\s*\+?\s*business\s*days?/i;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Date helpers ─────────────────────────────────────────────
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

  function formatDate(d) {
    return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
  }

  function parseBusinessDays(text) {
    if (!text) return null;
    const today = new Date();
    const rm = text.match(BIZ_RANGE_PATTERN);
    if (rm) {
      return {
        start: formatDate(addBusinessDays(today, parseInt(rm[1]))),
        end:   formatDate(addBusinessDays(today, parseInt(rm[2])))
      };
    }
    const sm = text.match(BIZ_SINGLE_PATTERN);
    if (sm) {
      const days = parseInt(sm[1]);
      const hasLeq = /[≤<]/.test(text);
      return {
        start: formatDate(addBusinessDays(today, hasLeq ? 1 : days)),
        end:   formatDate(addBusinessDays(today, days))
      };
    }
    return null;
  }

  function parseDateRange(text) {
    if (!text) return null;
    const m = text.match(DATE_PATTERN);
    if (!m) return null;
    const mn = MONTH_MAP[m[1].toLowerCase().slice(0,3)];
    if (!mn) return null;
    const yr = new Date().getFullYear();
    const mm = String(mn).padStart(2,"0");
    const d1 = parseInt(m[2]);
    const d2 = parseInt(m[3]);
    if (d2 < d1 || d1 < 1 || d2 > 31) return null;
    return {
      start: `${mm}/${String(d1).padStart(2,"0")}/${yr}`,
      end:   `${mm}/${String(d2).padStart(2,"0")}/${yr}`
    };
  }

  // ── ATC URL extraction ────────────────────────────────────────
  // ATC URL format: https://www.temu.com/goods.html?_bg_fs=1&goods_id=GOODS_ID&sku_id=SKU_ID
  //
  // goods_id: extracted from current page URL
  //   e.g. "g-601105486268962.html" → goods_id = 601105486268962
  //
  // sku_id: found in the DOM after user selects options.
  //   Temu stores it in:
  //   - window.__NEXT_DATA__ or window.__NUXT__ JS state
  //   - A hidden input or data attribute
  //   - The "Add to cart" button's data attributes
  //   - The cart panel that appears after adding to cart
  //   - XHR responses (not accessible without interception)
  //
  // We scan multiple sources for sku_id.

  function extractGoodsId() {
    const url = window.location.href;
    // Pattern: g-123456789.html
    const m1 = url.match(/g-(\d{10,20})\.html/i);
    if (m1) return m1[1];
    // Pattern: goods_id=123456789
    const m2 = url.match(/goods_id=(\d{8,20})/i);
    if (m2) return m2[1];
    // Pattern in pathname: /601105486268962
    const m3 = url.match(/\/(\d{12,20})/);
    if (m3) return m3[1];
    return "";
  }

  function extractSkuId() {
    // Strategy 1: Check URL params (if user navigated to a variant URL)
    const urlParams = new URLSearchParams(window.location.search);
    const skuFromUrl = urlParams.get("sku_id") || urlParams.get("skuId");
    if (skuFromUrl) return skuFromUrl;

    // Strategy 2: Check window.__NEXT_DATA__ (Next.js state)
    try {
      const nextData = window.__NEXT_DATA__;
      if (nextData) {
        const str = JSON.stringify(nextData);
        const m = str.match(/"sku_?[Ii]d"\s*:\s*"?(\d{10,20})"?/);
        if (m) return m[1];
      }
    } catch(e) {}

    // Strategy 3: Check page's inline scripts for skuId / sku_id
    try {
      const scripts = Array.from(document.querySelectorAll("script:not([src])"));
      for (const script of scripts) {
        const text = script.textContent || "";
        if (!text.includes("sku")) continue;
        const m = text.match(/["']sku_?[Ii]d["']\s*[=:]\s*["']?(\d{10,20})["']?/);
        if (m) return m[1];
      }
    } catch(e) {}

    // Strategy 4: Check data attributes on selected/active spec buttons
    // When user selects a variant, Temu marks it selected
    try {
      const selectedSpec = document.querySelector(
        '[class*="specItem"][class*="selected"] [data-sku], ' +
        '[class*="spec"][class*="active"] [data-sku], ' +
        '[class*="selected"][data-sku-id], ' +
        '[class*="active"][data-sku-id]'
      );
      if (selectedSpec) {
        const sku = selectedSpec.getAttribute("data-sku") ||
                    selectedSpec.getAttribute("data-sku-id");
        if (sku) return sku;
      }
    } catch(e) {}

    // Strategy 5: Check the Add to Cart button or its parent for sku data
    try {
      const addBtn = Array.from(document.querySelectorAll("button, [role='button']")).find(el => {
        const t = el.innerText?.trim() || "";
        return /add to cart|buy now/i.test(t) && t.length < 40;
      });
      if (addBtn) {
        // Check data attributes on button and its ancestors
        let node = addBtn;
        for (let i = 0; i < 5; i++) {
          if (!node) break;
          const sku = node.getAttribute("data-sku-id") ||
                      node.getAttribute("data-sku") ||
                      node.getAttribute("data-goods-sku");
          if (sku && /^\d{10,20}$/.test(sku)) return sku;
          node = node.parentElement;
        }
      }
    } catch(e) {}

    // Strategy 6: Cart panel that opens after "Add to cart" is clicked
    // The cart sidebar shows the item with a link containing sku_id
    try {
      const cartLinks = Array.from(document.querySelectorAll("a[href*='sku_id']"));
      if (cartLinks.length > 0) {
        const href = cartLinks[cartLinks.length - 1].href;
        const m = href.match(/sku_id=(\d{10,20})/);
        if (m) return m[1];
      }
    } catch(e) {}

    // Strategy 7: Scan all elements with sku-like data attributes
    try {
      const allEls = document.querySelectorAll("[data-sku-id], [data-skuid], [data-sku]");
      for (const el of allEls) {
        const sku = el.getAttribute("data-sku-id") ||
                    el.getAttribute("data-skuid") ||
                    el.getAttribute("data-sku");
        if (sku && /^\d{10,20}$/.test(sku)) return sku;
      }
    } catch(e) {}

    // Strategy 8: Check window object for any sku-related keys
    try {
      for (const key of Object.keys(window)) {
        if (!/sku|Sku|SKU/.test(key)) continue;
        const val = window[key];
        if (typeof val === "string" && /^\d{10,20}$/.test(val)) return val;
        if (typeof val === "object" && val !== null) {
          const str = JSON.stringify(val).slice(0, 2000);
          const m = str.match(/sku_?[Ii]d['"]\s*[=:]\s*['"]?(\d{10,20})/);
          if (m) return m[1];
        }
      }
    } catch(e) {}

    return "";
  }

  function buildAtcUrl(goodsId, skuId) {
    if (!goodsId) return "";
    const base = "https://www.temu.com/goods.html";
    const sessId = new URLSearchParams(window.location.search).get("_x_sessn_id") || "";
    let url = `${base}?_bg_fs=1&goods_id=${goodsId}`;
    if (skuId)  url += `&sku_id=${skuId}`;
    if (sessId) url += `&_x_sessn_id=${sessId}`;
    url += `&_oak_page_source=501`;
    return url;
  }

  function extractAtcUrl() {
    const goodsId = extractGoodsId();
    const skuId   = extractSkuId();
    const url     = buildAtcUrl(goodsId, skuId);
    console.log("🛒 ATC:", { goodsId, skuId, url });
    return { atcUrl: url, skuId, goodsId };
  }

  // ── WAREHOUSE DETECTION v6 ───────────────────────────────────
  function hasTemuGreenColor(el) {
    const style = el.getAttribute("style") || "";
    if (/color\s*:\s*#0[Aa]8800\b/i.test(style)) return true;
    if (/color\s*:\s*rgb\(\s*10\s*,\s*136\s*,\s*0\s*\)/i.test(style)) return true;
    return false;
  }

  function hasTruckSibling(el) {
    const parent = el.parentElement;
    if (!parent) return false;
    const checkForTruck = (container) => {
      const imgs = container.querySelectorAll("img");
      for (const img of imgs) {
        if (/wxWpAMbp/i.test(img.className || "")) return true;
      }
      return false;
    };
    if (checkForTruck(parent)) return true;
    if (parent.parentElement && checkForTruck(parent.parentElement)) return true;
    return false;
  }

  function isInsideNavOrHeader(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const tag = node.tagName?.toLowerCase();
      const cls = typeof node.className === "string" ? node.className : "";
      if (tag === "nav" || tag === "header" || tag === "a") return true;
      if (/\b(topBar|TopBar|NavBar|navBar|mainHeader|MainHeader)\b/.test(cls)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function detectWarehouse() {
    const localSpans = Array.from(document.querySelectorAll("span")).filter(el => {
      const t = el.innerText?.trim();
      return t && /^local\s*warehouse$/i.test(t);
    });

    // Signal 1 (strongest): green color + truck icon
    for (const el of localSpans) {
      if (isInsideNavOrHeader(el)) continue;
      if (hasTemuGreenColor(el) && hasTruckSibling(el)) return "Local";
    }
    // Signal 2: green color alone
    for (const el of localSpans) {
      if (isInsideNavOrHeader(el)) continue;
      if (hasTemuGreenColor(el)) return "Local";
    }
    return "Non Local";
  }

  // ── Brand / Origin ───────────────────────────────────────────
  function extractBrandOriginFromContainer(root) {
    let brand = "", origin = "";
    for (const el of root.querySelectorAll("div, td, span, p")) {
      const t = el.innerText?.trim();
      if (!t || t.length > 150) continue;
      if (!brand  && /^Brand\s*[：:]/i.test(t))
        brand  = t.replace(/^Brand\s*[：:]\s*/i,  "").split("\n")[0].trim();
      if (!origin && /^Origin\s*[：:]/i.test(t))
        origin = t.replace(/^Origin\s*[：:]\s*/i, "").split("\n")[0].trim();
      if (brand && origin) break;
    }
    if (!brand || !origin) {
      const allEls = Array.from(root.querySelectorAll("div, td, span, p"));
      for (let i = 0; i < allEls.length - 1; i++) {
        const lbl = allEls[i].innerText?.trim();
        if (!lbl) continue;
        const tryVal = (el) => el?.innerText?.trim().split("\n")[0].trim();
        if (!origin && /^origin$/i.test(lbl)) {
          const val = tryVal(allEls[i+1]) || tryVal(allEls[i+2]);
          if (val && !/^(origin|brand)$/i.test(val) && val.length < 80) origin = val;
        }
        if (!brand && /^brand$/i.test(lbl)) {
          const val = tryVal(allEls[i+1]) || tryVal(allEls[i+2]);
          if (val && !/^(origin|brand)$/i.test(val) && val.length < 80) brand = val;
        }
      }
    }
    return { brand, origin };
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
    if (btn) { try { btn.click(); await sleep(1000); } catch(e) {} }
  }

  async function extractBrandOrigin() {
    const goodsDetail = document.querySelector('#goodsDetail') ||
                        document.querySelector('[id*="goodsDetail"]');
    const root = goodsDetail || document.body;
    let { brand, origin } = extractBrandOriginFromContainer(root);
    if (!brand) {
      const m = document.body.innerText.match(/Brand\s*[：:]\s*([^\n\r,]{1,60})/i);
      if (m) brand = m[1].trim();
    }
    if (!origin) {
      const m = document.body.innerText.match(/Origin\s*[：:]\s*([^\n\r]{1,60})/i);
      if (m) origin = m[1].trim();
    }
    if (!brand || !origin) {
      await expandProductDetails();
      const r2 = extractBrandOriginFromContainer(goodsDetail || document.body);
      if (!brand  && r2.brand)  brand  = r2.brand;
      if (!origin && r2.origin) origin = r2.origin;
      if (!brand) {
        const m = document.body.innerText.match(/Brand\s*[：:]\s*([^\n\r,]{1,60})/i);
        if (m) brand = m[1].trim();
      }
      if (!origin) {
        const m = document.body.innerText.match(/Origin\s*[：:]\s*([^\n\r]{1,60})/i);
        if (m) origin = m[1].trim();
      }
    }
    return { brand, origin };
  }

  // ── Date extraction ───────────────────────────────────────────
  // Returns true if a text is a histogram bar label (not a delivery promise)
  function isHistogramLabel(t) {
    if (!t) return false;
    // "≤5 business days", "<5 business days", ">8 business days", "6 business days" (bare number)
    if (/^[≤<>]\s*\d+\s*(\+\s*)?business/i.test(t)) return true;
    // Plain "N business days" with no range — could be histogram row
    // We allow these only if they come from a specific trusted context (td in shipping table)
    return false;
  }

  function extractDateFromContainer(container) {
    // ── Priority 1: The shipping table <td> with exactly "N-M business days" ──
    // This is the most reliable source in the Temu shipping modal.
    // Structure: <tr><td>Delivery time</td><td>5-8 business days</td></tr>
    for (const row of container.querySelectorAll("tr")) {
      const cells = row.querySelectorAll("td");
      for (const cell of cells) {
        const t = cell.innerText?.trim();
        if (!t) continue;
        // Only accept cells that contain JUST a business days range (no other text)
        if (BIZ_RANGE_PATTERN.test(t) && t.length < 50) {
          const r = parseBusinessDays(t);
          if (r) return r;
        }
      }
    }

    // ── Priority 2: "Delivery: Apr 7-14 | ..." line ──
    for (const el of container.querySelectorAll("span, div, td")) {
      const t = el.innerText?.trim();
      if (!t || t.length > 300) continue;
      if (/^delivery\s*:/i.test(t)) {
        const part = t.replace(/^delivery\s*:\s*/i, "").split("|")[0].trim();
        const r = parseDateRange(part);
        if (r) return r;
        const rb = parseBusinessDays(part);
        if (rb) return rb;
      }
    }

    // ── Priority 3: Short span with actual date like "Apr 7-14" ──
    for (const el of container.querySelectorAll("span")) {
      const t = el.innerText?.trim();
      if (t && t.length < 30 && DATE_PATTERN.test(t)) {
        const r = parseDateRange(t); if (r) return r;
      }
    }

    // ── Priority 4: PjdWJn3s containers ──
    for (const el of container.querySelectorAll('[class*="PjdWJn3s"]')) {
      const t = el.innerText?.trim();
      const r = parseDateRange(t) || parseBusinessDays(t);
      if (r) return r;
    }

    // ── Priority 5: Any element with a business days RANGE (skip histogram labels) ──
    for (const el of container.querySelectorAll("span, div, td, p")) {
      const t = el.innerText?.trim();
      if (!t || t.length > 80) continue;
      if (isHistogramLabel(t)) continue;
      if (BIZ_RANGE_PATTERN.test(t)) {
        const r = parseBusinessDays(t); if (r) return r;
      }
    }

    // ── Priority 6: Single business days (only if NOT a histogram label) ──
    // Skip: "≤5 business days", ">8 business days", "6 business days" (bare single)
    // Accept: "Fastest delivery in 5 business days", "3 business days after shipment"
    for (const el of container.querySelectorAll("span, div, p")) {
      const t = el.innerText?.trim();
      if (!t || t.length > 100 || t.length < 10) continue;
      if (isHistogramLabel(t)) continue;
      // Must have context words — not a bare "N business days"
      if (/^\d+\s*business\s*days?$/i.test(t)) continue;
      if (BIZ_SINGLE_PATTERN.test(t)) {
        const r = parseBusinessDays(t); if (r) return r;
      }
    }

    // ── Priority 7: Broad date range fallback ──
    for (const el of container.querySelectorAll("span, div")) {
      const t = el.innerText?.trim();
      if (t && t.length < 60) { const r = parseDateRange(t); if (r) return r; }
    }

    return null;
  }

  // Only block real <a href> anchors that navigate away.
  // Do NOT block role="link" divs — Temu wraps the entire shipping section
  // (including the modal trigger button) in a role="link" div for non-local products.
  function isNavigationAnchor(el) {
    let node = el;
    while (node && node !== document.body) {
      const tag  = node.tagName?.toLowerCase();
      const href = node.getAttribute?.("href") || "";
      // Only real <a> tags with navigating hrefs are dangerous
      if (tag === "a" && href && !href.startsWith("#") && href !== "javascript:void(0)") return true;
      node = node.parentElement;
    }
    return false;
  }

  async function openShippingModalAndGetDate() {
    // Find the shipping modal trigger — the clickable row that opens the shipping details popup.
    // Temu renders this differently for local vs non-local:
    //   - Local:     role="button" with "Ships from this seller" aria-label
    //   - Non-local: role="button" inside a role="link" wrapper div
    // We look for role="button" elements with shipping-related text/aria,
    // then filter out only true <a href> anchors (which would navigate away).
    const candidates = [
      document.querySelector('[aria-label*="Ships from this seller"]'),
      document.querySelector('[aria-label*="ships from"]'),
      document.querySelector('[class*="_15GwfeZv"]'),
      ...Array.from(document.querySelectorAll('[role="button"]')).filter(el => {
        const text = (el.innerText?.trim() || "") + (el.getAttribute("aria-label") || "");
        const tag  = el.tagName?.toLowerCase();
        return /ships from/i.test(text) && text.length < 300 &&
               (tag === "div" || tag === "span") &&
               !isNavigationAnchor(el);
      }),
      // Also try clicking the shipping row even without ships-from text — look for the
      // delivery time row which is always present on product pages
      ...Array.from(document.querySelectorAll('[role="button"]')).filter(el => {
        const text = el.innerText?.trim() || "";
        return /business\s*days?|delivery\s*time/i.test(text) &&
               text.length < 200 && !isNavigationAnchor(el);
      }),
    ].filter(Boolean);

    // Deduplicate
    const seen = new Set();
    const triggers = candidates.filter(el => {
      if (seen.has(el)) return false;
      seen.add(el); return true;
    });

    if (triggers.length === 0) return { date: null, isLocal: null };

    for (const trigger of triggers) {
      try {
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        await sleep(1800);

        const modal =
          document.querySelector('[role="dialog"]') ||
          Array.from(document.querySelectorAll("div")).find(el => {
            const cls = typeof el.className === "string" ? el.className : "";
            return /modal|Modal|dialog|Dialog/i.test(cls) &&
                   el.offsetParent !== null &&
                   (el.querySelector("td") || el.querySelector('[class*="PjdWJn3s"]'));
          });

        const dateResult = modal
          ? extractDateFromContainer(modal)
          : extractDateFromContainer(document);

        const isLocalInModal = modal
          ? (() => {
              const spans = Array.from(modal.querySelectorAll("span")).filter(el => {
                const t = el.innerText?.trim();
                return t && /^local\s*warehouse$/i.test(t) && hasTemuGreenColor(el);
              });
              return spans.length > 0;
            })()
          : false;

        const closeBtn =
          document.querySelector('[aria-label="Close"]') ||
          document.querySelector('[aria-label="close"]') ||
          document.querySelector('[class*="_1SgweZv"]') ||
          document.querySelector('[data-ignore-height="true"][role="button"]');

        if (closeBtn) {
          closeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        } else {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        }
        await sleep(500);

        if (dateResult) return { date: dateResult, isLocal: isLocalInModal };
      } catch(e) { /* try next trigger */ }
    }
    return { date: null, isLocal: null };
  }

  // ── MAIN ─────────────────────────────────────────────────────
  async function scrapeTemuData() {
    await sleep(2500);

    // PRICE
    // Strategy: find the sale price, explicitly skipping struck-through elements.
    // DevTools shows the actual price is in span._14At0Pe5 inside the _1vkz0rqG
    // price container, while the MRP/original has style="...line-through..."
    let price = "";

    function isStrikethrough(el) {
      const style = el.getAttribute("style") || "";
      if (/line-through/i.test(style)) return true;
      try {
        const computed = window.getComputedStyle(el);
        if (/line-through/i.test(computed.textDecorationLine || "")) return true;
        if (/line-through/i.test(computed.textDecoration || "")) return true;
      } catch(e) {}
      return false;
    }

    // A valid price must look like: 3.71 or 26.54 or 1,234.56
    // NOT: 4.0 (star rating), 4 (bare integer), 87 (discount %)
    function isValidPrice(str) {
      if (!str) return false;
      const n = parseFloat(str.replace(/,/g, ""));
      if (isNaN(n) || n <= 0) return false;
      // Must have cents (decimal with 2 digits) OR be >= 10 (avoids star ratings like 4.0, 4.7)
      // Prices like 0.85, 1.48, 3.42, 3.71, 26.54 all pass
      // Star ratings 4.0, 4.7 fail because they are single digit before decimal
      if (/^\d{1,2}\.\d{2,}$/.test(str)) return true;  // e.g. 3.71, 26.54
      if (/^\d{3,}(\.\d+)?$/.test(str.replace(/,/g,""))) return true; // e.g. 1234 or 1234.56
      if (/^\d+,\d{3}/.test(str)) return true; // comma-thousands format
      return false;
    }

    function extractCleanPrice(el) {
      // Walk all spans inside the container, skip struck-through and aria-hidden ones
      const spans = Array.from(el.querySelectorAll("span"));
      for (const span of spans) {
        if (isStrikethrough(span)) continue;
        if (span.getAttribute("aria-hidden") === "true") continue;
        // Skip spans that contain child spans (they are wrappers, not leaf price values)
        if (span.querySelector("span")) continue;
        const t = span.innerText?.trim().replace(/^[$€£¥₹]/,"");
        if (!t) continue;
        if (isValidPrice(t)) return t.replace(/,/g, "");
      }
      return null;
    }

    // Strategy 1: Known sale price span (_14At0Pe5 from DevTools) — most reliable
    const salePriceSpan = document.querySelector('[class*="_14At0Pe5"]');
    if (salePriceSpan && !isStrikethrough(salePriceSpan)) {
      const t = salePriceSpan.innerText?.trim().replace(/^[$€£¥₹]/,"");
      if (t && isValidPrice(t)) price = t.replace(/,/g, "");
    }

    // Strategy 2: goods_price container — scan leaf spans, skip strikethrough
    if (!price) {
      const priceEl =
        document.querySelector('#goods_price') ||
        document.querySelector('[class*="goods_price"]') ||
        document.querySelector('[class*="GoodsPrice"]');
      if (priceEl) price = extractCleanPrice(priceEl) || "";
    }

    // Strategy 3: _1vkz0rqG PjdWJn3s price container (the sale price div from DevTools)
    if (!price) {
      // The sale price container has both _1vkz0rqG and PjdWJn3s classes
      const saleDivs = document.querySelectorAll('[class*="_1vkz0rqG"][class*="PjdWJn3s"],' +
        ' [class*="PjdWJn3s"][class*="_28K5UOnx"]');
      for (const container of saleDivs) {
        const p = extractCleanPrice(container);
        if (p) { price = p; break; }
      }
    }

    // Strategy 4: Any PjdWJn3s container
    if (!price) {
      for (const container of document.querySelectorAll('[class*="PjdWJn3s"]')) {
        const p = extractCleanPrice(container);
        if (p) { price = p; break; }
      }
    }

    // Strategy 5: Last resort — find smallest valid price in price-related elements
    if (!price) {
      const priceEls = Array.from(document.querySelectorAll(
        '#goods_price span, [class*="goods_price"] span, [class*="GoodsPrice"] span'
      )).filter(el => !isStrikethrough(el) && el.getAttribute("aria-hidden") !== "true"
                   && !el.querySelector("span"));
      let smallest = Infinity, smallestText = "";
      for (const span of priceEls) {
        const t = span.innerText?.trim().replace(/^[$€£¥₹]/,"");
        if (t && isValidPrice(t)) {
          const val = parseFloat(t.replace(/,/g, ""));
          if (val < smallest) { smallest = val; smallestText = t.replace(/,/g, ""); }
        }
      }
      if (smallestText) price = smallestText;
    }

    // SELLER
    let seller = "";

    // Strategy 1: Standard store link (_3A4F96VH role="link")
    const storeLink = document.querySelector('[class*="_3A4F96VH"][role="link"]');
    if (storeLink) {
      const label = storeLink.getAttribute("aria-label");
      if (label && label.length < 100) seller = label.trim();
      if (!seller) {
        const inner = storeLink.querySelector("div, span");
        if (inner) seller = inner.innerText?.trim().split("\n")[0];
      }
    }

    // Strategy 2: Brand Official Store banner (_3nBusaAC from DevTools)
    // Text format: "Brand Official Store: HITOZON · Quality assurance"
    // We extract just the brand name after the colon
    if (!seller) {
      const brandStoreSpan = document.querySelector('[class*="_3nBusaAC"]');
      if (brandStoreSpan) {
        const t = brandStoreSpan.innerText?.trim();
        if (t) {
          // "Brand Official Store: HITOZON · Quality assurance" → "HITOZON"
          const m = t.match(/Brand Official Store\s*[:\-·]\s*([^·\n]+)/i);
          if (m) seller = m[1].trim();
          else seller = t.split("·")[0].replace(/Brand Official Store\s*[:\-]?/i,"").trim();
        }
      }
    }

    // Strategy 3: Brand Official Store from the banner div containing the store name
    if (!seller) {
      const brandBanner = Array.from(document.querySelectorAll("div, span")).find(el => {
        const t = el.innerText?.trim();
        return t && /Brand Official Store/i.test(t) && t.length < 200;
      });
      if (brandBanner) {
        const t = brandBanner.innerText?.trim();
        const m = t.match(/Brand Official Store\s*[:\-·]\s*([A-Za-z0-9 &'._-]{2,50})/i);
        if (m) seller = m[1].trim().split("·")[0].trim();
      }
    }

    // Strategy 4: "Sold by" pattern
    if (!seller) {
      const soldByEl = Array.from(document.querySelectorAll("div, span")).find(el => {
        const t = el.innerText?.trim();
        return t && /^Sold by/i.test(t) && t.length < 200;
      });
      if (soldByEl) {
        for (const k of soldByEl.querySelectorAll("div, span, a")) {
          const t = k.innerText?.trim();
          if (t && !/^Sold by/i.test(t) && t.length > 1 && t.length < 80) {
            seller = t.split("\n")[0].trim(); break;
          }
        }
      }
    }

    // Strategy 5: "Sourced from" text (some Temu locales use this)
    if (!seller) {
      const sourcedEl = Array.from(document.querySelectorAll("span, div")).find(el => {
        const t = el.innerText?.trim();
        return t && /Sourced from/i.test(t) && t.length < 150;
      });
      if (sourcedEl) {
        const t = sourcedEl.innerText?.trim().replace(/Sourced from\s*/i,"").trim();
        if (t && t.length < 80) seller = t.split("\n")[0].trim();
      }
    }

    // BRAND + ORIGIN
    const { brand: rawBrand, origin: rawOrigin } = await extractBrandOrigin();
    const brand  = rawBrand  || "Brand Not Mentioned";
    const origin = rawOrigin || "NA";

    // WAREHOUSE
    let warehouse = detectWarehouse();

    // SHIPPING DATES
    const { date: dateResult, isLocal: modalSaysLocal } = await openShippingModalAndGetDate();
    if (warehouse === "Non Local" && modalSaysLocal === true) warehouse = "Local";
    const finalDate = dateResult || extractDateFromContainer(document);
    const shippingStart = finalDate?.start || "";
    const shippingEnd   = finalDate?.end   || "";

    // ATC URL (extracted without any clicks — purely from DOM/URL)
    const { atcUrl, skuId, goodsId } = extractAtcUrl();

    console.log("🛒 Temu Scraper v16:", { price, brand, seller, origin, warehouse, shippingStart, shippingEnd, atcUrl });
    return { price, brand, seller, origin, warehouse, shippingStart, shippingEnd, atcUrl };
  }

  // ── Message listener ─────────────────────────────────────────
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "SCRAPE_TEMU") {
      // Guard: reject mall/seller pages — only product pages are supported
      const url = window.location.href;
      // Seller/mall pages: temu.com/mall.html or temu.com/de/mall.html etc.
      const isMallPage   = /temu\.com(\/[a-z]{2})?\/mall\.html/i.test(url);
      // Search/listing pages
      const isSearchPage = /temu\.com(\/[a-z]{2})?\/[a-z-]*search/i.test(url) ||
                           /[?&](search_key|q)=/i.test(url);
      // Valid product pages: contain a goods ID in the URL
      const isProductPage = /\-g\-\d{8,}\.html/i.test(url) ||
                            /\/goods\.html/i.test(url) ||
                            /goods_id=\d+/i.test(url) ||
                            // Some Temu locales use /de/product-name-g-123.html
                            /\/g\-\d{8,}\.html/i.test(url);
      if (isMallPage) {
        sendResponse({ __error: "seller_page" });
        return true;
      }
      if (isSearchPage || (!isProductPage)) {
        sendResponse({ __error: "not_product_page" });
        return true;
      }
      window.__temuScraperInjected = false;
      scrapeTemuData().then(data => sendResponse(data));
      return true;
    }
    // Separate message to get JUST the ATC URL after user selects options
    if (request.type === "GET_ATC_URL") {
      const result = extractAtcUrl();
      sendResponse(result);
      return true;
    }
  });

})();
