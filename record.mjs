import { chromium } from '/Users/fahdnaveed/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, renameSync } from 'fs';

const DIR = dirname(fileURLToPath(import.meta.url));
const VID = join(DIR, 'video');
mkdirSync(VID, { recursive: true });
const BASE = 'http://localhost:4321';
const LOT = '5/905/26';
const SEQ = '905';
const W = 430, H = 932;

const pause = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: '/Users/fahdnaveed/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  recordVideo: { dir: VID, size: { width: W, height: H } },
});
const page = await ctx.newPage();

async function gotoApp() { await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' }); await pause(800); }

async function onLogin() {
  return page.evaluate(() => { const l = document.querySelector('#login'); return !!l && getComputedStyle(l).display !== 'none'; });
}
async function lock() {
  await page.evaluate(() => document.querySelector('header .icon-btn')?.click());
  await pause(700);
}
async function pin(code) {
  if (!(await onLogin())) await lock();
  await pause(400);
  for (const d of String(code).split('')) {
    await page.evaluate((d) => [...document.querySelectorAll('.pinpad button')].find(b => b.textContent.trim() === d)?.click(), d);
    await pause(260);
  }
  await pause(900); // land on menu
}
async function openView(v) {
  await page.evaluate((v) => window.App.openView(v), v);
  for (let i = 0; i < 30; i++) {
    await pause(180);
    const ready = await page.evaluate(() => { const m = document.querySelector('#main'); return !!m && !!m.querySelector('.fld, table, .timeline, .tiles, .srow, .stage'); });
    if (ready) break;
  }
  await pause(700);
}
async function typeField(labelStarts, text) {
  const sel = await page.evaluate((lbl) => {
    const m = document.querySelector('#main');
    const f = [...m.querySelectorAll('.fld')].find(f => { const L = f.querySelector('label'); return L && L.textContent.trim().toLowerCase().startsWith(lbl.toLowerCase()); });
    if (!f) return null;
    const i = f.querySelector('input,textarea'); if (!i) return null;
    if (!i.id) i.id = 'tf_' + Math.random().toString(36).slice(2, 8);
    i.scrollIntoView({ block: 'center' });
    return '#' + i.id;
  }, labelStarts);
  if (!sel) return false;
  await pause(250);
  await page.click(sel).catch(() => {});
  await page.fill(sel, '').catch(() => {});
  await page.locator(sel).pressSequentially(text, { delay: 55 }).catch(() => {});
  await pause(350);
  return true;
}
async function selectField(labelStarts, idx = 1) {
  await page.evaluate(({ lbl, idx }) => {
    const m = document.querySelector('#main');
    const f = [...m.querySelectorAll('.fld')].find(f => { const L = f.querySelector('label'); return L && L.textContent.trim().toLowerCase().startsWith(lbl.toLowerCase()); });
    const s = f && f.querySelector('select'); if (!s || s.options.length <= idx) return;
    s.scrollIntoView({ block: 'center' });
    s.value = s.options[idx].value; s.dispatchEvent(new Event('change', { bubbles: true }));
  }, { lbl: labelStarts, idx });
  await pause(450);
}
async function pickLot() {
  await page.evaluate((LOT) => {
    const s = [...document.querySelectorAll('#main select')].find(s => [...s.options].some(o => o.value === LOT));
    if (s) { s.scrollIntoView({ block: 'center' }); s.value = LOT; s.dispatchEvent(new Event('change', { bubbles: true })); }
  }, LOT);
  await pause(500);
}
async function bulkFill() { // fill remaining empties quickly (no overwrite of typed)
  await page.evaluate(() => {
    const set = (el, v) => { if (!el) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const m = document.querySelector('#main');
    [...m.querySelectorAll('.fld select')].forEach(s => { if (!s.value && s.options.length > 1) set(s, s.options[1].value); });
    [...m.querySelectorAll('.fld input')].forEach(i => {
      if (i.value) return;
      if (i.type === 'number') set(i, '12'); else if (i.type === 'time') set(i, '09:30');
      else if (i.type === 'date') set(i, '2026-06-01'); else if (i.type === 'datetime-local') set(i, '2026-06-01T09:30');
      else if (i.type === 'text') set(i, '—');
    });
    [...m.querySelectorAll('table input')].slice(0, 3).forEach((c, k) => set(c, c.type === 'number' ? String(10 + k) : '31/40'));
  });
  await pause(400);
}
async function submit() {
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#main button')].find(b => /save record|create lot|save inspection|save report/i.test(b.textContent));
    if (!b) return false; b.scrollIntoView({ block: 'center' }); return true;
  });
  if (!clicked) return;
  await pause(450);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#main button')].find(b => /save record|create lot|save inspection|save report/i.test(b.textContent)); b && b.click(); });
  await pause(1500); // let success toast show + return to menu
}
async function scrollThrough(steps = 16) {
  const max = await page.evaluate(() => Math.max(0, document.body.scrollHeight - innerHeight));
  for (let i = 1; i <= steps; i++) { await page.evaluate((y) => scrollTo({ top: y, behavior: 'smooth' }), Math.round(max * i / steps)); await pause(420); }
  await pause(500);
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' })); await pause(700);
}

