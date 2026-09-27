import assert from "node:assert/strict";
import { test } from "node:test";
import { acquireInspectionSlot, admitInspection } from "./rateLimit.ts";

test("limits requests per minute and resets the window", () => {
  const start = Date.now() + 120_000;
  let result;
  for (let i = 0; i < 30; i++) result = admitInspection(start);
  assert.equal(result?.allowed, true);

  const limited = admitInspection(start + 1);
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfterSeconds, 60);

  assert.equal(admitInspection(start + 60_000).allowed, true);
});

test("limits concurrent inspections and releases slots once", () => {
  const releases = Array.from({ length: 3 }, () => acquireInspectionSlot());
  assert.ok(releases.every((release) => release !== null));
  assert.equal(acquireInspectionSlot(), null);

  releases[0]?.();
  releases[0]?.();
  const replacement = acquireInspectionSlot();
  assert.ok(replacement);
  replacement();
  releases.slice(1).forEach((release) => release?.());
});
