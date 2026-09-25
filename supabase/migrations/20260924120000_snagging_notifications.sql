-- Inspector alerts (2026-09-24).
--
-- The app's Alerts tab was rebuilt on the phone from whatever jobs had
-- synced: nothing was stored, so read/unread lived only until the app
-- restarted, there was no unread count to badge, and nothing arrived until
-- the next pull. This stores each alert per inspector and publishes it over
-- Supabase Realtime, so the phone hears about it the moment it happens.
--
-- Written by triggers rather than by the portal routes, so every way a job
-- changes (assign, reject, reschedule, visit booked or sent back, approve)
-- produces its alert without each route having to remember to.
--
-- Additive only: a new table, its policies, trigger functions, and the
-- table added to the realtime publication. No existing row is changed.

create table if not exists public.snagging_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profile (id) on delete cascade,
  job_id uuid references public.snagging_jobs (id) on delete cascade,
  visit_id uuid references public.snagging_job_visits (id) on delete cascade,
  type text not null check (type in (
    'assigned', 'rejected', 'rescheduled', 'approved',
    'visit_booked', 'visit_sent_back', 'visit_rescheduled'
  )),
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

comment on table public.snagging_notifications is
  'In-app alerts for inspectors, written by triggers on jobs, rosters and visits.';

create index if not exists snagging_notifications_user_idx
  on public.snagging_notifications (user_id, created_at desc);
create index if not exists snagging_notifications_unread_idx
  on public.snagging_notifications (user_id) where read_at is null;
create index if not exists snagging_notifications_job_idx
  on public.snagging_notifications (job_id);

-- An inspector reads their own alerts (this is also what Realtime checks
-- before delivering a row). Writes go through the service role only.
alter table public.snagging_notifications enable row level security;

drop policy if exists snagging_notifications_select_own on public.snagging_notifications;
create policy snagging_notifications_select_own
  on public.snagging_notifications for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The unit as an inspector knows it: "Unit 72 E, Burj Tower", else the code.
create or replace function public.snagging_job_label(p_job public.snagging_jobs)
returns text
language sql
stable
as $$
  select coalesce(
    nullif(concat_ws(', ', nullif(trim(p_job.unit_label), ''), nullif(trim(p_job.building_name), '')), ''),
    p_job.code,
    'A job'
  );
$$;

-- When, in Dubai time: "Thu 3 Sep, 3:30 pm", or the day alone.
create or replace function public.snagging_when_label(p_at timestamptz, p_day date)
returns text
language sql
stable
as $$
  select case
    when p_at is not null then
      to_char(p_at at time zone 'Asia/Dubai', 'Dy FMDD Mon, FMHH12:MI ') ||
      lower(to_char(p_at at time zone 'Asia/Dubai', 'am'))
    when p_day is not null then to_char(p_day, 'Dy FMDD Mon')
    else 'no date set'
  end;
$$;

