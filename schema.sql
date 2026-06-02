-- =====================================================================
-- PROTECH ORGANO FOODS — production & traceability schema  (v1)
-- Project: protech-ops (ymoewukjsrbggchqzfbc)
-- Safe to run on an empty public schema. Re-runnable (IF NOT EXISTS).
-- RLS: enabled with permissive policies (single-org internal tool).
-- Spine: lots.lot_number is the FK target for every stage table.
-- =====================================================================

-- ---------- helper: shared columns are added per-table inline ----------

-- ============ LOTS (spine) ============
create table if not exists public.lots (
  id            uuid primary key default gen_random_uuid(),
  lot_number    text unique not null,            -- e.g. 5/89/26  (series/lot/year)
  series        text,
  lot_seq       integer,
  year          text,
  species       text,                            -- Vannamei
  species_code  text default 'V',
  product       text,                            -- R PD, R PTO, R PTO(V), HL, HON
  market        text,                            -- Russia, China
  intake_date   date,
  truck_plate   text,                            -- AP / TN / KL plate
  status        text default 'open',
  remarks       text,
  created_at    timestamptz default now(),
  created_by_role text
);

-- ============ Stage 1: grades / count breakdown at intake ============
create table if not exists public.lot_grades (
  id           uuid primary key default gen_random_uuid(),
  lot_number   text references public.lots(lot_number),
  grade        text,
  count_per_kg text,
  boxes        numeric,
  qty_kg       numeric,
  created_at   timestamptz default now(),
  created_by_role text
);

-- ============ 5A: Peeling Shed Report ============
create table if not exists public.peeling_shed_reports (
  id              uuid primary key default gen_random_uuid(),
  report_no       text,
  date            date,
  lot_number      text references public.lots(lot_number),
  species         text,
  input_count     text,
  input_qty_kg    numeric,
  converted_count text,
  converted_qty_kg numeric,
  yield_pct       numeric,                        -- ENTERED, never auto-calculated
  time_start      text,
  time_finish     text,
  remarks         text,
  section_in_charge   text,
  production_in_charge text,
  photo_url       text,
  -- scan-to-fill audit (see scan.js / extract-form Edge Function)
  entry_mode      text default 'manual',          -- manual | scan | scan_edited
  source_photo_url text,                           -- the photographed paper form
  extraction_json  jsonb,                          -- full model read for audit
  extraction_confidence jsonb,                     -- { column: 0..1 } per-field confidence
  created_at      timestamptz default now(),
  created_by_role text
);

-- ============ 5D: Shed Receipt (operational v1 = header + scanned image) ============
create table if not exists public.shed_receipts (
  id           uuid primary key default gen_random_uuid(),
  shed_name    text,
  shed_contact text,
  date         date,
  lot_number   text references public.lots(lot_number),
  species      text,
  header_count text,
  total_boxes  numeric,
  total_kg     numeric,
  notes        text,
  photo_url    text,                              -- the scanned receipt image
  -- scan-to-fill audit (see scan.js / extract-form Edge Function)
  entry_mode      text default 'manual',          -- manual | scan | scan_edited
  source_photo_url text,                           -- the photographed paper form
  extraction_json  jsonb,                          -- full model read for audit
  extraction_confidence jsonb,                     -- { column: 0..1 } per-field confidence
  created_at   timestamptz default now(),
  created_by_role text
);

-- ============ Stage 2: Peeling output (peeling role) ============
create table if not exists public.peeling_output (
  id              uuid primary key default gen_random_uuid(),
  lot_number      text references public.lots(lot_number),
  source          text,                           -- shed name or 'PPC' (in-house)
  input_count     text,
  input_qty_kg    numeric,
  converted_count text,
  converted_qty_kg numeric,
  yield_pct       numeric,                        -- ENTERED
  boxes           numeric,
  time_start      text,
  time_finish     text,
  remarks         text,
  created_at      timestamptz default now(),
  created_by_role text
);

-- ============ 5B: Treatment Log (FMT POF/PC/004) — one row per tub ============
create table if not exists public.treatment_logs (
  id                uuid primary key default gen_random_uuid(),
  date              date,
  shift             text,                          -- D / N
  chemical_id       text,
  salt_id           text,
  colour_id         text,
  tub_no            text,
  product           text,
  lot_number        text references public.lots(lot_number),  -- traceability
  species           text,
  grade             text,
  ph_solution       numeric,
  weight_kg         numeric,
  count_before_soak text,
  count_after_soak  text,
  pct_gain          numeric,                        -- ENTERED
  soak_in_time      text,
  soak_out_time     text,
  soln_temp_hr1     numeric,
  soln_temp_hr2     numeric,
  soln_temp_hr3     numeric,
  additive_stpp_np  boolean default false,          -- presence only (v1)
  additive_paprika  boolean default false,
  additive_salt     boolean default false,
  checked_by        text,
  verified_by       text,
  -- scan-to-fill audit (see scan.js / extract-form Edge Function)
  entry_mode        text default 'manual',         -- manual | scan | scan_edited
  source_photo_url  text,
  extraction_json   jsonb,
  extraction_confidence jsonb,
  created_at        timestamptz default now(),
  created_by_role   text
);

