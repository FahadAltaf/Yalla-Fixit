-- Area pins on floor plans (FR-3.05 / FR-3.07).
--
-- An area (room) can be located on a floor plan by a pin: floor_plan_id names
-- the plan and pin_x / pin_y are 0..1 fractions of it, so the marker survives
-- any zoom or display size. This realises the
--   Floor -> Floor Plan -> Pin -> Area
-- chain WITHOUT a new table — the pin lives on the area it represents, reusing
-- the existing snagging_areas / snagging_floor_plans structures. Existing areas
-- keep NULLs (no pin yet), so no current area or floor-plan data is lost.

alter table public.snagging_areas
  add column if not exists floor_plan_id uuid references public.snagging_floor_plans(id) on delete set null,
  add column if not exists pin_x real,
  add column if not exists pin_y real;

do $$
begin
  -- Coordinates, when present, are 0..1 fractions of the plan.
  if not exists (select 1 from pg_constraint where conname = 'snagging_areas_pin_range') then
    alter table public.snagging_areas
      add constraint snagging_areas_pin_range
      check (
        (pin_x is null or (pin_x >= 0 and pin_x <= 1)) and
        (pin_y is null or (pin_y >= 0 and pin_y <= 1))
      );
  end if;
  -- A pin is either fully placed (both coords + a plan) or not placed at all.
  if not exists (select 1 from pg_constraint where conname = 'snagging_areas_pin_complete') then
    alter table public.snagging_areas
      add constraint snagging_areas_pin_complete
      check ((pin_x is null) = (pin_y is null));
  end if;
end $$;

create index if not exists idx_snagging_areas_floor_plan
  on public.snagging_areas (floor_plan_id);