-- Everyone on a job: the roster, plus the job's own inspector_id.
create or replace function public.snagging_job_recipients(p_job_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select inspector_id from public.snagging_job_inspectors where job_id = p_job_id
  union
  select inspector_id from public.snagging_jobs where id = p_job_id and inspector_id is not null;
$$;

-- Writes one alert. An inspector is told they were assigned to a job once:
-- the portal saves the roster by deleting and re-inserting it, which would
-- otherwise re-announce the job on every edit.
create or replace function public.snagging_notify(
  p_user uuid, p_job uuid, p_visit uuid, p_type text, p_title text, p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then
    return;
  end if;
  if p_type = 'assigned' and exists (
    select 1 from public.snagging_notifications
     where user_id = p_user and job_id = p_job and type = 'assigned'
  ) then
    return;
  end if;
  -- The same event twice within a minute (a double save) is one alert.
  if exists (
    select 1 from public.snagging_notifications
     where user_id = p_user
       and job_id is not distinct from p_job
       and visit_id is not distinct from p_visit
       and type = p_type
       and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;
  insert into public.snagging_notifications (user_id, job_id, visit_id, type, title, body)
  values (p_user, p_job, p_visit, p_type, p_title, p_body);
end;
$$;

-- ---------------------------------------------------------------------------
-- Roster: an inspector added to a live job
-- ---------------------------------------------------------------------------

create or replace function public.snagging_notify_roster_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.snagging_jobs;
begin
  select * into j from public.snagging_jobs where id = new.job_id;
  -- A draft is not the inspector's yet; they hear when it goes live.
  if j.id is null or j.status not in ('assigned', 'in_progress') then
    return new;
  end if;
  perform public.snagging_notify(
    new.inspector_id, j.id, null, 'assigned',
    case
      when j.visit_type = 'desnag' or j.parent_job_id is not null then 'De-snag round assigned'
      else 'New job assigned'
    end,
    public.snagging_job_label(j) || ' · ' || public.snagging_when_label(j.appointment_at, j.scheduled_date)
  );
  return new;
-- An alert that cannot be written must never block the change itself.
exception when others then
  raise warning 'snagging alert not written: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists snagging_notify_roster_insert on public.snagging_job_inspectors;
create trigger snagging_notify_roster_insert
  after insert on public.snagging_job_inspectors
  for each row execute function public.snagging_notify_roster_insert();

-- ---------------------------------------------------------------------------
-- Jobs: goes live, sent back, rescheduled, approved
-- ---------------------------------------------------------------------------

create or replace function public.snagging_notify_job_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who uuid;
  label text := public.snagging_job_label(new);
  live boolean := new.status in ('assigned', 'in_progress', 'rejected');
begin
  -- Goes live (draft to assigned), or a new lead inspector on a live job.
  if (new.status = 'assigned' and old.status is distinct from 'assigned' and old.status = 'draft')
     or (live and new.inspector_id is not null and new.inspector_id is distinct from old.inspector_id) then
    for who in select public.snagging_job_recipients(new.id) loop
      perform public.snagging_notify(
        who, new.id, null, 'assigned',
        case
          when new.visit_type = 'desnag' or new.parent_job_id is not null then 'De-snag round assigned'
          else 'New job assigned'
        end,
        label || ' · ' || public.snagging_when_label(new.appointment_at, new.scheduled_date)
      );
    end loop;
  end if;

  -- Sent back by the reviewer.
  if new.status = 'rejected' and old.status is distinct from 'rejected' then
    for who in select public.snagging_job_recipients(new.id) loop
      perform public.snagging_notify(
        who, new.id, null, 'rejected',
        'Inspection sent back',
        label || coalesce(': ' || nullif(trim(new.rejection_reason), ''), ' needs changes before it can be approved.')
      );
    end loop;
  end if;

  -- Approved.
  if new.status = 'approved' and old.status is distinct from 'approved' then
    for who in select public.snagging_job_recipients(new.id) loop
      perform public.snagging_notify(
        who, new.id, null, 'approved',
        'Inspection approved',
        label || ' was approved.'
      );
    end loop;
  end if;

  -- Moved: a new day or time on a job that already had one.
  if live
     and (old.scheduled_date is not null or old.appointment_at is not null)
     and (new.scheduled_date is distinct from old.scheduled_date
          or new.appointment_at is distinct from old.appointment_at) then
    for who in select public.snagging_job_recipients(new.id) loop
      perform public.snagging_notify(
        who, new.id, null, 'rescheduled',
        'Inspection rescheduled',
        label || ' · now ' || public.snagging_when_label(new.appointment_at, new.scheduled_date)
      );
    end loop;
  end if;

  return new;
-- An alert that cannot be written must never block the change itself.
exception when others then
  raise warning 'snagging alert not written: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists snagging_notify_job_update on public.snagging_jobs;
create trigger snagging_notify_job_update
  after update on public.snagging_jobs
  for each row execute function public.snagging_notify_job_update();

-- ---------------------------------------------------------------------------
-- Return visits: booked, sent back, rescheduled
-- ---------------------------------------------------------------------------

create or replace function public.snagging_notify_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.snagging_jobs;
  who uuid;
  label text;
  recipients uuid[];
begin
  select * into j from public.snagging_jobs where id = new.job_id;
  if j.id is null then
    return new;
  end if;
  label := public.snagging_job_label(j) || ' · visit ' || new.visit_number;
  -- The visit's own inspector when it has one, else everyone on the job.
  recipients := case
    when new.inspector_id is not null then array[new.inspector_id]
    else array(select public.snagging_job_recipients(j.id))
  end;

  if tg_op = 'INSERT' then
    foreach who in array recipients loop
      perform public.snagging_notify(
        who, j.id, new.id, 'visit_booked',
        'Return visit booked',
        label || ' · ' || public.snagging_when_label(new.appointment_at, new.scheduled_date::date)
      );
    end loop;
    return new;
  end if;

  -- Sent back by the reviewer (submitted, back to in progress, with a note).
  if old.status = 'submitted' and new.status = 'in_progress' then
    foreach who in array recipients loop
      perform public.snagging_notify(
        who, j.id, new.id, 'visit_sent_back',
        'Visit sent back',
        label || coalesce(': ' || nullif(trim(new.review_note), ''), ' needs changes.')
      );
    end loop;
  end if;

  if new.status not in ('submitted', 'completed')
     and (old.scheduled_date is not null or old.appointment_at is not null)
     and (new.scheduled_date is distinct from old.scheduled_date
          or new.appointment_at is distinct from old.appointment_at) then
    foreach who in array recipients loop
      perform public.snagging_notify(
        who, j.id, new.id, 'visit_rescheduled',
        'Visit rescheduled',
        label || ' · now ' || public.snagging_when_label(new.appointment_at, new.scheduled_date::date)
      );
    end loop;
  end if;

  return new;
-- An alert that cannot be written must never block the change itself.
exception when others then
  raise warning 'snagging alert not written: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists snagging_notify_visit on public.snagging_job_visits;
create trigger snagging_notify_visit
  after insert or update on public.snagging_job_visits
  for each row execute function public.snagging_notify_visit();

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'snagging_notifications'
  ) then
    alter publication supabase_realtime add table public.snagging_notifications;
  end if;
end;
$$;
