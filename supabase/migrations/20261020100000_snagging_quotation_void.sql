-- A quotation made void because the property is not as quoted (UAT SNG-100).
--
-- The inspector flags on site that the unit's furnishing differs from what
-- the quotation was priced on (quoted unfurnished, found furnished). The
-- quotation is then void until a revised one is approved: the office is
-- told, the job cannot be approved, and "Raise revised quotation" makes the
-- new one, which this links back to.
--
-- The status values stay as they are ('draft','sent','approved','rejected'):
-- a void quotation is still the one the client approved; void is a fact
-- recorded beside it, so the CHECK constraint is not touched.
--
-- Live-safe: four nullable columns, no default, no rewrite, no policy
-- change, plus a partial index. The portal checks for voided_at before
-- reading or writing any of them, so the code can deploy before this is
-- applied, and the live site ignores them until it does.

alter table public.snagging_quotations
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists voided_by uuid references public.user_profile(id) on delete set null,
  add column if not exists replaced_by_quotation_id uuid references public.snagging_quotations(id) on delete set null;

comment on column public.snagging_quotations.voided_at is
  'When the quotation became void: the inspector found the property not as quoted (SNG-100).';
comment on column public.snagging_quotations.void_reason is
  'Why it is void, as recorded from the inspector''s flag (e.g. quoted unfurnished, found furnished).';
comment on column public.snagging_quotations.voided_by is
  'The inspector whose flag made it void.';
comment on column public.snagging_quotations.replaced_by_quotation_id is
  'The revised quotation raised in its place.';

-- The Needs attention card and the job page look for void quotations still waiting on a revision.
create index if not exists idx_snagging_quotations_voided
  on public.snagging_quotations (voided_at)
  where voided_at is not null;

-- Post-check:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'snagging_quotations'
--     and column_name in ('voided_at','void_reason','voided_by','replaced_by_quotation_id');
--   -- expect 4 rows
