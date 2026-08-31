-- Quotation + Pricing completion (FR-2.01 to FR-2.08).
--
-- 1) Sensible default pricing so a fresh environment never starts at zero.
--    rate_per_sqft = 1 AED/sqft, so a 1000 sqft apartment prices to
--    AED 1,000 + 5% VAT = AED 1,050 — matching the approved sample.
-- 2) Default Scope of Work + Terms (generalised from the sample, no
--    customer-specific data), editable by admins and snapshotted per quote.
-- 3) Snapshot + client-approval columns on snagging_quotations so an issued
--    quotation is fully reproducible and later config changes never alter it.

-- Ensure the singleton config row exists (fresh environments).
insert into public.snagging_pricing_config (id, currency, multipliers, tax_rate)
values (true, 'AED', '{"apartment":1,"villa":1.25,"townhouse":1.15,"commercial":1.5}'::jsonb, 5)
on conflict (id) do nothing;

-- Seed sensible defaults only where a value is still zero/empty.
update public.snagging_pricing_config set
  rate_per_sqft = case when coalesce(rate_per_sqft, 0) = 0 then 1 else rate_per_sqft end,
  external_rate_per_sqft = case when coalesce(external_rate_per_sqft, 0) = 0 then 0.5 else external_rate_per_sqft end,
  desnag_price = case when coalesce(desnag_price, 0) = 0 then 475 else desnag_price end,
  additional_visit_price = case when coalesce(additional_visit_price, 0) = 0 then 500 else additional_visit_price end,
  tax_rate = case when coalesce(tax_rate, 0) = 0 then 5 else tax_rate end,
  multipliers = coalesce(multipliers, '{"apartment":1,"villa":1.25,"townhouse":1.15,"commercial":1.5}'::jsonb),
  scope_of_work = coalesce(scope_of_work, $scope$Residential property handover snagging inspection and report, including but not limited to:
- Mechanical, electrical and plumbing (MEP).
- Air-conditioning including AC unit, thermostat, ducting, diffusers and design air flow.
- Lighting and power systems including all sockets, switches, controls and flex-outs.
- Plumbing including taps, pumps, water heaters and toilet flush mechanism.
- Carpentry: doors, windows and sliding doors; cabinets, locks and hinges; balcony and staircase.
- Civil and structural.
- Painting (wall and ceiling).
- Tiling (floor and wall) and grouting.
- Sloping in bathroom floors and sealant work.
- Internal and external (if applicable) wall conditions.$scope$),
  terms = coalesce(terms, $terms$1. This quotation is valid for 30 calendar days and is specifically limited to the scope of work and terms & conditions.
2. Payment terms: 100% upfront from approval.
3. All access pass / entry permit to be provided by the client ahead of the inspection schedule.
4. All communication and scheduling with the developer and/or main contractor to be done by the client.
5. Authority approval / NOC to be provided by the client (if applicable).
6. The scope of work is carried out during YFI standard working hours (9:00 am to 5:00 pm), excluding weekends and public holidays. If service is required during non-working hours, a 40% additional fee applies on the total cost of the service.
7. Yalla Fix It highlights in detail every possible minor and major defect in quality, imperfections and omissions, as well as general building flaws. Evaluation of electromechanical aspects is based on the approved design performance (approved design details to be provided by the client).
8. Yalla Fix It is not involved/responsible in the civil and electromechanical design of the property. Inspection and snagging is done as per the approved drawings; any fundamental architectural and/or MEP design issue is to be followed up directly by the client with the developer and consultant.
9. Any kind of rectification work is not included in this proposal; if required, it will be quoted separately.
10. Duration of the work: 1 working day (one schedule) for inspection and 3 working days for report preparation.
11. The YFI handover snagging report is shared with the customer in soft copy.
12. Connection of electricity, water and a functional air-conditioning system is mandatory during the handover inspection. If a second schedule is required due to disconnection of services, an additional fixed charge of AED 500 + VAT applies for each visit per property.$terms$)
where id = true;

-- Snapshot + approval columns on the quotation.
alter table public.snagging_quotations
  add column if not exists property_snapshot jsonb,
  add column if not exists pricing_snapshot jsonb,
  add column if not exists approved_by_name text,
  add column if not exists approved_by_contact text,
  add column if not exists decided_at timestamptz,
  add column if not exists email_message_id text,
  add column if not exists approval_token_hash text,
  add column if not exists approval_token_expires_at timestamptz;

create index if not exists idx_snagging_quotations_token
  on public.snagging_quotations (approval_token_hash);
