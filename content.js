// content.js — Amazon Product Scraper v2

async function scrapeAmazonData() {
  await new Promise(r => setTimeout(r, 1000));

  // ASIN — from product details table or URL
  let asin = "";

  for (const row of document.querySelectorAll('.a-keyvalue tr')) {
    const label = row.querySelector('th');
    const value = row.querySelector('td');
    if (label && value && /^ASIN$/i.test(label.innerText?.trim())) {
      const v = value.innerText?.trim();
      if (/^[A-Z0-9]{10}$/i.test(v)) { asin = v; break; }
    }
  }

  if (!asin) {
    for (const li of document.querySelectorAll('#detailBullets_feature_div li')) {
      const m = li.innerText?.trim().match(/ASIN\s*[：:]\s*([A-Z0-9]{10})/i);
      if (m) { asin = m[1].trim(); break; }
    }
  }

  if (!asin) {
    const urlMatch = window.location.href.match(/\/dp\/([A-Z0-9]{10})/i);
    if (urlMatch) asin = urlMatch[1];
  }

  // PRICE — combine whole + fraction to get e.g. "12.99"
  let price = "";

  // Try combining .a-price-whole + .a-price-fraction (most reliable)
  const priceBlock = document.querySelector(
    '.reinventPricePriceToPayMargin .a-price, ' +
    '#apex_offerDisplay_desktop .a-price, ' +
    '#corePriceDisplay_desktop_feature_div .a-price, ' +
    '.a-price[data-a-size="xl"], ' +
    '.a-price[data-a-size="b"], ' +
    '.a-price'
  );

  if (priceBlock) {
    const whole    = priceBlock.querySelector('.a-price-whole');
    const fraction = priceBlock.querySelector('.a-price-fraction');
    if (whole) {
      // .a-price-whole sometimes includes a trailing dot, strip it
      const w = whole.innerText?.trim().replace(/[^\d]/g, "") || "";
      const f = fraction ? fraction.innerText?.trim().replace(/[^\d]/g, "") : "";
      price = f ? `${w}.${f}` : w;
    }
  }

  // Fallback: .a-offscreen has the full price string e.g. "$12.99" or "₹2,296"
  if (!price) {
    const offscreen = document.querySelector('.a-price .a-offscreen');
    if (offscreen) {
      const raw = offscreen.textContent?.trim();
      // Extract numeric value — handles $12.99, ₹2,296, £9.99 etc.
      const m = raw.match(/([\d,]+\.?\d*)/);
      if (m) price = m[1].replace(/,/g, "");
    }
  }

  // BRAND
  let brand = "";

  for (const row of document.querySelectorAll('.a-keyvalue tr')) {
    const th = row.querySelector('th');
    const td = row.querySelector('td');
    if (th && td && /^Brand(\s*Name)?$/i.test(th.innerText?.trim())) {
      brand = td.innerText?.trim().split("\n")[0]; break;
    }
  }

  if (!brand) {
    for (const li of document.querySelectorAll('#detailBullets_feature_div li')) {
      const m = li.innerText?.trim().match(/Brand\s*[：:]\s*(.+)/i);
      if (m) { brand = m[1].trim().split("\n")[0]; break; }
    }
  }

  if (!brand) {
    const byline = document.querySelector('#bylineInfo, #brand');
    if (byline) brand = byline.innerText?.trim().replace(/^Visit the\s+/i, "").replace(/\s+Store$/i, "").split("\n")[0];
  }

  if (!brand) {
    for (const row of document.querySelectorAll('.po-brand tr')) {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2) { brand = cells[1].innerText?.trim().split("\n")[0]; break; }
    }
  }

  if (!brand) brand = "Brand NA";

  console.log("🛒 Amazon Scraper v2:", { asin, price, brand });
  return { asin, price, brand };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "SCRAPE_AMAZON") {
    scrapeAmazonData().then(data => sendResponse(data));
    return true;
  }
});
