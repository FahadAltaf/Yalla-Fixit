import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  canActivateContract,
  canCancelContract,
  canCorrectUsage,
  canEditCustomer,
  canLookUpFsmWorkOrder,
  canOperateContract,
  canReadAssessment,
  canReadContract,
  canRecordUsage,
  seesAllContracts,
  type AmcActor,
} from "@/lib/amc/access";
import { checkPhotoUpload } from "@/lib/amc/photos";
import { planUserUpdate, roleAccessSchema, deleteUserProfile, AdminError, type Caller } from "@/lib/server/admin/users-roles";
import { allowedGraphQLOperation } from "@/lib/server/graphql-allowlist";
import { checkEmailRequest } from "@/lib/server/email-request-policy";
import { hashResetToken } from "@/lib/server/password-reset-token";
import { signQuotationReview, verifyQuotationReview } from "@/lib/server/quotation-review-token";
import { crossSiteRejected, rateLimited } from "@/lib/server/request-origin";
import { signZohoEdgeRequest } from "@/lib/server/zoho/edge-auth";
import { hashLinkToken, mintLinkToken } from "@/lib/server/link-token";
import { resolveLink, type LinkRow } from "@/lib/server/amc/link-resolution";
import { listMyNotifications, markNotificationsRead } from "@/lib/server/amc/notifications";
import { GET_SETTINGS_BY_ID } from "@/modules/settings/services/setting-graphql";
import { ActionType, ResourceType } from "@/types/types";

import { fakeSupabase } from "./fake-supabase";

/*
  Security phase (6 Oct 2026): who may do what, and the guards that stop
  everyone else. Allowed AND denied paths. The database side (role tables,
  todos, uploads, private bucket, user deletion) is checked on a local
  PostgreSQL by scripts/amc-db-harness/97c_verify_security.sql.
*/

const none = { view: false, create: false, edit: false, approve: false };
const owner: AmcActor = { userId: "u-owner", canApprove: false, ops: none };
const stranger: AmcActor = { userId: "u-other", canApprove: false, ops: none };
const approver: AmcActor = { userId: "u-appr", canApprove: true, ops: none };
const opsViewer: AmcActor = { userId: "u-ops-view", canApprove: false, ops: { ...none, view: true } };
const opsEditor: AmcActor = { userId: "u-ops-edit", canApprove: false, ops: { ...none, view: true, edit: true } };
const opsActivator: AmcActor = { userId: "u-ops-create", canApprove: false, ops: { ...none, create: true } };
const opsCorrector: AmcActor = { userId: "u-ops-approve", canApprove: false, ops: { ...none, approve: true } };

/* ------------------------------------------------------------------ */
/* Object-level authorization (contracts, usage, activation, ...)      */
/* ------------------------------------------------------------------ */

test("contracts: the owner and approvers, never another user (IDOR)", () => {
  assert.equal(canReadContract(owner, "u-owner"), true);
  assert.equal(canReadContract(stranger, "u-owner"), false, "changing the id in the URL gives nothing");
  assert.equal(canReadContract(approver, "u-owner"), true);
  assert.equal(canReadContract(opsViewer, "u-owner"), true, "AMC Operations (View) reads every contract");
  assert.equal(canOperateContract(opsViewer, "u-owner"), false, "...but View cannot change one");
  assert.equal(canOperateContract(stranger, "u-owner"), false);
  assert.equal(canOperateContract(opsEditor, "u-owner"), true);
  assert.equal(seesAllContracts(stranger), false);
  assert.equal(seesAllContracts(approver), true);
});

test("activation: owner, approver or AMC Operations (Create); nobody else", () => {
  assert.equal(canActivateContract(owner, "u-owner"), true);
  assert.equal(canActivateContract(approver, "u-owner"), true);
  assert.equal(canActivateContract(opsActivator, "u-owner"), true);
  assert.equal(canActivateContract(stranger, "u-owner"), false);
  assert.equal(canActivateContract(opsEditor, "u-owner"), false, "Edit is not Create");
});

test("usage: recording and correcting are different privileges", () => {
  assert.equal(canRecordUsage(owner, "u-owner"), true);
  assert.equal(canRecordUsage(stranger, "u-owner"), false);
  assert.equal(canRecordUsage(opsCorrector, "u-owner"), false, "Approve alone does not record");
  assert.equal(canCorrectUsage(opsCorrector, "u-owner"), true);
  assert.equal(canCorrectUsage(opsEditor, "u-owner"), false, "Edit alone does not correct");
  assert.equal(canCorrectUsage(stranger, "u-owner"), false);
  assert.equal(canCorrectUsage(approver, "u-owner"), true);
  assert.equal(canCorrectUsage(owner, "u-owner"), true, "owner corrections kept until the business decides");
  assert.equal(canCorrectUsage(owner, "u-owner", true), false, "the approver-only switch takes them away");
});

