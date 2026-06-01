# Protech Production System

A mobile-first **Progressive Web App** for Protech Organo Foods — an IQF Vannamei
shrimp processor/exporter at the KSIDC Mega Food Park, Pallipuram, Cherthala,
Alappuzha. It replaces WhatsApp/paper production tracking with per-lot truth and
traceability across the full line: **intake → peeling → treatment → freezing → QC
→ stuffing/dispatch**, plus an Office stock/shipments layer and a Manager
costing/margin layer.

Each digital form mirrors its real paper form field-for-field (same order, labels
and FMT numbers) so the floor adopts it and buyers/auditors trust it.

## Stack

- **No build step.** Plain `index.html` at the repo root with inline CSS, plus a
  handful of IIFE JS modules registered on `window.App.views`.
- **Supabase** (Postgres + Storage) is loaded *lazily from a CDN only after a
  successful PIN login*. The key in `config.js` is the **publishable / anon
  client key** — safe to ship in a static site. Row-Level Security is open for
  this single-org internal tool; the Manager role is view-only at the UI layer.
- **Photos** are uploaded to the `protech-photos` Storage bucket and rendered
  inline inside the lot stage they belong to.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Shell: PIN login, role tiles, `window.App` runtime |
| `db.js` | Supabase data layer (lazy load, generic + lot-centric helpers, photo upload) |
| `config.js` | Runtime config (Supabase URL + publishable key, photo bucket) |
| `views.js` | Production-plan dashboard, lot list + timeline, Manager read-only summaries |
| `forms.js` | Stage data-entry forms (mirror the paper forms) |
| `management.js` | Manager-only cockpit: daily costs, lot economics, buyer analytics, rate card |
| `stock.js` | Cold-store stock-on-hand + reglaze draw-down loop |
| `shipments.js` | Order book, shipped history, projections, Office order form |
| `trace.html` | Public per-lot traceability page (`trace.html?lot=…`) + QR |
| `schema.sql` | Full Postgres schema (tables, indexes, RLS policies) |

`*.py` / `*.mjs` are one-off **dev/import tooling** (Excel → Supabase bulk loads,
walkthrough capture) and are not part of the deployed app.

## Roles (PIN login)

| PIN | Role | Capability |
|-----|------|------------|
| `0000` | Manager | View-only — dashboards, costing, economics, analytics |
| `1111` | RM Receiving | New lot, truck arrival, shed report/receipt |
| `2222` | Peeling | Peeling output + yield |
| `3333` | Production | Daily plan, machine events, temps, packing |
| `4444` | QC | Treatment log, online inspection, stuffing |
| `5555` | Office | Stock, reglaze, inventory, dispatch, shipments |

## Run locally

No dependencies to install — it's a static site. Serve the folder:

```bash
npx serve --listen 4321
```

Then open <http://localhost:4321/index.html>.

## Deploy (GitHub Pages)

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. The app is served at `https://<user>.github.io/<repo>/`.

`index.html` is already at the root and `.nojekyll` is present so the static
files are served as-is. The lot trace page is at
`.../trace.html?lot=<series>/<seq>/<year>` (e.g. `5/89/26`).

## Data model

See [`schema.sql`](schema.sql) for the authoritative schema. The lot code is
`series/seq/year` (e.g. `5/89/26`) and `lot_number` is the foreign key that ties
every stage table back to its lot. Costing lives in a separate per-day
controlling layer (`daily_costs`, `process_charges`, `lot_economics`) that sits
*beside* the lot spine rather than on the per-lot forms — cost is tracked per day
across all lots, never bolted onto a single lot.
