import { chromium } from '/Users/fahdnaveed/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const BASE = 'http://localhost:4321';
const LOT = '5/89/26';            // rich demo lot for timeline + trace
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots') + '/';
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise(r => setTimeout(r, ms));
let n = 0;
const pad = (i) => String(i).padStart(2, '0');

const browser = await chromium.launch({
  executablePath: '/Users/fahdnaveed/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
});
const ctx = await browser.newContext({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

async function shot(name, full = true) {
  n++;
  const file = `${OUT}${pad(n)}-${name}.png`;
  await page.screenshot({ path: file, fullPage: full });
  console.log('saved', file);
}

async function gotoApp() {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await wait(400);
}

async function login(pin) {
  // ensure login screen visible
  const onLogin = await page.evaluate(() => {
    const l = document.querySelector('#login');
    return l && getComputedStyle(l).display !== 'none';
  });
  if (!onLogin) {
    await page.evaluate(() => document.querySelector('header .icon-btn')?.click());
    await wait(300);
  }
  for (const d of String(pin).split('')) {
    await page.evaluate((d) => {
      [...document.querySelectorAll('.pinpad button')].find(b => b.textContent.trim() === d)?.click();
    }, d);
    await wait(80);
  }
  await wait(500);
}

async function openView(v, fill) {
  await page.evaluate((v) => window.App.openView(v), v);
  // wait for the form/table to render (lots load async)
  for (let i = 0; i < 25; i++) {
    await wait(200);
    const ready = await page.evaluate(() => {
      const m = document.querySelector('#main');
      return !!m && !!m.querySelector('.fld, table');
    });
    if (ready) break;
  }
  if (fill) await fill();
  await wait(300);
}

// light, no-submit fill so forms look realistic in docs
async function fillForm(values = {}) {
  await page.evaluate(({ values, LOT }) => {
    const set = (el, v) => { if (!el) return; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const m = document.querySelector('#main');
    const lotSel = [...m.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === LOT));
    if (lotSel) set(lotSel, LOT);
    [...m.querySelectorAll('.fld select')].forEach(s => { if (s !== lotSel && !s.value && s.options.length > 1) set(s, s.options[1].value); });
    [...m.querySelectorAll('.fld input')].forEach(i => {
      if (i.value) return;
      const k = (i.closest('.fld')?.querySelector('label')?.textContent || '').toLowerCase();
      if (values[k] !== undefined) return set(i, values[k]);
      if (i.type === 'number') set(i, '12');
      else if (i.type === 'time') set(i, '09:30');
      else if (i.type === 'date') set(i, '2026-06-01');
      else if (i.type === 'datetime-local') set(i, '2026-06-01T09:30');
      else if (i.type === 'text') set(i, '');
    });
  }, { values, LOT });
}

// ---------- LOGIN ----------
await gotoApp();
await shot('login');

// ---------- ROLE MENUS ----------
const roles = [
  ['0000', 'menu-manager'],
  ['1111', 'menu-rm-receiving'],
  ['2222', 'menu-peeling'],
  ['3333', 'menu-production'],
  ['4444', 'menu-qc'],
  ['5555', 'menu-office'],
];
for (const [pin, name] of roles) {
  await login(pin);
  await shot(name);
}

// ---------- THE PRODUCTION CYCLE (forms in order) ----------
// RM Receiving
await login('1111');
await openView('newlot', () => fillForm({ 'truck plate': 'KL-07-AB-1234' }));
await shot('cycle-1-new-lot');
await openView('arrival', () => fillForm({ 'grade / count': '26/30', 'count / kg': '26/30', boxes: '40', 'qty (kg)': '500' }));
await shot('cycle-2-truck-arrival');
await openView('shedrep', () => fillForm({ 'yield %': '88' }));
await shot('cycle-3-peeling-shed-report');
await openView('shedrcpt', () => fillForm());
await shot('cycle-4-shed-receipt');

// Peeling
await login('2222');
await openView('peeling', () => fillForm({ 'yield %': '90' }));
await shot('cycle-5-peeling-output');

// Production
await login('3333');
await openView('plan');
await shot('cycle-6-daily-plan');
await openView('machine', () => fillForm());
await shot('cycle-7-machine-event');
await openView('prodtemp', () => fillForm());
await shot('cycle-8-temps-photo');
await openView('packing', () => fillForm());
await shot('cycle-9-packing-status');

// QC
await login('4444');
await openView('treatment', () => fillForm({ '% gain': '12' }));
await shot('cycle-10-treatment-log');
await openView('inspection', () => fillForm());
await shot('cycle-11-online-inspection');
await openView('stuffing', () => fillForm());
await shot('cycle-12-depanning-stuffing');

// Office
await login('5555');
await openView('inventory', () => fillForm());
await shot('cycle-13-inventory');
await openView('dispatch', () => fillForm());
await shot('cycle-14-dispatch');
await openView('reglaze', () => fillForm());
await shot('cycle-15-reglaze');

// ---------- LOTS + TIMELINE ----------
await login('0000');
await openView('lots');
await wait(800);
await shot('lots-list');
await page.evaluate((lot) => window.App.openLot(lot), LOT);
await wait(1500);
await shot('lot-timeline');

// ---------- MANAGER READ-ONLY VIEWS ----------
for (const [v, name] of [['temps', 'manager-temperatures'], ['yield', 'manager-yield'], ['qc', 'manager-glaze-defects'], ['docs', 'manager-documents']]) {
  await page.evaluate((v) => window.App.openView(v), v);
  await wait(1600);
  await shot(name);
}

// ---------- PUBLIC TRACE PAGE ----------
await page.goto(`${BASE}/trace.html?v=${Date.now()}&lot=${encodeURIComponent(LOT)}`, { waitUntil: 'networkidle' });
await wait(1800);
await shot('public-trace-page');

await browser.close();
console.log(`\nDONE — ${n} screenshots in ${OUT}`);