test("cancellation: approvers only", () => {
  assert.equal(canCancelContract(approver), true);
  assert.equal(canCancelContract(owner), false);
  assert.equal(canCancelContract(opsEditor), false);
});

test("customers and properties: anyone reads and creates; edits by creator, approver or AMC Operations", () => {
  assert.equal(canEditCustomer(stranger, "u-owner"), false);
  assert.equal(canEditCustomer(owner, "u-owner"), true, "the creator");
  assert.equal(canEditCustomer(approver, "u-owner"), true);
  assert.equal(canEditCustomer(opsEditor, "u-owner"), true);
  assert.equal(canEditCustomer(stranger, null), false, "no creator recorded: approvers and operations only");
});

test("assessments: your own, unless you see all", () => {
  assert.equal(canReadAssessment(stranger, "u-owner"), false);
  assert.equal(canReadAssessment(owner, "u-owner"), true);
  assert.equal(canReadAssessment(approver, "u-owner"), true);
  assert.equal(canReadAssessment(opsViewer, "u-owner"), true);
});

test("FSM lookup: approvers and operations freely; others only from a contract they operate", () => {
  assert.equal(canLookUpFsmWorkOrder(approver), true);
  assert.equal(canLookUpFsmWorkOrder(opsEditor), true);
  assert.equal(canLookUpFsmWorkOrder(stranger), false, "not a general FSM search");
  assert.equal(canLookUpFsmWorkOrder(owner, "u-owner", true), true);
  assert.equal(canLookUpFsmWorkOrder(owner, "u-someone", true), false, "someone else's contract");
  assert.equal(canLookUpFsmWorkOrder(owner, "u-owner", false), false, "no contract context");
});

test("assessment photos: only an editor of a draft", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const denied = checkPhotoUpload({ assessmentStatus: "draft", canEdit: false, existingCount: 0, bytes: jpeg });
  assert.equal(!denied.ok && denied.status, 403);
  assert.equal(checkPhotoUpload({ assessmentStatus: "draft", canEdit: true, existingCount: 0, bytes: jpeg }).ok, true);
});

/* ------------------------------------------------------------------ */
/* Role escalation                                                     */
/* ------------------------------------------------------------------ */

const plain: Caller = { id: "u-1", isAdmin: false, canView: false, canCreate: false, canEdit: false, canDelete: false };
const manager: Caller = { id: "u-mgr", isAdmin: false, canView: true, canCreate: true, canEdit: true, canDelete: true };
const adminCaller: Caller = { ...manager, id: "u-admin", isAdmin: true };
const target = (over: Partial<Parameters<typeof planUserUpdate>[1]> = {}) => ({
  id: "u-1",
  roleName: "user",
  roleId: "r-user",
  isActive: true,
  receivesApprovalEmail: false,
  ...over,
});

test("role escalation: nobody changes their own role or access", () => {
  const self = planUserUpdate(plain, target(), { id: "u-1", role_id: "00000000-0000-0000-0000-00000000a0a1" }, "admin");
  assert.equal(self.ok, false);
  const selfManager = planUserUpdate({ ...manager, id: "u-1" }, target(), { id: "u-1", is_active: false }, null);
  assert.equal(selfManager.ok, false, "not even a user manager on themselves");
});

test("role escalation: only an admin grants the admin role or changes an admin", () => {
  const grant = planUserUpdate(manager, target(), { id: "u-1", role_id: "00000000-0000-0000-0000-00000000a0a1" }, "admin");
  assert.equal(grant.ok, false);
  const touchAdmin = planUserUpdate(manager, target({ roleName: "admin" }), { id: "u-1", is_active: false }, null);
  assert.equal(touchAdmin.ok, false);
  const byAdmin = planUserUpdate(adminCaller, target(), { id: "u-1", role_id: "00000000-0000-0000-0000-00000000a0a1" }, "admin");
  assert.equal(byAdmin.ok, true);
});

