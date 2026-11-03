import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { hashResetToken } from "@/lib/server/password-reset-token";

/* 3 Nov 2026: a reset row planted through the anon key must not match, so the hash needs the server's secret. */
test("reset tokens are hashed with a server secret, not a hash anyone can work out", () => {
  const token = "a".repeat(64);
  const before = { secret: process.env.PASSWORD_RESET_SECRET, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  try {
    process.env.PASSWORD_RESET_SECRET = "secret-one";
    const one = hashResetToken(token);
    assert.match(one, /^[0-9a-f]{64}$/);
    assert.equal(hashResetToken(token), one, "the same token hashes the same way, so a real link still works");
    assert.notEqual(one, createHash("sha256").update(`password-reset:${token}`).digest("hex"), "not the old public formula");
    process.env.PASSWORD_RESET_SECRET = "secret-two";
    assert.notEqual(hashResetToken(token), one, "another secret gives another hash");

    delete process.env.PASSWORD_RESET_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    assert.match(hashResetToken(token), /^[0-9a-f]{64}$/, "falls back to the service-role key");
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(() => hashResetToken(token), /must be set/, "refuses to hash with no secret at all");
  } finally {
    if (before.secret === undefined) delete process.env.PASSWORD_RESET_SECRET;
    else process.env.PASSWORD_RESET_SECRET = before.secret;
    if (before.service === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = before.service;
  }
});
