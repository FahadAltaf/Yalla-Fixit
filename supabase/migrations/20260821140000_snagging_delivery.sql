-- Client report delivery (K1-K3 / FR-5.04).
--
-- The report itself is generated on the client from the inspection data;
-- these columns record that a coordinator handed it to the client and how.
-- delivered_at already exists on snagging_jobs (set to null at creation),
-- so only the channel and recipient are new.

alter table public.snagging_jobs
  add column if not exists delivery_channel text,
  add column if not exists delivery_recipient text;
