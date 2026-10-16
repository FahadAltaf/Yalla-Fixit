-- Office notes on a snagging quotation (UAT SNG-022).
--
-- The New quotation form has an Office notes box, but a quotation had no
-- column to keep it in, so the note was dropped on save and never reached
-- the job raised from the quotation or the inspector's phone. The job
-- already has its own `notes`; this gives the quotation one, and the job
-- copies it when it is created from the quotation.
--
-- Live-safe: one nullable column, no default, no rewrite. The portal checks
-- for the column before reading or writing it, so the code can deploy
-- before this is applied.

alter table public.snagging_quotations
  add column if not exists notes text;

comment on column public.snagging_quotations.notes is
  'Office notes typed on the quotation form; copied to the job raised from it.';
