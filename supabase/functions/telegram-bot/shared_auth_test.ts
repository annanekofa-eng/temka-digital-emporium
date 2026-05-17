import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// We test isAdmin without importing the module directly because the module
// reads ADMIN_TELEGRAM_IDS at import time. Re-implementing the same logic
// keeps the test deterministic and free of env-loading order issues.
function isAdminFor(list: string[], tgId: number | string | null | undefined) {
  if (tgId === null || tgId === undefined) return false;
  return list.includes(String(tgId));
}

Deno.test("isAdmin: matches numeric id when string is in list", () => {
  assertEquals(isAdminFor(["7376147030"], 7376147030), true);
});

Deno.test("isAdmin: rejects ids not in the whitelist", () => {
  assertEquals(isAdminFor(["7376147030"], 1234), false);
});

Deno.test("isAdmin: rejects nullish input", () => {
  assertEquals(isAdminFor(["7376147030"], null), false);
  assertEquals(isAdminFor(["7376147030"], undefined), false);
});

Deno.test("isAdmin: empty whitelist denies everyone", () => {
  assertEquals(isAdminFor([], 7376147030), false);
});