-- ============ Stage 3: Production plan ============
create table if not exists public.production_plans (
  id           uuid primary key default gen_random_uuid(),
  date         date,
  lot_number   text references public.lots(lot_number),
  buyer        text,
  target_count text,
  target_kg    numeric,
  workforce    integer,
  remarks      text,
  created_at   timestamptz default now(),
  created_by_role text
);

-- ============ Stage 3: Machine events (auto duration) ============
create table if not exists public.machine_events (
  id               uuid primary key default gen_random_uuid(),
  lot_number       text references public.lots(lot_number),
  machine_type     text,        -- ice / plate_freezer / tunnel / iqf_infeed
  load_no          text,
  start_at         timestamptz,
  stop_at          timestamptz,
  duration_seconds integer,
  remarks          text,
  created_at       timestamptz default now(),
  created_by_role  text
);

-- ============ Stage 3/4/5: Temperature logs (with photo) ============
create table if not exists public.temp_logs (
  id           uuid primary key default gen_random_uuid(),
  lot_number   text references public.lots(lot_number),
  point        text,            -- iqf_infeed / tunnel / core_before / core_after / stuffing
  stage        text,            -- freezing / qc / stuffing
  temp_c       numeric,
  photo_url    text,
  recorded_at  timestamptz default now(),
  created_at   timestamptz default now(),
  created_by_role text
);

-- ============ 5C: Online Inspection Report (IQF) — header ============
create table if not exists public.online_inspection_reports (
  id              uuid primary key default gen_random_uuid(),
  report_no       text,
  date            date,
  time            text,
  market          text,                 -- Russia, China
  target_glaze_pct numeric,             -- e.g. 7
  shift           text,
  raw_production  text,
  checked_by      text,
  verified_by     text,
  -- scan-to-fill audit (samples are extracted into extraction_json.samples[])
  entry_mode      text default 'manual',           -- manual | scan | scan_edited
  source_photo_url text,
  extraction_json  jsonb,
  extraction_confidence jsonb,
  created_at      timestamptz default now(),
  created_by_role text
);

-- ============ 5C: Online Inspection samples (fixed up to 9 per report) ============
create table if not exists public.online_inspection_samples (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid references public.online_inspection_reports(id) on delete cascade,
  sample_index    integer,              -- 1..9
  lot_number      text references public.lots(lot_number),
  variety         text,
  grade           text,
  frozen_count    text,
  frozen_weight   numeric,
  glaze_pct       numeric,              -- ENTERED
  deglazed_count  text,
  deglazed_weight numeric,
  thawed_weight   numeric,
  thawed_count    text,
  uniformity      text,
  -- 16-point defect checklist (named, integer = pieces affected; nullable)
  defect_freezer_burn       integer,
  defect_deterioration      integer,
  defect_discolouration     integer,
  defect_dehydration        integer,
  defect_black_spot         integer,
  defect_black_ring         integer,
  defect_broken             integer,
  defect_damaged_bruised    integer,
  defect_vein               integer,
  defect_loose_shell        integer,
  defect_soft_shell         integer,
  defect_semi_peeled        integer,
  defect_clumps             integer,
  defect_foreign_matter     integer,
  defect_foreign_veg_matter integer,
  core_temp       numeric,              -- defect #16: core temp of product
  surface_temp    numeric,              -- defect #16: surface temp
  no_of_cases     integer,
  created_at      timestamptz default now(),
  created_by_role text
);

-- ============ Stage 5: QC depanning / repacking / stuffing specs ============
create table if not exists public.qc_logs (
  id               uuid primary key default gen_random_uuid(),
  lot_number       text references public.lots(lot_number),
  stage            text,            -- depanning / repacking / stuffing
  block_setting    text,
  core_temp_before numeric,
  core_temp_after  numeric,
  buyer            text,
  glaze_pct        numeric,         -- ENTERED
  filling_weight_min numeric,
  filling_weight_max numeric,
  rider_inserted   boolean default false,
  stuffing_temp_c  numeric,
  photo_url        text,
  notes            text,
  created_at       timestamptz default now(),
  created_by_role  text
);

-- ============ Stage 3/5: Packing status per buyer ============
create table if not exists public.packing_status (
  id           uuid primary key default gen_random_uuid(),
  lot_number   text references public.lots(lot_number),
  buyer        text,
  cases_target numeric,
  cases_packed numeric,
  packets      numeric,
  recorded_at  timestamptz default now(),
  created_at   timestamptz default now(),
  created_by_role text
);

