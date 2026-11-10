import type { AmcConfigSection } from "@/lib/amc/config";

/**
 * The texts behind each AMC page's (i): what the page is for, how its work
 * moves, what happens on its own, and the configuration that shapes it.
 * Written from what the code does (6 Nov 2026), in the words the screens
 * use; when a rule changes, change its line here too. Setting labels and
 * defaults are not repeated: they are read from the configuration itself.
 */

export type ModuleKey =
  | "enquiries"
  | "siteVisits"
  | "proposals"
  | "contracts"
  | "renewals"
  | "payments"
  | "clients"
  | "visitBoard"
  | "jobReviews"
  | "callOuts"
  | "additionalWork"
  | "technicians"
  | "reports"
  | "rateCard"
  | "fsmMapping"
  | "opsSettings"
  | "configuration"
  | "amcSettings";

export interface GuideSetting {
  section: Exclude<AmcConfigSection, "templates">;
  key: string;
  /** A word on what the setting does here, when its label does not say. */
  note?: string;
}

export interface GuideLink {
  label: string;
  href: string;
}

export interface Guide {
  title: string;
  summary: string;
  who?: string;
  steps: Array<{ title: string; detail: string }>;
  /** A term the page leans on, explained in its own block after the steps. */
  explain?: Array<{ title: string; items: string[] }>;
  automatic?: string[];
  rules?: string[];
  settings?: GuideSetting[];
  before?: GuideLink[];
  after?: GuideLink[];
}

const L = {
  enquiries: { label: "Enquiries", href: "/extensions/amc-contracts/enquiries" },
  siteVisits: { label: "Site visits", href: "/extensions/amc-contracts/assessments" },
  proposals: { label: "Proposals", href: "/extensions/amc" },
  contracts: { label: "Contracts", href: "/extensions/amc-contracts" },
  renewals: { label: "Renewals", href: "/extensions/amc-contracts/renewals" },
  payments: { label: "Payments", href: "/extensions/amc-contracts/payments" },
  clients: { label: "Clients", href: "/extensions/amc-contracts/customers" },
  visitBoard: { label: "Visit board", href: "/extensions/amc-contracts/board" },
  jobReviews: { label: "Job reviews", href: "/extensions/amc-contracts/job-reviews" },
  callOuts: { label: "Call outs", href: "/extensions/amc-contracts/call-outs" },
  additionalWork: { label: "Additional work", href: "/extensions/amc-contracts/additional-works" },
  technicians: { label: "Technicians", href: "/extensions/amc-contracts/technicians" },
  rateCard: { label: "Rate card", href: "/extensions/amc-contracts/rate-card" },
  reports: { label: "Reports", href: "/extensions/amc-contracts/reports" },
} satisfies Record<string, GuideLink>;

