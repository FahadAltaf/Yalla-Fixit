# AMC BRD v0.3 Gap Analysis

**Source of truth:** *AMC Generation and Tracking BRD*, Draft v0.3, 23 September 2026 (Sami Farah / Sharon Benedict Varghese).
**Audited:** branch `amc-hardening` at `926cb24`, 6 October 2026. **Re-audited** line by line on 13 October 2026, after Phases 0–13 and the Phase 14 completion sweep (working tree), against the code, migrations, API, screens and tests. Rows, IDs and wording are unchanged; Status, Evidence, Missing, Blocker and Next are current.
**Status:** this file is the authoritative AMC implementation checklist. It supersedes the requirement matrix and percentages in `docs/amc-master-status-report.md` §4, which measured the older proposals FRD, not this BRD.

## How to read this

**Rule.** A requirement is IMPLEMENTED only when the end-to-end behaviour the BRD describes exists: data, server logic and, where a person does it, a screen. These do not count as implemented on their own:
- a table or column;
- a settings field;
- a placeholder;
- a manual workaround;
- part of the workflow.

**Production caveat.** Every AMC migration after `20261005100000` is **not applied to production**, including contracts, entitlements, customers, assessments, notifications and the signed archive. "IMPLEMENTED" below therefore means implemented on the branch, not live.

**Status values**

| Written as | Status |
|---|---|
| IMPLEMENTED | IMPLEMENTED |
| PARTIAL | PARTIALLY IMPLEMENTED: the row says what exists and what is missing |
| NOT IMPLEMENTED | NOT IMPLEMENTED |
| BIZ BLOCKED | BLOCKED BY BUSINESS DECISION. Used only when everything else is built and only the BRD's "to confirm" point is open. None qualify today: every "to confirm" point sits on top of machinery that is not built yet |
| EXT BLOCKED | BLOCKED BY EXTERNAL SYSTEM |
| FSM | OUT OF SCOPE / ALREADY PROVIDED BY FSM (Zoho FSM mobile app or FSM records; any AMC-specific FSM configuration still needed is noted) |

**Columns:**
- **Evidence:** where it is, or what was searched for.
- **Missing:** what is not there.
- **Blocker:** a business decision ("BRD: to confirm") or an external system.
- **Next:** the roadmap goal (§ Roadmap) that closes it.

**Path short forms:**
- `M/` = `supabase/migrations/`
- `X/` = `components/dashboard/extensions/`
- `api/` = `app/api/`

## Results

### Detailed requirements (542 audited, re-audited 13 October 2026)

| Status | Count |
|---|---|
| IMPLEMENTED | **495** |
| PARTIALLY IMPLEMENTED | **0** |
| NOT IMPLEMENTED | **0** |
| BLOCKED BY BUSINESS DECISION | **8** |
| BLOCKED BY EXTERNAL SYSTEM | **23** |
| OUT OF SCOPE / ALREADY PROVIDED BY FSM | **16** |

- **Strict detailed completion: 495 of 526 in-scope requirements = 94.1%.** The 16 FSM-provided items are excluded from the denominator.
- **Excluding what is deferred** (23 waiting on an external system for Phase 15, 8 on a business decision): 495 of 495 = 100.0%. **Non-deferred gaps: 0.**
- **Counting rules:**
  - PARTIAL is not counted as done.
  - Where the BRD states the same requirement in two sections, it is audited, and counted, in each section, as the BRD lists it.

| Section | Total | Impl. | Partial | Not | Biz blocked | Ext. blocked | FSM |
|---|---|---|---|---|---|---|---|
| 5.1 Enquiry and prospect | 20 | 20 | 0 | 0 | 0 | 0 | 0 |
| 5.2 Property, scope, site visit | 36 | 36 | 0 | 0 | 0 | 0 | 0 |
| 5.3 Rate card | 19 | 19 | 0 | 0 | 0 | 0 | 0 |
| 5.4 Proposal and revisions | 20 | 20 | 0 | 0 | 0 | 0 | 0 |
| 5.5 Approvals | 16 | 16 | 0 | 0 | 0 | 0 | 0 |
| 5.6 Sharing and decision | 12 | 12 | 0 | 0 | 0 | 0 | 0 |
| 5.7 Contract and signature | 46 | 43 | 0 | 0 | 1 | 2 | 0 |
| 5.8 Payments | 25 | 21 | 0 | 0 | 0 | 4 | 0 |
| 5.9 Client profile, access, documents | 27 | 27 | 0 | 0 | 0 | 0 | 0 |
| 5.10 PPM schedule | 23 | 23 | 0 | 0 | 0 | 0 | 0 |
| 5.11 Confirmation, board, assignment, access | 35 | 27 | 0 | 0 | 5 | 3 | 0 |
| 5.12 Job execution and closure | 34 | 21 | 0 | 0 | 0 | 2 | 11 |
| 5.13 Call outs | 26 | 21 | 0 | 0 | 0 | 1 | 4 |
| 5.14 Additional works and entitlements | 37 | 35 | 0 | 0 | 2 | 0 | 0 |
| 5.15 Reports and dashboard | 41 | 34 | 0 | 0 | 0 | 7 | 0 |
| 5.16 Renewal, amendments, termination | 24 | 24 | 0 | 0 | 0 | 0 | 0 |
| 6.1 Emails (1, 2, 3, installment) | 37 | 37 | 0 | 0 | 0 | 0 | 0 |
| 6.2 Notifications | 28 | 28 | 0 | 0 | 0 | 0 | 0 |
| 6.3 WhatsApp / SMS | 9 | 6 | 0 | 0 | 0 | 3 | 0 |
| 6.7 Roles | 12 | 11 | 0 | 0 | 0 | 0 | 1 |
| 6.8 To-dos | 8 | 8 | 0 | 0 | 0 | 0 | 0 |
| 6.9 Metrics | 7 | 6 | 0 | 0 | 0 | 1 | 0 |
| **Total** | **542** | **495** | **0** | **0** | **8** | **23** | **16** |

### BRD 6.10 deliverables (14 groups)

| # | Deliverable (BRD 6.10) | Status |
|---|---|---|
| 1 | Enquiry pipeline, property, asset register, combined units, scope and site visit (5.1, 5.2) | COMPLETE |
| 2 | Governed rate card with floor rates, history and packages (5.3) | COMPLETE |
| 3 | Wizard linked to the prospect, versions, team visibility (5.4) | COMPLETE |
| 4 | Configurable approval ladder; approval link by email or WhatsApp, decision recorded (5.5, 5.6) | COMPLETE |
| 5 | Contract with commencement date and entitlements, signing routes, statuses; client profile with access rules, consent and documents (5.7, 5.9) | COMPLETE (deferred items open) |
| 6 | Payment bands, schedule, cheques, initial payment gate, Zoho Finance view (5.8) | COMPLETE (deferred items open) |
| 7 | PPM schedule per service line with service windows and clubbing, adherence kept (5.10) | COMPLETE |
| 8 | Confirmation to-do with configurable attempts, scheduling board, competency-based assignment, access status (5.11) | COMPLETE (deferred items open) |
| 9 | Offline FSM job with AMC checklist, supervisor closure, non-completion groups, partial completion per trade (5.12) | COMPLETE (deferred items open) |
| 10 | Reactive call outs with priority, SLA, coverage check and statuses (5.13) | COMPLETE (deferred items open) |
| 11 | Additional work parties and findings, entitlement check, allowance reserve and consume with audit trail (5.14) | COMPLETE (decisions open) |
| 12 | Client report, operational, commercial and profitability reports, dashboard (5.15) | COMPLETE (deferred items open) |
| 13 | Renewal reminder, draft with history, outcomes, edge cases with approval (5.16) | COMPLETE |
| 14 | Emails, notifications, messages, to-dos and roles (6.1, 6.2, 6.3, 6.7, 6.8) | COMPLETE (deferred items open) |

**Complete: 14 of 14** for everything that can be built today. 8 groups still have a deferred item (an external system for Phase 15, or a business decision); see §6.10.

---
## 5.1 Enquiry and prospect

Re-audited 13 Oct 2026 (after Phases 0–13). The enquiry pipeline exists (Phase 3, DEV-347/358/359): `amc_enquiries` and `amc_enquiry_follow_ups` (M/20261007130000, not applied), pure rules in `lib/amc/enquiries.ts`, server logic in `lib/server/amc/enquiries.ts`, routes under `api/amc-enquiries/*`, and the screens AMC → Enquiries (`X/amc-contracts/enquiries/enquiries-page.tsx`) and the enquiry page (`enquiry-detail.tsx`, dialogs in `enquiry-dialogs.tsx`). Logging an enquiry creates a prospect (`lifecycle = 'prospect'`, the contact becomes the primary contact) or links an existing client. Stages, sources, lost reasons and the idle/escalation days are AMC configuration (`lib/amc/config.ts` section `enquiries`, Settings → AMC configuration). The idle and follow-up sweeps run in `/api/amc-jobs/run` (`lib/server/amc/jobs.ts`).

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.1-01 | Enquiry date | IMPLEMENTED | `amc_enquiries.enquired_at` (M/20261007130000); `createEnquirySchema.enquiredAt` (lib/amc/enquiries.ts); shown on the list and the enquiry page | — | — | — |
| 5.1-02 | Source (SEO, website, referral, walk in, repeat client, campaign) | IMPLEMENTED | `source` (required) + `referrer` (required for a referral, `createEnquirySchema` refine); list in config `enquiries.sources`, defaulting to the six BRD sources (lib/amc/config.ts); Source select in `EnquiryForm` (X/amc-contracts/enquiries/enquiry-dialogs.tsx); source filter on the list | — | — | — |
| 5.1-03 | Contacts | IMPLEMENTED | Contact name, phone, email and WhatsApp on the enquiry (one of them required: `amc_enquiries_reachable`); the contact becomes the prospect's primary contact in `amc_customer_contacts` (`createEnquiry`, lib/server/amc/enquiries.ts); any number of further contacts on the client's Contacts tab (X/amc-contracts/profile/contacts-panel.tsx) | — | — | — |
| 5.1-04 | Preferred channel | IMPLEMENTED | `preferred_channel` whatsapp/email/call/sms; `EnquiryForm`; prefills the follow-up channel (`FollowUpForm`) | — | — | — |
| 5.1-05 | Preferred language | IMPLEMENTED | `preferred_language`; `EnquiryForm` | — | — | — |
| 5.1-06 | Area | IMPLEMENTED | `amc_enquiries.area`; `EnquiryForm`; copied to the property's community when the property is created from the enquiry | — | — | — |
| 5.1-07 | Property category | IMPLEMENTED | `property_category` + `unit_type` (full BRD list) on the enquiry; `EnquiryForm` (the category follows the type) | — | — | — |
| 5.1-08 | Need in short | IMPLEMENTED | `need` (required, at least 3 characters); `EnquiryForm` "What the client needs" | — | — | — |
| 5.1-09 | Owner | IMPLEMENTED | `owner_id` (defaults to the person logging it); reassignment with a notification (`updateEnquiry`, `notifyOwnerAssigned`); owner filter and "Mine" view on the list | — | — | — |
| 5.1-10 | Status | IMPLEMENTED | `stage` + `stage_changed_at`; stage badge, filters and views (Open, Mine, Follow-ups overdue, Idle, All) in enquiries-page.tsx | — | — | — |
| 5.1-11 | Next follow-up date | IMPLEMENTED | `next_follow_up_at`, set on the enquiry and by each follow-up; overdue/today flags (`followUpState`); follow-up filter and tiles | — | — | — |
| 5.1-12 | The 12 stages (New Enquiry … On Hold) | IMPLEMENTED | The 12 BRD stages are the configuration default (`enquiries.stages`, lib/amc/config.ts); `changeStage` / `StageDialog`; booking a site visit moves the enquiry to Site Visit Scheduled (`stageAfterSiteVisitBooked`), starting a proposal moves it to Proposal Preparation (`linkEnquiryProposal`); every change goes to status history (`recordStatusChange`). The later stages (Proposal Submitted … Won) are moved by hand | — | — | — |
| 5.1-13 | Configurable stages | IMPLEMENTED | Config `enquiries.stages` (validated: Won and Lost must stay); Settings → AMC configuration (X/amc/configuration/config-fields.ts); the stage rules read the configured order (`checkStageChange`) | — | — | — |
| 5.1-14 | Configurable owners | IMPLEMENTED | Owner chosen per enquiry from all active portal users (`listAmcPeople`, `PersonSelect`), reassignable at any time with a notification and an audit event (`enquiry_reassigned`). There is no automatic owner rule: the owner defaults to whoever logs the enquiry, which suits a team with no pre-sales staff yet | — | — | — |
| 5.1-15 | Configurable follow-up rules | IMPLEMENTED | Config `enquiries.idleDays` (5) and `managementEscalationDays` (10); next follow-up date per enquiry; follow-up-due sweep (`runEnquiryFollowUpSweep`) | — | — | — |
| 5.1-16 | Follow-up log (date, channel, person, outcome, next date) | IMPLEMENTED | `amc_enquiry_follow_ups` (occurred_at, channel, outcome, notes, next_follow_up_at, logged_by); `addFollowUp` resets the idle clock, can move the stage and copies the entry to the client's communication log; `FollowUpDialog`; Follow-ups tab on the enquiry page | — | — | — |
| 5.1-17 | Idle enquiry detection | IMPLEMENTED | `last_activity_at` + `idleState` (idle badge, Idle view); `runEnquiryIdleSweep` claims `idle_flagged_at` after the configured days (Won, Lost and On Hold exempt) | — | — | — |
| 5.1-18 | Owner alert | IMPLEMENTED | Notification `enquiry_idle` to the owner (`runEnquiryIdleSweep`); also `enquiry_follow_up_due` and `enquiry_assigned` | — | — | — |
| 5.1-19 | Management escalation | IMPLEMENTED | After `managementEscalationDays`: `enquiry_escalated` to the level 2 approvers (management) and the owner, claimed by `idle_escalated_at` (`runEnquiryIdleSweep`); the sweep reports `noManagementNamed` when nobody is named for level 2 | — | — | — |
| 5.1-20 | Lost needs a reason | IMPLEMENTED | `checkStageChange` requires a reason from config `enquiries.lostReasons` (Price, Competitor, Scope, No response, Deferred); DB check `amc_enquiries_lost_reason`; reopening a Won or Lost enquiry needs a reason; `StageDialog` | — | — | — |

## 5.2 Property, scope and site visit

Since Phase 6b, properties are the shared Snagging addresses: `snagging_properties` plus the AMC side table `amc_property_profiles`, read through `amc_property_directory` (M/20261007170000, not applied; the Phase 2 tables are in M/20261007120000). The property page (`X/amc-contracts/customer-property-views.tsx`) has the tabs Overview (details, combined units, current AMC), Contracts, Site visits, Assets, Access rules, Scope and Documents. The panels are in `X/amc-contracts/profile/property-panels.tsx` and the form in `X/amc-contracts/customer-pickers.tsx`.

**Property**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.2-01 | Category | IMPLEMENTED | `property_category` (residential/commercial) on the property (`amc_property_profiles`, M/20261007170000); property form (customer-pickers.tsx); wizard X/amc/steps/property-customer-step.tsx | — | — | — |
| 5.2-02 | Type: villa, apartment, townhouse, restaurant, clinic, shop, office | IMPLEMENTED | `UNIT_TYPES` = villa, apartment, townhouse, restaurant, clinic, shop, office, warehouse, other (lib/amc/client-profile.ts); the same list on the property, enquiry, assessment and proposal (`amc_submissions.property_type`, M/20261007140000); wizard type picker filtered by category (property-customer-step.tsx), priced on its rate model (`rateModelFor`) | — | — | — |
| 5.2-03 | Address down to the unit | IMPLEMENTED | Building, unit no., floor, street and city (`snagging_properties.building_name` + `amc_property_profiles`); property form fields Building / Unit no. / Floor / Street / City | — | — | — |
| 5.2-04 | Size | IMPLEMENTED | `size_sqft` (`built_up_area_sqft`) and `bedrooms`; property form | — | — | — |
| 5.2-05 | Floors or zones | IMPLEMENTED | `floors_count` (`snagging_properties.floors`) and `zones text[]`; property form fields "Floors" and "Zones" | — | — | — |
| 5.2-06 | Owner or tenant | IMPLEMENTED | `occupancy` owner/tenant/vacant on the property; property form "Occupied by"; owner and tenant contact roles in `amc_customer_contacts` | — | — | — |
| 5.2-07 | Access constraints | IMPLEMENTED | `access_constraints` on the property (shown as a banner on the property page); structured access rules per property (`amc_property_access_rules`, `AccessRulesPanel`) | — | — | — |

