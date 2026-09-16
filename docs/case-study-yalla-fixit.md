# Yalla Fix It

**Solution Category:** Dashboard

**Technology:** Zoho FSM, Next.js, Supabase, TypeScript and serverless functions

**Situation**

Yalla Fix It is a Dubai property maintenance contractor running field operations on
Zoho FSM. FSM handled dispatch, work orders and technician scheduling well, but two
parts of the business sat outside it. Property snagging inspections — the defect
surveys carried out on new-build handovers — were captured on site and then rebuilt
by hand into client reports, with photographs, floor-plan markings and severity
ratings reassembled for every job. Annual maintenance contract proposals were put
together the same way: priced manually, with nothing retained afterwards, so a
client asking for a revision meant starting the document over. Neither process kept
an audit trail, and there was no single place to follow a job from the first site
visit through to a signed contract.

**Task**

Our objective was to build one operations portal that sits on top of Zoho FSM rather
than replacing it. It had to carry a snagging inspection end to end — capture,
review, approval, client delivery, quotation, and repeat de-snag rounds — while
letting inspectors work offline on site, where connectivity is not guaranteed.
Client-ready PDFs had to be produced from the same data the office sees, with no
retyping and no drift between screen and document. AMC proposals had to become a
priced, saved and re-editable workflow. All of it needed role-based access so that
operations, inspectors, reviewers and approvers each see only their own part of it.

**Action**

We built the portal in Next.js with Supabase providing Postgres, authentication,
storage and row-level security, and integrated it bidirectionally with Zoho FSM for
technicians, work orders, appointments and service resources. The snagging module is
shared with a companion offline inspector app that authenticates against the same
Supabase project and syncs through the portal's API using a mutation ledger, so field
work survives a lost connection. Defects are classified against a maintained
catalogue of area, element, defect type and advisory severity, pinned to uploaded
floor plans, and evidenced with photographs compressed in the browser before upload.
Every state change is written to an append-only audit trail, and sign-off runs through
a review and approval chain with automatic escalation.

Reports and quotations are rendered server-side with a headless browser from a single
shared data builder, so the PDF and the on-screen version cannot diverge. Both reach
the client through tokenised links that need no login and record when they are opened.
Quotations are priced from a rate card the office maintains and can be approved or
rejected by the client in place. Alongside this we delivered an AMC proposals module
with a three-step wizard, a per-service table carrying units, frequency and computed
pricing, an overall discount, proposal and contract PDF generation, and per-user
submission history so any past proposal can be reopened and revised.

**Result**

The client now runs snagging from first inspection to signed contract in one system,
with Zoho FSM still the system of record for dispatch. Inspectors capture defects
offline and sync on return instead of writing notes up afterwards. Reports that were
previously reassembled by hand are generated on demand — a 200-defect inspection with
440 photographs renders a 52-page PDF in under five seconds — and the office can
reissue one at any time without rebuilding it. Clients open reports and quotations
from a link and respond in place, and every approval, rejection and revision is
recorded against the job. AMC proposals are no longer disposable documents: they are
stored records that can be reopened, repriced and regenerated.
