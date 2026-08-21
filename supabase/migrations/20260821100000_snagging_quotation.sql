-- ============================================================
-- Snagging — Quotation engine (Action Points F1-F13)
-- Pricing config (admin only), scope + terms, and per-job quotations.
-- ============================================================
begin;

-- 1. Pricing config — a single admin-editable row (F7, F8).
create table if not exists public.snagging_pricing_config (
  id boolean primary key default true,
  currency text not null default 'AED',
  rate_per_sqft numeric not null default 0,           -- built-up area rate
  external_rate_per_sqft numeric not null default 0,  -- external area (plot - BUA), F12
  multipliers jsonb not null default '{"apartment":1,"villa":1.25,"townhouse":1.15,"commercial":1.5}'::jsonb,
  tax_rate numeric not null default 5,                -- VAT %
  desnag_price numeric not null default 0,            -- per de-snag round, F13
  additional_visit_price numeric not null default 0,  -- per additional visit, F13
  scope_of_work text,                                 -- F4/F9
  terms text,                                         -- F4/F9
  updated_by uuid references public.user_profile(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint snagging_pricing_singleton check (id)
);

insert into public.snagging_pricing_config (id) values (true) on conflict (id) do nothing;

-- 2. Change log for the pricing formula, scope and terms (F10).
create table if not exists public.snagging_pricing_config_log (
  id bigserial primary key,
  changed_by uuid references public.user_profile(id) on delete set null,
  changes jsonb,
  created_at timestamptz not null default now()
);

-- 3. Quotations — one active quote per job, priced from the property (F1-F6).
create table if not exists public.snagging_quotations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.snagging_jobs(id) on delete cascade,
  quote_number text not null unique,
  status text not null default 'draft' check (status in ('draft','sent','approved','rejected')),
  currency text not null default 'AED',
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  tax_rate numeric not null default 5,
  tax_amount numeric not null default 0,
  total numeric not null default 0,
  scope_of_work text,
  terms text,
  lines jsonb not null default '[]'::jsonb,           -- snapshot of the priced lines
  sent_at timestamptz,
  sent_to text,
  approved_at timestamptz,
  rejected_reason text,
  created_by uuid references public.user_profile(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_snag_quotations_job on public.snagging_quotations (job_id, created_at desc);

-- 4. RLS: written through the service-role API; expose config read to any
--    authenticated user so the admin form can load it.
alter table public.snagging_pricing_config enable row level security;
alter table public.snagging_pricing_config_log enable row level security;
alter table public.snagging_quotations enable row level security;
create policy snag_pricing_read on public.snagging_pricing_config for select to authenticated using (true);

commit;
