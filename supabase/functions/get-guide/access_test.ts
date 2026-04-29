import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Mirror of plan ranking in index.ts to lock the ordering contract.
const PLAN_RANK: Record<string, number> = { start: 0, basic: 1, premium: 2 };

function hasAccess(userPlan: string | null, required: string): boolean {
  return userPlan !== null && PLAN_RANK[userPlan] >= PLAN_RANK[required];
}

Deno.test("anon (no plan) is denied any guide", () => {
  assertEquals(hasAccess(null, "start"), false);
  assertEquals(hasAccess(null, "basic"), false);
  assertEquals(hasAccess(null, "premium"), false);
});

Deno.test("start plan opens only start", () => {
  assertEquals(hasAccess("start", "start"), true);
  assertEquals(hasAccess("start", "basic"), false);
  assertEquals(hasAccess("start", "premium"), false);
});

Deno.test("basic plan opens start + basic", () => {
  assertEquals(hasAccess("basic", "start"), true);
  assertEquals(hasAccess("basic", "basic"), true);
  assertEquals(hasAccess("basic", "premium"), false);
});

Deno.test("premium plan opens everything", () => {
  assertEquals(hasAccess("premium", "start"), true);
  assertEquals(hasAccess("premium", "basic"), true);
  assertEquals(hasAccess("premium", "premium"), true);
});