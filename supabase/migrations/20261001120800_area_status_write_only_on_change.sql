-- Area status: write the area only when its derived status changes (F-DB-8).
--
-- The two functions from 20260904100000_restore_area_status_trigger.sql
-- recomputed the area's status and then updated the area row every time,
-- even when the answer was the status it already had. So every snag insert,
-- every snag status or area change, and every delete wrote one more area
-- row (and bumped its updated_at through snagging_areas_touch, which made
-- the job look changed to every device on its next delta). Confirming a
-- room that already had snags wrote the area a second time for nothing.
--
-- The logic is unchanged. Each UPDATE now carries one more condition,
-- `status is distinct from <the new status>`, so it touches no row when
-- the status would stay the same. Only the functions are replaced: the
-- triggers that call them (snagging_snags_refresh_area and
-- snagging_areas_refresh_status), their events and timing stay as they are.
-- Both are AFTER triggers that issue an UPDATE (neither is a BEFORE trigger
-- setting NEW.status), so both functions get the guard.
--
-- Staging check (do not run on production; everything is rolled back).
-- The trigger's own UPDATE count is not shown to the client, so watch the
-- area row instead: every UPDATE that writes it gives it a new ctid, and
-- its xmin becomes this transaction's id. Pick an area that already has a
-- live snag and was last written before this transaction. The inserts
-- list only the columns that matter here; fill the other NOT NULL columns
-- of snagging_snags from an existing snag on the same job ('...').
--
--   begin;
--   select ctid, xmin, status, updated_at from snagging_areas where id = :area;
--   -- 1. A second snag into an area that already has snags: expect UPDATE 0
--   --    for the area, i.e. ctid, xmin and updated_at all unchanged and
--   --    status still has_snags.
--   insert into snagging_snags (id, job_id, area_id, snag_code, status, ...)
--   values (gen_random_uuid(), :job, :area, 'TEST-S999', 'open', ...);
--   select ctid, xmin, status, updated_at from snagging_areas where id = :area;
--   -- 1b. The same without an insert: a status write on an existing live
--   --     snag fires the trigger too (UPDATE OF status), and must also
--   --     leave the area row as it was.
--   update snagging_snags set status = status where id = :live_snag_in_area;
--   select ctid, xmin, status, updated_at from snagging_areas where id = :area;
--   rollback;
--
--   begin;
--   -- 2. First snag into an empty, unconfirmed area: status pending ->
--   --    has_snags, and the row's ctid/xmin change.
--   insert into snagging_snags (id, job_id, area_id, snag_code, status, ...)
--   values (gen_random_uuid(), :job, :empty_area, 'TEST-S998', 'open', ...);
--   select ctid, xmin, status from snagging_areas where id = :empty_area;
--   -- 3. Withdrawing that last live snag: status goes back to pending
--   --    (clear if the area is confirmed).
--   update snagging_snags set status = 'withdrawn' where snag_code = 'TEST-S998';
--   select status from snagging_areas where id = :empty_area;
--   rollback;
--
-- With auto_explain (log_nested_statements = on, log_analyze = on) the
-- first case also logs the nested `Update on snagging_areas` with 0 rows.

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
   where id = v_area_id
     -- Only when it changes: an unchanged status is not written.
     and status is distinct from case
           when v_count > 0 then 'has_snags'
           when confirmed_at is not null then 'clear'
           else 'pending'
         end;

  return null;
end;
$$;

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
   where id = new.id
     -- Only when it changes: an unchanged status is not written.
     and status is distinct from case
           when v_count > 0 then 'has_snags'
           when new.confirmed_at is not null then 'clear'
           else 'pending'
         end;

  return null;
end;
$$;