test("profile edits: your own name and photo, nothing else; others need Users: Edit", () => {
  const own = planUserUpdate(plain, target(), { id: "u-1", full_name: "New Name", role_id: "r-user", is_active: true }, "user");
  assert.ok(own.ok);
  if (own.ok) assert.deepEqual(own.patch, { full_name: "New Name" }, "unchanged role/flags sent by the form are ignored");
  const other = planUserUpdate(plain, target({ id: "00000000-0000-0000-0000-0000000000d9" }), { id: "00000000-0000-0000-0000-0000000000d9", full_name: "X" }, null);
  assert.equal(other.ok, false);
  const managed = planUserUpdate(manager, target({ id: "00000000-0000-0000-0000-0000000000d9" }), { id: "00000000-0000-0000-0000-0000000000d9", role_id: "00000000-0000-0000-0000-0000000b0b0b" }, "sales");
  assert.ok(managed.ok);
});

test("permission rows must name a real resource and action", () => {
  const base = { role_id: "00000000-0000-0000-0000-000000000001" };
  assert.equal(roleAccessSchema.safeParse({ ...base, resource: ResourceType.AMC, action: ActionType.APPROVE }).success, true);
  assert.equal(roleAccessSchema.safeParse({ ...base, resource: "everything", action: ActionType.APPROVE }).success, false);
  assert.equal(roleAccessSchema.safeParse({ ...base, resource: ResourceType.AMC, action: "superuser" }).success, false);
});

test("deleting users: never yourself; an admin only by an admin; history-owning users are refused", async () => {
  const w = fakeSupabase({
    user_profile: [
      { id: "00000000-0000-0000-0000-0000000000d2", email: "a@x", roles: { name: "admin", role_access: [] } },
      { id: "00000000-0000-0000-0000-0000000000d9", email: "b@x", roles: { name: "user", role_access: [] } },
    ],
  });
  await assert.rejects(deleteUserProfile(w.client as never, manager, "u-mgr"), (e: unknown) => e instanceof AdminError && e.status === 403);
  await assert.rejects(deleteUserProfile(w.client as never, plain, "00000000-0000-0000-0000-0000000000d9"), (e: unknown) => e instanceof AdminError && e.status === 403);
  await assert.rejects(deleteUserProfile(w.client as never, manager, "00000000-0000-0000-0000-0000000000d2"), /Only an admin/);
  await deleteUserProfile(w.client as never, manager, "00000000-0000-0000-0000-0000000000d9");
  assert.equal(w.table("user_profile").some((u) => u.id === "00000000-0000-0000-0000-0000000000d9"), false);
});

test("the security migrations close the role tables and keep AMC history", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const lock = readFileSync(path.join(dir, "20261006160000_role_tables_server_only.sql"), "utf8");
  assert.match(lock, /ALTER TABLE public\.role_access ENABLE ROW LEVEL SECURITY/);
  assert.match(lock, /REVOKE ALL ON public\.roles, public\.role_access, public\.user_profile FROM anon/);
  assert.match(lock, /DROP POLICY IF EXISTS "Allow All on Roles"/);
  assert.match(lock, /REQUIRES NEW CODE FIRST/);
  const fk = readFileSync(path.join(dir, "20261006162000_amc_history_survives_user_deletion.sql"), "utf8");
  assert.match(fk, /ON DELETE RESTRICT/);
  assert.match(fk, /SAFE BEFORE CODE DEPLOY/);
  const shared = readFileSync(path.join(dir, "20261006163000_shared_tables_server_only.sql"), "utf8");
  for (const t of ["schedule_entries", "leave_records", "todo_comments", "technician_reference"]) {
    assert.ok(shared.includes(`'${t}'`), `${t} is closed to the anon key`);
  }
  assert.match(shared, /REVOKE ALL ON public\.%I FROM anon/);
});

/* ------------------------------------------------------------------ */
/* GraphQL                                                             */
/* ------------------------------------------------------------------ */

test("GraphQL: only the branding read, with its exact variables", () => {
  assert.equal(allowedGraphQLOperation(GET_SETTINGS_BY_ID, { filter: { type: { eq: "admin" } } }), "getSettingsById");
  assert.equal(allowedGraphQLOperation(`  ${GET_SETTINGS_BY_ID.replace(/\s+/g, "  ")}  `, { filter: { type: { eq: "admin" } } }), "getSettingsById", "whitespace does not matter");
  const mutation = `mutation { insertIntorole_accessCollection(objects: [{role_id: "x", resource: "amc", action: "approve"}]) { affectedCount } }`;
  assert.equal(allowedGraphQLOperation(mutation, {}), null, "privileged mutation refused");
  assert.equal(allowedGraphQLOperation(`query { user_profileCollection { edges { node { email } } } }`, {}), null, "sensitive read refused");
  assert.equal(allowedGraphQLOperation(`{ __schema { types { name } } }`, {}), null, "introspection refused");
  assert.equal(allowedGraphQLOperation(GET_SETTINGS_BY_ID, { filter: { id: { gt: 0 } } }), null, "other filters refused");
  assert.equal(allowedGraphQLOperation(GET_SETTINGS_BY_ID.replace("site_name", "oauth_access_token"), { filter: { type: { eq: "admin" } } }), null, "a changed document is not the allowed one");
});

