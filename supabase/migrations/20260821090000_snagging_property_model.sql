-- ============================================================
-- Snagging — Property + Client + Assign model rework
-- Action Points D1-D2 (client), E1-E10 (property), I1-I6 (assign),
-- C1-C2 (job detail). Adds the pricing/measurement basis the Quotation
-- engine will need. Idempotent; safe to re-run.
-- ============================================================
begin;

-- 1. Property type -> Apartment / Villa / Townhouse / Commercial (E1).
--    Capture the bedroom count from the old bedroom-based types first (E2).
alter table public.snagging_jobs add column if not exists bedrooms integer;

update public.snagging_jobs
   set bedrooms = case property_type
       when 'studio' then 0 when '1br' then 1 when '2br' then 2
       when '3br' then 3 when '4br' then 4 else bedrooms end
 where property_type in ('studio','1br','2br','3br','4br');

alter table public.snagging_jobs drop constraint if exists snagging_jobs_property_type_check;

update public.snagging_jobs
   set property_type = case
       when property_type in ('studio','1br','2br','3br','4br') then 'apartment'
       when property_type in ('apartment','villa','townhouse','commercial') then property_type
       else 'apartment' end;

alter table public.snagging_jobs
  add constraint snagging_jobs_property_type_check
  check (property_type is null or property_type in ('apartment','villa','townhouse','commercial'));

-- 2. Property measurements and documents (E3-E10).
alter table public.snagging_jobs
  add column if not exists built_up_area_sqft numeric,               -- pricing basis, required by the app (E3)
  add column if not exists plot_area_sqft numeric,                   -- villa/townhouse (E4)
  add column if not exists external_areas_in_scope boolean not null default false, -- villa/townhouse (E4)
  add column if not exists floors integer,                           -- villa (E5)
  add column if not exists location_lat double precision,            -- location pin (E7)
  add column if not exists location_lng double precision,
  add column if not exists title_deed_path text,                     -- storage key, optional (E8)
  add column if not exists noc_required boolean not null default false, -- requester not the owner (E10/I5)
  add column if not exists noc_path text;                            -- storage key, same as authorization letter (E10)

-- 3. Scheduling and site contacts (I2-I4).
alter table public.snagging_jobs
  add column if not exists appointment_at timestamptz,               -- date + time (I2)
  add column if not exists developer_contact_name text,              -- who opens the door (I3)
  add column if not exists developer_contact_phone text,
  add column if not exists client_contact_name text,                 -- client or their agent (I4)
  add column if not exists client_contact_phone text;

commit;
