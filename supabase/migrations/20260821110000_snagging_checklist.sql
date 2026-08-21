-- ============================================================
-- Snagging — Inspection Checklist (Action Points N1-N6, FR-4.13, BR-12)
-- A 47-check library seeded from the YFI website checklist, plus the
-- per-job checklist generated from the property type. Applicability,
-- mandatory flags and catalogue links carry sensible defaults; Operations
-- refine them (P2) via the checklist admin.
-- ============================================================
begin;

-- 1. Checklist library ----------------------------------------------------
create table if not exists public.snagging_checklist_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  group_name text not null,
  label text not null,
  applies_apartment boolean not null default true,
  applies_villa boolean not null default true,
  applies_townhouse boolean not null default true,
  applies_commercial boolean not null default true,
  mandatory boolean not null default true,
  linked_catalogue_codes text[] not null default '{}',
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

-- 2. Per-job checklist ----------------------------------------------------
create table if not exists public.snagging_job_checklist (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.snagging_jobs(id) on delete cascade,
  checklist_item_id uuid references public.snagging_checklist_items(id) on delete set null,
  code text not null,
  group_name text not null,
  label text not null,
  mandatory boolean not null default true,
  status text not null default 'pending' check (status in ('pending','passed','failed','not_checked')),
  reason text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint snag_job_checklist_unique unique (job_id, code)
);
create index if not exists idx_snag_job_checklist_job on public.snagging_job_checklist (job_id, sort_order);

-- 3. RLS ------------------------------------------------------------------
alter table public.snagging_checklist_items enable row level security;
alter table public.snagging_job_checklist enable row level security;
create policy snag_checklist_read on public.snagging_checklist_items for select to authenticated using (true);

-- 4. Seed the 47 checks (defaults: drainage/external not shown for
--    apartments; everything else applies to all four; all mandatory).
insert into public.snagging_checklist_items
  (code, group_name, label, applies_apartment, applies_villa, applies_townhouse, applies_commercial, mandatory, sort_order)
select v.code, v.grp, v.label,
       case when v.grp = 'Drainage and external' then false else true end,
       true, true, true, true, v.ord
from (values
  ('CHK-001','Structure and masonry','Wall levels within tolerances',10),
  ('CHK-002','Structure and masonry','Plaster-boarding and joints',20),
  ('CHK-003','Structure and masonry','Large cracks and overuse of fillers',30),
  ('CHK-004','Structure and masonry','Smoothness, finish line and grouting',40),
  ('CHK-005','Structure and masonry','Bricks, mortar and masonry',50),
  ('CHK-006','Structure and masonry','Brick perpends verticals for square',60),
  ('CHK-007','Structure and masonry','Stone sills damage',70),
  ('CHK-008','Electrical','Circuit protection devices',80),
  ('CHK-009','Electrical','Earthing arrangements',90),
  ('CHK-010','Electrical','Socket polarity',100),
  ('CHK-011','Electrical','Zoning compliance',110),
  ('CHK-012','Drainage and external','Drainage and water run-off',120),
  ('CHK-013','Drainage and external','Manhole location',130),
  ('CHK-014','Drainage and external','Damp course position or breach',140),
  ('CHK-015','Drainage and external','Driveway, paths and patio surfaces',150),
  ('CHK-016','Plumbing and heating','Boiler flue inspection',160),
  ('CHK-017','Plumbing and heating','Radiators and heating pipework',170),
  ('CHK-018','Plumbing and heating','Hot and cold mains pipework',180),
  ('CHK-019','Plumbing and heating','Bath and shower room installation',190),
  ('CHK-020','Windows and doors','Scratched glass and faulty seals',200),
  ('CHK-021','Windows and doors','Misaligned windows and doors',210),
  ('CHK-022','Windows and doors','Fire escape window suitability',220),
  ('CHK-023','Windows and doors','Window trickle vent effectiveness',230),
  ('CHK-024','Ventilation and AC','Cooker extractor flow rates',240),
  ('CHK-025','Ventilation and AC','Bathroom extractor flow rates',250),
  ('CHK-026','Ventilation and AC','All bathroom overrun times',260),
  ('CHK-027','Ventilation and AC','AC temperature and airflow',270),
  ('CHK-028','Painting and decoration','Drips, runs and brush marks',280),
  ('CHK-029','Painting and decoration','Missing and thin painted areas',290),
  ('CHK-030','Painting and decoration','Overpainting switches and brassware',300),
  ('CHK-031','Painting and decoration','General poor painting craftsmanship',310),
  ('CHK-032','Joinery and stairs','Skirting and architrave joinery',320),
  ('CHK-033','Joinery and stairs','Hinge and handle fitment',330),
  ('CHK-034','Joinery and stairs','Handrail, newel and baluster',340),
  ('CHK-035','Joinery and stairs','Tread and riser conformity',350),
  ('CHK-036','Kitchen and fittings','Worktops and surfaces',360),
  ('CHK-037','Kitchen and fittings','Brown and white goods',370),
  ('CHK-038','Kitchen and fittings','Cupboard and door alignment',380),
  ('CHK-039','Kitchen and fittings','Sanitary-ware, shower and screens',390),
  ('CHK-040','Levels and alignment','Wall, ceiling and floor levels',400),
  ('CHK-041','Levels and alignment','Wall and floor tile levels',410),
  ('CHK-042','Levels and alignment','Window and door levels',420),
  ('CHK-043','Levels and alignment','Not square to eye levels',430),
  ('CHK-044','Floor finishes','Vinyl floor damage and fitment',440),
  ('CHK-045','Floor finishes','Carpet stains, damage and fitment',450),
  ('CHK-046','Floor finishes','Wood and laminate marks and fitment',460),
  ('CHK-047','Floor finishes','Floor tiles damage and fitment',470)
) as v(code, grp, label, ord)
on conflict (code) do nothing;

commit;
