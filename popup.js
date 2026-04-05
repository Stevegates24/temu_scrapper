// popup.js — Amazon Product Scraper v1.0.0
let scrapedData = null;

// ── Theme persistence ──
const body = document.body;
const themeToggle = document.getElementById("themeToggle");

function applyTheme(dark) {
  body.classList.toggle("dark", dark);
  chrome.storage.local.set({ darkMode: dark });
}

chrome.storage.local.get("darkMode", ({ darkMode }) => {
  if (darkMode) body.classList.add("dark");
});

themeToggle.addEventListener("click", () => {
  applyTheme(!body.classList.contains("dark"));
});

// ── Helpers ──
function setField(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = (value || "").trim();
  if (v) { el.textContent = v; el.classList.remove("empty"); }
  else   { el.textContent = "Not scraped"; el.classList.add("empty"); }
}

function setStatus(msg, type = "") {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = "status " + type;
}

function setLoading(on) {
  const btn = document.getElementById("scrapeBtn");
  btn.disabled = on;
  btn.classList.toggle("loading", on);
  document.getElementById("btnLabel").textContent = on ? "Scraping…" : "Scrape Page";
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

// FIX: replaced innerHTML with safe DOM manipulation
function flashBtn(id, tempText) {
  const btn = document.getElementById(id);
  // Save original child nodes
  const origNodes = Array.from(btn.childNodes).map(n => n.cloneNode(true));
  // Set temp content safely
  btn.textContent = "✅ " + tempText;
  btn.classList.add("flashed");
  setTimeout(() => {
    btn.textContent = "";
    origNodes.forEach(n => btn.appendChild(n));
    btn.classList.remove("flashed");
  }, 1800);
}

// ── Scrape ──
document.getElementById("scrapeBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url?.includes("amazon.")) {
    setStatus("⚠️ Open an Amazon product page first.", "error");
    return;
  }

  setLoading(true);
  setStatus("Scanning page…");

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (_) {}

  chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_AMAZON" }, (data) => {
    setLoading(false);

    if (chrome.runtime.lastError || !data) {
      setStatus("❌ Failed. Refresh the page and try again.", "error");
      return;
    }

    scrapedData = data;
    setField("f-asin",  data.asin);
    setField("f-price", data.price);
    setField("f-brand", data.brand);

    document.getElementById("copyBtns").style.display = "flex";
    setStatus("✅ Done! Use the copy buttons below.", "success");
  });
});

// ── Copy buttons ──
document.getElementById("copyAsinPrice").addEventListener("click", async () => {
  if (!scrapedData) return;
  await copyText((scrapedData.asin || "") + "\t" + (scrapedData.price || ""));
  flashBtn("copyAsinPrice", "Copied!");
  setStatus("Click the ASIN cell in Excel → Ctrl+V", "success");
});

document.getElementById("copyBrand").addEventListener("click", async () => {
  if (!scrapedData) return;
  await copyText(scrapedData.brand || "Brand NA");
  flashBtn("copyBrand", "Copied!");
  setStatus("Click the Brand cell in Excel → Ctrl+V", "success");
});
