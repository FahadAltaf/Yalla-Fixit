import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/graphql/route";
import { allowedGraphQLOperation } from "@/lib/server/graphql-allowlist";
import { GET_SETTINGS_BY_ID } from "@/modules/settings/services/setting-graphql";

/* 3 Nov 2026 (Sami's report): /api/graphql asks for no session, so it must forward only its allowlist. */
const call = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/graphql", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

test("a signed-out caller cannot list roles or change permissions through /api/graphql", async () => {
  const roles = await call({ query: "{ rolesCollection { edges { node { id name } } } }" });
  assert.equal(roles.status, 403);
  const grant = await call({
    query: 'mutation { insertIntorole_accessCollection(objects: [{ role_id: "x", resource: "users", action: "view" }]) { affectedCount } }',
  });
  assert.equal(grant.status, 403);
  const profiles = await call({ query: "{ user_profileCollection { edges { node { email } } } }" });
  assert.equal(profiles.status, 403);
});

test("the settings query the portal sends before sign-in is still allowed, and only in its own shape", () => {
  assert.equal(allowedGraphQLOperation(GET_SETTINGS_BY_ID, { filter: { type: { eq: "general" } } }), "getSettingsById");
  /* Whitespace differences do not matter. */
  assert.equal(allowedGraphQLOperation(`  ${GET_SETTINGS_BY_ID.replace(/\s+/g, "  ")}  `, { filter: { type: { eq: "general" } } }), "getSettingsById");
  /* The same query with a wider filter is refused. */
  assert.equal(allowedGraphQLOperation(GET_SETTINGS_BY_ID, {}), null);
  assert.equal(allowedGraphQLOperation(GET_SETTINGS_BY_ID, { filter: { id: { neq: "x" } } }), null);
});
