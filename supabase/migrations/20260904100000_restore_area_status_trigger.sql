-- Restore the derived area status (FR-2.07).
--
-- `snagging_areas.status` is meant to track itself: has_snags when the area
-- holds a live defect, clear when the inspector confirmed it and found
-- nothing, pending otherwise. The trigger that maintained it was defined in
-- the original module migration against `snagging_tasks`, and was lost when
-- that table became `snagging_jobs` out of band.
--
-- The result is that every area in the database reads `pending` -- 30 of
-- them hold live snags and none has ever held any other value -- so an app
-- reading `status` shows "Not started" for an area the inspector has walked,
-- confirmed and raised defects in. Only `started_at` and `confirmed_at` were
-- telling the truth.
--
-- Two gaps are fixed here, not one. The original trigger fired on snag
-- changes only, so confirming an area that legitimately has no defects never
-- moved it off pending either; confirmation now maintains it too.

create or replace function public.snagging_refresh_area_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- NEW is unassigned on DELETE, so it cannot be read unconditionally.
  v_area_id uuid := case when tg_op = 'DELETE' then old.area_id else new.area_id end;
  v_count integer;
begin
  if v_area_id is null then
    return null;
  end if;

  select count(*) into v_count
    from public.snagging_snags
   where area_id = v_area_id
     and status <> 'withdrawn';

  update public.snagging_areas
     set status = case
           when v_count > 0 then 'has_snags'
           when confirmed_at is not null then 'clear'
           else 'pending'
         end
   where id = v_area_id;

  return null;
end;
$$;

drop trigger if exists snagging_snags_refresh_area on public.snagging_snags;
create trigger snagging_snags_refresh_area
after insert or update of status, area_id or delete on public.snagging_snags
for each row execute function public.snagging_refresh_area_status();

-- Confirming an empty area is also a status change, and the snag trigger
-- can never see it. Recomputed from the area's own row.
create or replace function public.snagging_refresh_area_status_self()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.snagging_snags
   where area_id = new.id
     and status <> 'withdrawn';

  -- Sets `status` only. The trigger below fires on confirmed_at, which this
  -- statement does not touch, so it cannot re-enter.
  update public.snagging_areas
     set status = case
           when v_count > 0 then 'has_snags'
           when new.confirmed_at is not null then 'clear'
           else 'pending'
         end
   where id = new.id;

  return null;
end;
$$;

drop trigger if exists snagging_areas_refresh_status on public.snagging_areas;
create trigger snagging_areas_refresh_status
after update of confirmed_at on public.snagging_areas
for each row execute function public.snagging_refresh_area_status_self();

-- Bring every existing area up to date in one pass. Read-modify-write on a
-- derived column only: no inspector-entered data is touched.
update public.snagging_areas a
   set status = case
         when s.live_snags > 0 then 'has_snags'
         when a.confirmed_at is not null then 'clear'
         else 'pending'
       end
  from (
    select a2.id,
           (select count(*)
              from public.snagging_snags sn
             where sn.area_id = a2.id
               and sn.status <> 'withdrawn') as live_snags
      from public.snagging_areas a2
  ) s
 where s.id = a.id
   and a.status is distinct from case
         when s.live_snags > 0 then 'has_snags'
         when a.confirmed_at is not null then 'clear'
         else 'pending'
       end;