/* ------------------------------------------------------------------ */
/* Email relay                                                         */
/* ------------------------------------------------------------------ */

test("email: anonymous callers reach only a company mailbox, one recipient, no attachment", () => {
  const html = "<p>x</p>";
  assert.equal(checkEmailRequest({ to: "victim@gmail.com", subject: "s", html }, "anonymous", ["yallafixit.ae"]).ok, false);
  assert.equal(checkEmailRequest({ to: "owner@yallafixit.ae", subject: "s", html }, "anonymous", ["yallafixit.ae"]).ok, true);
  assert.equal(checkEmailRequest({ to: "owner@yallafixit.ae", cc: ["x@gmail.com"], subject: "s", html }, "anonymous", ["yallafixit.ae"]).ok, false);
  const route = readFileSync(path.join(process.cwd(), "app", "api", "send-email", "route.ts"), "utf8");
  assert.match(route, /ResourceType\.EXTENSIONS, ActionType\.VIEW/, "signed-in senders need the quotations permission");
  assert.match(route, /rateLimited\(/, "and are throttled");
});

/* ------------------------------------------------------------------ */
/* Integration secrets                                                 */
/* ------------------------------------------------------------------ */

test("Zoho Edge Functions: a signature is bound to its function and the shared key", () => {
  const key = "test-key";
  const h = signZohoEdgeRequest("get-estimate", 1_700_000_000_000, key);
  const expected = createHmac("sha256", key).update("get-estimate:1700000000000").digest("hex");
  assert.equal(h["x-yfi-internal-signature"], expected);
  const other = signZohoEdgeRequest("zoho-fsm-estimate-transitions", 1_700_000_000_000, key);
  assert.notEqual(other["x-yfi-internal-signature"], expected, "not reusable on another function");
  assert.deepEqual(signZohoEdgeRequest("get-estimate", Date.now(), undefined), {}, "no key, no signature (the function refuses)");
});

test("the Edge Function sources refuse unsigned callers and never log the token", () => {
  for (const slug of ["get-estimate", "zoho-fsm-estimate-transitions", "zoho-fsm-work-orders", "zoho-fsm-appointments", "refresh-token", "token-refresher"]) {
    const src = readFileSync(path.join(process.cwd(), "supabase", "functions", slug, "index.ts"), "utf8")
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    assert.match(src, /isPortalRequest\(req, "[a-z-]+"\)|isCronRequest\(req\)/, `${slug} checks its caller`);
    assert.doesNotMatch(src, /console\.log\([^)]*(settings|token|data)/i, `${slug} logs no token or payload`);
    assert.doesNotMatch(src, /Access-Control-Allow-Origin": "\*"/, `${slug} has no wildcard CORS`);
  }
  const portal = readFileSync(path.join(process.cwd(), "components", "dashboard", "extensions", "bulk-download.tsx"), "utf8");
  assert.doesNotMatch(portal, /functions\/v1/, "the browser no longer calls Edge Functions");
});

test("quotation review links: valid only with the portal's signature for that estimate", () => {
  const key = "k";
  const sig = signQuotationReview("4776000000265108", key)!;
  assert.equal(verifyQuotationReview("4776000000265108", sig, key), true);
  assert.equal(verifyQuotationReview("4776000000265109", sig, key), false, "next sequential id");
  assert.equal(verifyQuotationReview("4776000000265108", undefined, key), false, "no signature");
  assert.equal(verifyQuotationReview("4776000000265108", "0".repeat(40), key), false);
});

/* ------------------------------------------------------------------ */
/* Public links, password reset, cross-site                            */
/* ------------------------------------------------------------------ */

function linkTable(rows: LinkRow[]) {
  return async (hash: string) => rows.find((r) => r.proposal_token_hash === hash || r.contract_token_hash === hash) ?? null;
}

test("client links: unknown, malformed and expired tokens are refused; stored only as a hash", async () => {
  const t = mintLinkToken();
  assert.match(t.raw, /^[A-Za-z0-9_-]{43}$/, "256 bits");
  assert.equal(t.hash, hashLinkToken(t.raw));
  assert.notEqual(t.hash, t.raw);
  const row = {
    id: "s",
    status: "proposal_sent",
    proposal_token_hash: t.hash,
    proposal_token_expires_at: "2020-01-01T00:00:00Z",
    contract_token_hash: null,
    contract_token_expires_at: null,
  } as unknown as LinkRow;
  const NOW = Date.parse("2026-10-06T00:00:00Z");
  assert.equal((await resolveLink(t.raw, linkTable([row]) as never, NOW)).state, "expired");
  assert.equal((await resolveLink(mintLinkToken().raw, linkTable([row]) as never, NOW)).state, "not_found");
  assert.equal((await resolveLink("short", linkTable([row]) as never, NOW)).state, "not_found");
});

test("password reset tokens are stored hashed", () => {
  const raw = "a".repeat(64);
  assert.match(hashResetToken(raw), /^[0-9a-f]{64}$/);
  assert.notEqual(hashResetToken(raw), raw);
  assert.equal(hashResetToken(raw), hashResetToken(raw));
  const actions = readFileSync(path.join(process.cwd(), "modules", "auth", "auth-actions.ts"), "utf8");
  assert.match(actions, /\.is\("used_at", null\)/, "single use: claimed atomically");
  assert.match(actions, /token: hashResetToken\(token\)/, "only the hash is stored");
  assert.doesNotMatch(actions, /console\.log\(/, "no logging of reset details");
});

test("privileged server actions check the caller first", () => {
  const actions = readFileSync(path.join(process.cwd(), "modules", "auth", "auth-actions.ts"), "utf8");
  for (const fn of ["deleteAuthUser", "createAuthUser", "updateUserPassword", "deleteAuthUserById"]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}`));
    const next = body.indexOf("export async function", 10);
    assert.match(next > 0 ? body.slice(0, next) : body, /requireActionCaller\(/, `${fn} is guarded`);
  }
  const service = readFileSync(path.join(process.cwd(), "modules", "auth", "services", "auth-service.ts"), "utf8");
  assert.match(service, /void role_id;/, "sign-up ignores a role sent by the browser");
  assert.match(service, /Invites are not available/, "the user-id invite is switched off");
});

test("cross-site writes are refused; same-site and server calls pass", () => {
  assert.equal(crossSiteRejected({ method: "POST", origin: "https://evil.example", host: "portal.yallafixit.ae" }), true);
  assert.equal(crossSiteRejected({ method: "POST", origin: "https://portal.yallafixit.ae", host: "portal.yallafixit.ae" }), false);
  assert.equal(crossSiteRejected({ method: "POST", origin: null, host: "portal.yallafixit.ae" }), false, "server/cron/mobile send no Origin");
  assert.equal(crossSiteRejected({ method: "GET", origin: "https://evil.example", host: "portal.yallafixit.ae" }), false, "reads are not state changes");
  assert.equal(crossSiteRejected({ method: "DELETE", origin: "null", host: "x" }), true, "sandboxed/opaque origins refused");
});

test("rate limits trip after the limit and reset after the window", () => {
  const key = `test:${Math.random()}`;
  for (let i = 0; i < 3; i += 1) assert.equal(rateLimited(key, 3, 1000, 0), false);
  assert.equal(rateLimited(key, 3, 1000, 10), true);
  assert.equal(rateLimited(key, 3, 1000, 2000), false, "a new window");
});

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

test("notifications: you see and mark only your own", async () => {
  const w = fakeSupabase({
    amc_notifications: [
      { id: "n1", recipient_user_id: "u-a", channel: "in_app", event: "proposal_submitted", title: "t", body: "b", created_at: "1", read_at: null },
      { id: "n2", recipient_user_id: "u-b", channel: "in_app", event: "proposal_submitted", title: "t", body: "b", created_at: "2", read_at: null },
      { id: "n3", recipient_user_id: "u-a", channel: "email", event: "proposal_submitted", title: "t", body: "b", created_at: "3", read_at: null },
    ],
  });
  const mine = await listMyNotifications(w.client as never, "u-a");
  assert.deepEqual(mine.notifications.map((n) => n.id), ["n1"]);
  await markNotificationsRead(w.client as never, "u-a", ["n2"]);
  assert.equal(w.table("amc_notifications").find((n) => n.id === "n2")!.read_at, null, "someone else's stays unread");
  await markNotificationsRead(w.client as never, "u-a", "all");
  assert.notEqual(w.table("amc_notifications").find((n) => n.id === "n1")!.read_at, null);
  assert.equal(w.table("amc_notifications").find((n) => n.id === "n2")!.read_at, null);
});
