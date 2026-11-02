import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FsmBudgetExceededError,
  FsmReadDisabledError,
  FsmWriteRefusedError,
  assertReadOnlyRequest,
  createFsmReader,
  financeFsmReadEnabled,
} from "@/lib/server/finance/fsm-read";

/*
  These tests must never reach Zoho. Every reader below is given a fake
  fetcher that records what it would have sent; nothing here has a token
  for, or a route to, the real FSM.
*/

const ON = { FINANCE_FSM_READ: "on" } as unknown as NodeJS.ProcessEnv;
const OFF = {} as unknown as NodeJS.ProcessEnv;

function recordingFetcher() {
  const sent: { path: string; init: RequestInit }[] = [];
  const fetcher = async (_token: string, path: string, init: RequestInit) => {
    sent.push({ path, init });
    return { ok: true, status: 200, json: { data: [] } };
  };
  return { sent, fetcher };
}

test("the flag is off unless it is exactly 'on'", () => {
  assert.equal(financeFsmReadEnabled(OFF), false);
  assert.equal(financeFsmReadEnabled({ FINANCE_FSM_READ: "true" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(financeFsmReadEnabled({ FINANCE_FSM_READ: "ON" } as unknown as NodeJS.ProcessEnv), false);
  assert.equal(financeFsmReadEnabled(ON), true);
});

test("with the flag off, nothing is sent", async () => {
  const { sent, fetcher } = recordingFetcher();
  const reader = createFsmReader({ token: "t", fetcher, env: OFF });
  await assert.rejects(reader.get("/Work_Orders"), FsmReadDisabledError);
  assert.equal(sent.length, 0);
  assert.equal(reader.calls(), 0);
});

test("a read goes out as an explicit GET with no body", async () => {
  const { sent, fetcher } = recordingFetcher();
  const reader = createFsmReader({ token: "t", fetcher, env: ON });
  await reader.get("/Work_Orders?per_page=200&page=1");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].init.method, "GET");
  assert.equal(sent[0].init.body, undefined);
  assert.equal(sent[0].path, "/Work_Orders?per_page=200&page=1");
});

test("every write method is refused by the guard", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "post", "put"]) {
    assert.throws(
      () => assertReadOnlyRequest("/Work_Orders", { method }),
      FsmWriteRefusedError,
      method,
    );
  }
});

test("a request with no method is refused rather than assumed to be a GET", () => {
  // fetch() defaults a missing method to GET, but the guard does not trust
  // a default: the method has to be stated.
  assert.throws(() => assertReadOnlyRequest("/Work_Orders", {}), FsmWriteRefusedError);
});

test("a body is refused even on a GET", () => {
  assert.throws(
    () => assertReadOnlyRequest("/Work_Orders", { method: "GET", body: "{}" }),
    FsmWriteRefusedError,
  );
});

test("FSM action endpoints are refused whatever the method", () => {
  for (const path of [
    "/Estimates/123/actions/blueprint/transitions",
    "/Service_Appointments/9/actions/reschedule",
    "/Work_Orders/1/actions",
    "/Work_Orders/1/actions?x=1",
  ]) {
    assert.throws(() => assertReadOnlyRequest(path, { method: "GET" }), FsmWriteRefusedError, path);
  }
});

test("a full URL is refused, so the client can only reach the FSM base", () => {
  assert.throws(
    () => assertReadOnlyRequest("https://example.com/steal", { method: "GET" }),
    FsmWriteRefusedError,
  );
});

test("reaching past the type with a cast still cannot send a write", async () => {
  // get() takes a path only. A caller that forces an init through a cast is
  // ignored: the client builds its own GET and never reads a second argument.
  const { sent, fetcher } = recordingFetcher();
  const reader = createFsmReader({ token: "t", fetcher, env: ON });
  const forced = reader.get as unknown as (path: string, init: RequestInit) => Promise<unknown>;
  await forced("/Work_Orders", { method: "POST", body: JSON.stringify({ data: [{}] }) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].init.method, "GET");
  assert.equal(sent[0].init.body, undefined);
});

test("the call budget stops a runaway loop", async () => {
  const { sent, fetcher } = recordingFetcher();
  const reader = createFsmReader({ token: "t", fetcher, env: ON, budget: 3 });
  await reader.get("/Work_Orders?page=1");
  await reader.get("/Work_Orders?page=2");
  await reader.get("/Work_Orders?page=3");
  await assert.rejects(reader.get("/Work_Orders?page=4"), FsmBudgetExceededError);
  assert.equal(sent.length, 3);
  assert.equal(reader.calls(), 3);
});

test("a refused path does not use up the budget", async () => {
  const { fetcher } = recordingFetcher();
  const reader = createFsmReader({ token: "t", fetcher, env: ON, budget: 1 });
  await assert.rejects(reader.get("/X/actions/y"), FsmWriteRefusedError);
  assert.equal(reader.calls(), 0);
  await reader.get("/Work_Orders");
  assert.equal(reader.calls(), 1);
});
