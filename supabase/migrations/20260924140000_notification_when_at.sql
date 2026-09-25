-- Alerts carry the appointment as an instant (2026-09-24).
--
-- An alert's text had its appointment time written into it in Dubai time
-- ("Thu 24 Sep, 6:30 pm"), so an inspector whose phone is on another zone
-- read a time an hour out from the one the job screen showed them. The
-- instant now goes with the alert and the phone words it on its own clock.
-- The text keeps its Dubai wording, for anything that shows it as it is.
--
-- Additive: a nullable column, and the notify helper and its triggers
-- re-created to fill it. Existing alerts are left as they are.

alter table public.snagging_notifications
  add column if not exists when_at timestamptz;

comment on column public.snagging_notifications.when_at is
  'The appointment the alert is about, when it has a time. The phone shows it in its own zone.';

-- One more argument, so the old six-argument form goes first: two versions
-- side by side would make every six-argument call ambiguous.
drop function if exists public.snagging_notify(uuid, uuid, uuid, text, text, text);

create or replace function public.snagging_notify(
  p_user uuid, p_job uuid, p_visit uuid, p_type text, p_title text, p_body text,
  p_when_at timestamptz default null
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
  insert into public.snagging_notifications (user_id, job_id, visit_id, type, title, body, when_at)
  values (p_user, p_job, p_visit, p_type, p_title, p_body, p_when_at);
end;
$$;

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
    public.snagging_job_label(j) || ' · ' || public.snagging_when_label(j.appointment_at, j.scheduled_date),
    j.appointment_at
  );
  return new;
-- An alert that cannot be written must never block the change itself.
exception when others then
  raise warning 'snagging alert not written: %', sqlerrm;
  return new;
end;
$$;

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
        label || ' · ' || public.snagging_when_label(new.appointment_at, new.scheduled_date),
        new.appointment_at
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
        label || ' · now ' || public.snagging_when_label(new.appointment_at, new.scheduled_date),
        new.appointment_at
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
        label || ' · ' || public.snagging_when_label(new.appointment_at, new.scheduled_date::date),
        new.appointment_at
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
        label || ' · now ' || public.snagging_when_label(new.appointment_at, new.scheduled_date::date),
        new.appointment_at
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

-- Alerts already written are left alone: their job may have moved since,
-- and today's time would contradict what the alert said at the time.
