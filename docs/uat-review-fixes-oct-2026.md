# UAT review with Sharon: fixes checklist (October 2026)

Source: *YFI UAT Review Notes for Danish* (Sami's notes from the UAT review with Sharon). Branch: `main` (portal) and `yfi-mobile-app/YFI-MobileApp` `main` (inspector app). Bugs first; the new features in section C are not to be started now.

Each item is ticked when it is done in code and checked (lint, types, tests where they exist). Nothing is committed or pushed by me.

## A. Snagging bugs (fix now)

- [x] **SNG-055 PDF floor plans.** A PDF plan uploads but cannot be marked. Either make it markable, or remove the PDF option on create and edit job with a clear "the plan must be an image" message.
  *Done:* a PDF plan is now turned into an image (its first page) when it is picked, in the quotation/job wizard as well as on the job's Floor plans tab, so it can be pinned and drawn on. If a PDF cannot be read, the message asks for the plan as a PNG or JPG.
- [x] **SNG-082 Tap inside a room (app).** After Add snag, tapping inside a drawn area goes straight to adding the snag in that area, without "Which room is this snag in?".
  *Done (inspector app):* a tap inside a room's outline or on its pin opens snag capture in that room at once. The question is only asked when the tap is outside every room, or in a room the inspector cannot add to (finished, or someone else's). Tapping a room without Add snag still opens the room.
- [x] **SNG-140 Client report link.**
  - [x] A Download (PDF) option on the client report link. *Always shown now, with Print beside it. It uses the stored PDF when the version has one; otherwise the browser makes the PDF from the same report, so it no longer depends on the server's Chrome, which production does not seem to have.*
  - [x] The Word file identical to the PDF (nothing missing). *The portal report keeps its design. Word now follows the PDF section by section: the same cover table (no severity legend), Definition, Overview and General remarks, the same summary figures, What was found and Most affected sub-categories, the defect cards laid out as the PDF's (tags in the header, the photo beside category and comment), and the commercial summary with subtotal and tax. Like the PDF, the running head starts on page 2.*
  - [x] PDF is the default (listed first). The portal report and the client link keep their own designs; neither shows the checklist, and both use the snag's code.
- [x] **SNG-097 One snag ID.** The same snag ID in the app, the report and the portal (the web snag view shows it too).
  *Done:* the snag's own code from the app (e.g. UATTESTO-C4RD-S004) is the one ID. The report prints it on every defect, and its short form (S004) on the defect badge and the plan pin, in the PDF, the Word file and the link. The portal shows the short form in the snag list and on the plan, and the full code in the snag view.
- [x] **SNG-008 Phone required in Clients.** Phone mandatory when adding or editing a client in the Clients module, as in the quotation form.
  *Done:* required (at least six digits, any country code) in the Clients dialog, on the job Setup tab's client edit, and in the clients API, so no screen can save a client without one.
- [x] **SNG-022 Office notes.** Saved, and shown on the job Setup tab and in the inspector app (and on the quotation).
  *Done:* the note is saved on the quotation and shown on the quotation page. It is copied to the job raised from it, shown and editable on the job's Setup tab (new Office notes section), and the app already shows the job's notes. **Needs migration `20261013150000_snagging_quotation_office_notes.sql`** (one nullable column). Until it is applied the portal works but quotation notes are not stored.
- [x] **SNG-104 Unit with no snags (app).** A unit can be submitted with zero snags when every area is marked and the checklist is done.
  *Done (inspector app):* with no snags, every area marked finished and the whole checklist answered, Review shows "No defects found" with a tick and Submit is enabled. Otherwise the message now says both ways forward. The server already accepted it.
- [x] **SNG-134 Checklist not in the report.** Remove the checklist and its counts (e.g. 43 of 43) from the report, the Word and PDF files and the client link.
  *Done:* the Checklist figure is gone from the summary, and "Areas not fully inspected" lists rooms only, never checklist items, in every output. The older public report data endpoint no longer returns the checklist either.
