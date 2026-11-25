-- DEV-495 (24 Nov 2026): free handyman hours counted in team-hours.
--
-- A handyman job is a call out booked against the contract's hours
-- allowance, with the number of teams sent (a team is one technician and one
-- helper; two teams for one hour count as two hours). When the call out is
-- closed the coordinator records the hours used, rounded to the nearest
-- whole hour; they come off the allowance, and any hours beyond what was
-- left are chargeable.
--
-- Live-safe: three nullable columns, no data changed. Until it is applied a
-- call out cannot be booked as a handyman job; everything else is as before.

alter table public.amc_call_outs
  add column if not exists handyman_teams smallint check (handyman_teams between 1 and 10),
  add column if not exists hours_used numeric(7,2) check (hours_used >= 0),
  add column if not exists hours_chargeable numeric(7,2) check (hours_chargeable >= 0);

comment on column public.amc_call_outs.handyman_teams is
  'DEV-495: a handyman job against the hours allowance, and how many teams (one technician and one helper each) were sent. Null: an ordinary call out.';
comment on column public.amc_call_outs.hours_used is
  'DEV-495: team-hours the coordinator recorded at closing, rounded to the nearest whole hour.';
comment on column public.amc_call_outs.hours_chargeable is
  'DEV-495: the part of hours_used beyond the allowance left, which the client pays.';

notify pgrst, 'reload schema';
