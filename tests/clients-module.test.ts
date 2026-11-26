import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { getNavData } from "@/components/dashboard-layout/menu-items";
import { checkRouteAccess } from "@/components/auth/check-route-access";
import { clientHref, clientsAccess } from "@/lib/clients/access";
import { contactProblem, readContactInput } from "@/lib/clients/client-input";
import { ActionType, ResourceType, type MenuItem, type User } from "@/types/types";

/* 26 Nov 2026: one Clients module for AMC and Snagging. */

const userWith = (grants: Array<[ResourceType, ActionType]>): User =>
  ({
    roles: {
      name: "coordinator",
      role_accessCollection: { edges: grants.map(([resource, action]) => ({ node: { resource, action, enabled: true } })) },
    },
  }) as unknown as User;

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const titles = (items: MenuItem[]): string[] => items.flatMap((i) => [i.title, ...(i.items ?? []).map((s) => `${i.title} > ${s.title}`)]);

test("either module's Clients permission opens the one Clients page; what each sees follows the module", () => {
  const inspector = clientsAccess(userWith([[ResourceType.SNAGGING_CLIENTS, ActionType.VIEW], [ResourceType.SNAGGING, ActionType.EDIT]]));
  assert.deepEqual(inspector, { view: true, amc: false, snagging: true, create: false, editViaSnagging: true });
  assert.equal(
    clientsAccess(userWith([[ResourceType.SNAGGING_CLIENTS, ActionType.VIEW], [ResourceType.SNAGGING_CLIENTS, ActionType.EDIT]])).editViaSnagging,
    false,
    "editing asks for Snagging (Edit), as Snagging's own Clients page did",
  );

  const amcOnly = clientsAccess(userWith([[ResourceType.AMC, ActionType.VIEW], [ResourceType.AMC_CLIENTS, ActionType.VIEW]]));
  assert.equal(amcOnly.view, true);
  assert.equal(amcOnly.amc, true);
  assert.equal(amcOnly.snagging, false);
  assert.equal(amcOnly.create, true, "AMC users could always add a client");
  assert.equal(amcOnly.editViaSnagging, false, "AMC's own edit rule is checked per client on the server");

  assert.equal(clientsAccess(userWith([[ResourceType.SNAGGING_JOBS, ActionType.VIEW]])).view, false);
  assert.equal(clientsAccess(userWith([[ResourceType.AMC_CLIENTS, ActionType.VIEW]])).amc, true, "a role with only AMC's Clients page reaches it, as AMC's page grants do");
});

test("the menu has one Clients, outside AMC and Snagging, and the route guard lets it open", () => {
  const user = userWith([
    [ResourceType.AMC, ActionType.VIEW],
    [ResourceType.AMC_CLIENTS, ActionType.VIEW],
    [ResourceType.AMC_CONTRACTS, ActionType.VIEW],
    [ResourceType.SNAGGING, ActionType.VIEW],
    [ResourceType.SNAGGING_CLIENTS, ActionType.VIEW],
    [ResourceType.SNAGGING_JOBS, ActionType.VIEW],
  ]);
  const { navMain } = getNavData(user);
  const all = navMain.flatMap((section) => titles(section.items));
  assert.deepEqual(all.filter((t) => /Clients$/.test(t)), ["Clients"]);
  assert.equal(checkRouteAccess("/clients", navMain), true);
  assert.equal(checkRouteAccess("/clients/2f0c3a52-9a51-4f4e-9b62-0a2d6f1d2c11", navMain), true);

  const inspector = getNavData(userWith([[ResourceType.SNAGGING_CLIENTS, ActionType.VIEW]])).navMain;
  assert.equal(checkRouteAccess("/clients", inspector), true, "Snagging's Clients alone opens it");
  assert.equal(checkRouteAccess("/clients", getNavData(userWith([[ResourceType.SNAGGING_JOBS, ActionType.VIEW]])).navMain), false);
});

