import { test } from "node:test";
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureTechnicianLogin, generatePassword, listTechnicianAccounts } from "@/lib/server/technician-accounts";
import { fakeSupabase } from "../amc/fake-supabase";

const INSPECTOR = "role-inspector";

/** The fake client plus the bits of auth.admin a login needs. */
function setup(seed: Record<string, Record<string, unknown>[]>, authUsers: Array<{ id: string; email: string }> = []) {
  const fake = fakeSupabase({ roles: [{ id: INSPECTOR, name: "inspector" }, { id: "role-user", name: "user" }], ...seed });
  const created: Array<{ email: string; password: string }> = [];
  const passwords = new Map<string, string>();
  const auth = {
    admin: {
      createUser: async ({ email, password }: { email: string; password: string }) => {
        if (authUsers.some((u) => u.email === email)) return { data: { user: null }, error: { message: "A user with this email address has already been registered" } };
        const user = { id: `auth-${authUsers.length + 1}`, email };
        authUsers.push(user);
        created.push({ email, password });
        return { data: { user }, error: null };
      },
      listUsers: async () => ({ data: { users: authUsers }, error: null }),
      updateUserById: async (id: string, { password }: { password: string }) => {
        passwords.set(id, password);
        return { data: {}, error: null };
      },
      deleteUser: async () => ({ data: {}, error: null }),
    },
  };
  const admin = { ...fake.client, auth } as unknown as SupabaseClient;
  return { admin, fake, created, passwords };
}

const tech = (over: Record<string, unknown> = {}) => ({
  fsm_resource_id: "T1",
  display_name: "Ali Raza Khan",
  email: "Ali.Khan@example.com",
  user_profile_id: null,
  is_active: true,
  hidden_from_lists: false,
  ...over,
});

test("passwords are 12 readable characters in three groups, with every kind", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const p = generatePassword();
    assert.match(p, /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    assert.match(p, /[a-z]/);
    assert.match(p, /[A-Z]/);
    assert.match(p, /[2-9]/);
    assert.doesNotMatch(p, /[0O1lI]/);
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});

test("a technician without a login gets an Inspector account with their FSM email, linked", async () => {
  const { admin, fake, created } = setup({ technician_reference: [tech()], user_profile: [] });
  const result = await ensureTechnicianLogin(admin, "T1");
  assert.equal(result.status, "created");
  assert.equal(result.email, "ali.khan@example.com");
  assert.ok(result.password);
  assert.deepEqual(created, [{ email: "ali.khan@example.com", password: result.password }]);
  const profile = fake.table("user_profile")[0];
  assert.equal(profile.id, result.userId);
  assert.equal(profile.role_id, INSPECTOR);
  assert.equal(profile.first_name, "Ali");
  assert.equal(profile.last_name, "Raza Khan");
  assert.equal(fake.table("technician_reference")[0].user_profile_id, result.userId);
});

test("an account that already has the email is linked, not duplicated, and no password is shown", async () => {
  const { admin, fake, created } = setup({
    technician_reference: [tech()],
    user_profile: [{ id: "u-9", email: "ali.khan@example.com", role_id: "role-user", is_active: true }],
  });
  const result = await ensureTechnicianLogin(admin, "T1");
  assert.equal(result.status, "linked");
  assert.equal(result.userId, "u-9");
  assert.equal(result.password, undefined);
  assert.equal(created.length, 0);
  assert.equal(fake.table("user_profile")[0].role_id, "role-user", "their role is left alone");
  assert.equal(fake.table("technician_reference")[0].user_profile_id, "u-9");
});

test("an already linked technician is left as is", async () => {
  const { admin, created } = setup({ technician_reference: [tech({ user_profile_id: "u-1" })], user_profile: [{ id: "u-1", email: "x@example.com" }] });
  const result = await ensureTechnicianLogin(admin, "T1");
  assert.equal(result.status, "existing");
  assert.equal(created.length, 0);
});

test("a sign-in user left without a profile is adopted with a new password", async () => {
  const { admin, fake, passwords } = setup({ technician_reference: [tech()], user_profile: [] }, [{ id: "auth-orphan", email: "ali.khan@example.com" }]);
  const result = await ensureTechnicianLogin(admin, "T1");
  assert.equal(result.status, "created");
  assert.equal(result.userId, "auth-orphan");
  assert.equal(passwords.get("auth-orphan"), result.password);
  assert.equal(fake.table("user_profile")[0].id, "auth-orphan");
});

test("no email in FSM, or an unknown technician, is refused with a reason", async () => {
  const { admin } = setup({ technician_reference: [tech({ email: null })], user_profile: [] });
  await assert.rejects(ensureTechnicianLogin(admin, "T1"), /no email in Zoho FSM/);
  await assert.rejects(ensureTechnicianLogin(admin, "NOPE"), /not found/);
});

test("the list says who can sign in and who can be put on a snagging job", async () => {
  const { admin } = setup({
    technician_reference: [
      tech({ fsm_resource_id: "A", display_name: "A", user_profile_id: "u-a" }),
      tech({ fsm_resource_id: "B", display_name: "B" }),
      tech({ fsm_resource_id: "C", display_name: "C", user_profile_id: "u-c" }),
      tech({ fsm_resource_id: "D", display_name: "D", user_profile_id: "u-d" }),
      tech({ fsm_resource_id: "H", display_name: "H", hidden_from_lists: true }),
    ],
    user_profile: [
      { id: "u-a", role_id: INSPECTOR, is_active: true },
      { id: "u-c", role_id: "role-user", is_active: true },
      { id: "u-d", role_id: INSPECTOR, is_active: false },
    ],
    role_access: [{ role_id: INSPECTOR, resource: "snagging", action: "view", enabled: true }],
  });
  const list = await listTechnicianAccounts(admin);
  const by = Object.fromEntries(list.map((t) => [t.fsmId, t]));
  assert.deepEqual(Object.keys(by).sort(), ["A", "B", "C", "D"]);
  assert.equal(by.A.login, "ready");
  assert.equal(by.A.canInspect, true);
  assert.equal(by.B.login, "none");
  assert.equal(by.B.userId, null);
  assert.equal(by.C.canInspect, false);
  assert.equal(by.D.login, "inactive");
});
