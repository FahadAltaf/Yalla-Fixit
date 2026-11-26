import { test } from "node:test";
import assert from "node:assert/strict";

import { greeting, nonEmpty, type HomeItem } from "@/lib/home/summary";
import { buildHomeSummary } from "@/lib/server/home/summary";
import { ActionType, ResourceType, type User } from "@/types/types";

/* 26 Nov 2026: the home dashboard follows what each person holds across the portal. */

const userWith = (grants: Array<[ResourceType, ActionType]>, role = "user"): User =>
  ({
    roles: { name: role, role_accessCollection: { edges: grants.map(([resource, action]) => ({ node: { resource, action, enabled: true } })) } },
  }) as unknown as User;

/** A database that answers every query with nothing, and remembers which tables were read. */
function fakeAdmin() {
  const tables: string[] = [];
  const answer = { data: [], count: 0, error: null };
  const chain = (): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve(answer);
          if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
          return () => chain();
        },
      },
    );
  const admin = {
    from: (table: string) => {
      tables.push(table);
      return chain();
    },
    schema: (schema: string) => ({
      from: (table: string) => {
        tables.push(`${schema}.${table}`);
        return chain();
      },
    }),
    rpc: () => chain(),
  };
  return { admin: admin as never, tables };
}

const me = { id: "u1", email: "me@example.com" };

test("an inspector (Snagging clients and jobs only) reads Snagging and Clients, nothing of AMC, Finance or the admin health", async () => {
  const { admin, tables } = fakeAdmin();
  const summary = await buildHomeSummary(admin, me, userWith([[ResourceType.SNAGGING, ActionType.VIEW], [ResourceType.SNAGGING_CLIENTS, ActionType.VIEW]], "inspector"));
  assert.equal(summary.admin, null, "no portal health for a non-admin");
  assert.equal(summary.role.isAdmin, false);
  assert.ok(tables.includes("snagging_jobs"));
  assert.ok(tables.includes("snagging_clients"), "Clients figure for anyone with a Clients permission");
  for (const t of tables) assert.doesNotMatch(t, /^amc_|^finance\.|^schedule_|^todo|user_profile/, t);
  assert.deepEqual(summary.unavailable, []);
});

test("a scheduler who approves days is asked about days, not AMC or Snagging", async () => {
  const { admin, tables } = fakeAdmin();
  await buildHomeSummary(admin, me, userWith([[ResourceType.SCHEDULING, ActionType.VIEW], [ResourceType.SCHEDULING, ActionType.APPROVE]]));
  assert.ok(tables.includes("schedule_versions"));
  for (const t of tables) assert.doesNotMatch(t, /^amc_|^snagging_|^finance\./, t);
});

test("someone with no grants gets an empty dashboard, not an error", async () => {
  const { admin, tables } = fakeAdmin();
  const summary = await buildHomeSummary(admin, me, userWith([]));
  assert.deepEqual([summary.approvals, summary.work, summary.overview], [[], [], []]);
  assert.equal(summary.role.isApprover, false);
  assert.deepEqual(tables, []);
});

test("a part that fails is named, and the rest still show", async () => {
  const { admin } = fakeAdmin();
  const broken = {
    ...(admin as object),
    from: (table: string) => {
      if (table === "snagging_clients") throw new Error("down");
      return (admin as unknown as { from: (t: string) => unknown }).from(table);
    },
  } as never;
  const summary = await buildHomeSummary(broken, me, userWith([[ResourceType.SNAGGING, ActionType.VIEW], [ResourceType.SNAGGING_CLIENTS, ActionType.VIEW]]));
  assert.deepEqual(summary.unavailable, ["Clients"]);
});

test("only items with something in them show, the urgent first", () => {
  const item = (key: string, count: number, tone: HomeItem["tone"]): HomeItem => ({ key, module: "amc", title: key, detail: null, count, tone, href: "/" });
  assert.deepEqual(
    nonEmpty([item("a", 3, "neutral"), item("b", 0, "bad"), item("c", 1, "bad"), item("d", 9, "neutral")]).map((i) => i.key),
    ["c", "d", "a"],
  );
});

test("the greeting follows the Dubai clock", () => {
  assert.equal(greeting(new Date("2026-11-26T04:00:00Z")), "Good morning");
  assert.equal(greeting(new Date("2026-11-26T10:00:00Z")), "Good afternoon");
  assert.equal(greeting(new Date("2026-11-26T15:00:00Z")), "Good evening");
});

/* ---- the popups behind the figures (26 Nov 2026) ---- */

import { homeDrill } from "@/lib/server/home/drill";

test("a popup opens only for someone who may see the figure behind it", async () => {
  const { admin } = fakeAdmin();
  const inspector = userWith([[ResourceType.SNAGGING, ActionType.VIEW], [ResourceType.SNAGGING_CLIENTS, ActionType.VIEW]], "inspector");
  const opts = { page: 0, pageSize: 10 };
  assert.equal(await homeDrill(admin, me, inspector, "amc-active", opts), null, "no AMC contracts without AMC");
  assert.equal(await homeDrill(admin, me, inspector, "users", opts), null, "the user list is for administrators");
  assert.equal(await homeDrill(admin, me, inspector, "no-such-list", opts), null);
  const mine = await homeDrill(admin, me, inspector, "snagging-mine", opts);
  assert.ok(mine, "their own inspections");
  assert.equal(mine?.href, "/snagging/jobs");
  assert.deepEqual([mine?.total, mine?.rows], [0, []]);
});

test("a popup pages and searches what its figure counted", async () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({ id: `c${i}`, name: i === 7 ? "Needle Client" : `Client ${i}`, email: null, phone: null, company: null, created_at: "2026-11-01T00:00:00Z" }));
  const admin = {
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "eq", "in", "not", "or", "lt", "is"]) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
      return chain;
    },
  } as never;
  const user = userWith([[ResourceType.SNAGGING_CLIENTS, ActionType.VIEW]]);
  const page2 = await homeDrill(admin, me, user, "clients", { page: 2, pageSize: 10 });
  assert.equal(page2?.total, 23);
  assert.equal(page2?.rows.length, 3, "the last page holds the rest");
  assert.equal(page2?.rows[0].href, "/clients/c20", "each row opens its record");
  const found = await homeDrill(admin, me, user, "clients", { page: 0, pageSize: 10, q: "needle" });
  assert.deepEqual(found?.rows.map((r) => r.title), ["Needle Client"]);
});
