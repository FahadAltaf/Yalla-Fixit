-- The client's Maher ID (Sami, 15 Oct 2026: "it should be an input field").
-- Zoho FSM requires it on every contact (Maher_Id__C), so the portal asks
-- for it when a client is added and keeps a copy, as it does the name,
-- email and phone, sent to FSM on create and edit.
--
-- Live-safe: one nullable column; nothing existing is rewritten.

alter table public.snagging_clients
  add column if not exists maher_id text;

comment on column public.snagging_clients.maher_id is
  'The client''s Maher ID, kept in Zoho FSM as Maher_Id__C (required there on a new contact).';
