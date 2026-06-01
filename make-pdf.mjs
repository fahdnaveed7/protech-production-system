import { chromium } from '/Users/fahdnaveed/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { writeFileSync } from 'fs';

const DIR = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(DIR, 'screenshots');

// [file, heading, narration]
const slides = [
  ['01-login.png', 'Secure PIN Sign-In',
    'Protech Organo Foods runs on one secure sign-in. Everyone on the floor enters their own four-digit PIN — no usernames, no passwords to forget. The PIN decides exactly what that person can see and do.'],
  ['02-menu-manager.png', 'Manager — View Only',
    'The Manager signs in to a view-only dashboard. From here you see the live production plan, every lot timeline, temperatures, yields, glaze and defect summaries, and scanned documents — without changing any floor record.'],
  ['03-menu-rm-receiving.png', 'RM Receiving',
    'Raw Material Receiving starts every lot. This role creates new lots, records truck arrivals, and logs peeling shed reports and receipts as raw shrimp comes through the door.'],
  ['04-menu-peeling.png', 'Peeling',
    'The Peeling team has one focused job — record peeling output: how much went in, how much came out, and the measured yield for each run.'],
  ['05-menu-production.png', 'Production',
    'Production manages the freezing line. They open the daily plan, log machine events with automatic timers, capture IQF and tunnel temperatures with photos, and track packing status.'],
  ['06-menu-qc.png', 'Quality Control',
    'Quality Control owns the treatment logs, the online inspection report, and depanning and stuffing checks — the food-safety backbone of every lot.'],
  ['07-menu-office.png', 'Office',
    'The Office handles inventory, dispatch, and the reglaze ledger — everything that happens once product is frozen and ready to ship.'],

  ['08-cycle-1-new-lot.png', 'Step 1 — Create a New Lot',
    'Every batch begins here. The system suggests the next lot code automatically — series, sequence, and year — so the code is always unique. Choose the species, product, and market, note the truck, and create the lot.'],
  ['09-cycle-2-truck-arrival.png', 'Step 2 — Truck Arrival',
    'As the truck is unloaded, receiving records each grade line. Grades are tracked by count size — like 26/30 — with count per kilo, number of boxes, and total weight.'],
  ['10-cycle-3-peeling-shed-report.png', 'Step 3 — Peeling Shed Report',
    'The shed report mirrors the paper form exactly. It captures input versus converted counts and quantities, and the yield percentage — always entered by the operator, never auto-calculated.'],
  ['11-cycle-4-shed-receipt.png', 'Step 4 — Shed Receipt',
    'Each shed receipt is logged and the original scanned invoice is attached, so the paper trail lives right alongside the digital record.'],
  ['12-cycle-5-peeling-output.png', 'Step 5 — Peeling Output',
    'Peeling output records the conversion in detail — input and converted counts, boxes, timing, and the measured yield for that run.'],
  ['13-cycle-6-daily-plan.png', 'Step 6 — Daily Production Plan',
    'The production plan shows the day’s targets and live progress per buyer, so the whole team can see how the shift is tracking against plan.'],
  ['14-cycle-7-machine-event.png', 'Step 7 — Machine Event',
    'Machine events log the freezing equipment. Start and stop times are captured and the run duration is timed automatically.'],
  ['15-cycle-8-temps-photo.png', 'Step 8 — Temperatures & Photo',
    'Cold-chain temperatures are logged at each stage, and the operator attaches a photo of the gauge as proof — viewable later with a single tap.'],
  ['16-cycle-9-packing-status.png', 'Step 9 — Packing Status',
    'Packing status tracks cases packed against the target, along with the running balance.'],
  ['17-cycle-10-treatment-log.png', 'Step 10 — Treatment Log',
    'The treatment log follows form FMT POF/PC/004. It records soak details, solution temperatures, and percent gain — entered, not calculated — plus additive presence by simple checkboxes.'],
  ['18-cycle-11-online-inspection.png', 'Step 11 — Online Inspection',
    'The online inspection report captures up to nine samples per lot, scoring fifteen named defects alongside counts, weights, glaze, and temperatures — the full IQF quality picture in one form.'],
  ['19-cycle-12-depanning-stuffing.png', 'Step 12 — Depanning & Stuffing',
    'Depanning and stuffing records core temperatures before and after, block settings, filling weights, and container details at the point of packing.'],
  ['20-cycle-13-inventory.png', 'Step 13 — Inventory',
    'The office records stock as it comes on hand — by buyer, product, cases, and weight.'],
  ['21-cycle-14-dispatch.png', 'Step 14 — Dispatch',
    'Dispatch captures the container loadout — product, buyer, quantity, container number, and dispatch date.'],
  ['22-cycle-15-reglaze.png', 'Step 15 — Reglaze Ledger',
    'The reglaze ledger tracks any re-glazing, keeping the record complete all the way through to shipment.'],

  ['23-lots-list.png', 'Lots — One Tap Away',
    'Every lot is one tap away. The lot list is the entry point to the full production story of any batch.'],
  ['24-lot-timeline.png', 'Full Lot Timeline',
    'Open a lot and the entire lifecycle unfolds in order — intake, peeling, treatment, freezing, quality inspection, and dispatch — with photos inline at every stage.'],
  ['25-manager-temperatures.png', 'Manager — Temperatures',
    'Managers get a consolidated cold-chain log across all lots in one place.'],
  ['26-manager-yield.png', 'Manager — Yield per Lot',
    'Yield per lot, side by side, makes peeling conversion easy to compare and review.'],
  ['27-manager-glaze-defects.png', 'Manager — Glaze & Defects',
    'The inspection summary rolls up glaze percentages and defect findings per report.'],
  ['28-manager-documents.png', 'Manager — Documents',
    'All scanned shed receipts and supporting documents are collected together for quick reference.'],
  ['29-public-trace-page.png', 'Public Traceability & QR',
    'Finally, every lot has a public traceability page with a QR code. Scan it and you see a verified production record — origin, processing, quality, and packing — building buyer trust all the way to the export market.'],
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const total = slides.length;

const cover = `
<section class="slide cover">
  <div class="globe">
    <svg viewBox="0 0 64 64" width="120" height="120"><circle cx="32" cy="32" r="30" fill="#0ea5e9"/><g stroke="#fff" stroke-width="2.2" fill="none" opacity=".95"><circle cx="32" cy="32" r="30"/><path d="M2 32h60M32 2c12 9 12 51 0 60M32 2C20 11 20 53 32 62M8 16h48M8 48h48"/></g></svg>
  </div>
  <h1>PROTECH ORGANO FOODS</h1>
  <h2>Production &amp; Traceability System</h2>
  <p class="sub">A complete walkthrough — from raw-material intake to the public, QR-verified trace page.</p>
  <p class="loc">IQF Vannamei Shrimp · KSIDC Mega Food Park, Cherthala, Alappuzha</p>
</section>`;

const body = slides.map(([file, head, narr], i) => `
<section class="slide">
  <div class="left"><img src="${file}" alt="${esc(head)}"></div>
  <div class="right">
    <div class="step">Scene ${i + 1} of ${total}</div>
    <h3>${esc(head)}</h3>
    <p class="narration">${esc(narr)}</p>
    <div class="brandbar"><span class="dot"></span> Protech Organo Foods — Production &amp; Traceability</div>
  </div>
</section>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#0f172a; }
  .slide { width:1280px; height:720px; page-break-after:always; display:flex; background:#f1f5f9; overflow:hidden; }
  .slide:last-child { page-break-after:auto; }

  .cover { flex-direction:column; align-items:center; justify-content:center; text-align:center;
           background:linear-gradient(160deg,#e0f2fe 0%,#f8fafc 55%,#eff6ff 100%); gap:6px; }
  .cover .globe { margin-bottom:18px; }
  .cover h1 { font-size:54px; letter-spacing:2px; color:#0f172a; }
  .cover h2 { font-size:30px; font-weight:600; color:#0284c7; margin-top:6px; }
  .cover .sub { font-size:20px; color:#475569; margin-top:22px; max-width:760px; line-height:1.5; }
  .cover .loc { font-size:15px; color:#94a3b8; margin-top:28px; text-transform:uppercase; letter-spacing:1px; }

  .left { width:44%; display:flex; align-items:center; justify-content:center;
          background:linear-gradient(160deg,#0ea5e9 0%,#0284c7 100%); padding:34px; }
  .left img { max-height:652px; max-width:100%; border-radius:18px;
              box-shadow:0 18px 50px rgba(2,32,71,.35); background:#fff; }

  .right { width:56%; padding:70px 72px; display:flex; flex-direction:column; justify-content:center; background:#ffffff; }
  .step { font-size:14px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#0ea5e9; }
  .right h3 { font-size:40px; line-height:1.12; margin:14px 0 22px; color:#0f172a; }
  .narration { font-size:22px; line-height:1.62; color:#334155; }
  .brandbar { margin-top:auto; padding-top:34px; font-size:14px; color:#94a3b8; display:flex; align-items:center; gap:9px; }
  .brandbar .dot { width:9px; height:9px; border-radius:50%; background:#10b981; display:inline-block; }
</style></head><body>${cover}${body}</body></html>`;

const htmlPath = join(SHOTS, '_deck.html');
writeFileSync(htmlPath, html);

const browser = await chromium.launch({
  executablePath: '/Users/fahdnaveed/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
});
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
const out = join(DIR, 'Protech-Production-System-Clueso.pdf');
await page.pdf({ path: out, width: '1280px', height: '720px', printBackground: true, pageRanges: '' });
await browser.close();
console.log('PDF created:', out);
