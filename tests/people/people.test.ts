import { test } from "node:test";
import assert from "node:assert/strict";

import { isListedTechnician, pickableOptions } from "@/lib/people/pickable";
import { isPickable } from "@/lib/server/people/pickable-users";
import { keepWhenGoneFromFsm, planTechnicianLinks } from "@/lib/server/people/technician-links";

// DEV-458: hidden accounts.

test("a hidden account is not offered as a new choice", () => {
  const people = [
    { id: "a", hidden_from_lists: false },
    { id: "b", hidden_from_lists: true },
    { id: "c" },
  ];
  assert.deepEqual(pickableOptions(people).map((p) => p.id), ["a", "c"]);
});

test("a hidden account already chosen stays, so saving does not drop it", () => {
  const people = [{ id: "a" }, { id: "b", hidden_from_lists: true }];
  assert.deepEqual(pickableOptions(people, ["b"]).map((p) => p.id), ["a", "b"]);
});

test("server pickers leave out hidden and deactivated accounts alike", () => {
  assert.equal(isPickable({ is_active: true, hidden_from_lists: false }), true);
  assert.equal(isPickable({ is_active: null, hidden_from_lists: null }), true);
  assert.equal(isPickable({ is_active: true, hidden_from_lists: true }), false);
  assert.equal(isPickable({ is_active: false, hidden_from_lists: false }), false);
});

test("the schedule shows a technician only when active and not hidden", () => {
  assert.equal(isListedTechnician({ is_active: true }), true);
  assert.equal(isListedTechnician({ is_active: true, hidden_from_lists: true }), false);
  assert.equal(isListedTechnician({ is_active: false, hidden_from_lists: false }), false);
});

// Technician <-> portal account link.

const tech = (fsmResourceId: string, email: string | null, userProfileId: string | null = null) => ({
  fsmResourceId,
  email,
  userProfileId,
});

test("a technician is linked to the account with the same email, ignoring case and spaces", () => {
  assert.deepEqual(planTechnicianLinks([tech("T1", " Ali@YFI.ae ")], [{ id: "U1", email: "ali@yfi.ae" }]), [
    { fsmResourceId: "T1", userProfileId: "U1" },
  ]);
});

test("an existing link is never overwritten", () => {
  assert.deepEqual(
    planTechnicianLinks([tech("T1", "ali@yfi.ae", "U9")], [{ id: "U1", email: "ali@yfi.ae" }]),
    [],
  );
});

test("an account already linked to another technician is not linked again", () => {
  assert.deepEqual(
    planTechnicianLinks(
      [tech("T1", "old@yfi.ae", "U1"), tech("T2", "ali@yfi.ae")],
      [{ id: "U1", email: "ali@yfi.ae" }],
    ),
    [],
  );
});

test("an ambiguous email links nobody", () => {
  // Two technicians share one email.
  assert.deepEqual(
    planTechnicianLinks([tech("T1", "ali@yfi.ae"), tech("T2", "ALI@yfi.ae")], [{ id: "U1", email: "ali@yfi.ae" }]),
    [],
  );
  // Two accounts share one email.
  assert.deepEqual(
    planTechnicianLinks([tech("T1", "ali@yfi.ae")], [
      { id: "U1", email: "ali@yfi.ae" },
      { id: "U2", email: "Ali@yfi.ae" },
    ]),
    [],
  );
});

test("no email, or no matching account, links nobody", () => {
  assert.deepEqual(planTechnicianLinks([tech("T1", null), tech("T2", "")], [{ id: "U1", email: "" }]), []);
  assert.deepEqual(planTechnicianLinks([tech("T1", "x@yfi.ae")], [{ id: "U1", email: "y@yfi.ae" }]), []);
});

// DEV-457: a leaver survives the FSM sync.

test("a technician with a leaving date or resigned status is kept when gone from FSM", () => {
  assert.equal(keepWhenGoneFromFsm({ employment_status: "resigned", leaving_date: "2026-10-15" }), true);
  assert.equal(keepWhenGoneFromFsm({ employment_status: "active", leaving_date: "2026-11-01" }), true);
  assert.equal(keepWhenGoneFromFsm({ employment_status: "active", leaving_date: null }), false);
  assert.equal(keepWhenGoneFromFsm({}), false);
});
