-- Where to send an alert when the app is not open.
--
-- The alerts themselves already work: triggers write a row into
-- snagging_notifications whenever a job is assigned, sent back,
-- rescheduled or approved, or a visit is booked, rescheduled or sent
-- back, and Supabase Realtime carries it to the phone.
--
-- Realtime only reaches an app that is running. An inspector whose phone
-- is in their pocket learns about a job reassigned at 7am when they next
-- open the app, which may be after they have driven to the wrong tower.
-- A push notification is the part that reaches them.
--
-- This table is only the addresses. One row per device, because an
-- inspector may carry a phone and a tablet, and both should buzz.

create table if not exists public.snagging_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profile(id) on delete cascade,
  /*
    An Expo push token ("ExponentPushToken[...]"), which Expo's service
    resolves to APNs or FCM. Unique on its own: a device that is handed
    to another inspector keeps the token and must move with it, not end
    up delivering one person's jobs to another.
  */
  token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  /*
    Touched on every sign-in. A token nothing has refreshed in months
    belongs to a device that is gone, and Expo will reject it anyway.
  */
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.snagging_push_tokens is
  'Devices to push snagging alerts to. One row per device, not per inspector.';

create index if not exists idx_push_tokens_user
  on public.snagging_push_tokens (user_id);

-- ── Who may read and write it ────────────────────────────────────────
--
-- An inspector registers and removes their own device and sees nothing
-- else. The sender runs with the service role, which bypasses this.
alter table public.snagging_push_tokens enable row level security;

drop policy if exists "own push tokens" on public.snagging_push_tokens;
create policy "own push tokens"
  on public.snagging_push_tokens
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
