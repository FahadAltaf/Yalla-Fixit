# YFI Finance Invoicing & Management Reporting

Planning and tracking for the project defined by **BRD v1.0** ("YFI Portal: Invoicing Notification and
Management Reporting", Sami Farah for Sharon Benedict Varghese, 19 Oct 2026) and **Jira DEV-433 … DEV-463**
(31 subtasks under DEV-432).

Branch `feature/yfi-finance-reporting`, from `origin/main` `f341a26`, in its own worktree
(`_wt/finance-reporting`). `main` is live production and is not modified.

## Status — 20 Oct 2026

**P0 (foundation and discovery) done on the branch.** Next: P1, after review.

| | |
|---|---|
| Jira mapped to phases | 31 / 31 |
| On `main` today | 0 implemented · 3 partial (DEV-443, 456, 459) · 28 not implemented |
| Externally blocked | 8 issues in whole or part, all by **B-01** (Zoho OAuth scope) |
| Waiting on a business decision | 9 before their build can finish (D-01 … D-22) |
| Tests | 21 passing (`npm test`), both safety rails mutation-tested |

## The four things to know first

1. **The Zoho token can't read what the reports need.** Trips, time sheets/check-ins, service reports,
   ratings and field metadata all return `401 OAUTH_SCOPE_MISMATCH`. A Zoho admin has to widen the
   token's read scopes before attendance, compliance, travel and ratings can be built (B-01).
2. **The invoice flag is on the quotation, and work orders are rarely completed.**
   `Estimates.Post_To_Maher__C = "To Be Invoiced"` is the likely "Ready to be Invoiced" flag; work orders
   reach Completed on 3 of 600. What "job completed" means must be decided before the queue trigger is
   built (D-01, D-02, D-03).
3. **Production has a privilege-escalation hole** independent of this project: role tables are writable
   with the public anon key. The fix is ported on this branch but only closes the hole when deployed (B-02).
4. **Development runs on the production database and production FSM**, by decision. FSM access is
   read-only by construction, every write flag is off in this worktree, and no email or notification can
   reach a real person (both rails tested).

## Documents

| # | Document | What it answers |
|---|---|---|
| 1 | [requirements-traceability.md](requirements-traceability.md) | Every BRD requirement and Jira issue, its status in the code, and its phase |
| 2 | [existing-system-audit.md](existing-system-audit.md) | What exists, and Reuse / Extend / Build for each component; what P0 ported |
| 3 | [architecture-and-data-flow.md](architecture-and-data-flow.md) | How data moves from FSM to the queue, reports and notifications |
| 4 | [database-design-and-migration-plan.md](database-design-and-migration-plan.md) | Tables, constraints, indexes, migration order, live-safety rules, test volumes |
| 5 | [zoho-fsm-integration-plan.md](zoho-fsm-integration-plan.md) | What FSM exposes (discovery results), the sync design, client sync |
| 6 | [reporting-calculation-specification.md](reporting-calculation-specification.md) | Every formula, edge case and recomputed worked example |
| 7 | [security-and-permissions-matrix.md](security-and-permissions-matrix.md) | Roles × capabilities, enforcement, the escalation fix |
| 8 | [implementation-roadmap.md](implementation-roadmap.md) | Phases P0–P9, dependencies, parallel work, definition of done |
| 9 | [test-strategy-and-acceptance-matrix.md](test-strategy-and-acceptance-matrix.md) | TC01–TC15 and the expanded matrix |
| 10 | [business-decisions-and-blockers.md](business-decisions-and-blockers.md) | D-01 … D-22 and B-01 … B-08 — who decides what, and what each blocks |
| 11 | [performance-and-scalability-plan.md](performance-and-scalability-plan.md) | Volumes, and each optimisation with its reason |

## Working rules for this branch

- Every migration is additive and harmless to live `main`; the user applies it with the shipped pre/post
  checks, one file at a time. Never `supabase db push`.
- FSM is read only (`lib/server/finance/fsm-read.ts`, `FINANCE_FSM_READ`).
- Email and in-app notifications go through `lib/server/finance/delivery-policy.ts`: blocked unless a
  redirect address is set; live only with `FINANCE_NOTIFY_LIVE=on`, never on a development machine.
- Each verified phase is committed to this branch; pushing and merging are the user's.
- Install with `bun install` (the declared lockfile, though it is out of sync on `main`, B-06); build with
  `node node_modules/next/dist/bin/next build --webpack` so the worktree's own Next is used rather than a
  stray install higher up the directory tree.