test("the old addresses forward to the Clients module, the client's tab kept", () => {
  assert.match(read("app/(dashboard)/snagging/clients/page.tsx"), /redirect\("\/clients"\)/);
  assert.match(read("app/(dashboard)/extensions/amc-contracts/customers/page.tsx"), /redirect\("\/clients"\)/);
  assert.match(read("app/(dashboard)/extensions/amc-contracts/customers/[customerId]/page.tsx"), /redirect\(clientHref\(customerId, tab\)\)/);
  assert.equal(clientHref("abc", "contracts"), "/clients/abc?tab=contracts");
  assert.equal(clientHref("abc"), "/clients/abc");
  assert.equal(existsSync(path.join(process.cwd(), "app/(dashboard)/snagging/clients/loading.tsx")), false, "a forward shows no list skeleton first");
});

test("both Clients permissions stay on the Permissions screen, each under its module", async () => {
  const { RESOURCE_ACTIONS, RESOURCE_PARENT } = await import("@/components/dashboard/permissions/constants");
  assert.deepEqual(RESOURCE_ACTIONS[ResourceType.AMC_CLIENTS], [ActionType.VIEW]);
  assert.deepEqual(RESOURCE_ACTIONS[ResourceType.SNAGGING_CLIENTS], [ActionType.VIEW]);
  assert.equal(RESOURCE_PARENT[ResourceType.AMC_CLIENTS], ResourceType.AMC);
  assert.equal(RESOURCE_PARENT[ResourceType.SNAGGING_CLIENTS], ResourceType.SNAGGING);
});

test("the Clients pages ask about the Clients permission on the server", () => {
  for (const file of ["app/(dashboard)/clients/(list)/page.tsx", "app/(dashboard)/clients/[id]/page.tsx"]) {
    assert.match(read(file), /canSeeClientsPage\(\)/, file);
  }
});

test("the row menu offers only Open client and Edit client", () => {
  const src = read("components/dashboard/clients/clients-page.tsx");
  const menu = src.slice(src.indexOf("<DropdownMenuContent"), src.indexOf("</DropdownMenuContent>"));
  const items = [...menu.matchAll(/<DropdownMenuItem[\s\S]*?<\/DropdownMenuItem>/g)].map((m) => m[0].slice(m[0].lastIndexOf("/>") + 2).replace(/<[^>]+>/g, "").trim());
  assert.deepEqual(items, ["Open client", "Edit client"]);
});

test("one Edit client: what a client needs to be saved, in FSM or the portal", () => {
  const ok = readContactInput({ name: " Micheal ", phone: "+971 50 123 4567", email: "m@x.ae", maherId: "C1", company: " ", notes: "" });
  assert.deepEqual(ok, { name: "Micheal", phone: "+971 50 123 4567", email: "m@x.ae", maherId: "C1", company: null, notes: null });
  assert.equal(contactProblem(ok, { savedInFsm: true }), null);
  assert.match(contactProblem({ ...ok, name: "M" }, { savedInFsm: false }) ?? "", /two characters/);
  assert.ok(contactProblem({ ...ok, phone: null }, { savedInFsm: false }), "a phone is required everywhere");
  assert.match(contactProblem({ ...ok, email: "nope" }, { savedInFsm: false }) ?? "", /full email/);
  assert.match(contactProblem({ ...ok, email: null }, { savedInFsm: true }) ?? "", /email is required/);
  assert.equal(contactProblem({ ...ok, email: null, maherId: null }, { savedInFsm: false }), null, "the portal alone needs neither");
  assert.equal(contactProblem({ ...ok, maherId: null }, { savedInFsm: true }), null, "the Maher ID is optional, even in FSM (26 Nov 2026)");
});

test("AMC's Edit client everywhere is the Clients module's", () => {
  assert.match(read("components/dashboard/extensions/amc-contracts/edit-client-dialog.tsx"), /<ClientDialog\b/);
  const detail = read("components/dashboard/extensions/amc-contracts/customer-property-views.tsx");
  assert.match(detail, /<ClientDialog\b/);
  assert.doesNotMatch(detail, /updateCustomer\(/, "the client page no longer saves around Zoho FSM");
});
