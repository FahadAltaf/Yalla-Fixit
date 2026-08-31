-- Normalise the property record out of the job (BR-1).
--
-- Property attributes lived directly on snagging_jobs, so the same unit
-- across rounds/visits was duplicated and could drift. This introduces a
-- first-class property record: snagging_clients -> snagging_properties ->
-- snagging_jobs. A property belongs to a client; a job references a property.
--
-- The job keeps a small denormalised snapshot (unit_label, building_name,
-- community, property_type, developer_name) used by the list search and the
-- mobile sync wire — the anti-corruption pattern already used elsewhere — so
-- those paths are untouched. The bulk of property data (measurements,
-- location, title deed, NOC) now lives only on the property.

create table if not exists public.snagging_properties (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.snagging_clients(id) on delete set null,
  unit_label text,
  building_name text,
  community text,
  developer_name text,
  property_type text check (property_type in ('apartment', 'villa', 'townhouse', 'commercial')),
  bedrooms integer,
  built_up_area_sqft numeric,
  plot_area_sqft numeric,
  external_areas_in_scope boolean not null default false,
  floors integer,
  location_lat double precision,
  location_lng double precision,
  title_deed_path text,
  noc_required boolean not null default false,
  noc_path text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_snagging_properties_client
  on public.snagging_properties (client_id);
alter table public.snagging_properties enable row level security;

alter table public.snagging_jobs
  add column if not exists property_id uuid references public.snagging_properties(id) on delete set null;
create index if not exists idx_snagging_jobs_property
  on public.snagging_jobs (property_id);

-- Backfill: one property per distinct (client, unit, building, community),
-- taking the earliest job (the original, most complete) as the source. All
-- jobs on that unit — including de-snag rounds and additional visits that
-- only copied the 5 display columns — then point at the one property, which
-- also repairs their previously-missing measurements.
insert into public.snagging_properties
  (client_id, unit_label, building_name, community, developer_name, property_type,
   bedrooms, built_up_area_sqft, plot_area_sqft, external_areas_in_scope, floors,
   location_lat, location_lng, title_deed_path, noc_required, noc_path)
select distinct on (client_id, coalesce(unit_label, ''), coalesce(building_name, ''), coalesce(community, ''))
  client_id, unit_label, building_name, community, developer_name, property_type,
  bedrooms, built_up_area_sqft, plot_area_sqft, coalesce(external_areas_in_scope, false), floors,
  location_lat, location_lng, title_deed_path, coalesce(noc_required, false), noc_path
from public.snagging_jobs
where client_id is not null and unit_label is not null
order by client_id, coalesce(unit_label, ''), coalesce(building_name, ''), coalesce(community, ''), created_at asc;

update public.snagging_jobs j
   set property_id = p.id
  from public.snagging_properties p
 where j.property_id is null
   and j.client_id = p.client_id
   and coalesce(j.unit_label, '') = coalesce(p.unit_label, '')
   and coalesce(j.building_name, '') = coalesce(p.building_name, '')
   and coalesce(j.community, '') = coalesce(p.community, '');
