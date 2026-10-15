-- Clients and their addresses come from Zoho FSM (Sami, 14 Oct 2026: "If
-- client and address exist on Zoho they should be selectable, and creating a
-- new client and address on the portal should sync to Zoho").
--
-- FSM is where the clients are kept: the Clients page and the quotation's
-- client picker read it directly. The portal keeps its own row only for a
-- client or an address that is actually used, created when one is picked,
-- so quotations, jobs and documents keep pointing at portal records. These
-- columns are that link.
--
-- Live-safe: nullable columns and partial unique indexes. Nothing existing
-- is rewritten, and the portal checks for these columns before using them.

alter table public.snagging_clients
  add column if not exists fsm_contact_id text,
  add column if not exists fsm_company_id text;

-- One portal client per FSM contact.
create unique index if not exists snagging_clients_fsm_contact_id_key
  on public.snagging_clients (fsm_contact_id)
  where fsm_contact_id is not null;

alter table public.snagging_properties
  add column if not exists fsm_address_id text;

-- One portal address per FSM address.
create unique index if not exists snagging_properties_fsm_address_id_key
  on public.snagging_properties (fsm_address_id)
  where fsm_address_id is not null;

comment on column public.snagging_clients.fsm_contact_id is
  'The Zoho FSM contact this client is. Set when the client is created in or picked from FSM.';
comment on column public.snagging_properties.fsm_address_id is
  'The Zoho FSM address (AD-…) this property is. Set when it is picked from FSM or created there.';
