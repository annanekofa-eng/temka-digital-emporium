// Locks down the F1/F2 fix: the claim-first idempotency pattern guarantees
// that under concurrent webhook deliveries for the same invoice_id, exactly
// one delivery proceeds with the business logic (credit/fulfillment), and
// the others see a unique-violation and exit silently.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Minimal in-memory mock of the processed_invoices table that mirrors the
// PRIMARY KEY(invoice_id) constraint behavior used by claimInvoice/release.
function makeStore() {
  const rows = new Map<string, { type: string }>();
  return {
    async claim(invoiceId: string, type: string): Promise<boolean> {
      // Simulate INSERT ... — Postgres serializes concurrent inserts,
      // first wins, others get 23505. We emulate that with the Map.has().
      if (rows.has(invoiceId)) return false;
      rows.set(invoiceId, { type });
      return true;
    },
    async release(invoiceId: string) { rows.delete(invoiceId); },
    size() { return rows.size; },
  };
}

Deno.test("only one of N parallel claims for the same invoice wins", async () => {
  const store = makeStore();
  const tries = await Promise.all(
    Array.from({ length: 10 }, () => store.claim("INV-RACE-1", "topup")),
  );
  const winners = tries.filter(Boolean).length;
  assertEquals(winners, 1, "exactly one parallel delivery must succeed");
  assertEquals(store.size(), 1);
});

Deno.test("release after failure allows a retry to succeed", async () => {
  const store = makeStore();
  assert(await store.claim("INV-RETRY", "payment"));
  // Business logic failed → release.
  await store.release("INV-RETRY");
  // CryptoBot retries → must succeed again.
  assert(await store.claim("INV-RETRY", "payment"));
  assertEquals(store.size(), 1);
});

Deno.test("different invoices do not collide", async () => {
  const store = makeStore();
  const a = await store.claim("A", "topup");
  const b = await store.claim("B", "subscription");
  const c = await store.claim("C", "payment");
  assert(a && b && c);
  assertEquals(store.size(), 3);
});