-- ============ Production: IQF frozen output (form 144) ============
-- One row per frozen batch, appended through the shift (low-typing, per-batch).
-- The Frozen Output screen sums these per lot for a live progress total.
create table if not exists public.production_output (
  id                uuid primary key default gen_random_uuid(),
  lot_number        text references public.lots(lot_number),
  product           text,
  grade             text,            -- e.g. 11/15
  frozen_count      text,            -- e.g. 15ct (count per kg, kept literal)
  net_weight_kg     numeric,         -- pre-processing / treatment net weight
  gross_weight_kg   numeric,         -- frozen gross weight
  achieved_glaze    numeric,         -- ENTERED glaze %
  target_glaze      numeric,         -- target glaze %
  packing           text,            -- e.g. 1x12
  cases             numeric,         -- no. of cases
  loose_cases       numeric,
  remarks           text,
  entry_mode        text default 'manual',   -- manual | scan | scan_edited
  source_photo_url  text,
  extraction_json   jsonb,
  extraction_confidence jsonb,
  created_at        timestamptz default now(),
  created_by_role   text
);
create index if not exists idx_production_output_lot on public.production_output(lot_number);

-- ============ Captured documents (Phase 1: photo IS the record) ============
-- Each freezing / load / repacking sheet is kept as a photo, tagged by lot,
-- sheet type and the date written on the paper. summary_json /
-- extraction_confidence are reserved for Phase 2 auto-read of the
-- "money numbers" (product · grade · slabs/cases · slab-wt · glaze · kg).
create table if not exists public.documents (
  id                uuid primary key default gen_random_uuid(),
  lot_number        text references public.lots(lot_number),
  sheet_type        text,            -- IQF 144 | Plate/Block | Spiral | Blast/Tuna | Load Report 72 | Repacking 639 | Other
  photo_url         text not null,   -- the kept document = source of truth
  doc_date          date default current_date,  -- date written on the sheet
  remarks           text,
  entry_mode        text default 'photo',
  summary_json      jsonb,           -- Phase 2: read money-numbers
  extraction_confidence jsonb,
  created_at        timestamptz default now(),
  created_by_role   text
);
create index if not exists documents_lot_idx  on public.documents(lot_number);
create index if not exists documents_date_idx on public.documents(doc_date);
create index if not exists documents_type_idx on public.documents(sheet_type);

-- ============ Office: inventory / dispatch / reglaze ledger ============
create table if not exists public.inventory_transactions (
  id           uuid primary key default gen_random_uuid(),
  lot_number   text references public.lots(lot_number),
  txn_type     text,            -- in / dispatch / reglaze
  product      text,
  buyer        text,
  qty_cases    numeric,
  qty_kg       numeric,
  container_no text,
  dispatch_date date,
  notes        text,
  created_at   timestamptz default now(),
  created_by_role text
);

-- ---------- helpful indexes on the lot_number spine ----------
create index if not exists idx_lot_grades_lot          on public.lot_grades(lot_number);
create index if not exists idx_peeling_shed_lot         on public.peeling_shed_reports(lot_number);
create index if not exists idx_shed_receipts_lot        on public.shed_receipts(lot_number);
create index if not exists idx_peeling_output_lot       on public.peeling_output(lot_number);
create index if not exists idx_treatment_logs_lot       on public.treatment_logs(lot_number);
create index if not exists idx_production_plans_lot     on public.production_plans(lot_number);
create index if not exists idx_machine_events_lot       on public.machine_events(lot_number);
create index if not exists idx_temp_logs_lot            on public.temp_logs(lot_number);
create index if not exists idx_oir_samples_lot          on public.online_inspection_samples(lot_number);
create index if not exists idx_qc_logs_lot              on public.qc_logs(lot_number);
create index if not exists idx_packing_status_lot       on public.packing_status(lot_number);
create index if not exists idx_inventory_tx_lot         on public.inventory_transactions(lot_number);

-- =====================================================================
-- RLS — open for v1 (single-org internal tool). Enable + permissive policy.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'lots','lot_grades','peeling_shed_reports','shed_receipts','peeling_output',
    'treatment_logs','production_plans','machine_events','temp_logs',
    'online_inspection_reports','online_inspection_samples','qc_logs',
    'packing_status','inventory_transactions'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_all', t);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true);',
      t||'_all', t);
  end loop;
end $$;

-- =====================================================================
-- STORAGE — public bucket for lot/stage photos
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('protech-photos','protech-photos', true)
on conflict (id) do nothing;

drop policy if exists protech_photos_read   on storage.objects;
drop policy if exists protech_photos_insert on storage.objects;
create policy protech_photos_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'protech-photos');
create policy protech_photos_insert on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'protech-photos');