// ============ RECORDING ============
await gotoApp();                       // login screen
await pause(1200);

// Show every role's menu
await pin('0000'); await pause(1200);  // Manager
await pin('1111'); await pause(900);   // RM Receiving

// ---- CYCLE: RM Receiving ----
await openView('newlot');
await typeField('Sequence', SEQ);
await selectField('Product', 1); await selectField('Market', 1);
await typeField('Truck plate', 'KL-07-AB-1234');
await submit();

await openView('arrival');
await pickLot(); await typeField('Grade', '26/30'); await typeField('Count', '26/30');
await typeField('Boxes', '40'); await typeField('Qty', '500'); await submit();

await openView('shedrep'); await pickLot(); await typeField('Yield', '88'); await bulkFill(); await submit();
await openView('shedrcpt'); await pickLot(); await bulkFill(); await submit();

// ---- Peeling ----
await pin('2222'); await pause(800);
await openView('peeling'); await pickLot(); await typeField('Yield', '90'); await bulkFill(); await submit();

// ---- Production ----
await pin('3333'); await pause(800);
await openView('plan'); await scrollThrough(8);
await openView('machine'); await pickLot(); await bulkFill(); await submit();
await openView('prodtemp'); await pickLot(); await bulkFill(); await submit();
await openView('packing'); await pickLot(); await bulkFill(); await submit();

// ---- QC ----
await pin('4444'); await pause(800);
await openView('treatment'); await pickLot(); await typeField('% gain', '12'); await bulkFill(); await submit();
await openView('inspection'); await typeField('Report no', 'OIR-DEMO'); await pickLot(); await bulkFill(); await scrollThrough(8); await submit();
await openView('stuffing'); await pickLot(); await bulkFill(); await submit();

// ---- Office ----
await pin('5555'); await pause(800);
await openView('inventory'); await pickLot(); await bulkFill(); await submit();
await openView('dispatch'); await pickLot(); await bulkFill(); await submit();
await openView('reglaze'); await pickLot(); await bulkFill(); await submit();

// ---- Traceability + Manager views ----
await pin('0000'); await pause(900);
await openView('lots'); await pause(1000); await scrollThrough(6);
await page.evaluate((lot) => window.App.openLot(lot), '5/89/26'); await pause(1500);
await scrollThrough(20);                // full lifecycle timeline
for (const v of ['temps', 'yield', 'qc', 'docs']) { await openView(v); await pause(1400); await scrollThrough(6); }

// ---- Public trace page ----
await page.goto(`${BASE}/trace.html?v=${Date.now()}&lot=${encodeURIComponent('5/89/26')}`, { waitUntil: 'networkidle' });
await pause(1600); await scrollThrough(18);

// finish
await pause(800);
const vpath = await page.video().path();
await ctx.close();      // finalizes the video file
await browser.close();

const finalWebm = join(DIR, 'Protech-Walkthrough.webm');
renameSync(vpath, finalWebm);
console.log('VIDEO_WEBM=' + finalWebm);
