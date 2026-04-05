// popup.js — Temu Product Scraper v1.0 by Steve Gates

let scrapedData = null;

// ── Theme persistence ──
const body = document.body;
const themeToggle = document.getElementById("themeToggle");

chrome.storage.local.get("temuDarkMode", ({ temuDarkMode }) => {
  if (temuDarkMode) body.classList.add("dark");
});

themeToggle.addEventListener("click", () => {
  const isDark = body.classList.toggle("dark");
  chrome.storage.local.set({ temuDarkMode: isDark });
});

// ── Helpers ──

// FIX: warehouse tag built with safe DOM — no innerHTML
function buildWarehouseTag(v) {
  const isLocal = /^local$/i.test(v);
  const span = document.createElement("span");
  span.className = "tag " + (isLocal ? "local" : "non-local");
  span.textContent = (isLocal ? "🏠 " : "🌐 ") + v;
  return span;
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = (value || "").trim();
  if (v) {
    el.textContent = "";
    if (id === "f-warehouse") {
      el.appendChild(buildWarehouseTag(v));
    } else {
      el.textContent = v;
    }
    el.classList.remove("empty");
    el.classList.add("loaded");
  } else {
    el.textContent = "—";
    el.classList.add("empty");
    el.classList.remove("loaded");
  }
}

// FIX: setStatus uses safe DOM — no innerHTML
function setStatus(text, type = "", showSpinner = false) {
  const el = document.getElementById("status");
  el.textContent = "";
  el.className = "status " + type;
  if (showSpinner) {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    el.appendChild(spinner);
    el.appendChild(document.createTextNode(" " + text));
  } else {
    el.textContent = text;
  }
}

function setProgress(pct) {
  const bar  = document.getElementById("progressBar");
  const fill = document.getElementById("progressFill");
  if (pct === 0) { bar.classList.remove("active"); fill.style.width = "0%"; return; }
  bar.classList.add("active"); fill.style.width = pct + "%";
}

function clearFields() {
  ["f-price","f-brand","f-seller","f-warehouse","f-origin","f-start","f-end"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = "—"; el.classList.add("empty"); el.classList.remove("loaded");
  });
}

// FIX: copy button flash uses safe DOM — no innerHTML
function flashCopyBtn(btn, originalNodes) {
  btn.textContent = "";
  // checkmark SVG via DOM
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "13"); svg.setAttribute("height", "13");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  poly.setAttribute("points", "20 6 9 17 4 12");
  svg.appendChild(poly);
  btn.appendChild(svg);
  btn.appendChild(document.createTextNode(" Copied!"));
  setTimeout(() => {
    btn.textContent = "";
    originalNodes.forEach(n => btn.appendChild(n));
  }, 1800);
}

// ── Scrape ──
document.getElementById("scrapeBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url?.includes("temu.com")) {
    setStatus("⚠️ Please open a Temu product page first.", "error");
    return;
  }
  clearFields();
  document.getElementById("copyBtn").style.display = "none";
  document.getElementById("scrapeBtn").disabled = true;
  setStatus("Scraping page…", "", true);
  setProgress(20);
  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }); } catch (_) {}
  setProgress(55);
  chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_TEMU" }, (data) => {
    document.getElementById("scrapeBtn").disabled = false;
    setProgress(100); setTimeout(() => setProgress(0), 600);
    if (chrome.runtime.lastError || !data) {
      setStatus("❌ Could not scrape. Refresh page & try again.", "error"); return;
    }
    scrapedData = data;
    setField("f-price",    data.price);
    setField("f-brand",    data.brand);
    setField("f-seller",   data.seller);
    setField("f-warehouse",data.warehouse);
    setField("f-origin",   data.origin);
    setField("f-start",    data.shippingStart);
    setField("f-end",      data.shippingEnd);
    document.getElementById("copyBtn").style.display = "flex";
    setStatus("✅ Data scraped successfully!", "success");
  });
});

// ── Copy ──
document.getElementById("copyBtn").addEventListener("click", async () => {
  if (!scrapedData) return;
  const row = [
    scrapedData.price || "", "",
    scrapedData.brand || "", "",
    scrapedData.seller || "", "", "", "",
    scrapedData.warehouse || "",
    scrapedData.origin || "",
    scrapedData.shippingStart || "",
    scrapedData.shippingEnd || "",
  ].join("\t");
  try { await navigator.clipboard.writeText(row); }
  catch (_) {
    const ta = document.createElement("textarea"); ta.value = row;
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
  }
  setStatus("📋 Copied! Click first cell in Excel → Ctrl+V", "success");
  const btn = document.getElementById("copyBtn");
  // save original child nodes before flashing
  const origNodes = Array.from(btn.childNodes).map(n => n.cloneNode(true));
  flashCopyBtn(btn, origNodes);
});