**Asset register**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.2-08 | AC units by type and count | IMPLEMENTED | `amc_property_assets` with `asset_type`, `trade = 'ac'` and `quantity` (identical units as one row) (M/20261007120000); `AssetsPanel` and the asset dialog (property-panels.tsx); the site visit counts units per service (`amc_assessments.asset_counts`) | — | — | — |
| 5.2-09 | Other assets | IMPLEMENTED | Same register, any trade (plumbing, electrical, handyman, civil, other); add, edit and retire with a reason (api/amc-contracts/properties/[propertyId]/assets/*) | — | — | — |
| 5.2-10 | Asset type | IMPLEMENTED | `asset_type` (required); asset dialog | — | — | — |
| 5.2-11 | Location | IMPLEMENTED | `location`; asset dialog and register column | — | — | — |
| 5.2-12 | Make | IMPLEMENTED | `make`; asset dialog | — | — | — |
| 5.2-13 | Model | IMPLEMENTED | `model`; asset dialog | — | — | — |
| 5.2-14 | Serial number | IMPLEMENTED | `serial_no`, unique per property, one unit per serial (`amc_property_assets_serial_single`); asset dialog | — | — | — |
| 5.2-15 | Condition | IMPLEMENTED | `condition` good/fair/poor/critical/unknown per asset; asset dialog and badge | — | — | — |
| 5.2-16 | Service history per asset | IMPLEMENTED | Phase 14 (working tree, 13 Oct): assetHistory() (lib/server/amc/client-history.ts), api/amc-contracts/properties/[propertyId]/assets/[assetId]/history; History dialog on the property Assets tab: checklist results and photos recorded against the asset on job sheets, with the visit, and the call outs at the property for the asset's trade | Call outs carry no asset of their own (matched by trade) | — | — |

**Scope**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.2-17 | Trade (AC, plumbing, electrical, handyman, civil) | IMPLEMENTED | `amc_scope_items.trade` ac/plumbing/electrical/handyman/civil/other (M/20261007120000); `ScopePanel` (property-panels.tsx, `tradeForService`) | — | — | — |
| 5.2-18 | Frequency per item | IMPLEMENTED | `frequency_per_year` per scope item; per proposal row (X/amc/components/service-table.tsx), limited to the rate card's allowed frequencies | — | — | — |
| 5.2-19 | Duration | IMPLEMENTED | `duration_minutes` per scope item; contract term from the wizard's start and end dates | — | — | — |
| 5.2-20 | Preferred months or days | IMPLEMENTED | `preferred_months` and `preferred_days` per scope item (month and day pickers in `ScopePanel`); used for PPM target dates (lib/server/amc/ppm.ts reads `preferred_months, preferred_days`) | — | — | — |
| 5.2-21 | Exclusions | IMPLEMENTED | `exclusions` per scope item (`ScopePanel`); per site visit (`amc_assessments.exclusions`); per contract entitlement (`ENTITLEMENT_TERMS_COLUMNS`, lib/server/amc/contracts.ts) | — | — | — |
| 5.2-22 | Photos | IMPLEMENTED | Property documents with the category "Photos" in the document store (`DOCUMENT_CATEGORIES.property`, lib/amc/client-profile.ts; `DocumentsPanel` on the property page); site visit photos (`amc_assessment_photos`) | — | — | — |

**Combined units**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.2-23 | Parent and child properties | IMPLEMENTED | `parent_property_id` (never its own parent; `amc_property_profiles`, M/20261007170000); "Part of (combined units)" in the property form; the Combined units card on the property page lists the parent and the children | — | — | — |
| 5.2-24 | Each keeps its ownership | IMPLEMENTED | Each unit keeps its own `client_id`; a child with another owner is labelled "different owner" (customer-property-views.tsx) | — | — | — |
| 5.2-25 | Each keeps its billing | IMPLEMENTED | Linking never merges: proposals, contracts, instalments and payments stay per property and per client (`amc_contracts.property_id`; `amc_installments` / `amc_payments` per contract, M/20261008100100) | — | — | — |
| 5.2-26 | Each keeps its history | IMPLEMENTED | Each property page shows its own current and previous contracts, site visits, additional-service quotes and documents (customer-property-views.tsx) | — | — | — |

**Commercial site visit** (`amc_assessments`, M/20261006130000; photos M/20261006150000; enquiry link, schedule, attendance, asset counts, access notes and exclusions M/20261007130000)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.2-27 | Date | IMPLEMENTED | `scheduled_at` (booked from the enquiry, `scheduleSiteVisit`) and `assessed_on` (required to complete); X/amc-contracts/assessments.tsx | — | — | — |
| 5.2-28 | Assessor | IMPLEMENTED | `assessor_id` / `assessor_name`, assigned when the visit is booked (`SiteVisitDialog`) and notified (site visit assigned) | — | — | — |
| 5.2-29 | Asset count checked on site | IMPLEMENTED | `asset_counts` per recommended service (`cleanAssetCounts`, lib/amc/enquiries.ts); "Units counted" inputs in assessments.tsx; used as the proposal's line units (lib/amc/business.ts) | — | — | — |
| 5.2-30 | Condition notes | IMPLEMENTED | Checklist result and notes per item; assessments.tsx | — | — | — |
| 5.2-31 | Photos | IMPLEMENTED | `amc_assessment_photos`; api/amc-contracts/assessments/[assessmentId]/photos; Photos tab (assessment-photos.tsx). The stale "photos are not stored" text was removed (Phase 0.4) | — | — | — |
| 5.2-32 | Access notes | IMPLEMENTED | `amc_assessments.access_notes`; "Access notes" field in assessments.tsx | — | — | — |
| 5.2-33 | Recommended scope | IMPLEMENTED | `recommended_service_ids`; assessments.tsx | — | — | — |
| 5.2-34 | Exclusions | IMPLEMENTED | `amc_assessments.exclusions`; "Exclusions" field in assessments.tsx | — | — | — |
| 5.2-35 | Proposal draws its lines from the visit | IMPLEMENTED | `createProposalFromEnquiry` (lib/server/amc/enquiry-proposal.ts) and the assessment route (lib/server/amc/business.ts: `priceSubmission` with `rateCardInForce`) tick the recommended services with the units counted on site, priced on the rate card. Minor: assessments.tsx still says "Prices are entered in the proposal" | — | — | — |
| 5.2-36 | Wizard blocks or flags when a required visit is missing | IMPLEMENTED | Phase 14 (working tree, 13 Oct): siteVisitProblem() (lib/server/amc/enquiry-proposal.ts) checked on submit for approval in api/amc-submissions/approval for every proposal however it was started; "block" refuses (409), "flag" lets it through with a warning toast and a site_visit_missing audit event | — | — | — |

## 5.3 Rate card

There is a governed AMC rate card (Phase 4, DEV-349/363/364). `amc_rate_card_versions` stores the whole card (rates per service and property model, packages, promotions) as one locked, effective-dated version per publish (M/20261007140000, not applied); history rows cannot be changed (`amc_history_row_locked`). The rules are in `lib/amc/rate-card.ts`, the server logic in `lib/server/amc/rate-card.ts`, the route is `api/amc-rate-card` and the screen is AMC → Rate card (`X/amc-contracts/rate-card/rate-card-page.tsx`). With a card in force, the server prices every proposal line from it, whatever the browser sends (`priceSubmission`, `lib/server/amc/pricing.ts`). With no card published, proposals are priced as entered.

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.3-01 | Governed service list | IMPLEMENTED | Rate items per catalogue service and property model, with a retire flag (`rateItemSchema`, `rateCardSchema`); publishing refuses services that are not in the AMC catalogue (api/amc-rate-card/route.ts POST) | — | — | — |
| 5.3-02 | Unit | IMPLEMENTED | `unit` (required) and `basis` per_unit/per_property/per_visit/per_hour (`RATE_BASES`) | — | — | — |
| 5.3-03 | Standard rate | IMPLEMENTED | `standardRate`, applied to the line (`applyRateCard`, `rateItemFor`) | — | — | — |
| 5.3-04 | Floor rate | IMPLEMENTED | `floorRate` (not above the standard rate); recorded on each priced line; `lineBelowFloor` | — | — | — |
| 5.3-05 | Allowed frequencies | IMPLEMENTED | `allowedFrequencies` per rate; a ticked line at another frequency is a rate problem and submitting is refused (`applyRateCard` problems; `submissionRateProblem` in api/amc-submissions/approval/route.ts) | — | — | — |
| 5.3-06 | Residential / commercial model | IMPLEMENTED | Rates per model villa/apartment/office or any (`PROPERTY_MODELS`); commercial types are priced on the office rates (`rateModelFor`, lib/amc/proposal-rules.ts) | — | — | — |
| 5.3-07 | Only department head and Finance edit | IMPLEMENTED | POST gated by AMC Rate Card Edit (`requireResourceAccess(AMC_RATE_CARD, EDIT)`); Edit is only in the department head and Finance templates (lib/amc/role-templates.ts); the screen is read-only without Edit (`canEdit`) | — | — | — |
| 5.3-08 | Price-change history | IMPLEMENTED | Every publish is a new locked version; History tab (`HistoryTab`, rate-card-page.tsx) | — | — | — |
| 5.3-09 | Changed by | IMPLEMENTED | `amc_rate_card_versions.changed_by`, shown in History; audit actor | — | — | — |
| 5.3-10 | Changed at | IMPLEMENTED | `created_at` per version, shown in History | — | — | — |
| 5.3-11 | Old value | IMPLEMENTED | `diffRateCards` gives the old and new value per field, shown in History and stored in the audit event (`publishRateCard`) | — | — | — |
| 5.3-12 | New value | IMPLEMENTED | Same | — | — | — |
| 5.3-13 | Effective-from date | IMPLEMENTED | `effective_from` (today or later, never back-dated); `versionInForce` picks the card for each day | — | — | — |
| 5.3-14 | An old proposal keeps the rate of its day | IMPLEMENTED | Each line records its rate, floor and promotion, and the proposal records `rate_card_version_id` (M/20261007140000); shared versions are locked with their snapshot (`amc_submission_versions`) | — | — | — |
| 5.3-15 | Brochure packages (Essential, Advantage, Premium, Complete, Build your own) | IMPLEMENTED | Packages are preset service sets with frequencies, per model (`packageSchema`, edited on the Rate card screen); package picker in the wizard (`packagesFor`, `applyPackage`, X/amc/steps/services-pricing-step.tsx). The package names are entered on the card; "Build your own" means ticking services without a package | — | — | — |
| 5.3-16 | Promotions with start and end dates | IMPLEMENTED | `promotionSchema` (percent off, start and end date, services, models); the best promotion in date is applied (`promotionFor`) and marked on the line in the wizard | — | — | — |
| 5.3-17 | Users cannot change the rate | IMPLEMENTED | With a card in force, the base price is read-only in the wizard (service-table.tsx) and set by the server (`priceSubmission` → `applyRateCard`) | — | — | — |
| 5.3-18 | Discount within authority | IMPLEMENTED | The wizard shows the approval level a discount needs (`discountApprovalLevel`, services-pricing-step.tsx); above the configured thresholds the proposal goes up the approval ladder (`evaluateTriggers`) | — | Threshold values to confirm (Q2); configurable, not blocking | — |
| 5.3-19 | Below floor triggers approval | IMPLEMENTED | `below_floor` is set when a discounted line falls under its floor; trigger `below_floor` at the configured level (`evaluateTriggers`, lib/amc/approval-ladder.ts) | — | — | — |

## 5.4 Proposal and revisions

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.4-01 | Proposal created from the prospect | IMPLEMENTED | "Create proposal" on the enquiry page → api/amc-enquiries/[enquiryId]/proposal → `createProposalFromEnquiry` (lib/server/amc/enquiry-proposal.ts); links `amc_submissions.enquiry_id` and moves the enquiry to Proposal Preparation. Also from a completed assessment | — | — | — |
| 5.4-02 | Customer prefilled | IMPLEMENTED | Client, contact, phone and email filled from the enquiry and the prospect (`createProposalFromEnquiry`); assessment path (lib/amc/business.ts) | — | — | — |
| 5.4-03 | Property prefilled | IMPLEMENTED | Property, category and full type from the enquiry's property (`createProposalFromEnquiry`) or from the assessment (lib/amc/business.ts) | — | — | — |
| 5.4-04 | Commercial lines from the site visit | IMPLEMENTED | Lines and units from the latest completed site visit, else from the property's scope, priced on the card (`createProposalFromEnquiry`) | — | — | — |
| 5.4-05 | Unique number | IMPLEMENTED | Sequence + unique index (M/20260916105000, M/20261005110000; lib/amc/proposal-number.ts) | — | — | — |
| 5.4-06 | Date | IMPLEMENTED | `proposal_sent_at`, printed as the document date (`computeAmcData`, X/amc/amc-pricing.ts); each version's `started_at` / `locked_at` (`amc_submission_versions`) | — | — | — |
| 5.4-07 | Validity period | IMPLEMENTED | valid_until set on send (configured days); shown on the proposal page, in Email 1, on locked versions, and on the client page (Phase 14 (working tree, 13 Oct)); the client link refuses an answer after it (410, api/amc/[token]); owner reminder before expiry | Not printed inside the PDF itself | — | — |
| 5.4-08 | Payment terms | IMPLEMENTED | `payment_plan` single / 50-50 / quarterly / monthly / custom replaces monthly/quarterly/annual, with legacy terms mapped (`legacyTermsForPlan`); printed and shown on the link page | — | — | — |
| 5.4-09 | Payment plan | IMPLEMENTED | `payment_plan` + `payment_plan_custom` instalments (M/20261007140000); `PaymentPlanSection` in the wizard offers plans by value band and marks non-standard ones (`isNonStandardPlan`); the plan becomes the instalment schedule on activation (Phase 7) | — | — | — |
| 5.4-10 | Visible to the team by role | IMPLEMENTED | Approvers and AMC Operations (View) see the team's non-draft proposals; others see their own (api/amc-submissions/route.ts `seesTeam`; lib/server/amc/proposal-access.ts) | — | — | — |
| 5.4-11 | Edit after sharing creates V2, V3 | IMPLEMENTED | Revise (owner, on proposal_sent / proposal_rejected) → api/amc-submissions/versions POST → `reviseProposal` → `amc_lock_proposal_version` opens V(n+1) as a draft; in-place edits only in draft/sent_back (`EDITABLE_STATUSES`); `ReviseProposalDialog` | — | — | — |
| 5.4-12 | Old versions locked | IMPLEMENTED | `amc_submission_versions` rows cannot be updated or deleted (trigger `amc_history_row_locked`); the old version's client link stops working | — | — | — |
| 5.4-13 | Old PDF kept | IMPLEMENTED | Server-printed document stored per locked version in the `amc-documents` bucket (`reviseProposal`, `renderPdf`; self-contained HTML on a host without headless Chrome); opened from `ProposalVersionsPanel` (api/amc-submissions/versions/file) | — | — | — |
| 5.4-14 | Revision date | IMPLEMENTED | `version_started_at` / `started_at` and `locked_at` per version | — | — | — |
| 5.4-15 | Revision user | IMPLEMENTED | `version_started_by` / `started_by` and `locked_by` | — | — | — |
| 5.4-16 | Revision reason (scope, discount, price, frequency, duration, plan, other) | IMPLEMENTED | `VERSION_REASONS` scope_up, scope_down, discount, price_correction, frequency, duration, payment_plan, other (required by `reviseSchema`; DB check) | — | — | — |
| 5.4-17 | Revision summary | IMPLEMENTED | `summary` required (at least 5 characters, `reviseSchema`), stored per version | — | — | — |
| 5.4-18 | Final price per version | IMPLEMENTED | `amc_submission_versions.final_price`, with discount and plan per version; prices side by side in `ProposalVersionsPanel` | — | — | — |
| 5.4-19 | Active version marked | IMPLEMENTED | `current_version`; "Active version" row and V badge (proposal-versions-panel.tsx, submission-details.tsx) | — | — | — |
| 5.4-20 | Revision crossing a threshold returns for approval | IMPLEMENTED | `priorApprovalCovers`: a new version is approved at once only if it asks for no more than the previous approval; a higher discount, a plan change, a new below-floor line or a higher level goes back to the ladder (lib/amc/approval-ladder.ts, `shareProposal`) | — | — | — |

## 5.5 Approval of discounts, values and payment plans

The approval ladder is Phase 5 (DEV-369): `amc_approval_steps` (M/20261007150000, not applied), rules in `lib/amc/approval-ladder.ts`, server logic in `lib/server/amc/approval-ladder.ts` (`shareProposal`, `decideStep`), thresholds and named approvers per level in the AMC configuration section `approvals` (management only). The threshold values are the plan's defaults until the business confirms them (Q2). They are configurable, so nothing is blocked.

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.5-01 | Trigger: discount percent | IMPLEMENTED | `discountApprovalLevel` from `discountLevel1/2/3AbovePercent` (default: above 10% level 1, above 20% level 2); `evaluateTriggers` on share | — | Values to confirm (Q2); not blocking | — |
| 5.5-02 | Trigger: final value | IMPLEMENTED | `valueApprovalLevel` from `valueLevel1/2/3AboveAed` (default: above AED 50,000 → level 2, annual fee before VAT) | — | Values to confirm (Q2); not blocking | — |
| 5.5-03 | Trigger: non-standard payment plan | IMPLEMENTED | `isNonStandardPlan` against the payment bands (config `payments`); level `nonStandardPlanLevel` | — | — | — |
| 5.5-04 | Trigger: below floor rate | IMPLEMENTED | `below_floor` from the rate card; level `belowFloorLevel` | — | — | — |
| 5.5-05 | Configurable thresholds | IMPLEMENTED | Config `approvals` thresholds, editable only with AMC Configuration Approve (`AMC_CONFIG_SECTION_LEVEL.approvals = "management"`), audited | — | — | — |
| 5.5-06 | Configurable approval levels | IMPLEMENTED | Three levels with names and named approvers (`level1..3Name`, `level1..3ApproverIds`); each trigger names its level | — | — | — |
| 5.5-07 | Level 1, then higher levels in sequence | IMPLEMENTED | `ladderLevels`; level 1 opens and each approval opens the next waiting level (`decideStep`); one pending level at a time (unique index) | — | — | — |
| 5.5-08 | Approve | IMPLEMENTED | `decideStep` action approve; approval route `approve` | — | — | — |
| 5.5-09 | Reject | IMPLEMENTED | Action `reject` with a required reason (approval/route.ts; `decideStep`); cancels the levels above and returns the proposal to the owner | — | — | — |
| 5.5-10 | Return with comments | IMPLEMENTED | `send_back` / `return` with a required comment (DB check `amc_approval_steps_reason`) | — | — | — |
| 5.5-11 | Logged with user and time | IMPLEMENTED | `amc_approval_steps.decided_by` / `decided_at` / `comment`; an audit event per decision; status history; Approvals & sends tab (proposal-sharing-panel.tsx) | — | — | — |
| 5.5-12 | A pending proposal cannot be shared | IMPLEMENTED | Sending requires `approved` (`canSend`, lib/amc/workflow.ts; send/route.ts) | — | — | — |
| 5.5-13 | Open approval escalates after a set time | IMPLEMENTED | escalateDueAmcTodos + escalateApprovalStep (lib/server/amc/todos.ts, Phase 14 (working tree, 13 Oct)): the next level's approvers are added to the to-do AND to the pending step's approver_ids, so they can decide; below level 3 the to-do is armed again, climbing one level per escalation period | A level with nobody named has no to-do to escalate (role-based approvers decide it) | — | — |
| 5.5-14 | Raised discount or changed plan re-triggers | IMPLEMENTED | `priorApprovalCovers` (higher discount, different plan, new below-floor line or higher level) | — | — | — |
| 5.5-15 | Nobody approves their own proposal | IMPLEMENTED | `AMC_SELF_APPROVAL_ALLOWED = false` (lib/amc/workflow.ts), pinned by tests/amc/workflow.test.ts; `decideStep` refuses the owner; the owner is filtered out of a level's approvers (`openLevel`) | — | — | — |
| 5.5-16 | No trigger: share directly | IMPLEMENTED | `shareProposal` outcome `shared_directly` (or `covered` by the previous version's approval): approved at once and ready to send | — | — | — |

## 5.6 Sharing and the prospect decision

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.6-01 | Approval link per proposal version | IMPLEMENTED | Hashed token minted per send of the active version (send/route.ts, `mintLinkToken`); revising clears it, so each version has its own link (`amc_lock_proposal_version`); the send log records the version and the token hint | — | — | — |
| 5.6-02 | Email sharing | IMPLEMENTED | Email 1 from the configured template, to the chosen contacts, owner in cc, PDF attached, renewal first line (send/route.ts; `proposalShareTexts`, lib/server/amc/proposal-share.ts). Content details are audited under 6.1 Email 1 | — | — | — |
| 5.6-03 | WhatsApp: portal prepares the text with the link | IMPLEMENTED | `deliver: "whatsapp"` returns the prepared text with the link and a wa.me link per contact (`whatsappMessages`, `whatsappUrl`); template `messageProposalShared` (renewals: `messageRenewalProposal`); AmcSendDialog | — | — | — |
| 5.6-04 | WhatsApp default for residential, email for commercial | IMPLEMENTED | `defaultShareChannel` by property category (lib/amc/approval-ladder.ts), used by `shareChannelFor` in X/amc/amc-send-dialog.tsx | — | — | — |
| 5.6-05 | More than one contact | IMPLEMENTED | `recipients` array (up to 10) in send/route.ts; the dialog lists the proposal's contact and coordination contacts and lets the user add more addresses or numbers | — | — | — |
| 5.6-06 | Send log: channel, recipient, version, user, time | IMPLEMENTED | `amc_send_log` (version_no, channel, recipients, cc, outcome, token hint, sent_by, sent_at) for email, WhatsApp and link sends (`recordSend`); Approvals & sends tab (`ApprovalsAndSendsPanel`, api/amc-submissions/sharing) | — | — | — |
| 5.6-07 | Prospect approves | IMPLEMENTED | api/amc/[token]/route.ts action `approve` (the name is asked first; decided once) | — | — | — |
| 5.6-08 | Prospect rejects with a reason | IMPLEMENTED | Action `reject` with a required reason, stored in `client_rejected_reason` | — | — | — |
| 5.6-09 | Prospect requests a revision | IMPLEMENTED | Separate action `request_revision` with a note ("Request a change", app/amc/[token]/public-amc-document.tsx); `client_answer = 'revision_requested'`; audit `revision_requested_by_client` | — | — | — |
| 5.6-10 | Decision kept with version, date and time | IMPLEMENTED | `client_decision`, `client_answer`, `client_decided_at` and `client_decided_by_name` on the active version (`current_version`); kept in the locked version's snapshot on revise (`versionSnapshot`); audit with origin client | — | — | — |
| 5.6-11 | Manual decision with evidence | IMPLEMENTED | `RecordClientAnswerDialog` (X/amc/proposal-sharing-panel.tsx) uploads the evidence to the proposal's documents, then api/amc-submissions/client-decision → lib/server/amc/client-decision.ts (evidence mandatory, `client_answer_source = 'coordinator'`, `client_answer_evidence_id`); the link then closes | — | — | — |
| 5.6-12 | Approved proposal locked | IMPLEMENTED | Edits only in draft/sent_back (`EDITABLE_STATUSES`, api/amc-submissions/route.ts); Revise is not offered once the client approves (`REVISABLE_STATUSES`); DB lock (M/20261005100000) | — | — | — |

## 5.7 Contract and signature

**Contract document**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.7-01 | Approval auto-creates the contract | IMPLEMENTED | `createContractFromApproval` (lib/server/amc/contract-lifecycle.ts:144) runs on the client's approval on the link (api/amc/[token]/route.ts:334) and on a decision the coordinator records (lib/server/amc/client-decision.ts:91). It creates a Draft `amc_contracts` row with the approved version's values, entitlements, wording snapshot and signatories. The document is built from proposal data with no retyping (X/amc/amc-document-model.ts) | — | — | — |
| 5.7-02 | Residential and commercial templates | BIZ BLOCKED | Template chosen by category and stored on amc_contracts.template; the document prints one clause set | The commercial clause wording | Business to supply the commercial contract wording | When supplied: a commercial clause list in AMC Settings, chosen by template |
| 5.7-03 | Customer and property | IMPLEMENTED | Parties table and details table (X/amc/amc-document-model.ts:206-243) | — | — | — |
| 5.7-04 | Scope text per service | IMPLEMENTED | Scope clause per selected service, from AMC Settings (amc-document-model.ts:451-470) | — | — | — |
| 5.7-05 | Frequency table | IMPLEMENTED | Frequency table with units (amc-document-model.ts:600-625) | — | — | — |
| 5.7-06 | Value | IMPLEMENTED | "Total Amount" and amount in words (amc-document-model.ts:256-265) | — | — | — |
| 5.7-07 | VAT | IMPLEMENTED | Net + 5% VAT, VAT-inclusive total (amc-document-model.ts:258-263) | — | — | — |
| 5.7-08 | Term of one year or more | IMPLEMENTED | checkTerm() against contracts.minimumTermMonths on submit for approval (api/amc-submissions/approval, Phase 14 (working tree, 13 Oct)) as well as at activation, so a short term is refused before it is sent or signed | — | Default 12 months per the BRD; Jonathan's 6-month contracts need the minimum set to 6 in AMC configuration | — |
| 5.7-09 | Entitlements in the contract | IMPLEMENTED | Phase 14 (working tree, 13 Oct): coverage terms (labour, materials, value limit, exclusions) mirrored to the proposal's document_options.entitlementTerms whenever they are set (mirrorTermsToDocument, lib/server/amc/contract-lifecycle.ts); the contract document prints a "What each service covers" table (X/amc/amc-document-model.ts) | — | — | — |
| 5.7-10 | Payment terms | IMPLEMENTED | "Terms of Payment" (amc-document-model.ts:267; `formatPaymentLabel`, X/amc/amc-pricing.ts:253) | — | — | — |
| 5.7-11 | Payment plan | IMPLEMENTED | The plan is printed under Terms of Payment: single, 50/50, quarterly, monthly, or the custom splits (`paymentPlanLabel`, lib/amc/proposal-rules.ts:91). Email 2 quotes the first instalment (`firstInstalment`, lib/amc/contract-lifecycle.ts:183). The dated schedule is made on activation, as BRD 5.8 says | Instalment amounts and dates are not printed in the document (by design: they are set on activation) | — | — |
| 5.7-12 | Terms and conditions | IMPLEMENTED | Clause list from AMC Settings (amc-document-model.ts:270-790) | — | — | — |
| 5.7-13 | Bank details | IMPLEMENTED | `bankDetails` clause (amc-document-model.ts:712) | — | — | — |

**Entitlements per contract** (`amc_contract_entitlements`, M/20261006100000:117-160, extended in M/20261007160000:95-101)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.7-14 | Visit frequency per service | IMPLEMENTED | `frequency`, `included_quantity`, `entitlement_type`; the usage ledger; PPM visits generated from them (lib/server/amc/ppm.ts:375) | — | — | — |
| 5.7-15 | Asset quantities | IMPLEMENTED | `units` per entitlement, copied from the approved version. Printed in the frequency table and used for standard visit durations (Phase 9). Asset register per property (`amc_property_assets`, M/20261007120000:134) | Allowances do not scale with units, by assumption Q6 (lib/amc/contracts.ts:110) | Q6 to confirm | — |
| 5.7-16 | Labour coverage | IMPLEMENTED | `labour_covered` (M/20261007160000:96). Edited in the TermsDialog (contract-lifecycle-panel.tsx:531-610). Checked by `checkCallOutCoverage` (lib/amc/call-outs.ts:200) | — | — | — |
| 5.7-17 | Material coverage | IMPLEMENTED | `material_coverage` none/consumables/parts_within_limit/all (M/20261007160000:97-98); checked at lib/amc/call-outs.ts:210-215 | — | — | — |
| 5.7-18 | Call-out allowances | IMPLEMENTED | `call_out_class`: emergency unlimited, non-emergency counted (lib/amc/contracts.ts:91). Reserve, consume and release (Phase 11, M/20261012120000) | — | — | — |
| 5.7-19 | Value limits | IMPLEMENTED | `value_limit_aed` (M/20261007160000:99); checked against parts (lib/amc/call-outs.ts:211-215) | — | — | — |
| 5.7-20 | Exclusions | IMPLEMENTED | `exclusions` per service per contract (M/20261007160000:100). Shown in the coverage check (lib/amc/call-outs.ts:198) | — | — | — |
| 5.7-21 | Covered/chargeable check uses the entitlements | IMPLEMENTED | One check, `checkCallOutCoverage` (lib/amc/call-outs.ts:187). It covers in force, service on the contract, used + booked vs included, labour, material vs value limit, and exclusions. It runs before a call out is confirmed (lib/server/amc/call-outs.ts:169, X/amc-contracts/log-call-out-dialog.tsx). Booking a chargeable call out as covered needs AMC Allowances Approve and a reason | — | — | — |

**Identity and versions**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.7-22 | Unique contract number | IMPLEMENTED | `contract_number` AMC-C-YYYY-NNNN, unique and not null (`amc_next_contract_number`, M/20261007160000:15-58). Shown on the contract page (contract-detail.tsx:366) | — | — | — |
| 5.7-23 | Linked to the enquiry | IMPLEMENTED | `amc_contracts.enquiry_id` is set from the proposal at creation (lib/server/amc/contract-lifecycle.ts:160, 172). Contract → proposal (contract-detail.tsx:412) → "Open the enquiry" (X/amc/submission-details.tsx:880) | — | — | — |
| 5.7-24 | Linked to every proposal version | IMPLEMENTED | `approved_version_no` on the contract (M/20261007160000:43). The proposal's `amc_proposal_versions` are listed with their locked documents on the proposal page (X/amc/proposal-versions-panel.tsx), reached from the contract | — | — | — |
| 5.7-25 | Amendments after signing versioned with a reason | IMPLEMENTED | `amc_contract_amendments` (M/20261012140000:61-85): kind, required reason, details, effective date, approval by someone other than the requester, applied stamp. Each amendment is its own kept record (lib/server/amc/amendments.ts:134, 185; X/amc-contracts/contract-amendments-panel.tsx). A scope change opens a new proposal through the normal flow | — | — | — |

**Signature**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.7-26 | Zoho Sign or internal signing tool | EXT BLOCKED | The internal tool is built. The client signs on the link (api/amc/[token]/route.ts:257, 337; `clientSignedOnLink`, lib/server/amc/contract-lifecycle.ts:339). Internal signatories sign in the portal (`signInternally`, :355). There is an immutable signed archive with a hash (lib/server/amc/signed-archive.ts). `signature_route` already allows `zoho_sign` (M/20261007160000:47) | Zoho Sign route and status return (DEV-375 part 2) | Zoho Sign account and how it returns status | Phase 15 |
| 5.7-27 | Signed scan uploaded with its date | IMPLEMENTED | `recordSignedScan` (lib/server/amc/contract-lifecycle.ts:377) checks that the document belongs to the contract and that the date is not in the future, then records every open signature. ScanDialog uploads to the contract's documents with the date (contract-lifecycle-panel.tsx:250-320). Stored in `signed_scan_document_id` and `signed_scan_date` | — | — | — |
| 5.7-28 | Client signatory tracked | IMPLEMENTED | Client row in `amc_contract_signatories` (method, name, time); `signed_by_name`, `signed_at`; audit | — | — | — |
| 5.7-29 | Each internal signatory tracked separately | IMPLEMENTED | `amc_contract_signatories` (M/20261007160000:108-125), one row per internal signatory from `contracts.internalSignatoryIds`. Each has its own status, method, time and name; the next signer is notified (lib/server/amc/contract-lifecycle.ts:303-336). Listed in the lifecycle panel (contract-lifecycle-panel.tsx:60-100) | — | — | — |
| 5.7-30 | Configurable signing order | IMPLEMENTED | `contracts.signingOrder` client_first/internal_first plus the order of `internalSignatoryIds` (lib/amc/config.ts:115-116; Configuration screen, X/amc/configuration/config-fields.ts). `planSignatories` and `nextPendingSignatory` (lib/amc/contract-lifecycle.ts:71, 97) enforce turn order in `signInternally` | — | — | — |
| 5.7-31 | Reminder after N unsigned days | IMPLEMENTED | runUnsignedContractSweep: client reminders (Email 2) after N days; Phase 14 (working tree, 13 Oct): remindInternalSignatories() tells the internal signatory whose turn it is every N days while pending_internal_signature | — | — | — |
| 5.7-32 | Signing date | IMPLEMENTED | `signed_at` on the contract and on each signatory; scan date for paper | — | — | — |
| 5.7-33 | Commencement date separate from signing | IMPLEMENTED | `activationSchema.commencementDate` (lib/amc/contract-lifecycle.ts:125) sets `start_date` at activation (X/amc-contracts/activate-contract-dialog.tsx) | — | — | — |
| 5.7-34 | Commencement and term set the expiry | IMPLEMENTED | `expiryFromCommencement` (lib/amc/contract-lifecycle.ts:116) sets `end_date` at activation (lib/server/amc/contract-lifecycle.ts:449). The PPM schedule is generated from commencement and end (lib/server/amc/ppm.ts:375). The renewal reminder runs off the expiry (daily `renewals` job, lib/server/amc/renewals.ts) | — | — | — |
| 5.7-35 | Signed contract linked to FSM for Finance | EXT BLOCKED | Manual link of the contract to an existing FSM contact (`linkFsmCustomer`, lib/server/amc/fsm-integration.ts:113) | Push/link of the signed contract to the FSM record Finance uses (DEV-377) | Which FSM record Finance uses | Phase 15 |

**Statuses.** Proposals: draft … signed (M/20260916100000:48-59). Contracts store all 11 BRD statuses (`amc_contracts_status_check`, M/20261007160000:77-80; `CONTRACT_STATUSES`, lib/amc/contract-lifecycle.ts:20). Every change goes through one guarded helper (`setContractStatus`, lib/server/amc/contract-state.ts) and into the status history. Hold and terminate need a reason (M/20261007160000:86-88).

| ID | BRD status | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.7-36 | Draft | IMPLEMENTED | `draft` from client approval (lib/server/amc/contract-lifecycle.ts:175) | — | — | — |
| 5.7-37 | Pending Client Signature | IMPLEMENTED | `pending_client_signature` on send (`contractSent`, lib/server/amc/contract-lifecycle.ts:269; `statusFromSignatures`, lib/amc/contract-lifecycle.ts:90) | — | — | — |
| 5.7-38 | Pending Internal Signature | IMPLEMENTED | `pending_internal_signature` while an internal signatory is due (lib/amc/contract-lifecycle.ts:90) | — | — | — |
| 5.7-39 | Signed | IMPLEMENTED | `signed` when the last signature, or a scan, is recorded (lib/server/amc/contract-lifecycle.ts:303, 377) | — | — | — |
| 5.7-40 | Pending Initial Payment | IMPLEMENTED | Activation holds the contract in `pending_initial_payment` until instalment 1 is received (`gateOpen`, lib/amc/payments.ts:289; lib/server/amc/contract-lifecycle.ts:465-485) | — | — | — |
| 5.7-41 | Active | IMPLEMENTED | `active` once the first instalment is received or the gate is overridden (lib/server/amc/payments.ts:506-520; contract-lifecycle.ts:465) | — | — | — |
| 5.7-42 | On Hold | IMPLEMENTED | Hold/Resume with a reason (`changeContractStatus`, lib/server/amc/contract-lifecycle.ts:524; `checkStatusChange`, lib/amc/contract-lifecycle.ts:173). The hold amendment also pauses the schedule (lib/server/amc/amendments.ts) | — | — | — |
| 5.7-43 | Expired | IMPLEMENTED | Stored `expired` by `runContractExpirySweep` (lib/server/amc/contract-lifecycle.ts:568) | — | — | — |
| 5.7-44 | Renewed | IMPLEMENTED | Activating a renewal marks its predecessor `renewed` (lib/server/amc/contract-lifecycle.ts:487-493). Renewal outcome recorded (M/20261012140000:34-37) | — | — | — |
| 5.7-45 | Cancelled | IMPLEMENTED | Before start, by an approver, with a reason, user and date (lib/amc/contract-lifecycle.ts:162-170; lib/server/amc/contract-lifecycle.ts:533) | — | — | — |
| 5.7-46 | Terminated | IMPLEMENTED | `terminated` with a reason from active/on hold (lib/amc/contract-lifecycle.ts:165). Early-termination amendment with 30-day notice and pro-rata refund (lib/amc/amendments.ts:68, 78) | — | — | — |

## 5.8 Payment plan and collection

**The payments module is built, without its external integrations** (Phase 7, M/20261008100100, not applied). It has the plan on the contract, `amc_instalments` with the 9 BRD statuses, `amc_payments` and the `amc_cheques` register. Instalments are created on activation and the initial payment gate holds visits back. Screens: the contract Payments tab (X/amc-contracts/contract-payments-panel.tsx, payment-dialogs.tsx), AMC → Payments (X/amc-contracts/payments-page.tsx) and the client Payments tab. The daily `payments` job sends the alerts (lib/server/amc/payments.ts:959). Payment links (PayTabs/NomuPay) and Zoho Finance invoices/receipts wait for Phase 15.

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.8-01 | Plan proposed from value bands (below AED 4,000 single) | IMPLEMENTED | `allowedPaymentPlans` / `defaultPaymentPlan` (lib/amc/proposal-rules.ts:100-108) on the configured `payments.singlePaymentBelowAed` and `plansAboveBand`. Used in the wizard (X/amc/steps/services-pricing-step.tsx:515) and in proposals from enquiries and site visits (lib/server/amc/enquiry-proposal.ts:113, business.ts:1331) | — | Band values are a setting; defaults await confirmation (BRD "bands to confirm", Q3) | — |
| 5.8-02 | Single payment | IMPLEMENTED | Plan `single`; `buildSchedule` makes one instalment (lib/amc/payments.ts:162) | — | — | — |
| 5.8-03 | 50/50 | IMPLEMENTED | Plan `fifty_fifty`: two instalments, the second at half term (lib/amc/payments.ts:126-145) | — | — | — |
| 5.8-04 | Quarterly | IMPLEMENTED | Plan `quarterly`: every 3 months over the term | — | — | — |
| 5.8-05 | Monthly | IMPLEMENTED | Plan `monthly`: one per month of the term | — | — | — |
| 5.8-06 | Another permitted plan | IMPLEMENTED | Plan `custom` with labelled percentage splits (`customPlanSchema`, lib/amc/proposal-rules.ts:61), offered when `customPlanAllowed`; scheduled by `buildSchedule` | — | — | — |
| 5.8-07 | Plan outside the rule needs approval | IMPLEMENTED | `isNonStandardPlan` is an approval-ladder trigger (lib/amc/approval-ladder.ts:64); the wizard marks the plan (services-pricing-step.tsx:517). A new version re-triggers when the plan changes | — | "Level 1 + Finance" is level 1 until Finance approvers are named | — |
| 5.8-08 | Schedule created on activation (number, due date, amount, VAT, mode, received date/amount/reference) | IMPLEMENTED | Schedule created on activation (createSchedule); Phase 14 (working tree, 13 Oct): expected mode per instalment set from the contract Payments panel (action set_expected_mode, lib/server/amc/payments.ts) | — | — | — |
| 5.8-09 | Statuses Not Due … Waived | IMPLEMENTED | All 9 statuses (M/20261008100100:66-69; `instalmentStatus`, lib/amc/payments.ts:203). Write-off/waive need AMC Payments Approve and a reason. Status history trigger (M/20261013100000) | — | — | — |
| 5.8-10 | Cash: receipt, collector, handover | IMPLEMENTED | Phase 14 (working tree, 13 Oct): "Collected by" picker on Record payment (collectorId; payments.ts records the collector and the handover) | — | — | — |
| 5.8-11 | Bank transfer: reference, value date, proof | IMPLEMENTED | Phase 14 (working tree, 13 Oct): proof of transfer uploaded to the contract's documents from Record payment and sent as proofDocumentId (checked: assertContractDocument) | — | — | — |
| 5.8-12 | PayTabs / NomuPay link per instalment, status returned | EXT BLOCKED | Mode `link` can be recorded by hand (lib/amc/payments.ts:51); the prepared message has no link yet | Link generation per instalment and automatic settlement (DEV-385) | PayTabs/NomuPay accounts, keys and callbacks | Phase 15 |
| 5.8-13 | Cheque: number, bank, date, amount, custody, deposit, clearance, bounce reason and charges, replacement | IMPLEMENTED | `amc_cheques` (M/20261008100100:99-125) with held → deposited → cleared/bounced/replaced/returned, bounce reason and charges, `replaces_cheque_id`, and unique number per bank. Actions `record_cheque`, `cheque_deposit`, `cheque_clear`, `cheque_bounce`, `cheque_replace`, `cheque_return` (lib/amc/payments.ts:318-363). Dialogs (payment-dialogs.tsx:515-600) and the Cheques tab (payments-page.tsx) | — | — | — |
| 5.8-14 | Alert before a cheque date | IMPLEMENTED | `cheque_date_near`, `chequeAlertDaysBefore` days ahead, claimed once (lib/server/amc/payments.ts:1049-1075) | — | — | — |
| 5.8-15 | Alert on a bounce | IMPLEMENTED | `cheque_bounced` notification on the bounce action (lib/server/amc/payments.ts:691-721); the instalment becomes Bounced and opens the overdue flow | — | — | — |
| 5.8-16 | Initial payment gate: no visit until the first instalment | IMPLEMENTED | `pending_initial_payment` until instalment 1 is received (`gateOpen`, lib/amc/payments.ts:289). The PPM schedule is made only on `active` (lib/server/amc/contract-lifecycle.ts:506). The board places visits and call outs only for active contracts (lib/server/amc/visits.ts:553, 613; call-outs.ts:192) | — | — | — |
| 5.8-17 | Authorised override keeps user and reason | IMPLEMENTED | `startWithoutPayment` at activation and `override_gate` on the Payments tab need AMC Payments Approve and a reason (lib/amc/contract-lifecycle.ts:131; lib/amc/payments.ts:359, 366-372). Stored in `gate_override_by/at/reason` (M/20261008100100:39-41) | — | — | — |
| 5.8-18 | Late first payment alert | IMPLEMENTED | `initial_payment_late` after `lateFirstPaymentDays` (default 7) to the owner and Finance, plus the follow-up to-do (lib/server/amc/payments.ts:1077-1110) | — | — | — |
| 5.8-19 | Zoho Finance invoices shown in the portal | EXT BLOCKED | Portal instalments, balance and ageing exist for when invoices arrive | Invoices against contract/client/instalment (DEV-387) | Finance: trigger and direction | Phase 15 |
| 5.8-20 | Receipts | EXT BLOCKED | Receipt numbers are recorded on portal payments (`receipt_no`) | Zoho Finance receipts against the instalment (DEV-387) | Same | Phase 15 |
| 5.8-21 | Outstanding balance | IMPLEMENTED | `summarizeBalance` / `outstandingOf` (lib/amc/payments.ts:214, 252), shown per contract (contract Payments tab), per client (client Payments tab) and for all (AMC → Payments) | — | — | — |
| 5.8-22 | Ageing | IMPLEMENTED | Buckets current / 1-30 / 31-60 / 61-90 / 90+ (`ageingBucket`, lib/amc/payments.ts:223-240), on the payments screens and in the commercial report "collections and ageing" (lib/amc/reports.ts) | — | — | — |
| 5.8-23 | Resend to the client | EXT BLOCKED | Instalment reminder (Email 4) can be sent on demand (`send_reminder`, lib/server/amc/payments.ts:856) | Resending Zoho Finance invoices/receipts (DEV-387) | Finance integration | Phase 15 |
| 5.8-24 | Overdue instalment creates a to-do | IMPLEMENTED | "Instalment overdue" to-do (`installment_overdue`) opened by the daily job, escalating after 7 days (lib/server/amc/payments.ts:1025-1043) | — | — | — |
| 5.8-25 | Client reminder | IMPLEMENTED | Email 4 sent automatically when an instalment falls due and when overdue (`sendInstalmentReminder`, lib/server/amc/payments.ts:856, called at :1008 and :1045); the prepared WhatsApp text (`messageInstallmentDue`) with a wa.me link | Automatic WhatsApp/SMS sending (DEV-422 automatic) | WhatsApp/SMS provider | Phase 15 |

## 5.9 Client profile, access rules and documents

The client master is Snagging's (`snagging_clients` / `snagging_properties`, Phase 6b). AMC-only fields live in `amc_client_profiles` / `amc_property_profiles` (M/20261007170000:67, 104), read through `amc_client_directory` / `amc_property_directory`. The client page (X/amc-contracts/customer-property-views.tsx `CustomerDetail`) has these tabs: overview, properties, contracts, payments, site visits, contacts, documents and communication log. The property page has overview (with the current AMC), contracts, site visits, assets, access rules, scope and documents.

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.9-01 | Individual or company | IMPLEMENTED | `customer_type` individual/company (M/20261007120000:19, now on `amc_client_profiles`). Badge and edit form (customer-property-views.tsx:351, 522) | — | — | — |
| 5.9-02 | Trade licence | IMPLEMENTED | `trade_license_no`, `trade_license_expiry` (M/20261007120000:23-24). Expiry warning on the client page (customer-property-views.tsx:368-381) | — | — | — |
| 5.9-03 | TRN | IMPLEMENTED | `trn` (M/20261007120000:25); identity card and edit form | — | — | — |
| 5.9-04 | Contacts: primary, alternate, accounts, tenant | IMPLEMENTED | `amc_customer_contacts` with roles primary/alternate/accounts/tenant/owner/signatory/site/other (M/20261007120000:37-56). Contacts tab (X/amc-contracts/profile/contacts-panel.tsx; lib/server/amc/client-profile.ts:138-200) | — | — | — |
| 5.9-05 | Properties | IMPLEMENTED | Shared `snagging_properties` via `amc_property_directory`. Properties tab and property page (customer-property-views.tsx:427-468, `PropertyDetail`) | — | — | — |
| 5.9-06 | Services | IMPLEMENTED | Property "Current AMC" card lists the services in force (customer-property-views.tsx `CurrentAmcCard`); contract coverage tab | — | — | — |
| 5.9-07 | Schedule | IMPLEMENTED | Phase 14 (working tree, 13 Oct): Schedule tab on the client page: every planned visit across the client's contracts (clientSchedule, api/amc-contracts/customers/[customerId]/history?part=schedule) | — | — | — |
| 5.9-08 | Contracts | IMPLEMENTED | Contracts tab (customer-property-views.tsx:469-479); property Contracts tab | — | — | — |
| 5.9-09 | Payments and cheques | IMPLEMENTED | ClientPaymentsPanel: open instalments, balance, ageing; Phase 14 (working tree, 13 Oct): the client's cheques (api/amc-payments?view=cheques&clientId) and payments received (history?part=payments) | — | — | — |
| 5.9-10 | Service history | IMPLEMENTED | Phase 14 (working tree, 13 Oct): Service history tab on the client page: visits done (with the service report), call outs and additional work, newest first (clientServiceHistory, history?part=service) | — | — | — |
| 5.9-11 | Allowances | IMPLEMENTED | Property "Current AMC" table, used vs included (customer-property-views.tsx `CurrentAmcCard`). Contract Call outs tab: used/booked/remaining and movements (X/amc-contracts/contract-call-outs-panel.tsx) | — | — | — |
| 5.9-12 | Documents | IMPLEMENTED | Client Documents tab lists everything that rolls up to the client (client, properties, contracts, visits) and uploads at client level (customer-property-views.tsx:489; X/amc-contracts/profile/documents-panel.tsx) | Per-level gaps: see 5.9-26 | — | — |
| 5.9-13 | Communication log | IMPLEMENTED | Manual entries and enquiry follow-ups; Phase 14 (working tree, 13 Oct): every portal send (Emails 1–4, appointment messages, service report, call-out acknowledgement, quotation, client report, prepared WhatsApp) is written as a system entry (logClientCommunication in recordSend, lib/server/amc/proposal-share.ts) | — | — | — |
| 5.9-14 | Marketing consent separate | IMPLEMENTED | `marketing_consent` with date, source and user, apart from the contact details (`setMarketingConsent`, lib/server/amc/client-profile.ts:69; audited). ConsentDialog (X/amc-contracts/profile/identity-card.tsx:114) | — | — | — |
| 5.9-15 | Prospect becomes client on signing and first payment | IMPLEMENTED | `prospectBecomesClient` (lib/server/amc/contract-state.ts:50) runs when the contract becomes active after the first instalment (lib/server/amc/payments.ts:518) or on the authorised override (contract-lifecycle.ts:503). Recorded in the status history | — | — | — |
| 5.9-16 | FSM customer linked behind the profile | IMPLEMENTED | Phase 14 (working tree, 13 Oct): fsmContactId on the client profile (amc_client_profiles.fsm_contact_id; customerProfileFields), edited and shown on the client page; contract-level FSM link as before | Creating the FSM customer when none exists | DEV-378 p2 (Phase 15) | — |
| 5.9-17 | Access type: community gate pass | IMPLEMENTED | `amc_property_access_rules.access_type` `community_gate_pass` (M/20261007120000:165-185, re-keyed to Snagging properties in M/20261007170000). Access rules tab (X/amc-contracts/profile/property-panels.tsx:420-660); feeds the visit access status (Phase 9) | — | — | — |
| 5.9-18 | Building permit | IMPLEMENTED | `building_permit` (same table and screen) | — | — | — |
| 5.9-19 | Security clearance | IMPLEMENTED | `security_clearance` | — | — | — |
| 5.9-20 | Lift booking | IMPLEMENTED | `lift_booking` | — | — | — |
| 5.9-21 | Key collection | IMPLEMENTED | `key_collection` | — | — | — |
| 5.9-22 | Lead time | IMPLEMENTED | `lead_time_days` (property-panels.tsx:475) | — | — | — |
| 5.9-23 | Permitted hours | IMPLEMENTED | `permitted_days`, `permitted_from`, `permitted_to` (property-panels.tsx:486; DayPicker :541) | — | — | — |
| 5.9-24 | Parking | IMPLEMENTED | `parking` (property-panels.tsx:487) | — | — | — |
| 5.9-25 | Notes | IMPLEMENTED | `notes` per access rule, plus issuer and contact (property-panels.tsx:493) | — | — | — |
| 5.9-26 | Documents per prospect, client, contract and visit | IMPLEMENTED | Client, property, contract and visit documents in amc_documents (api/amc-documents: visit and call-out levels added in Phase 14 (working tree, 13 Oct)); the contract Documents tab lists and uploads them; the visit Access tab uploads the gate pass | The signed archive (amc_signed_documents) and assessment photos stay in their own stores, linked from their records | — | — |
| 5.9-27 | Document category, version, date, user, expiry | IMPLEMENTED | `category`, auto `version` with `superseded_by`, `uploaded_at`, `uploaded_by`, `expires_on`, plus sha256 (M/20261007120000:219-243). Shown with expiry states and earlier versions (documents-panel.tsx:78-207) | — | — | — |

## 5.10 PPM schedule and service windows

**The PPM schedule is built** (Phase 8, M/20261008110000, not applied). It uses `amc_visits` (cycle, window, target, original target, reschedule count), `amc_visit_lines` (one per service-line occurrence, with home window, so a visit can hold several trades) and the append-only `amc_visit_changes`. The rules are per contract (`ppm_window_days`, attempt rule, `ppm_confirmed_at`). The tentative schedule is generated when the contract becomes active (`ensurePpmSchedule`, lib/server/amc/ppm.ts:471, called from lib/server/amc/contract-lifecycle.ts:506). The screen is the contract Schedule tab (X/amc-contracts/contract-schedule-panel.tsx), with every action in `ppmActionSchema` (lib/amc/ppm.ts:354).

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.10-01 | Tentative schedule generated on activation | IMPLEMENTED | `ensurePpmSchedule` → `generatePpmSchedule` (lib/server/amc/ppm.ts:375, 471) when the contract becomes active, after the payment gate or the override (contract-lifecycle.ts:506; payments.ts:407-420) | — | — | — |
| 5.10-02 | Per service line | IMPLEMENTED | One visit per PPM line occurrence; `amc_visit_lines` keyed to the entitlement (M/20261008110000:97-120; `buildPpmSchedule`, lib/amc/ppm.ts:206) | — | — | — |
| 5.10-03 | From the commencement date | IMPLEMENTED | `planLine` starts the first cycle on `commencementDate` (lib/amc/ppm.ts:166-204) | — | — | — |
| 5.10-04 | Spread evenly | IMPLEMENTED | Equal cycles, whole months when the term divides (6 a year = every 2 months), else equal days (lib/amc/ppm.ts:155-180) | — | — | — |
| 5.10-05 | Configurable holiday calendar | IMPLEMENTED | `calendar.weekendDays` and `calendar.holidays` (lib/amc/config.ts:122-127, UAE 2026–27 defaults). Working calendar section in AMC Configuration (X/amc/configuration/config-fields.ts:144-149; HolidaysInput, section-form.tsx:246) | — | — | — |
| 5.10-06 | Skips non-working days | IMPLEMENTED | `firstWorkingDay` / `isWorkingDay` pick the target on the first working day in the window (lib/amc/ppm.ts:97-118); also used when clubbing (:267) | — | — | — |
| 5.10-07 | Service cycle | IMPLEMENTED | `cycle_start` / `cycle_end` per visit (M/20261008110000:65-66) | — | — | — |
| 5.10-08 | Service window, configurable per contract | IMPLEMENTED | `window_start` / `window_end`; default `serviceWindowDays` 15 (lib/amc/config.ts:133). Per-contract `ppm_window_days` set by the `rules` action (M/20261008110000:37; lib/amc/ppm.ts:364-371) | — | — | — |
| 5.10-09 | Target date | IMPLEMENTED | `target_date` (M/20261008110000:69) | — | — | — |
| 5.10-10 | Preferred months or days set target dates | IMPLEMENTED | `preferred_months` / `preferred_days` from the property scope (`amc_scope_items`) feed `planLine`: a preferred month moves the window, preferred weekdays pick the target (lib/server/amc/ppm.ts:216-256; lib/amc/ppm.ts:172-190) | — | — | — |
| 5.10-11 | Team adjusts dates | IMPLEMENTED | `move` action (lib/server/amc/ppm.ts:487; Schedule tab) | — | — | — |
| 5.10-12 | Add or remove visits with a reason | IMPLEMENTED | `add` / `remove` with a required reason (lib/amc/ppm.ts:358-359); DB check `amc_visit_changes_reason_where_needed` (M/20261008110000:140-142) | — | — | — |
| 5.10-13 | Team confirms | IMPLEMENTED | `confirm` action sets `ppm_confirmed_at` / `ppm_confirmed_by` (M/20261008110000:34-35) | — | — | — |
| 5.10-14 | Confirmed schedule is the plan of record | IMPLEMENTED | After confirmation, moves outside the window are reschedules measured against the kept window (`windowAfterMove`, lib/amc/ppm.ts:242). Regeneration is refused once confirmed. Adherence report (lib/amc/reports.ts) | — | — | — |
| 5.10-15 | Moving inside the window is not a reschedule | IMPLEMENTED | `classifyMove` → `in_window`, no reason, logged `moved_in_window` (lib/amc/ppm.ts:227-239) | — | — | — |
| 5.10-16 | Moving outside needs a reason | IMPLEMENTED | `outside_window` needs a reason once confirmed; status Rescheduled, `reschedule_count` (lib/amc/ppm.ts:227-239; lib/server/amc/ppm.ts:487). Same rule on the Visit board (Phase 9) | — | — | — |
| 5.10-17 | Original date kept for adherence | IMPLEMENTED | `original_target_date` set on the first move outside the window (M/20261008110000:70-72); history in `amc_visit_changes` (append-only trigger) | — | — | — |
| 5.10-18 | Clubbing trades into one visit | IMPLEMENTED | `club` / `club_overlapping` (`clubbedWindow`, `clubbingGroups`, lib/amc/ppm.ts:267-310; `clubVisits`, lib/server/amc/ppm.ts:686). Several lines in one visit | — | — | — |
| 5.10-19 | Unclubbing | IMPLEMENTED | `separate` restores the line's home window on a new visit (lib/amc/ppm.ts:362; `home_*` columns, M/20261008110000:108-112) | — | — | — |
| 5.10-20 | Completion tracked per trade | IMPLEMENTED | `amc_visit_lines.status` per trade. The job sheet records each trade's outcome and only the remaining trade is re-planned (Phase 10, lib/server/amc/job-sheets.ts) | — | — | — |
| 5.10-21 | Visits completed | IMPLEMENTED | `ppmProgress.completed` (lib/amc/ppm.ts:322), from visits closed after supervisor review; Schedule tab stat (contract-schedule-panel.tsx:307) | — | — | — |
| 5.10-22 | Visits remaining | IMPLEMENTED | `ppmProgress.remaining` (contract-schedule-panel.tsx:313); allowance remaining in `summarizeContract` (lib/amc/contracts.ts) | — | — | — |
| 5.10-23 | Visits overdue | IMPLEMENTED | `ppmProgress.overdue`: window passed, not done (contract-schedule-panel.tsx:318; contract tab badge, contract-detail.tsx:205). Daily `ppm_overdue` notification (`runPpmOverdueSweep`, lib/server/amc/ppm.ts:737) | — | — | — |

## 5.11 Appointment confirmation, scheduling board and assignment

Built in Phase 9 (M/20261008120000, not applied): rules in `lib/amc/visits.ts`, server in `lib/server/amc/visits.ts`, routes `api/amc-board`, `api/amc-visits/[visitId]`, `api/amc-technicians/**`, screens AMC → Visit board (`X/amc-contracts/visit-board*.tsx`), the visit dialog (`X/amc-contracts/visit-detail-dialog.tsx`) and AMC → Technicians (`X/amc-contracts/technicians-page.tsx`). Daily job `visits` (`runVisitSweep`, `lib/server/amc/jobs.ts`).

**Confirmation**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.11-01 | Coordinator to-do N days before the window | IMPLEMENTED | `runVisitSweep` opens to-do `ppm_confirmation` and notification `ppm_confirmation_due` when `confirmationDue()` is reached; closed on client confirmation | — | — | — |
| 5.11-02 | Configurable lead days (7 in the meeting) | IMPLEMENTED | `scheduling.confirmationLeadDays` (lib/amc/config.ts), AMC configuration field (X/amc/configuration/config-fields.ts:158) | — | — | — |
| 5.11-03 | Client confirmation request by WhatsApp, SMS or email | EXT BLOCKED | `performVisitAction` `request_confirmation`: email sent (template `messageAppointmentConfirmation`), WhatsApp prepared as a wa.me link with copyable text; logged in `amc_send_log` and as an attempt. An SMS attempt can be logged, but no SMS is prepared or sent | Automatic WhatsApp/SMS sending | WhatsApp/SMS provider (DEV-422 automatic) | Phase 15 |
| 5.11-04 | Answer stored on the visit | IMPLEMENTED | `amc_visits.client_confirmation`, `confirmed_at`, `confirmation_channel`, `confirmation_note`; visit moves to Confirmed (`attempt` action) | — | — | — |
| 5.11-05 | Attempts logged (date, channel, outcome) | IMPLEMENTED | `amc_visit_attempts` (M/20261008120000:119); attempts list and "Log attempt" in the visit dialog | — | — | — |
| 5.11-06 | Configurable number of attempts | IMPLEMENTED | Default `scheduling.attemptCount`; per contract `amc_contracts.attempt_count` set on the Schedule tab (contract-schedule-panel.tsx:980-1066); `attemptState()` marks No answer when used up | — | — | — |
| 5.11-07 | Configurable minimum interval | IMPLEMENTED | Phase 14 (working tree, 13 Oct): the attempt action refuses a no-answer or message attempt before the interval since the last one (performVisitAction, lib/server/amc/visits.ts); the screen shows "next attempt from" | — | — | — |
| 5.11-08 | Escalation recipient | IMPLEMENTED | attempt_escalation_user_id notified on no answer with the owner; Phase 14 (working tree, 13 Oct): set per contract on the Schedule tab ("Escalate no-answer to") | No default in configuration: the owner is told when none is set | — | — |
| 5.11-09 | Two no-shows count as a consumed visit | IMPLEMENTED | `noShowConsumesVisit()` (lib/amc/job-sheets.ts:48) applied in `closeJobSheet` (consumption recorded); count from `scheduling.noShowsConsumeVisit` | — | — | — |

**Scheduling board.** AMC → Visit board is an AMC overlay on the day: AMC visits and call outs are placed on `amc_visits` / `amc_call_outs`; live board jobs (`schedule_entries`) and leave are read only, to show who is busy and to block double booking. Nothing is written to the live scheduling tables or FSM until visits are published (DEV-391, Phase 15).

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.11-10 | Drag and drop | IMPLEMENTED | Drag from the "AMC to place" panel or between rows (visit-board-grid.tsx `onDropNew`/`onDropPlaced`), confirmed in visit-board-dialogs.tsx | — | — | — |
| 5.11-11 | Change team | IMPLEMENTED | `reassign` board action sets the crew (several technicians, first is lead) (lib/server/amc/visits.ts `performBoardAction`) | — | — | — |
| 5.11-12 | Change technician | IMPLEMENTED | Same `reassign` action; drag to another technician row | — | — | — |
| 5.11-13 | Reschedule | IMPLEMENTED | `move` action via `dateChange()`: inside the window = move; outside after the plan is confirmed = reason required, status Rescheduled, `reschedule_count`, `amc_visit_changes` row | — | — | — |
| 5.11-14 | Update several in one action | IMPLEMENTED | `move` and `reassign` take up to 50 `visitIds` (lib/amc/visits.ts `boardActionSchema`); shift-click multi-select on the board (visit-board-grid.tsx:335) | — | — | — |
| 5.11-15 | Job details travel with the visit | IMPLEMENTED | `BoardVisit` / `VisitDetail` carry contract, client, property, services, window, confirmation and access; nothing retyped in the portal | Carrying them into FSM is part of the publish (5.11-30) | — | — |
| 5.11-16 | Original date kept | IMPLEMENTED | `amc_visits.original_target_date` set on the first reschedule (`dateChange()`), shown on the board and visit | — | — | — |

**Assignment**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.11-17 | Suggest trade and headcount from scope | BIZ BLOCKED | `crewNeed()` (trades from the visit lines via `tradeForService()`, duration from `scheduling.durationPerServiceMinutes` / `durationPerExtraUnitMinutes`, one technician per trade); `suggestForVisit()`; shown in the place dialog | — | BRD: standard durations to confirm (the configurable defaults are assumptions) | Phase 14 sign-off |
| 5.11-18 | Only confirmed-competent technicians | IMPLEMENTED | `amc_technician_skills` (trade, level, certificate expiry); `fitFor()` blocks "Not confirmed for this trade" / "Certificate expired"; `suggestForVisit()` lists only technicians covering a trade | — | — | — |
| 5.11-19 | Filter by shift | BIZ BLOCKED | Shift recorded per technician (technician_reference.shift) and shown on the board | Filtering by shift | Shift hours per shift to confirm | When confirmed: a fitFor blocker outside the technician's shift |
| 5.11-20 | Location | IMPLEMENTED | `amc_technician_profiles.areas`; `fitFor()` notes "Usually works another area" and ranks lower against the property community (soft filter) | — | — | — |
| 5.11-21 | Existing workload | IMPLEMENTED | `busyOn()` (AMC visits, call outs, live jobs read only, leave); overlaps block, `workloadMinutes` lowers the score | — | — | — |
| 5.11-22 | Team composition | BIZ BLOCKED | Crew of one technician per trade with a lead, headcount from the standard durations | Technician + helper pairs and teams | Team composition rule to confirm (helpers are not on the FSM roster) | When confirmed: suggestCrew composes the team |
| 5.11-23 | Vehicle | IMPLEMENTED | `amc_technician_profiles.has_vehicle`; `fitFor()` notes "No vehicle" and ranks lower | — | — | — |
| 5.11-24 | Driver | BIZ BLOCKED | Driver and vehicle captured on AMC → Technicians; 'No vehicle' noted in suggestions | A crew-level driver check | Whether every crew needs a driver to confirm | When confirmed: assignmentProblems checks the crew |
| 5.11-25 | Tools | BIZ BLOCKED | Tools captured per technician | Matching tools to a visit | Which services need which tools to confirm (no tool requirement exists per service) | When confirmed: a tools field per service and a fitFor check |
| 5.11-26 | Access permissions | IMPLEMENTED | `amc_technician_profiles.access_permissions` against the property's security-clearance rules; `fitFor()` blocker "No access permission" | — | — | — |
| 5.11-27 | Prevents double booking | IMPLEMENTED | `fitFor()` blocker "Already booked at that time"; `assignmentProblems()` refuses place/move/reassign (409) | — | — | — |
| 5.11-28 | Shows the day's workload | IMPLEMENTED | Place dialog shows "N booked that day" per candidate (visit-board-dialogs.tsx:352); board rows show each technician's day | — | — | — |
| 5.11-29 | Accept or override with a reason | IMPLEMENTED | `place` refuses a crew different from the suggestion without `overrideReason`; kept as `assignment_note` and audited | — | — | — |
| 5.11-30 | FSM appointment created | EXT BLOCKED | Visit placement stored on `amc_visits` (overlay) | FSM work order / appointment for the visit | One FSM work order per contract or per visit (DEV-391) | Phase 15 |

**Access**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.11-31 | Visit shows the property access rule | IMPLEMENTED | Phase 14 (working tree, 13 Oct): the visit carries every active property access rule (accessRules: type, issuer, lead time, permitted days and hours, parking, contact, notes; loadVisitContext) and the visit dialog's Access tab lists them; security clearances still filter technicians | — | — | — |
| 5.11-32 | Access status: not required, pending, approved, rejected, expired | IMPLEMENTED | `amc_visits.access_status` (`ACCESS_STATUSES`), set by the sweep from the property's rules and in the visit dialog; approved passes past `access_valid_until` become Expired | Pass upload from the visit dialog (a pass already in the visit/contract documents is linked) | — | — |
| 5.11-33 | Alert when a visit is near without access | IMPLEMENTED | `accessAlertDue()` in `runVisitSweep`: to-do `access_gate_pass` and notification `visit_access_pending`, `scheduling.accessAlertDaysBefore` | — | — | — |
| 5.11-34 | Client reminder the day before | IMPLEMENTED | `runVisitSweep` emails `messageAppointmentReminder` the day before a placed visit (`client_reminder_sent_at`), logged in `amc_send_log` | Automatic WhatsApp/SMS copy | WhatsApp/SMS provider (DEV-422 automatic) | — |
| 5.11-35 | Technician reminder on the day | EXT BLOCKED | none in the portal (visits are not in FSM yet) | Reminder through the FSM app once visits are published | FSM publish (DEV-391) and FSM dispatch notification | Phase 15 |

## 5.12 Job execution and closure

The technician side is the Zoho FSM mobile app (BRD §3). FSM rows still need AMC configuration in FSM: asset checklist, allowance flag, additional work, pending works, client signature (§3, §5.17). Since Phase 10 (M/20261012110000, not applied) the portal keeps the same record as a job sheet on the visit (`amc_visit_job_sheets`, `amc_visit_checklist_items`, `amc_visit_photos`; `lib/server/amc/job-sheets.ts`; Job sheet tab, `X/amc-contracts/job-sheet-panel.tsx`; `api/amc-visits/[visitId]/job-sheet/**`), with supervisor review on AMC → Job reviews (`X/amc-contracts/job-reviews-page.tsx`, `api/amc-job-reviews`). Filling it from the FSM job sheet is DEV-400 (Phase 15).

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.12-01 | Technician gets the job | FSM | FSM app | AMC visits reach FSM only once published (DEV-391) | — | — |
| 5.12-02 | Client, property, contact, access notes | FSM | FSM work order | AMC access rules not pushed to FSM | DEV-391 | Phase 15 |
| 5.12-03 | Scope | FSM | FSM service lines | AMC scope not pushed | DEV-391 | Phase 15 |
| 5.12-04 | Property history | FSM | — | Needs FSM Assets per property | FSM config | Phase 15 |
| 5.12-05 | Arrival time | FSM | FSM app; portal job sheet `arrived_at` (moves the visit to In progress) | FSM `Actual_Start` into the portal job sheet | DEV-400 | Phase 15 |
| 5.12-06 | Completion time | FSM | FSM `Actual_End`; portal job sheet `completed_at` | — | — | — |
| 5.12-07 | Before/after photos per asset | FSM | FSM app; portal `amc_visit_photos` (kind before/after/fault, `asset_id`, `visit_line_id`) | Per-asset structure in FSM | FSM config | Phase 15 |
| 5.12-08 | Checklist per asset | FSM | FSM app; portal `amc_visit_checklist_items` per trade line and asset | FSM job-sheet checklist | FSM config | Phase 15 |
| 5.12-09 | Faults | FSM | FSM app; portal job sheet `faults` and fault photos | FSM field | FSM config | Phase 15 |
| 5.12-10 | Consumables (link to Inventory) | FSM | FSM app; portal job sheet `consumables` (item, quantity, unit) | Inventory link | Inventory process | Phase 15 |
| 5.12-11 | Additional work found | IMPLEMENTED | Job sheet `additional_work`; "Raise" on a submitted/closed sheet creates `amc_additional_works` with `source = 'visit'` (job-sheet-panel.tsx:317, raise-additional-work-dialog.tsx) | FSM field (DEV-400) | — | — |
| 5.12-12 | Pending works with a reason | IMPLEMENTED | Job sheet `pending_works` (reason required by `submitProblems()`); makes review mandatory | FSM field (DEV-400) | — | — |
| 5.12-13 | Client signature | FSM | FSM native; portal records the signer's name (`client_signature_name`, `client_signed_at`), no drawn signature | — | — | — |
| 5.12-14 | Works offline | EXT BLOCKED | FSM native (to verify) | Verified and documented offline behaviour | What the FSM app supports offline (DEV-401) | Phase 15 |
| 5.12-15 | Syncs when online | EXT BLOCKED | App to FSM native; FSM to the portal job sheet not built | Verification (DEV-401); FSM job sheet into the portal (DEV-400) | DEV-401, DEV-400 | Phase 15 |
| 5.12-16 | Submitting does not close the visit | IMPLEMENTED | `saveJobSheet(submit)` sets the sheet and visit to Submitted, never Completed | — | — | — |
| 5.12-17 | Supervisor reviews and closes | IMPLEMENTED | To-do `job_closure_review` + notification `job_sheet_awaiting_review`; `closeJobSheet` from AMC → Job reviews (supervisors from configuration, level 1 approvers, or AMC Visits Approve) | — | — | — |
| 5.12-18 | Mandatory review rules | IMPLEMENTED | `reviewReasons()` (pending works, quality concern, missing evidence, incomplete scope) stored as `review_required` / `review_reasons` and shown in the queue | — | — | — |
| 5.12-19 | Return workflow | IMPLEMENTED | `returnJobSheet` (comment required, `return_count`), visit back to In progress, notification `job_sheet_returned` | — | — | — |
| 5.12-20 | Not Scheduled | IMPLEMENTED | `VISIT_STATUSES` (lib/amc/ppm.ts:15; M/20261008110000:59); generated visits start Not scheduled | — | — | — |
| 5.12-21 | Scheduled | IMPLEMENTED | Set when the plan is confirmed as plan of record (lib/server/amc/ppm.ts:672) and on remainder visits | — | — | — |
| 5.12-22 | Confirmed | IMPLEMENTED | Set on client confirmation (`performVisitAction` `attempt` outcome confirmed) | — | — | — |
| 5.12-23 | In Progress | IMPLEMENTED | Set when arrival is recorded on the portal job sheet, and on return | FSM status feed (DEV-400) | — | — |
| 5.12-24 | Submitted | IMPLEMENTED | `saveJobSheet(submit)` | — | — | — |
| 5.12-25 | Completed | IMPLEMENTED | `closeJobSheet` → `closedStatus()` | — | — | — |
| 5.12-26 | Completed with Additional Work | IMPLEMENTED | `closedStatus()` when every trade is done and additional work was found | — | — | — |
| 5.12-27 | Partially Completed | IMPLEMENTED | `closedStatus()` | — | — | — |
| 5.12-28 | Pending Access | IMPLEMENTED | Phase 14 (working tree, 13 Oct): a pending, rejected or expired pass moves a waiting visit to pending_access; an approved or not-required pass moves it back to confirmed or scheduled (performVisitAction access) | — | — | — |
| 5.12-29 | Rescheduled | IMPLEMENTED | `dateChange()` on a move outside the window after confirmation | — | — | — |
| 5.12-30 | Not Completed | IMPLEMENTED | `closedStatus()`; each trade carries a reason group (`amc_visit_lines.outcome_group`, DB check `amc_visit_lines_not_done_explained`) | — | — | — |
| 5.12-31 | Cancelled | IMPLEMENTED | Visit removal with a required reason (M/20261008110000:86); contract hold/termination handling (lib/server/amc/amendments.ts:333) | — | — | — |
| 5.12-32 | Five non-completion reason groups | IMPLEMENTED | `OUTCOME_GROUPS` with sub-reasons (lib/amc/job-sheets.ts:23); required on Not/Partially completed trades | — | — | — |
| 5.12-33 | Partial clubbed visit: remaining trade rescheduled without reopening | IMPLEMENTED | `remainingTrades()` + `planRemainder()`: new remainder visit, lines point back via `retry_of_line_id`; closed visit untouched; a partly done trade is not counted twice | — | — | — |
| 5.12-34 | Report to the client within 48 hours | IMPLEMENTED | `report_due_at` = completion + 48 h (`reportDueAt()`); `sendServiceReport` (stored PDF, Email 3, prepared WhatsApp link) on close; `runJobSheetSweep` sends "Service report due soon / late" | — | — | — |

## 5.13 Call outs and reactive maintenance

**Call outs are an entity since Phase 11** (M/20261012120000, not applied): `amc_call_outs`, rules in `lib/amc/call-outs.ts`, server in `lib/server/amc/call-outs.ts`, routes `api/amc-call-outs/**`, screens AMC → Call outs (`X/amc-contracts/call-outs-page.tsx`, `log-call-out-dialog.tsx`, `call-out-detail-dialog.tsx`) and the contract's Call outs tab. Daily job `call_outs`.

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.13-01 | Logged from call, WhatsApp or email | IMPLEMENTED | `createCallOut`; `channel` call / whatsapp / email / portal | — | — | — |
| 5.13-02 | Against the contract | IMPLEMENTED | `amc_call_outs.contract_id`; active or on-hold contracts only | — | — | — |
| 5.13-03 | Property | IMPLEMENTED | The contract's property (`amc_contracts.property_id` / `property_label`), shown on the call out | — | — | — |
| 5.13-04 | Reported issue | IMPLEMENTED | `issue` (required), `trade` | — | — | — |
| 5.13-05 | Photos | IMPLEMENTED | `amc_work_photos` (kind reported/before/after/finding); `api/amc-call-outs/[id]/photos`; Photos tab | — | — | — |
| 5.13-06 | Contact on site | IMPLEMENTED | `on_site_contact_name`, `on_site_contact_phone` | — | — | — |
| 5.13-07 | Priority emergency / non-emergency | IMPLEMENTED | `priority` emergency / non_emergency | — | — | — |
| 5.13-08 | Entitlement check before confirming | IMPLEMENTED | `checkCallOutCoverage()` (quantity, labour, materials vs value limit, exclusions); `api/amc-call-outs/coverage` re-runs live in the log dialog before saving | — | — | — |
| 5.13-09 | Covered/chargeable told to coordinator and client | IMPLEMENTED | Coverage panel with reasons and balance for the coordinator; acknowledgement `messageCallOutAcknowledgement` with the coverage line, prepared for WhatsApp (`amc_send_log`), `acknowledged` action | Automatic sending | WhatsApp provider (DEV-422 automatic) | — |
| 5.13-10 | Emergency logged within 60 minutes | IMPLEMENTED | `loggedInTime()` against `sla.emergencyLogMinutes`, shown on the call out | — | — | — |
| 5.13-11 | Emergency attended within 120 minutes | IMPLEMENTED | `slaDeadlines()` with `sla.emergencyAttendMinutes` (120); `slaState()` at risk at `atRiskPercent`, met/missed from the attendance time recorded in the portal (`attend` → `sla_met`) | FSM arrival timestamp instead of the hand-entered time | Zoho FSM timestamps (DEV-406 FSM part) | Phase 15 |
| 5.13-12 | Non-emergency scheduled within 48 hours | IMPLEMENTED | `sla.nonEmergencyScheduleHours` (48) → `sla_schedule_due_at`, measured against attendance; the old 6 h definition is gone | FSM booking/arrival timestamps | Zoho FSM timestamps (DEV-406 FSM part) | Phase 15 |
| 5.13-13 | Minor fix up to 2 hours | IMPLEMENTED | `needsAdditionalWork()` with `sla.minorFixHours` (2): the record step prompts to quote additional work when parts are needed or time on site exceeds it | — | — | — |
| 5.13-14 | Becomes an FSM appointment | EXT BLOCKED | Portal scheduling of the call out (`schedule` action, slot and crew on `amc_call_outs`) | FSM appointment | DEV-391 | Phase 15 |
| 5.13-15 | Same assignment rules as PPM | IMPLEMENTED | Phase 14 (working tree, 13 Oct): call-out scheduling uses fitFor with the property's security clearances (callOutNeed), refuses blockers, and needs a reason for a crew other than the suggested one (server and dialog) | Shift, team, driver and tools as in 5.11 (to confirm) | — | — |
| 5.13-16 | Emergencies ahead of planned work | IMPLEMENTED | Board side panel lists open call outs emergencies first (`openCallOuts()`); an emergency can be attended straight from Logged | — | — | — |
| 5.13-17 | Attendance time | FSM | FSM app; portal `attended_at` (`attend` action) settles the SLA | FSM timestamp mapping | DEV-406 FSM part | Phase 15 |
| 5.13-18 | Diagnosis | FSM | FSM app; portal `diagnosis` (`record` action) | FSM field | FSM config | Phase 15 |
| 5.13-19 | Resolution | FSM | FSM app; portal `resolution` | FSM field | FSM config | Phase 15 |
| 5.13-20 | Pending works | IMPLEMENTED | `pending_works` with reasons (`record` outcome pending_works requires them); status Pending works | — | — | — |
| 5.13-21 | Parts needed | FSM | FSM app; portal `parts_needed` | Inventory link | Inventory process | Phase 15 |
| 5.13-22 | Over 2 h or parts: quoted as additional work | IMPLEMENTED | Prompt from `needsAdditionalWork()`; raise from the call out (`amc_additional_works.call_out_id`); call out moves to Quoted when shared (`followCallOut`) | — | — | — |
| 5.13-23 | Stays open until that work is done or declined | IMPLEMENTED | `close` refuses while any linked additional work is not in `SETTLED_ADDITIONAL_WORK` | — | — | — |
| 5.13-24 | Statuses Logged … Closed | IMPLEMENTED | `CALL_OUT_STATUSES` with allowed moves (`canMoveCallOut`), plus Cancelled with reason; status history | — | — | — |
| 5.13-25 | SLA misses flagged for reporting | IMPLEMENTED | `sla_met`; daily `call_outs` job notifies "SLA at risk / missed"; Reports → Call outs by priority (met/missed) | — | — | — |
| 5.13-26 | Misuse of the emergency line flagged | IMPLEMENTED | `flag_misuse` action (emergencies only, note required), `misuse_flag`; counted in the call-out report | — | — | — |

## 5.14 Additional works and entitlements

**Additional works** (`amc_additional_works`, M/20261012120000; `lib/server/amc/additional-works.ts`; AMC → Additional work, `X/amc-contracts/additional-works-page.tsx`, `additional-work-detail-dialog.tsx`, `raise-additional-work-dialog.tsx`; `api/amc-additional-works/**`). The older `amc_additional_quotes` (M/20261006130000) is still what the client page shows.

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.14-01 | Raised from a PPM visit or call out | IMPLEMENTED | `source` visit / call_out / manual with `visit_id` / `call_out_id` (check `amc_additional_works_source_link`); raised from the job sheet and the call out | — | — | — |
| 5.14-02 | Linked to the contract | IMPLEMENTED | `contract_id NOT NULL` | — | — | — |
| 5.14-03 | Linked to the property | IMPLEMENTED | Through the contract's property (`amc_contracts.property_id`, label on the record) | — | — | — |
| 5.14-04 | Linked to the technician | IMPLEMENTED | Phase 14 (working tree, 13 Oct): technician picked from the FSM roster on Raise additional work and the finding editor, defaulting to the visit's or call out's lead technician | — | — | — |
| 5.14-05 | Technical finding kept apart from the commercial part | IMPLEMENTED | `finding`, `trade`, `risk` separate from `quotation_lines` and totals; separate sections in the detail dialog | — | — | — |
| 5.14-06 | Photos | IMPLEMENTED | `amc_work_photos.additional_work_id` (finding/before/after); `api/amc-additional-works/[id]/photos` | — | — | — |
| 5.14-07 | Risk | IMPLEMENTED | `risk` low / medium / high / safety | — | — | — |
| 5.14-08 | Commercial quotation | IMPLEMENTED | `quote` action: labour and material lines, `quotationTotals()` (fee, VAT); quotation PDF on share | — | — | — |
| 5.14-09 | Requester, approver, payer, invoice recipient, report recipient | IMPLEMENTED | Five jsonb parties defaulting to the client (`WORK_PARTIES`), editable | — | — | — |
| 5.14-10 | Status Identified | IMPLEMENTED | `ADDITIONAL_WORK_STATUSES` (default `identified`) | — | — | — |
| 5.14-11 | Quotation Prepared | IMPLEMENTED | `quote` → `quotation_prepared` | — | — | — |
| 5.14-12 | Shared | IMPLEMENTED | `share`: emails the quotation PDF to the approver, prepares WhatsApp, notification `additional_work_awaiting_approval` | — | — | — |
| 5.14-13 | Approved with evidence | IMPLEMENTED | `approve` requires evidence (DB check `amc_additional_works_approval_evidence`) | — | — | — |
| 5.14-14 | Rejected | IMPLEMENTED | `reject` with required reason | — | — | — |
| 5.14-15 | Scheduled | IMPLEMENTED | `schedule` (`scheduled_for`) | FSM appointment (DEV-391) | — | — |
| 5.14-16 | Completed | IMPLEMENTED | `complete` (`completed_at`); releases its call out | — | — | — |
| 5.14-17 | Invoiced | IMPLEMENTED | `invoice` with invoice number and date (DB check) | Invoice created in Zoho Finance instead of typed | Zoho Finance (DEV-387) | Phase 15 |
| 5.14-18 | Paid | IMPLEMENTED | `pay` with date and reference | Receipt from Zoho Finance | Zoho Finance (DEV-387) | Phase 15 |
| 5.14-19 | 20% material handling fee | IMPLEMENTED | `additionalWork.materialHandlingFeePercent` (default 20) copied to `material_fee_percent`; `quotationTotals()` | — | — | — |
| 5.14-20 | Totals roll up to contract and client | IMPLEMENTED | additionalWorkRollup per contract (contract Call outs tab); Phase 14 (working tree, 13 Oct): the client's totals across contracts on the client page (clientAdditionalWorkTotals, history?part=additional_work) | — | — | — |

**Entitlements and allowances** (ledger M/20261006100000:165-276; corrections M/20261006110000; reserve/release M/20261012120000)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.14-21 | Contract defines what is included | IMPLEMENTED | Entitlements created at activation | — | — | — |
| 5.14-22 | Checked when a call out or service is booked | IMPLEMENTED | `checkCallOutCoverage()` before a call out is confirmed; PPM visits are generated from the entitlements; read-only notice in the live scheduling dialog (amc-work-order-notice.tsx) | — | — | — |
| 5.14-23 | Used | IMPLEMENTED | `used_quantity` kept by trigger `amc_apply_entitlement_usage` | — | — | — |
| 5.14-24 | Reserved | IMPLEMENTED | `reserved_quantity` (kinds `reserve` / `release`); used, booked, remaining per allowance on the contract's Call outs tab and in the client report | — | — | — |
| 5.14-25 | Remaining | IMPLEMENTED | `allowanceBalance()` (included − used − reserved) | — | — | — |
| 5.14-26 | Booking reserves one unit | BIZ BLOCKED | Covered call outs reserve a unit on booking, consume on closure, release on cancel (Phase 11) | PPM visits do not reserve on placement: they consume at closure | Decision recorded (Phase 11): the planned visits are the allowance itself; confirm or ask for PPM reservations | — |
| 5.14-27 | Consumed only on completion | IMPLEMENTED | PPM: `closeJobSheet` on supervisor closure; call out: reservation consumed on `close` | — | — | — |
| 5.14-28 | Cancelled visit releases the unit | IMPLEMENTED | Call-out `cancel` releases the reservation (`settleReservation`); a cancelled PPM visit is never consumed | — | — | — |
| 5.14-29 | Failed visit releases the unit | IMPLEMENTED | Call out closed as chargeable releases; a Not completed PPM trade is not consumed (except the BRD no-show rule) and is planned again | — | — | — |
| 5.14-30 | Reversals possible | IMPLEMENTED | Correction entries (`recordCorrection`, lib/server/amc/contract-operations.ts:201) | — | — | — |
| 5.14-31 | Corrections possible | IMPLEMENTED | api/amc-contracts/[id]/usage/[usageId]/correction | — | — | — |
| 5.14-32 | With a reason | IMPLEMENTED | Required reason (M/20261006110000:49-55); release/cancel notes carry the reason | — | — | — |
| 5.14-33 | Every movement in an audit trail | IMPLEMENTED | Append-only ledger incl. reserve/release + `amc_audit_events`; movements listed on the Call outs tab | — | — | — |
| 5.14-34 | Warns near zero | IMPLEMENTED | `nearZero()` with `allowances.warningRemaining`; `notifyEntitlementState` (entitlement low / exhausted) | — | — | — |
| 5.14-35 | Blocks chargeable recorded as free without authorisation | IMPLEMENTED | Booking a chargeable call out as covered needs AMC Allowances Approve and a reason (`createCallOut`, `coverage_override_reason`); over-allowance usage refused (DB check) | — | — | — |
| 5.14-36 | Balance shown at booking so the client hears first | IMPLEMENTED | Coverage panel shows the balance before saving; acknowledgement tells the client covered or chargeable before the visit | — | — | — |
| 5.14-37 | Reset basis | BIZ BLOCKED | allowances.resetBasis in configuration (contract_year / contract_term) | Applying a yearly reset on contracts longer than 12 months | BRD 'reset basis to confirm' (Q7) | When confirmed: reset per contract year |

## 5.15 Reports and dashboard

Phase 12 (M/20261012130000, not applied): Reports page (AMC Reports permission; `X/amc-contracts/amc-reports.tsx`, `amc-insights.tsx`; `api/amc-insights`) for a chosen period, CSV/Excel export per table. Rules in `lib/amc/reports.ts`, queries in `lib/server/amc/insights.ts`; client report in `lib/server/amc/client-report.ts` (`api/amc-contracts/[id]/client-report`, `X/amc-contracts/client-report-dialog.tsx`).

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.15-01 | Client report per contract, on demand | IMPLEMENTED | `clientReportFacts` / `clientReportHtml`; preview and send from the contract | — | — | — |
| 5.15-02 | — scope | IMPLEMENTED | "Your plan and allowances" section | — | — | — |
| 5.15-03 | — visits completed with dates | IMPLEMENTED | Visits done with completion dates | — | — | — |
| 5.15-04 | — photos | IMPLEMENTED | Up to two before/after photos per visit from `amc_visit_photos` (signed URLs) | FSM photos once DEV-400 maps them | — | — |
| 5.15-05 | — call outs attended | IMPLEMENTED | Call outs section from `amc_call_outs` | — | — | — |
| 5.15-06 | — additional works and cost | IMPLEMENTED | Additional work section with totals from `amc_additional_works` | — | — | — |
| 5.15-07 | — allowances used and remaining | IMPLEMENTED | Used, booked, remaining per service | — | — | — |
| 5.15-08 | — visits remaining | IMPLEMENTED | "Visits remaining" section with windows | — | — | — |
| 5.15-09 | Residential and commercial templates | IMPLEMENTED | `clientReport.residentialIntro` / `commercialIntro` (and closing) in AMC configuration, chosen by the contract's category | — | — | — |
| 5.15-10 | Sent by email | IMPLEMENTED | `sendClientReport`: PDF stored as a contract document and emailed to the client, owner copied | — | — | — |
| 5.15-11 | Sent by WhatsApp | IMPLEMENTED | Prepared WhatsApp text with the report link (wa.me) | Automatic sending | WhatsApp provider (DEV-422 automatic) | — |
| 5.15-12 | Schedule adherence against windows | IMPLEMENTED | `adherence()` (inside, early, late); "Schedule adherence" | — | — | — |
| 5.15-13 | Visits due | IMPLEMENTED | `visitBacklog().due` | — | — | — |
| 5.15-14 | Visits overdue | IMPLEMENTED | `visitBacklog().overdue`; daily `ppm_overdue` job | — | — | — |
| 5.15-15 | Pending by reason group | IMPLEMENTED | `visitBacklog().byReasonGroup` (five groups) | — | — | — |
| 5.15-16 | Call outs by priority, SLA met or missed | IMPLEMENTED | `callOutStats()`: met, missed, open, covered/chargeable, misuse | FSM timestamps (DEV-406 FSM part) | — | — |
| 5.15-17 | Contracts at risk of ending incomplete | IMPLEMENTED | `contractsAtRisk()` (overdue visit, or more visits left than half-months to the end) | — | — | — |
| 5.15-18 | Technician utilisation | IMPLEMENTED | `utilisation()` (AMC time booked vs working days); visits by technician | — | — | — |
| 5.15-19 | Allowance use | IMPLEMENTED | `allowanceUse()` with chargeable call outs; "Allowance use" | — | — | — |
| 5.15-20 | Access failures by community | IMPLEMENTED | `accessFailures()` from trade outcome groups (access, client "No access given") by community | — | — | — |
| 5.15-21 | Proposals and conversion | IMPLEMENTED | `proposalConversion()`; enquiry funnel by source, owner, month with lost reasons | — | — | — |
| 5.15-22 | Discounts by level | IMPLEMENTED | `discountsByLevel()` against the configured approval thresholds | — | — | — |
| 5.15-23 | Signed value by period and category | IMPLEMENTED | `signedValue()` by month and residential/commercial | — | — | — |
| 5.15-24 | Collections and ageing | IMPLEMENTED | `collections()`, `ageing()` | — | — | — |
| 5.15-25 | Cheques by status | IMPLEMENTED | `chequesByStatus()` | — | — | — |
| 5.15-26 | Additional work revenue | IMPLEMENTED | `workRevenue()` (quoted, approved, rejected, invoiced, paid, approval rate) | — | — | — |
| 5.15-27 | Renewals | IMPLEMENTED | `renewalOutcomes()`; AMC → Renewals | — | — | — |
| 5.15-28 | Profitability: contract revenue | EXT BLOCKED | Revenue data exists (`grand_total`) | Profitability view (needs the costs below) | Cost source (DEV-413) | Phase 15 |
| 5.15-29 | — additional work revenue | EXT BLOCKED | Data exists (`amc_additional_works.total`) | In the profitability view | DEV-413 | Phase 15 |
| 5.15-30 | — actual labour hours | EXT BLOCKED | none | Data | FSM timesheets (DEV-413) | Phase 15 |
| 5.15-31 | — material cost | EXT BLOCKED | none | Data | Inventory / Zoho Finance (DEV-413) | Phase 15 |
| 5.15-32 | — subcontractor cost | EXT BLOCKED | none | Data | Zoho Finance (DEV-413) | Phase 15 |
| 5.15-33 | — other direct costs | EXT BLOCKED | none | Data | Zoho Finance (DEV-413) | Phase 15 |
| 5.15-34 | — per contract and client | EXT BLOCKED | none | View | DEV-413 | Phase 15 |
| 5.15-35 | Dashboard: pipeline | IMPLEMENTED | `managementDashboard().pipeline`: open enquiries by stage, proposals by status | — | — | — |
| 5.15-36 | Dashboard: contracts | IMPLEMENTED | Contracts by status and active value; `amc_contracts_dashboard` (M/20261006140000:84-171), contracts-summary.tsx | — | — | — |
| 5.15-37 | Dashboard: approvals | IMPLEMENTED | Pending proposal approval steps for the caller, job sheets awaiting review | — | — | — |
| 5.15-38 | Dashboard: delivery | IMPLEMENTED | Visits due this week, overdue, open call outs and emergencies, SLA missed (pending access always 0, see 5.12-28) | — | — | — |
| 5.15-39 | Dashboard: workforce | IMPLEMENTED | Utilisation over the next 7 days | — | — | — |
| 5.15-40 | Dashboard: commercial | IMPLEMENTED | Signed and collected this month, overdue, quotations awaiting the client | — | — | — |
| 5.15-41 | Dashboard: renewals in 30, 60, 90 days | IMPLEMENTED | `renewalWindows()`; Renewals group | — | — | — |

## 5.16 Renewal, amendments and termination

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.16-01 | Reminder 30 days before expiry, configurable 30–60 | IMPLEMENTED | `renewals.leadDays` int(30, 60), default 30 (lib/amc/config.ts renewalsSchema); daily job `renewals` → runRenewalSweep opens the reminder at the lead time (lib/server/amc/renewals.ts; lib/server/amc/jobs.ts, called by the external scheduler on api/amc-jobs/run or "Run now") | — | — | — |
| 5.16-02 | Owner reminded | IMPLEMENTED | runRenewalSweep: `renewal_due` notification and to-do to the proposal owner | — | — | — |
| 5.16-03 | Management reminded | IMPLEMENTED | `renewals.notifyManagement` (default on); renewalManagement() = level 2 approvers, else level 1 (renewals.ts) | — | — | — |
| 5.16-04 | Renewals-due view | IMPLEMENTED | AMC → Renewals (X/amc-contracts/renewals-page.tsx; api/amc-renewals → renewalsDue): due, idle, ended without renewal, recent outcomes, suggested escalated total; own permission AMC Renewals | — | — | — |
| 5.16-05 | Escalation if nothing happens | IMPLEMENTED | renewalStage() "idle" after `idleEscalationDays` (default 15) → `renewal_idle` to management; the "Renewal due" to-do escalates at the same time (lib/amc/renewal-outcomes.ts; renewals.ts) | — | — | — |
| 5.16-06 | Renewal proposal drafted from the expiring contract | IMPLEMENTED | createRenewalProposal (api/amc-contracts/[id]/renewal POST); buildRenewalDraft (lib/amc/renewal.ts) | — | — | — |
| 5.16-07 | Configurable escalation percent | IMPLEMENTED | `renewals.escalationPercent` (default 5) applied to last year's base prices in buildRenewalDraft; shown on the Renewal tab and Renewals page | — | — | — |
| 5.16-08 | Past year's visits, call outs, additional works, allowance use beside the draft | IMPLEMENTED | pastYearSummary (renewals.ts) returned by GET api/amc-contracts/[id]/renewal; PastYearBlock on the contract Renewal tab (X/amc-contracts/contract-renewal.tsx) | — | — | — |
| 5.16-09 | Sent through the normal flow | IMPLEMENTED | The renewal is a normal proposal (ladder, sharing, contract) | — | — | — |
| 5.16-10 | New contract linked to the old | IMPLEMENTED | `renewed_from_contract_id`; `renewal_of_contract_id` on the proposal | — | — | — |
| 5.16-11 | Outcome: Renewed | IMPLEMENTED | runRenewalSweep sets `renewed` when the successor contract exists (renewedOutcome, lib/amc/renewal-outcomes.ts) | — | — | — |
| 5.16-12 | Outcome: Renewed with Revised Scope | IMPLEMENTED | renewedOutcome() compares old and new entitlements → `renewed_revised_scope`; M/20261012140000 | — | — | — |
| 5.16-13 | Outcome: Under Negotiation | IMPLEMENTED | Manual outcome `under_negotiation` (renewalOutcomeSchema; api/amc-contracts/[id]/renewal/outcome; Record outcome on Renewal tab and Renewals page); blocks the automatic Lapsed | — | — | — |
| 5.16-14 | Outcome: Not Renewed with a reason | IMPLEMENTED | Manual `not_renewed`, reason required (renewalOutcomeSchema refine); stored in `renewal_outcome_reason`, status history entity `renewal` | — | — | — |
| 5.16-15 | Outcome: Lapsed | IMPLEMENTED | runRenewalSweep sets `lapsed` when the contract ended with nothing renewing it and no negotiation; also recordable by hand | — | — | — |
| 5.16-16 | Scope change with approval | IMPLEMENTED | Amendment `scope_change` (add services or replace contract): requested with reason, decided by another AMC approver, applying opens the new proposal (lib/amc/amendments.ts; lib/server/amc/amendments.ts draftForScopeChange; X/amc-contracts/contract-amendments-panel.tsx) | — | — | — |
| 5.16-17 | Property change with approval | IMPLEMENTED | Amendment `property_change` (applyAmendment moves property_id / label) | — | — | — |
| 5.16-18 | Hold with approval | IMPLEMENTED | Amendments `hold` / `resume`: status On hold pauses the schedule; resume re-plans passed visits (replanAfterHold) | — | — | — |
| 5.16-19 | Transfer to a new owner or tenant | IMPLEMENTED | Amendment `transfer` (new owner/tenant, optional client link) | — | — | — |
| 5.16-20 | Early termination | IMPLEMENTED | Amendment `early_termination`; the daily `renewals` job terminates on the effective date and cancels later visits (cancelVisitsFrom). Note: the approver-only "Terminate" on the contract menu (api/amc-contracts/[id]/lifecycle) still terminates at once without notice or refund | — | — | — |
| 5.16-21 | Cancellation with approval | IMPLEMENTED | Amendment `cancellation` (before start), decided by a different approver; legacy approver-only Cancel (api/amc-contracts/[id]/cancel) with reason, audited | — | — | — |
| 5.16-22 | 30 days' notice | IMPLEMENTED | terminationEffective(): notice date + 30 days, or later if asked (lib/amc/amendments.ts) | — | — | — |
| 5.16-23 | Pro-rata refund with a valid reason | IMPLEMENTED | proRataRefund(): received minus the value of the days served, zero without a valid reason; stored in `termination_refund`. Paying the refund out is Zoho Finance (Phase 15, DEV-387) | — | — | — |
| 5.16-24 | Reason handling | IMPLEMENTED | Every amendment needs a reason; the approver ticks "The reason is valid" for a termination (amendmentActionSchema `validReason`), which decides the refund | — | — | — |

## 6.1 Emails

**Email 1: Proposal shared** (api/amc-submissions/send/route.ts; lib/server/amc/proposal-share.ts proposalShareTexts; template `emailProposalShared` in lib/amc/message-templates.ts, editable in AMC configuration)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.1-01 | Subject "… proposal {no} {version} for {property}" | IMPLEMENTED | Subject "Yalla Fix It AMC proposal {Proposal no} {Version} for {Property}" | — | — | — |
| 6.1-02 | Prospect name | IMPLEMENTED | {Prospect name} | — | — | — |
| 6.1-03 | Proposal number | IMPLEMENTED | {Proposal no} | — | — | — |
| 6.1-04 | Version | IMPLEMENTED | {Version} = V{current_version} | — | — | — |
| 6.1-05 | Property address | IMPLEMENTED | {Property address} | — | — | — |
| 6.1-06 | Service list | IMPLEMENTED | {Service list} from the included services | — | — | — |
| 6.1-07 | Visit count | IMPLEMENTED | {Visit count} = sum of PPM frequencies | — | — | — |
| 6.1-08 | Final price including VAT | IMPLEMENTED | {Final price} = grandTotalFromFinal(final_price) | — | — | — |
| 6.1-09 | Payment plan | IMPLEMENTED | {Payment plan} = paymentPlanLabel(plan, custom) | — | — | — |
| 6.1-10 | Validity date | IMPLEMENTED | {Validity date} = `valid_until` set on send from `proposals.validityDays` | — | — | — |
| 6.1-11 | Approval link | IMPLEMENTED | {Approval link} token link; the page offers Approve, Reject with reason, Request a change | — | — | — |
| 6.1-12 | Coordinator phone | IMPLEMENTED | {Coordinator phone} = owner's phone, else provider contact number | — | — | — |
| 6.1-13 | Coordinator name | IMPLEMENTED | {Coordinator name} = owner's name | — | — | — |
| 6.1-14 | Recipients: selected prospect contacts | IMPLEMENTED | Send dialog: tick contacts and add more addresses, up to 10 (X/amc/amc-send-dialog.tsx; `recipients` in sendSchema) | — | — | — |
| 6.1-15 | Copy to coordinator | IMPLEMENTED | "Copy me (the coordinator)", `cc_owner` default true | — | — | — |
| 6.1-16 | Renewal opening line | IMPLEMENTED | {Renewal line} "Your contract {Old contract no} expires on {Expiry date}." for proposals with `renewal_of_contract_id` | — | — | — |
| 6.1-17 | Proposal attached | IMPLEMENTED | Email always carries the PDF built before sending (use-amc-actions.tsx), named "Proposal-{no}-V{n}.pdf" | — | — | — |

**Email 2: Contract for signature** (send/route.ts; proposal-share.ts contractShareTexts; reminder resend in lib/server/amc/contract-lifecycle.ts runUnsignedContractSweep)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.1-18 | Trigger: contract issued for signature | IMPLEMENTED | Owner sends the contract (document "contract"); contractSent moves it to pending signature | — | — | — |
| 6.1-19 | Subject "… contract {Contract no} is ready to sign" | IMPLEMENTED | "Your Yalla Fix It AMC contract {Contract no} is ready to sign" | — | — | — |
| 6.1-20 | Client name | IMPLEMENTED | {Client name} | — | — | — |
| 6.1-21 | Proposal number | IMPLEMENTED | {Proposal no} | — | — | — |
| 6.1-22 | Contract number | IMPLEMENTED | {Contract no} = own number AMC-C-YYYY-NNNN (M/20261007160000) | — | — | — |
| 6.1-23 | Property address | IMPLEMENTED | {Property address} | — | — | — |
| 6.1-24 | Signing link | IMPLEMENTED | {Signing link} token link | — | — | — |
| 6.1-25 | Start and end date | IMPLEMENTED | {Start date}, {End date} from the contract record | — | — | — |
| 6.1-26 | Value including VAT | IMPLEMENTED | {Value} = contract grand_total | — | — | — |
| 6.1-27 | Payment plan | IMPLEMENTED | {Payment plan} | — | — | — |
| 6.1-28 | First instalment amount | IMPLEMENTED | {First amount} = firstInstalment(plan, custom, final price) | — | — | — |
| 6.1-29 | Recipient: client signatory | IMPLEMENTED | The client signatory is the customer contact (planSignatories in createContractFromApproval); Email 2 goes to it, with extra addresses allowed | — | — | — |
| 6.1-30 | Copy to coordinator | IMPLEMENTED | `cc_owner` on send; owner always copied on the resend | — | — | — |
| 6.1-31 | Copy to Finance | IMPLEMENTED | `contracts.financeCcEmails` copied on send and resend | — | — | — |
| 6.1-32 | Resent after N unsigned days | IMPLEMENTED | runUnsignedContractSweep (job `unsigned_contracts`): every `unsignedReminderDays`, up to `unsignedReminderMax`, fresh link, logged | — | — | — |
| 6.1-33 | PDF attached for paper signature | IMPLEMENTED | PDF attached on send; signed scan route recordSignedScan (DEV-375 part 1). The automatic resend carries the link only, no PDF | — | — | — |

**Email 3: Service report; instalment reminder** (lib/server/amc/job-sheets.ts sendServiceReport; lib/server/amc/payments.ts sendInstalmentReminder)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.1-34 | Email 3 sent when the supervisor approves the job sheet | IMPLEMENTED | closeJobSheet → sendServiceReport (PDF stored as the visit's document and attached), unless Not completed | — | — | — |
| 6.1-35 | Within 48 hours of the visit | IMPLEMENTED | `report_due_at` = completion + 48 h (reportDueAt); job `job_sheets` sends "Service report due soon / late" and "Job sheet not submitted" (runJobSheetSweep) | — | — | — |
| 6.1-36 | Values: service, seq of total, done/remaining, free visits used of allowed, additional-work line | IMPLEMENTED | {Service} {Seq} {Total} {Completed} {Remaining} {Used} {Allowed} {Additional work line}; Used/Allowed = the non-emergency call-out allowance (reportFacts; working tree, Phase 14) | — | — | — |
| 6.1-37 | Instalment reminder email (due and overdue) | IMPLEMENTED | Email 4 `emailInstallmentReminder`, sent by job `payments` before the due date and when overdue, and by hand (send_reminder); owner and Finance copied. Wording is a draft until the companion workbook arrives | — | — | — |

## 6.2 Notifications

Events are written per recipient to `amc_notifications` by notifyUsers / notifyProposalEvent / notifyContractEvent (lib/server/amc/notifications.ts); the original 13 workflow events and their email policy are in lib/amc/notifications.ts, the rest are raised directly by each module and its daily job (lib/server/amc/jobs.ts). All 27 BRD events exist; they show on the portal home until opened, then in the inbox.

| ID | Notification | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.2-01 | New enquiry assigned | IMPLEMENTED | `enquiry_assigned` (lib/server/amc/enquiries.ts) | — | — | — |
| 6.2-02 | Follow-up due | IMPLEMENTED | `enquiry_follow_up_due` (runEnquiryFollowUpSweep) | — | — | — |
| 6.2-03 | Enquiry idle | IMPLEMENTED | `enquiry_idle`, then `enquiry_escalated` to management (runEnquiryIdleSweep) | — | — | — |
| 6.2-04 | Site visit assigned | IMPLEMENTED | `site_visit_assigned` (scheduleSiteVisit) | — | — | — |
| 6.2-05 | Proposal pending approval, with escalation | IMPLEMENTED | `proposal_pending_approval` per level (approval-ladder.ts); "Proposal approval" to-do escalates one level up → `todo_escalated` (escalateDueAmcTodos) | — | — | — |
| 6.2-06 | Approved, rejected or returned | IMPLEMENTED | `proposal_level_approved`, `proposal_approved`, `proposal_sent_back` (a reject is sent with "Rejected: {reason}") (decideStep) | — | — | — |
| 6.2-07 | Validity expiring | IMPLEMENTED | `proposal_validity_expiring`, 3 days before (runProposalValiditySweep) | — | — | — |
| 6.2-08 | Prospect decision recorded | IMPLEMENTED | `client_approved` / `client_rejected` (revision requests included) (client-decision.ts) | — | — | — |
| 6.2-09 | Contract unsigned | IMPLEMENTED | `contract_unsigned` (runUnsignedContractSweep) | — | — | — |
| 6.2-10 | Initial payment pending | IMPLEMENTED | `initial_payment_pending` on activation; `initial_payment_late` after the configured days (payments.ts) | — | — | — |
| 6.2-11 | Instalment due | IMPLEMENTED | `instalment_due` (runPaymentSweep) | — | — | — |
| 6.2-12 | Instalment overdue | IMPLEMENTED | `instalment_overdue` (runPaymentSweep) | — | — | — |
| 6.2-13 | Cheque date near | IMPLEMENTED | `cheque_date_near` (runPaymentSweep) | — | — | — |
| 6.2-14 | Cheque bounced | IMPLEMENTED | `cheque_bounced` (performPaymentAction cheque_bounce) | — | — | — |
| 6.2-15 | Payment received | IMPLEMENTED | `payment_received` on a recorded payment and a cleared cheque (performPaymentAction) | — | — | — |
| 6.2-16 | PPM confirmation due | IMPLEMENTED | `ppm_confirmation_due` (runVisitSweep) | — | — | — |
| 6.2-17 | No client answer after the set attempts | IMPLEMENTED | `visit_no_answer` (performVisitAction, per-contract attempt rule) | — | — | — |
| 6.2-18 | Access or gate pass pending | IMPLEMENTED | `visit_access_pending` (runVisitSweep) | — | — | — |
| 6.2-19 | Call out logged | IMPLEMENTED | `call_out_logged` (createCallOut) | — | — | — |
| 6.2-20 | SLA at risk | IMPLEMENTED | `call_out_sla_at_risk` at 75 % of the window and when missed (runCallOutSweep) | — | — | — |
| 6.2-21 | Job sheet not submitted | IMPLEMENTED | `job_sheet_not_submitted` (runJobSheetSweep) | — | — | — |
| 6.2-22 | Job sheet awaiting review | IMPLEMENTED | `job_sheet_awaiting_review` (saveJobSheet on submit) | — | — | — |
| 6.2-23 | PPM overdue | IMPLEMENTED | `ppm_overdue` (runPpmOverdueSweep) | — | — | — |
| 6.2-24 | Allowance near limit or used up | IMPLEMENTED | `entitlement_low` / `entitlement_exhausted` via notifyEntitlementState from recordUsage, visit closure and call outs | — | — | — |
| 6.2-25 | Quotation waiting for client approval | IMPLEMENTED | `additional_work_awaiting_approval` (additional-works.ts) | — | — | — |
| 6.2-26 | Contract expiring in 60 and 30 days | IMPLEMENTED | `contract_expiring` at 60 and 30 days (expiryNotice; runRenewalSweep, daily job `renewals`, on by default) | — | — | — |
| 6.2-27 | Expiry near with no renewal activity | IMPLEMENTED | `renewal_idle` after the idle days with no renewal activity (`renewal_activity_at`) | — | — | — |
| 6.2-28 | Shown on the portal home until opened, then inbox | IMPLEMENTED | Home panel lists unread and marks read on open (components/dashboard/home/notifications-panel.tsx); inbox page app/(dashboard)/notifications (NotificationsInbox); bell on AMC screens | — | — | — |

## 6.3 SMS and WhatsApp messages

No WhatsApp or SMS provider exists. "Prepared" means the portal builds the text (template in lib/amc/message-templates.ts, editable in AMC configuration) with a wa.me link and the coordinator sends it from WhatsApp. "Automatic" means the portal sends it, which waits for a provider (Phase 15, DEV-422). The eight texts are drafts until the companion workbook arrives.

| ID | Message | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.3-01 | Proposal shared (prepared, sent by coordinator) | IMPLEMENTED | `messageProposalShared` + wa.me per contact (proposalShareTexts, whatsappMessages; send dialog WhatsApp tab); logged in the send log | — | — | — |
| 6.3-02 | Contract ready to sign | IMPLEMENTED | `messageContractReady` (contractShareTexts) prepared with wa.me | — | — | — |
| 6.3-03 | Appointment confirmation request (attempts per contract) | IMPLEMENTED | `messageAppointmentConfirmation` prepared with wa.me or emailed (performVisitAction request_confirmation); attempts log and per-contract attempt rule | — | — | — |
| 6.3-04 | Appointment reminder the day before | EXT BLOCKED | `messageAppointmentReminder` text; daily job `visits` emails it to the client the day before (runVisitSweep) | WhatsApp/SMS delivery (no prepared wa.me for this one) | WhatsApp/SMS provider (DEV-422 automatic) | Phase 15 |
| 6.3-05 | Call-out acknowledgement | IMPLEMENTED | `messageCallOutAcknowledgement` prepared on logging (createCallOut), wa.me in the log dialog | — | — | — |
| 6.3-06 | Instalment due with payment link | EXT BLOCKED | `messageInstallmentDue` prepared with wa.me from send_reminder (sendInstalmentReminder); {Payment link} empty | Payment link | PayTabs/NomuPay (DEV-385); provider for automatic | Phase 15 |
| 6.3-07 | Service report link | IMPLEMENTED | `messageServiceReport` with a 14-day signed report link, wa.me shown after closing (sendServiceReport; X/amc-contracts/job-sheet-panel.tsx) | — | — | — |
| 6.3-08 | Renewal proposal | IMPLEMENTED | Own template `messageRenewalProposal` chosen for renewal proposals (proposalShareTexts; working tree, Phase 14) | — | — | — |
| 6.3-09 | WhatsApp main channel, SMS fallback | EXT BLOCKED | WhatsApp is the default channel for residential (defaultShareChannel); smsLink() helper exists (lib/amc/templates.ts) but is not offered | Automatic sending, SMS fallback | WhatsApp Business / SMS provider (DEV-422 automatic) | Phase 15 |

## 6.7 Roles

| ID | Rule | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.7-01 | Roles configurable | IMPLEMENTED | roles / role_access; AMC resources incl. amc_enquiries, amc_rate_card, amc_config, amc_payments, amc_visits, amc_allowances and per-page permissions (types/types.ts); one-click role templates (lib/amc/role-templates.ts) | — | — | — |
| 6.7-02 | Only department head and Finance edit rate card, floors, promotions | IMPLEMENTED | AMC Rate card Edit gates PUT api/amc-rate-card (floor rates, promotions in lib/amc/rate-card.ts); granted to the Department Head and Finance templates | — | — | — |
| 6.7-03 | Only management sets thresholds and value bands | IMPLEMENTED | AMC_CONFIG_SECTION_LEVEL: `approvals` and `payments` need AMC Configuration Approve (lib/amc/config.ts; api/amc-config) | — | — | — |
| 6.7-04 | Approval levels per trigger | IMPLEMENTED | Discount / value / plan / floor triggers per level, named approvers per level (config `approvals`; lib/amc/approval-ladder.ts) | — | — | — |
| 6.7-05 | Nobody approves their own proposal | IMPLEMENTED | `AMC_SELF_APPROVAL_ALLOWED = false` (lib/amc/workflow.ts); approvers filtered against the owner (approval-ladder.ts) | — | — | — |
| 6.7-06 | Initial payment override: named role, reason kept | IMPLEMENTED | `override_gate` needs AMC Payments Approve and a reason; `gate_override_by/at/reason` (payments.ts) | — | — | — |
| 6.7-07 | Allowance override: named role, reason kept | IMPLEMENTED | Booking a chargeable call out as covered needs AMC Allowances Approve and a reason (createCallOut; contract-access.ts allowanceOverride) | — | — | — |
| 6.7-08 | Technicians see their own jobs only | FSM | FSM app | — | — | — |
| 6.7-09 | Coordinators see all AMC prospects, clients and contracts | IMPLEMENTED | AMC Operations View sees all contracts and every non-draft proposal (lib/amc/access.ts seesAllContracts; proposal-access.ts); AMC Enquiries View sees every enquiry (enquiry-access.ts); Coordinator template grants both. Another person's draft stays private | — | — | — |
| 6.7-10 | Only a supervisor closes a visit with pending works or gaps | IMPLEMENTED | Every visit closes through the job sheet review: named supervisors (else level 1 approvers) or AMC Visits Approve (api/amc-visits/[visitId]/job-sheet; closeJobSheet) | — | — | — |
| 6.7-11 | Only an authorised role reverses an allowance movement | IMPLEMENTED | canCorrectUsage: approver, AMC Operations Approve or AMC Allowances Approve; `AMC_CORRECTIONS_APPROVER_ONLY = true` (lib/amc/access.ts) | — | — | — |
| 6.7-12 | Prospects and clients act by link, no login | IMPLEMENTED | api/amc/[token] | — | — | — |

## 6.8 To-dos

All eight kinds are opened as portal Todos through openAmcTodo (lib/server/amc/todos.ts, `AMC_TODO_KINDS`, link rows in `amc_todos`, `related_type 'amc_<entity>'` allowed by M/20261007110000). They close when the action is taken on the record and escalate through the daily `todo_escalations` job (escalateDueAmcTodos). Cross-cutting gap: the Todos screen shows the related type and raw id only (components/dashboard/todos/index.tsx), with no link to the AMC record where the actions are.

| ID | To-do | Status | Shown / actions / assignee / escalation today | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.8-01 | Proposal approval | IMPLEMENTED | Prospect, number V{n}, price, discount, plan, triggers crossed (approval-ladder.ts); Approve / Reject with reason / Return on the proposal and the pending-approvals queue; approvers of the level; escalates one level up after the configured hours | — (Todos row has no link to the proposal) | — | — |
| 6.8-02 | Contract follow-up | IMPLEMENTED | Contract follow-up to-do for unsigned contracts and unpaid first instalments; Phase 14 (working tree, 13 Oct): assigned to the owner and Finance; Snooze (days + reason, lifecycle action snooze_follow_up); the Todos screen links to the contract | — | — | — |
| 6.8-03 | PPM confirmation | IMPLEMENTED | Phase 14 (working tree, 13 Oct): the PPM confirmation to-do names the services, the property's access rules and the allowance balance (runVisitSweep); actions on the visit dialog; the Todos screen links to the visit board | — | — | — |
| 6.8-04 | Access or gate pass | IMPLEMENTED | Phase 14 (working tree, 13 Oct): gate pass uploaded from the visit dialog's Access tab and attached to the visit; mark requested, approved, rejected or not required | — | — | — |
| 6.8-05 | Job closure review | IMPLEMENTED | Visit, review reasons; full sheet (checklist, photos, pending and additional work, signature name, outcome per trade) on AMC → Job reviews / job sheet tab; Close (sends Email 3) / Return with comment; remaining trade planned again automatically; supervisors, due in 8 h, escalates after 24 h | — (Todos row has no link to the visit) | — | — |
| 6.8-06 | Instalment overdue | IMPLEMENTED | Phase 14 (working tree, 13 Oct): the overdue to-do carries the cheque details; Escalate by hand (payments action escalate) besides the automatic escalation after 7 days | — | — | — |
| 6.8-07 | Renewal due | IMPLEMENTED | Contract, expiry, last year's summary (runRenewalSweep); open draft, send, record outcome and reason on the Renewal tab / Renewals page; owner; management after the idle days (15) | — (Todos row has no link to the Renewal tab) | — | — |
| 6.8-08 | Call out | IMPLEMENTED | Phase 14 (working tree, 13 Oct): supervisors join the call-out to-do when the SLA is at risk; the to-do escalates to the supervisors at the SLA deadline (escalationRecipients call_out) | — | — | — |

## 6.9 Expected metrics

| ID | Metric | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.9-01 | Enquiries by source, owner, month; conversion; lost reasons | IMPLEMENTED | enquiryFunnel (lib/amc/reports.ts) in commercialReport (lib/server/amc/insights.ts); AMC → Reports with CSV/Excel | — | — | — |
| 6.9-02 | Visits by status, technician, month; reasons; attempts | IMPLEMENTED | visitsByMonth / visitsByTechnician with attempts (working tree, Phase 14), visitBacklog by reason group, accessFailures, adherence (reports.ts; operationalReport; X/amc-contracts/amc-insights.tsx); per contract on the Schedule tab | — | — | — |
| 6.9-03 | Allowance use; visits that became chargeable | IMPLEMENTED | allowanceUse with chargeable call outs per contract (reports.ts); contract Call outs tab allowances and movements | — | — | — |
| 6.9-04 | Additional works raised, approved, rejected; revenue | IMPLEMENTED | workRevenue (raised, quoted, approved, rejected, invoiced, paid, approval rate) in commercialReport; per contract and client additionalWorkRollup / clientWorkRollup (additional-works.ts) | — | — | — |
| 6.9-05 | Call outs by priority, SLA, covered or chargeable | IMPLEMENTED | callOutStats (reports.ts) in operationalReport | — | — | — |
| 6.9-06 | Contract profitability | EXT BLOCKED | Revenue side in reports | Labour hours, material, subcontractor and other costs | Cost source FSM / Zoho Finance (DEV-413) | Phase 15 |
| 6.9-07 | Who changed each status and when | IMPLEMENTED | `status_changed` in `amc_audit_events` (recordStatusChange, lib/server/amc/status-history.ts) for enquiries, proposals, contracts, call outs, additional works, amendments, renewals, customers, assets; visits, job sheets, instalments and cheques by trigger (M/20261013100000, working tree, not applied). Shown on enquiry, proposal and contract history; not on the visit, call-out or payment dialogs | — | — | — |

## 6.10 Project deliverables checklist

Re-audited 13 October 2026. Evidence for each group is in its sections above; tests are `tests/amc/*.test.ts` (341 node tests) and the PostgreSQL harness `scripts/amc-db-harness/9*_verify_*.sql` (97 to 97t), run with `compat.sh` showing live `main` unaffected (28/11, unchanged since Phase 4).

| # | Deliverable | Status | Built in | Still open (deferred) |
|---|---|---|---|---|
| 1 | Enquiry pipeline, property, asset register, combined units, scope and site visit (5.1, 5.2) | COMPLETE | Phases 2–3; asset history and the site-visit rule on submit in Phase 14 | — |
| 2 | Governed rate card with floor rates, history and packages (5.3) | COMPLETE | Phase 4 | Threshold values to confirm (configurable) |
| 3 | Wizard linked to the prospect, versions, team visibility (5.4) | COMPLETE | Phase 4; validity on the client page and enforced in Phase 14 | — |
| 4 | Configurable approval ladder; approval link by email or WhatsApp, decision recorded (5.5, 5.6) | COMPLETE | Phase 5; escalation that the next level can decide, climbing, in Phase 14 | — |
| 5 | Contract with commencement date and entitlements, signing routes, statuses; client profile with access rules, consent and documents (5.7, 5.9) | COMPLETE (deferred items open) | Phases 2, 6; coverage table, internal-signatory reminders, minimum term on submit, client schedule/history/payments/documents, FSM contact in Phase 14 | Zoho Sign, FSM record for Finance (Phase 15); commercial clause wording (business) |
| 6 | Payment bands, schedule, cheques, initial payment gate, Zoho Finance view (5.8) | COMPLETE (deferred items open) | Phase 7; collector, proof, expected mode, escalate in Phase 14 | Payment links, Zoho Finance invoices and receipts (Phase 15) |
| 7 | PPM schedule per service line with service windows and clubbing, adherence kept (5.10) | COMPLETE | Phase 8 | — |
| 8 | Confirmation to-do with configurable attempts, scheduling board, competency-based assignment, access status (5.11) | COMPLETE (deferred items open) | Phase 9; attempt interval, all access rules, Pending Access, escalation recipient in Phase 14 | FSM appointments and technician reminder (Phase 15); shift, team, driver and tools rules (business) |
| 9 | Offline FSM job with AMC checklist, supervisor closure, non-completion groups, partial completion per trade (5.12) | COMPLETE (deferred items open) | Phase 10 (portal job sheet, closure, groups, remainder visits, Email 3) | FSM job-sheet fields and offline (Phase 15; the technician side is the FSM app) |
| 10 | Reactive call outs with priority, SLA, coverage check and statuses (5.13) | COMPLETE (deferred items open) | Phase 11; access rules and crew reason in Phase 14 | FSM appointments and FSM timestamps for the SLA (Phase 15) |
| 11 | Additional work parties and findings, entitlement check, allowance reserve and consume with audit trail (5.14) | COMPLETE (decisions open) | Phase 11; technician picker and client roll-up in Phase 14 | PPM reservations and the reset basis (business, Q7) |
| 12 | Client report, operational, commercial and profitability reports, dashboard (5.15) | COMPLETE (deferred items open) | Phase 12; visits by month and technician in Phase 14 | Profitability needs cost data (Phase 15) |
| 13 | Renewal reminder, draft with history, outcomes, edge cases with approval (5.16) | COMPLETE | Phase 13 | — |
| 14 | Emails, notifications, messages, to-dos and roles (6.1, 6.2, 6.3, 6.7, 6.8) | COMPLETE (deferred items open) | Phases 1, 5–13; renewal message, Email 3 counts, to-do details, Todos links, status history triggers in Phase 14 | Automatic WhatsApp/SMS sending and payment links (Phase 15); workbook wording for Email 4 and the messages |

## Comparison with `docs/amc-master-status-report.md`

That report measured the older proposals FRD. This file measures BRD v0.3 line by line and is the checklist to use. On 6 October it showed 78 of 524 in-scope requirements implemented (14.9%); on 13 October, 495 of 526 (94.1%), with every remaining in-scope row deferred to Phase 15 or to a business decision.

## Roadmap

Phases 0 to 14 of `docs/amc-brd-v0.3-implementation-plan.md` are built on `amc-hardening`. What remains:

| Step | Scope | Needs first |
|---|---|---|
| Apply the migrations | Rows 19 to 29 of `docs/production-migration-log.md`, in order, with the checks in `docs/production-migration-checks.md` §11 to §21 | Your go-ahead; out of hours for rows 17, 18 and 20 |
| Business decisions | The 8 BIZ BLOCKED rows (below) | Answers from the business |
| Phase 15 | The 23 EXT BLOCKED rows: Zoho Sign, FSM customer/work orders/appointments/job sheet/offline/timestamps, PayTabs/NomuPay links, Zoho Finance, profitability costs, automatic WhatsApp/SMS | The external answers listed in the plan's Phase 15 table |
| Release | Production migration-history reconciliation, the held Group B migrations, code deploy, credential rotation, smoke test, merge | Your approval (runbook) |

## Business decisions required

The 8 BIZ BLOCKED rows, each built as far as it can go and waiting on one answer:

1. **Commercial contract wording** (5.7-02): the clause set for commercial contracts; the template is already chosen per contract.
2. **Standard durations** per trade for the crew suggestion (5.11-17): configurable today, values to confirm.
3. **Shift hours** (5.11-19): so suggestions can filter by shift.
4. **Team composition** (5.11-22): technician + helper pairs or teams.
5. **Driver per crew** (5.11-24): whether every crew needs a driver.
6. **Tools per service** (5.11-25): which services need which tools.
7. **PPM reservations** (5.14-26): whether placing a PPM visit should reserve a unit (today the planned visits are the allowance and consume at closure).
8. **Allowance reset basis** (5.14-37, Q7): per contract year or per term for contracts longer than 12 months.

Also to confirm, configurable today and counted as implemented: approval thresholds and approvers per level (Q2), payment value bands, proposal validity days, the site-visit rule (flag or block), threshold metric values (6.5), the renewal escalation percent and lead time, and **the minimum contract term** (12 months per the BRD; Jonathan's 6-month contracts need it set to 6 in AMC configuration). Still open from earlier: final document layout sign-off; existing signed rows AMC-2026-6886/6890/6891.

## FSM / Zoho dependencies

- FSM job sheet AMC fields: per-asset checklist and photos, allowance flag, additional work, pending works with reason, client signature (BRD 3, 5.12).
- FSM timestamps for SLA: arrival and booking times; the meaning of "Completed" and whether appointments reopen.
- Creating FSM appointments from AMC visits and call-outs, with emergencies ahead of planned work.
- Creating the FSM customer on signing; making the signed contract visible to Finance in FSM (5.7, 5.9).
- FSM estimate creation for additional work (existing one-time quotation flow).
- FSM Assets per property, if property history is to come from FSM.
- Inventory link for consumables and parts.
- Zoho Sign, if chosen.

## Finance dependencies

- Zoho Finance integration: invoices and receipts per instalment, the trigger and direction (Finance is building it).
- PayTabs / NomuPay merchant setup, payment-link API and status callbacks.
- Cheque custody, deposit and clearance process ownership.
- Value bands, non-standard plan approvals, pro-rata refund rules.
- Cost data for profitability: labour hours (FSM), material cost (inventory), subcontractor and other direct costs.
- Finance co-ownership of the rate card.
