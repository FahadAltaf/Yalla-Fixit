-- Zones drawn around rooms, instead of a single pin (BA change 6, FR-3.05).
--
-- A pin names an area but not its edges, so on site the app still has to
-- ask the inspector which room they are standing in. A zone is the outline
-- drawn around the room, which lets a tap inside it open that area
-- directly, so the question disappears.
--
-- Additive and nullable on purpose. Every job created so far carries pins
-- and no zones, and there is no way to derive edges from a point, so the
-- pin cannot be migrated into a zone. The two have to coexist for the life
-- of those jobs: the app reads the zone when it is there and falls back to
-- the pin when it is not.

alter table public.snagging_areas
  add column if not exists zone jsonb;

comment on column public.snagging_areas.zone is
  'Outline of the area on floor_plan_id: [{"x":0..1,"y":0..1}, ...], at least 3 points, fractions of the plan image. Null = pin only.';

/*
  Shape is enforced in the database, not only in the API.

  A malformed polygon reaches the inspector through the sync payload, and
  a handset half way through an inspection with no signal has no way to
  recover from one. A check constraint cannot contain a subquery, so the
  rule lives in an immutable function the constraint calls.
*/
create or replace function public.snagging_zone_is_valid(z jsonb)
returns boolean
language sql
immutable
as $$
  select
    z is null
    or (
      jsonb_typeof(z) = 'array'
      and jsonb_array_length(z) >= 3
      and (
        select bool_and(
          /*
            coalesce, because an aggregate SKIPS null inputs rather than
            failing on them. A point with no `x` at all makes
            `jsonb_typeof(pt -> 'x')` null, so the whole conjunction is
            null, so bool_and quietly ignores that point and the malformed
            outline passes — which is the one case this constraint exists
            to catch. Forcing null to false makes a missing key a failure.
          */
          coalesce(
            jsonb_typeof(pt) = 'object'
            and jsonb_typeof(pt -> 'x') = 'number'
            and jsonb_typeof(pt -> 'y') = 'number'
            and (pt ->> 'x')::numeric between 0 and 1
            and (pt ->> 'y')::numeric between 0 and 1,
            false
          )
        )
        from jsonb_array_elements(z) as pt
      )
    );
$$;

alter table public.snagging_areas
  drop constraint if exists snagging_areas_zone_shape;

alter table public.snagging_areas
  add constraint snagging_areas_zone_shape
  check (public.snagging_zone_is_valid(zone));

/*
  A zone belongs to a plan, the same way a pin does. Without this an area
  could carry an outline with nothing to draw it on, which the app would
  have to silently drop.
*/
alter table public.snagging_areas
  drop constraint if exists snagging_areas_zone_needs_plan;

alter table public.snagging_areas
  add constraint snagging_areas_zone_needs_plan
  check (zone is null or floor_plan_id is not null);