- [x] **SNG-037 Quotation history.**
  - [x] Created by and modified by on quotations (and who picked the rate, and when).
  - [x] A change history on quotations (created, edited with old and new total and rate, repriced, sent, link shared, rate approved, approved or rejected).
  - [x] A change history for the Snagging settings (a Change history tab in Settings > Snagging: rates, charges, scope, terms, catalogue and checklist changes).
  *Built from the audit trail the portal already writes, so it covers past quotations too and needs no migration.*
- [x] **SNG-052 Old job wizard (low).** Remove the old `/snagging/jobs/new` page from the code.
  *Done:* the bare address now sends you to the quotations list. A job opens only from an approved quotation's Create job button, and the API refuses to create a job without an approved quotation that has no job yet.
- [x] **SNG-100 Furnished status (app, after the bugs).** Show whether the unit is furnished or unfurnished in the job in the app.
  *Done:* the job's Property section in the app shows Furnishing: Furnished or Unfurnished, as declared on the job's quotation (a de-snag round or extra visit takes its original job's). It is sent with the job by the portal's sync; the app stores it without a database change. The flag for "not as quoted" is still a new feature (section C).

## B. AMC proposals (fix now)

- [x] **AMC-042 Short contract wording.** "For 6 months" instead of "a year / yearly fee" on the proposal and the proposal page. *(Done on main in 99b4f5a and checked in the code: the proposal, the proposal page and the email all use the term wording. It shows once that commit is deployed.)*
- [x] **AMC-057 Contract document and optional sections.**
  - [x] Clause numbering checked with the price list on and off; no reference to a missing clause. *Checked all four on/off combinations. Fixed one fault: clause 6.3 kept its number when the fixed price section was off, which left a gap after it.*
  - [x] The Additional fixed price services switch asks for the rates. *Turning it on shows the rate lines, starting from the standard rates in AMC Settings. They can be edited, added to, removed or reset; are saved with the proposal; and print in clause 6.3. At least one rate is needed while it is on.*
  - [x] Price list rows can be deleted. *A bin on every row; one row always stays while the section is on.*
  - [x] The supply and installation price list shows on the proposal page. *A table under the plan, in the proposal's own style.*
  - [x] The "Enter a base price for every selected service" error names the service. *It lists the services still waiting for a price, marks their fields, and says to tick Free for a service included at no charge.*
- [x] **AMC-099 Contacts.** A custom contact designation (e.g. Operation Manager) and extra coordination contacts on the proposal.
  *Done:* each contact's designation is Owner, Tenant, Representative or Other, where the client's own title is typed in. It prints in the contract in capitals. Up to six contacts can be added, and any one but the first removed. The first is required; the others are all or nothing (a name needs a number).

## C. New features (after the bugs; not to start now)

- [ ] Cancel a job (Cancelled status before the site visit; finance told).
- [ ] Furnished flag and asset list (portal upload, app checklist, in the report).

## D. Zoho FSM sync (SNG-187 to 191)

- [ ] **Deferred: taken out before this push.** A first version (quotations as FSM estimates, and the completed job as a work order with the report) is saved outside the repo in `Prohelp-Work/Yalla-Fixit-FSM-WIP/` and will be reworked against *YFI Snagging - Zoho FSM APIs for Quotations* after this release, without the Settings > Zoho FSM tab.

## E. Follow-ups asked for during testing

- [x] **Google Maps everywhere a map is shown.** Portal: the location picker (quotation/job wizard, client addresses, job Setup) is a Google map with Google address search; the read-only map on the job Setup tab uses Google. App: the job screen shows a Google map picture of the unit with its pin (tap opens Google Maps). The key is in the gitignored env files; production needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (portal host) and EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (EAS environment).
- [x] **A new floor plan opens when it is added**, on the job Floor plans tab and in the job wizard.
- [x] **Quotation page layout.** The document and its history on the left; Details (created by, last modified by, rate picked by) and Office notes in a side column, in the same cards as the other detail pages.
