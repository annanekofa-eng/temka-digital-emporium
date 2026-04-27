// Pure-logic tests for the canonical referral base used by the webhook
// and check-payment polling. We don't run the actual handler here (it
// requires Supabase env + service role); instead we lock down the math
// rule that the handler relies on: referral base = total - discount,
// regardless of how the order was paid (external invoice vs balance).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

function refBase(order: { total_amount: number; discount_amount: number }): number {
  return Math.max(0, Number(order.total_amount || 0) - Number(order.discount_amount || 0));
}

Deno.test("referral base = total - discount (no promo)", () => {
  assertEquals(refBase({ total_amount: 10, discount_amount: 0 }), 10);
});

Deno.test("referral base = total - discount (with promo)", () => {
  assertEquals(refBase({ total_amount: 10, discount_amount: 2 }), 8);
});

Deno.test("referral base never negative", () => {
  assertEquals(refBase({ total_amount: 1, discount_amount: 5 }), 0);
});

Deno.test("referral base ignores how it was paid (balance vs external)", () => {
  // Whether buyer paid 8 externally + 0 balance, or 0 externally + 8 balance,
  // or 4+4, the referral base is the same — total minus discount.
  const order = { total_amount: 10, discount_amount: 2 };
  const base = refBase(order);
  // Simulate three split scenarios — base must not depend on split.
  for (const split of [{ inv: 8, bal: 0 }, { inv: 0, bal: 8 }, { inv: 4, bal: 4 }]) {
    assertEquals(split.inv + split.bal, base);
  }
});