export const MODULE_GUIDES: Record<ModuleKey, Guide> = {
  /* ---------------------------------------------------------------- */
  /* Sales                                                             */
  /* ---------------------------------------------------------------- */
  enquiries: {
    title: "Enquiries",
    summary: "The sales pipeline: every AMC enquiry from first contact until it is won or lost, who owns it and when to follow up.",
    who: "Sales, coordinators, the department head and management.",
    steps: [
      { title: "Log the enquiry", detail: "New enquiry with the client, the property, a phone, WhatsApp or email, and the source. A referral needs the referrer's name." },
      { title: "Work it through the stages", detail: "New Enquiry, Contacted, Qualified, Details Captured, Site Visit Scheduled, Proposal Preparation, Proposal Submitted, Under Negotiation, Awaiting Decision, then Won or Lost. On Hold parks it." },
      { title: "Log every contact", detail: "Log follow-up records what was said and sets the next follow-up time. Book site visit sends an assessor and moves the stage to Site Visit Scheduled." },
      { title: "Create the proposal", detail: "Create proposal (once per enquiry, with a property linked) opens a draft proposal and moves the stage to Proposal Preparation." },
      { title: "Close it", detail: "Set Won or Lost by hand. Lost needs a reason from the list; reopening a won or lost enquiry needs a reason too." },
    ],
    automatic: [
      "The owner is told when a follow-up time passes (until Won or Lost).",
      "No activity for the idle days: the owner is told the enquiry is idle. Longer still: management is told as well.",
      "Any follow-up, stage change or booking restarts the idle clock; Won, Lost and On Hold stop it.",
      "A new owner and the booked assessor are notified.",
    ],
    rules: [
      "Only two stages move on their own (booking a site visit, creating the proposal). Proposal Submitted, Won and Lost are always set by hand; signing a contract does not close the enquiry.",
      "Commercial properties need a completed site visit before the proposal: the proposal is flagged, or blocked, depending on the rule.",
    ],
    settings: [
      { section: "enquiries", key: "idleDays" },
      { section: "enquiries", key: "managementEscalationDays" },
      { section: "enquiries", key: "stages" },
      { section: "proposals", key: "siteVisitRule" },
    ],
    after: [L.siteVisits, L.proposals],
  },

  siteVisits: {
    title: "Site visits",
    summary: "Assess a property before quoting: run the checklist, record what needs attention and which services to recommend, then start a proposal from it.",
    who: "Assessors and coordinators.",
    steps: [
      { title: "Start the visit", detail: "Booked from an enquiry, or New site visit here. It starts as a Draft." },
      { title: "Record what you find", detail: "Details, Checklist (each item OK, Attention required or Not applicable), Findings and services with unit counts, and Photos." },
      { title: "Complete it", detail: "Needs a visit date, a linked property, attendance as Attended, and every checklist item answered. A completed visit is history: it cannot be edited or deleted." },
      { title: "Create AMC proposal", detail: "Opens a draft proposal priced from the rate card in force, with the recommended services ticked and the unit counts taken on site. The linked enquiry moves to Proposal Preparation." },
    ],
    rules: [
      "Services not offered for the property's unit type are left out of the proposal, with a warning.",
      "The visit's creator, its assessor or an AMC approver can edit, complete or delete a draft.",
      "The checklist items themselves are kept in Operations settings; past visits keep their wording.",
    ],
    settings: [
      { section: "proposals", key: "siteVisitRequiredCategories" },
      { section: "proposals", key: "siteVisitRule" },
    ],
    before: [L.enquiries],
    after: [L.proposals],
  },

  proposals: {
    title: "Proposals",
    summary: "Write the AMC proposal, get it approved, send it to the client and get the contract signed.",
    who: "Account managers (the owner), approvers and management.",
    steps: [
      { title: "Draft", detail: "Pick the services and property; prices come from the rate card. The term must be at least the minimum term." },
      { title: "Submit for approval", detail: "The approval ladder checks the discount, the yearly value, the payment plan and any line below its floor price. Nothing crossed: approved straight away. Otherwise it climbs one level at a time." },
      { title: "Approver decides", detail: "Approve, Return or Reject. Return and Reject need a reason and send it back as Sent back for the owner to fix and Submit again." },
      { title: "Send the proposal", detail: "The owner sends it (email, WhatsApp, or a link). The client approves or rejects it on the link before it expires." },
      { title: "Send the contract", detail: "Once the client approves, a contract is drafted and sent for signature. Signed is the final status." },
    ],
    automatic: [
      "Each approval level gets a to-do and a notice; an open level escalates to the next level after the set hours.",
      "The owner hears when it is approved, returned, answered or signed.",
      "The owner is told 3 days before the proposal's validity runs out.",
    ],
    rules: [
      "Nobody approves their own proposal. Only the owner can submit and send.",
      "A revised version (V+1) skips approval if it needs no more than the last version was approved for.",
      "Placeholder text (XXX) blocks sending. The client cannot answer after the valid-until date.",
    ],
    settings: [
      { section: "approvals", key: "discountLevel1AbovePercent" },
      { section: "approvals", key: "discountLevel2AbovePercent" },
      { section: "approvals", key: "valueLevel2AboveAed", note: "Yearly value before VAT" },
      { section: "approvals", key: "belowFloorLevel" },
      { section: "approvals", key: "escalateAfterHours" },
      { section: "payments", key: "singlePaymentBelowAed" },
      { section: "proposals", key: "validityDays" },
      { section: "contracts", key: "minimumTermMonths" },
    ],
    before: [L.enquiries, L.siteVisits],
    after: [L.contracts],
  },

  contracts: {
    title: "AMC contracts",
    summary: "The signed contract: signatures, activation, what it covers, how much is used, and any changes to it.",
    who: "Account managers, operations, approvers and finance.",
    steps: [
      { title: "Collect the signatures", detail: "Pending client signature, then Pending internal signature, in the configured order. Record signed scan signs for everyone at once." },
      { title: "Activate", detail: "Set the commencement date. The payment schedule is created and the contract waits in Pending initial payment." },
      { title: "First payment", detail: "When instalment 1 is received (or waived or written off), the contract becomes Active and its PPM visit schedule is drafted. Start before payment lets work begin earlier, with approval." },
      { title: "Run it", detail: "Coverage, Schedule, Call outs, Usage, FSM and Payments tabs show what is included, what is planned and what has been used. Check coverage answers \"is this covered?\" without recording anything." },
      { title: "Change it only by amendment", detail: "Scope change, Property change, Hold, Resume, Transfer, Early termination or Cancellation: requested, approved by someone else, then applied." },
      { title: "End", detail: "Past its end date an active contract becomes Expired, or Renewed when its renewal is activated." },
    ],
    automatic: [
      "Client has not signed after the set days: a Contract follow-up to-do opens for the owner and finance.",
      "The client is emailed a fresh signing link every few days, up to the set number of reminders (the old link stops working).",
      "Internal signatories are reminded in the app at the same interval until they sign.",
    ],
    rules: [
      "Terminate, Call off and Cancel need an AMC approver. Hold and Resume can also be done by the owner.",
      "What the contract says about the client and property is kept as signed; today's records may differ.",
      "Allowances reset every contract year.",
    ],
    settings: [
      { section: "contracts", key: "minimumTermMonths" },
      { section: "contracts", key: "unsignedReminderDays" },
      { section: "contracts", key: "unsignedReminderMax" },
      { section: "contracts", key: "signingOrder" },
      { section: "contracts", key: "internalSignatoryIds" },
      { section: "allowances", key: "warningRemaining" },
    ],
    before: [L.proposals],
    after: [L.payments, L.visitBoard, L.renewals],
  },

  renewals: {
    title: "Renewals",
    summary: "Contracts coming up to their end: start the renewal proposal in time and record what the client decided.",
    who: "Account managers and management.",
    steps: [
      { title: "A contract comes due", detail: "Inside the reminder window before its end date it shows as Due; with no activity it becomes Idle." },
      { title: "Start renewal", detail: "Creates a draft proposal starting the day after the old contract ends, for the same length, at last year's prices plus the price escalation. Services no longer offered are dropped." },
      { title: "Approve, send and sign", detail: "The renewal proposal goes through the normal approval and signing like any proposal." },
      { title: "Outcome", detail: "Renewed (or Renewed with revised scope) is set when the new contract is activated. Under negotiation and Not renewed are recorded by hand." },
    ],
    automatic: [
      "Expiry notices in the app at 60 and 30 days before the end date.",
      "At the reminder window a Renewal due to-do opens for the owner (and management, if set).",
      "No activity for the set days: management is told and the to-do escalates.",
      "Ended with no live renewal and nobody negotiating: marked Lapsed.",
    ],
    rules: [
      "One renewal proposal per contract. The old contract is never changed by renewing it.",
      "Cancelled or already-renewed contracts cannot be renewed.",
    ],
    settings: [
      { section: "renewals", key: "leadDays" },
      { section: "renewals", key: "notifyManagement" },
      { section: "renewals", key: "idleEscalationDays" },
      { section: "renewals", key: "escalationPercent" },
    ],
    before: [L.contracts],
    after: [L.proposals],
  },

  payments: {
    title: "Payments",
    summary: "What is owed across AMC contracts and how late it is: instalments to chase and the cheque register.",
    who: "Finance and account managers.",
    steps: [
      { title: "The schedule is made on activation", detail: "Instalment 1 is due on the activation day; the rest fall on the payment plan's months." },
      { title: "Record what comes in", detail: "Record payment or Record cheque on the contract's Payments tab. A bank transfer needs a reference; you cannot record more than is still open." },
      { title: "Follow the cheques", detail: "Held, then Deposit, Clear, or Bounce, Replace, Return." },
      { title: "Chase what is late", detail: "The ageing columns (Not yet due, 1-30, 31-60, 61-90, Over 90 days) show what to chase. Send reminder or Escalate an instalment." },
    ],
    automatic: [
      "Before an instalment is due, the client is emailed a reminder; when it goes overdue, again, plus an Instalment overdue to-do that later escalates to management.",
      "Before a held cheque's date, finance is alerted.",
      "First payment late after activation: an alert and a First instalment unpaid to-do.",
      "Receiving instalment 1 in full makes the contract Active.",
    ],
    rules: [
      "Waive, Write off and Start before payment need AMC Payments approval and a reason.",
      "Opening this page needs AMC Payments (View).",
    ],
    settings: [
      { section: "payments", key: "dueReminderDaysBefore" },
      { section: "payments", key: "lateFirstPaymentDays" },
      { section: "payments", key: "chequeAlertDaysBefore" },
      { section: "payments", key: "financeUserIds" },
    ],
    before: [L.contracts],
  },

  clients: {
    title: "Clients",
    summary: "The same clients and addresses as Snagging, read from Zoho FSM, with what AMC keeps about each: Customer ID, status, properties, contracts and history.",
    who: "Everyone working on AMC.",
    steps: [
      { title: "Find the client", detail: "The list is newest first from FSM. Prospects saved only in the portal show with Not in FSM yet." },
      { title: "Open it", detail: "Opening a client gives it a Customer ID. The client page has Overview, Properties, Contracts, Schedule, Service history, Payments, Site visits, Contacts, Documents and the Communication log." },
      { title: "Set up the property", detail: "On the property: Details, Assets and scope (which trades and units, preferred months and days) and Access rules. These drive the PPM schedule and who may be sent." },
    ],
    automatic: ["A Prospect becomes a Client when its first payment is received."],
    rules: [
      "FSM is read-only from here: new clients and edits are saved in the portal.",
      "Signed contracts keep the client and property as signed; editing the client changes future documents only.",
      "Addresses are shared with Snagging and edited with the same address form.",
    ],
    after: [L.enquiries, L.contracts],
  },

  /* ---------------------------------------------------------------- */
  /* Delivery                                                          */
  /* ---------------------------------------------------------------- */
  visitBoard: {
    title: "Visit board",
    summary: "Put planned maintenance (PPM) visits on a day: who goes and when. Live jobs and leave show who is already busy.",
    who: "Coordinators and supervisors.",
    steps: [
      { title: "Visits wait in To place", detail: "Visits from active contracts with no time yet, grouped by whether their window is open. Call outs to place sit above, emergencies first." },
      { title: "Confirm with the client", detail: "On the visit: send the request (WhatsApp or email) and Log attempt with the outcome. Sort out access (permit, gate pass) on the Access tab." },
      { title: "Place it", detail: "Drag onto a technician or press Place. The board suggests a crew; choosing another asks why. A day outside the window makes it Rescheduled and asks for a reason." },
      { title: "The visit happens", detail: "Then the technician's job sheet goes to Job reviews." },
    ],
    automatic: [
      "Before each window opens, the owner gets a Confirm PPM visit to-do.",
      "Access still not ready close to the visit: an Access needed to-do and an alert.",
      "The day before a placed visit, the client is emailed a reminder.",
      "Window passed and the visit not done: a PPM visit overdue alert.",
    ],
    rules: [
      "A technician cannot be placed if not confirmed for the trade, certificate expired, on leave, already booked, or missing a required clearance.",
      "Sending the request counts as an attempt. After the set number with no answer, the owner is alerted.",
      "Visits of contracts on hold are not listed.",
    ],
    settings: [
      { section: "scheduling", key: "serviceWindowDays" },
      { section: "scheduling", key: "confirmationLeadDays" },
      { section: "scheduling", key: "attemptCount" },
      { section: "scheduling", key: "attemptIntervalDays" },
      { section: "scheduling", key: "durationPerServiceMinutes" },
      { section: "scheduling", key: "durationPerExtraUnitMinutes" },
      { section: "scheduling", key: "accessAlertDaysBefore" },
    ],
    before: [L.contracts, L.technicians],
    after: [L.jobReviews],
  },

  jobReviews: {
    title: "Job reviews",
    summary: "Submitted job sheets waiting for a supervisor, oldest first: return one with what needs fixing, or close the visit and send the client the service report.",
    who: "Supervisors (named in configuration, otherwise the level 1 approvers).",
    steps: [
      { title: "The technician's sheet is submitted", detail: "Needs arrival and completion times, an outcome for every trade, a reason for anything unfinished, and the client's signature name when work was done." },
      { title: "Check it", detail: "The Review column says why a sheet needs a closer look: Pending works, Quality concern, Missing evidence or Incomplete scope." },
      { title: "Return or close", detail: "Return (with a comment) sends it back to In progress. Close visit sets the final status, uses the allowance, and puts any unfinished trade on a new visit." },
      { title: "Service report", detail: "On closing, the service report PDF is emailed to the client (owner copied), due within 48 hours of the visit." },
    ],
    automatic: [
      "On submit, supervisors get a Review job sheet to-do and an alert.",
      "Sheet not submitted the set hours after the visit's planned end: the owner and supervisors are told.",
      "Service report due within 12 hours or late: the owner and supervisors are told.",
    ],
    rules: [
      "2 client no-shows in a row on the same visit count it as used.",
      "With no supervisors and no level 1 approvers named, nobody gets the review to-dos.",
      "Additional work written on a sheet is not raised by itself: raise it in Additional work.",
    ],
    settings: [
      { section: "scheduling", key: "supervisorUserIds" },
      { section: "scheduling", key: "jobSheetGraceHours" },
    ],
    before: [L.visitBoard, L.callOuts],
    after: [L.additionalWork],
  },

  callOuts: {
    title: "Call outs",
    summary: "Emergency and non-emergency requests on AMC contracts: whether it is covered, the SLA clock, the visit, the findings and any additional work.",
    who: "Coordinators, supervisors and account managers.",
    steps: [
      { title: "Log call out", detail: "Pick the contract, the priority and the service. The coverage check answers Covered or Chargeable and says why. A covered call out books one unit of the allowance." },
      { title: "Schedule the visit", detail: "Find technicians (same crew rules as the board). Status: Logged, then Scheduled." },
      { title: "Attend and record", detail: "Record attendance, then Save findings. Needs parts or more than a minor fix? Raise additional work." },
      { title: "Close", detail: "Resolved, then Closed: the booked unit is used. Cancelled releases it." },
    ],
    explain: [
      {
        title: "Covered or chargeable?",
        items: [
          "Covered: the AMC pays. The client pays nothing for the visit, and one call out is taken from the contract's allowance when the call out is closed.",
          "Chargeable: the client pays for this visit. Nothing is taken from the allowance.",
          "It is chargeable when no AMC is in force on the day, the contract has no call-out service for this priority (emergency or non-emergency), the allowance is used up, the contract does not cover labour, or you tick Excluded by the contract.",
          "Parts are separate. Even on a covered visit, parts beyond what the contract covers show as Chargeable extras, and the client pays for those.",
          "The client's acknowledgement says either \"covered by your AMC\" or \"chargeable; we will confirm the charge before the visit\". Agree the price with the client before sending anyone.",
          "There is no fixed call-out fee in the portal. To charge the client, use Raise additional work on the call out and share the quotation.",
          "Book as covered anyway (needs AMC Allowances approval and a reason) makes a chargeable call out free for the client.",
        ],
      },
    ],
    automatic: [
      "On logging: a to-do due at the SLA deadline for the owner, an alert (supervisors too for emergencies), and a WhatsApp acknowledgement to the client is prepared.",
      "Once the warning share of the time has passed, or the deadline is missed, the owner and supervisors are alerted.",
    ],
    rules: [
      "A call out cannot close while its additional work is still open.",
      "Book as covered anyway needs allowance approval and a reason.",
      "Flag misuse is for emergencies that were not.",
    ],
    settings: [
      { section: "sla", key: "emergencyLogMinutes" },
      { section: "sla", key: "emergencyAttendMinutes" },
      { section: "sla", key: "nonEmergencyScheduleHours" },
      { section: "sla", key: "minorFixHours" },
      { section: "sla", key: "atRiskPercent" },
    ],
    before: [L.contracts],
    after: [L.jobReviews, L.additionalWork],
  },

  additionalWork: {
    title: "Additional work",
    summary: "Work outside the contract found on visits and call outs: quoted to the client, approved with evidence, done, invoiced and paid.",
    who: "Account managers, coordinators and finance.",
    steps: [
      { title: "Raise it", detail: "Raise additional work from a call out, a visit, or by hand. Status: Identified." },
      { title: "Quote", detail: "Save quotation (materials plus the handling fee, then VAT), then Share quotation: the PDF is emailed to the client, or a WhatsApp is prepared." },
      { title: "Client decides", detail: "Approve, saying how the client approved (email, signed quotation or WhatsApp), or Reject with a reason." },
      { title: "Do it and get paid", detail: "Schedule (optional), Mark completed, Record invoice (the number from accounts), Mark paid." },
    ],
    automatic: [
      "Sharing tells the owner the quotation is awaiting the client.",
      "The linked call out follows along: Quoted when shared, Resolved when all its work is done.",
    ],
    rules: [
      "No invoice is generated here; the invoice from accounts is recorded.",
      "The handling fee is fixed on each item when raised; changing the setting later does not change existing items.",
    ],
    settings: [{ section: "additionalWork", key: "materialHandlingFeePercent" }],
    before: [L.callOuts, L.jobReviews],
  },

  technicians: {
    title: "Technicians",
    summary: "What AMC knows about each FSM technician (trades, level, certificates, areas, access permissions) so the board can suggest and allow crews.",
    who: "Supervisors and coordinators.",
    steps: [
      { title: "The list comes from FSM", detail: "Every technician on the FSM roster. Filter by trade or Active only." },
      { title: "Edit technician", detail: "Tick the trades, set the level per trade (Trainee, Competent, Expert) with certificate and expiry, plus areas, tools, access permissions and vehicle." },
      { title: "The board uses it", detail: "Each visit needs one technician per trade. Suggestions favour whoever covers the trades, is Expert, and has the lightest day." },
    ],
    rules: [
      "A technician with no trade ticked is never suggested. Trainee or an expired certificate blocks that trade.",
      "Access permissions must match the clearance named on the property's access rules (same spelling).",
    ],
    settings: [
      { section: "scheduling", key: "durationPerServiceMinutes" },
      { section: "scheduling", key: "durationPerExtraUnitMinutes" },
    ],
    after: [L.visitBoard, L.callOuts],
  },

  /* ---------------------------------------------------------------- */
  /* Insight and set-up                                                */
  /* ---------------------------------------------------------------- */
  reports: {
    title: "Reports",
    summary: "Figures counted from contract data only. Draft or rejected proposals and quotes are never counted as revenue.",
    who: "Management, finance and AMC leads. Approvers and operations see every contract; others see their own.",
    steps: [
      { title: "Dashboard", detail: "Today: pipeline, contracts, approvals, delivery, workforce, money in and renewals due." },
      { title: "Operations and Commercial", detail: "Pick a period (this month by default, up to two years): schedule adherence, call outs and SLA, utilisation, allowance use; enquiries, conversion, discounts, signed value, collections and ageing." },
      { title: "Portfolio tabs", detail: "Expiry, Renewal pipeline, Account managers and Services, filtered by account manager, client and property." },
      { title: "Export", detail: "Every table exports the rows on screen, with the filters applied." },
    ],
    rules: [
      "Proposal values are before VAT; signed contract values and additional work include VAT.",
      "A contract with two account managers counts for each. Cancelled contracts are left out.",
    ],
  },

  rateCard: {
    title: "Rate card",
    summary: "The rates every proposal is priced from: per service and property model, with a floor, the frequencies allowed, packages and promotions.",
    who: "Pricing and management. Changing it needs Rate Card Edit.",
    steps: [
      { title: "Rates", detail: "One rate per service and property model (Villa, Apartment, Office or Any), with a standard rate, a floor rate and the visits a year allowed." },
      { title: "Packages and promotions", detail: "Packages tick a preset set of services. Promotions take a percentage off while they are in date; the bigger one wins." },
      { title: "Change the card", detail: "Edit a working copy, then Publish with an Effective from date and a reason. Nothing changes for proposals until it is published." },
      { title: "History", detail: "Every published version: who, when, why, and each old and new value." },
    ],
    rules: [
      "Proposals already shared keep their prices; drafts take the new rates from the effective date.",
      "A discount that takes a line below its floor sends the proposal for approval.",
      "The service list itself comes from AMC Settings → Scope of work.",
    ],
    settings: [{ section: "approvals", key: "belowFloorLevel" }],
    after: [L.proposals],
  },

  fsmMapping: {
    title: "FSM service mapping",
    summary: "Which Zoho FSM service each AMC service is. FSM work is matched to a contract's services through this link.",
    who: "AMC approvers change it; anyone with access can view it.",
    steps: [
      { title: "Find the service", detail: "Search, or filter by Mapped, Inactive or Unmapped." },
      { title: "Edit", detail: "Find from a work order (e.g. WO731, then pick its service line), or type the FSM service id and name." },
      { title: "Activate", detail: "Tick Active (used to match FSM work) and Save. Remove mapping deletes the link." },
    ],
    rules: [
      "An unmapped or inactive service means FSM work for it cannot be matched: the coverage check says so and the contract shows a warning.",
      "Nothing is matched by name; only the FSM service id counts.",
      "Usage from FSM work is confirmed by a person; it is never taken off the allowance on its own.",
    ],
  },

  opsSettings: {
    title: "Operations settings",
    summary: "Which notifications and reminders go out, the AMC discount on additional services, and the site visit checklist.",
    who: "Viewed by everyone with access; changed by AMC approvers.",
    steps: [
      { title: "Notifications and reminders", detail: "Workflow emails (on), allowance emails (off), and contract expiry reminders with the days before the end date and who receives them." },
      { title: "Additional-service discount", detail: "On or off, the discount and which services or categories qualify." },
      { title: "Site visit checklist", detail: "The items each new site visit starts with, by category and order." },
    ],
    rules: [
      "Contract expiry reminders only go out once Send automatically is on (off until the business decides). Run reminders now never sends the same reminder twice.",
      "Checklist changes apply to new site visits; past visits keep their wording.",
      "The additional-service discount is not applied to quotations yet.",
    ],
  },

  configuration: {
    title: "AMC configuration",
    summary: "The business rules AMC runs on, changeable without a software release: approvals, payments, pipeline, schedule, service levels, renewals, message texts, roles and jobs.",
    who: "Management sets approval and payment thresholds; AMC Configuration Edit changes the rest.",
    steps: [
      { title: "Pick a view", detail: "Approvals and payments, Pipeline and contracts, Scheduling and SLA, Emails and messages, Change history." },
      { title: "Change a section", detail: "Edit the values, then Save. Discard undoes unsaved edits; Reset to defaults goes back to the standard values." },
      { title: "It applies from the next action", detail: "Records already made keep what they were made with; the next proposal, visit or reminder uses the new value." },
      { title: "Check the history", detail: "Every change is recorded with who, when, and the old and new value." },
    ],
    rules: [
      "Sections marked Management only need AMC Configuration Approve.",
      "If a saved section stops being valid, the page warns and uses the defaults.",
    ],
  },

  amcSettings: {
    title: "AMC settings",
    summary: "The wording and lists every proposal and contract is printed from: company details, contract clauses, the service catalogue and the approvers.",
    who: "Administrators.",
    steps: [
      { title: "Standard values", detail: "Contact numbers, emails, address, response times printed in the proposal, and the account managers proposals pick from." },
      { title: "Contract clauses", detail: "The editable clauses; unedited ones keep the standard wording." },
      { title: "Scope of work", detail: "The service catalogue: add, rename, reorder, which property types each is offered on, and the scope text it prints." },
      { title: "Approvers", detail: "Who approves proposals when a level in AMC configuration has nobody named." },
    ],
    rules: [
      "Changes apply to new proposals only. Reset goes back to the standard wording.",
      "Prices are on the Rate card; validity and approval thresholds are in AMC configuration.",
    ],
    after: [L.rateCard, L.proposals],
  },
};
